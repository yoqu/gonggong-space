import type { CommandCandidatesDto, FileCandidatesDto, GroupDto, GroupPluginDto } from '@gonggong/protocol'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Avatar, Icon, type IconName } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { PRESENCE } from '../bots/model'
import { CATEGORY } from '../plugins/model'

export interface Candidate {
  key: string
  icon: IconName
  label: string
  /** Paths and commands use the mono font. */
  mono: boolean
  hint: string
  /** Replaces the typed `@query` / `/query`. */
  insert: string
  /** Bots only: presence dot + text. */
  status?: { label: string; color: string }
  /** A skill: agents read its mention anywhere, so it is inserted where typed (commands move to the head). */
  skill?: boolean
  /** A plugin enabled in the group: picking it opens the 创作 panel instead of inserting text. */
  plugin?: string
}

interface Section {
  label: string
  src: string
  items: Candidate[]
}

const DEBOUNCE_MS = 150

/** Where a command goes: after leading whitespace and mentions (`@bot /…`). */
function headOf(text: string, names: string[]) {
  let i = text.length - text.trimStart().length
  const ordered = [...names].sort((a, b) => b.length - a.length)
  for (
    let n = ordered.find((x) => text.startsWith(`@${x}`, i));
    n;
    n = ordered.find((x) => text.startsWith(`@${x}`, i))
  )
    i +=
      n.length + 1 + (text.slice(i + n.length + 1).length - text.slice(i + n.length + 1).trimStart().length)
  return i
}

/**
 * The token being completed right before the caret: `@query` anywhere; `/query` at the head (first word, or right
 * after leading mentions), or `mid` sentence after a space while the message has no command yet. A `/` inside a word
 * (paths, URLs, `1/2`) never triggers.
 */
export function trigger(before: string, names: string[]) {
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { char: '@', query: at[1] ?? '' } as const
  const head = before.slice(headOf(before, names))
  const first = /^\/(\S*)$/.exec(head)
  if (first) return { char: '/', query: first[1] ?? '', mid: false } as const
  const mid = /\s\/([^\s/]*)$/.exec(head)
  return mid && !head.startsWith('/') ? ({ char: '/', query: mid[1] ?? '', mid: true } as const) : null
}

/** A command picked mid-sentence moves to the head (the server and agents only read it there); the rest stays its text. */
export function placeCommand(draft: string, caret: number, command: string, names: string[]) {
  const start = draft.slice(0, caret).lastIndexOf('/')
  let rest = draft.slice(0, start) + draft.slice(caret)
  if (rest[start - 1] === ' ' && rest[start] === ' ') rest = rest.slice(0, start) + rest.slice(start + 1)
  const head = headOf(rest, names)
  const insert = `${command} `
  return { next: rest.slice(0, head) + insert + rest.slice(head), pos: start + insert.length }
}

/** Latest answer (debounced); the previous one stays while the next loads, flagged not `fresh`. */
function useRemote<T>(path: string | null) {
  const [data, setData] = useState<{ path: string; value: T } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    const timer = setTimeout(() => {
      api.get<T>(path).then(
        (value) => live && setData({ path, value }),
        // Candidates are a convenience: a failed lookup just leaves that group out.
        () => {},
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [path])
  return data && { value: data.value, fresh: data.path === path }
}

function fileHint(e: FileCandidatesDto['entries'][number]) {
  if (e.dir) return t('文件夹')
  if (e.notInWorkspace) return t('该文件不在你的工作区，可能需要拉取')
  return e.uncommitted ? t('未提交') : ''
}

/** @ and / candidates of the composer (spec §8.7): grouped, with file sources and agent commands from the server. */
export function useCandidates(group: GroupDto, before: string | null, plugins: GroupPluginDto[] = []) {
  const bots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const people = [
    ...bots.map((b) => ({
      key: `bot:${b.id}`,
      icon: 'bot' as const,
      name: b.name,
      hint: b.ownerName,
      status: PRESENCE[b.presence],
    })),
    ...group.members.map((m) => ({
      key: `member:${m.userId}`,
      icon: 'person' as const,
      name: m.name,
      hint: t('成员'),
    })),
  ]
  const names = people.map((p) => p.name)
  const token = before === null ? null : trigger(before, names)
  // Bots already mentioned, in the order they appear.
  const mentioned = (before === null ? [] : bots)
    .map((b) => ({ b, at: before?.indexOf(`@${b.name}`) ?? -1 }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)
    .map((x) => x.b)
  // A dm with a single bot needs no @: its commands and workspace files are offered right away.
  if (!mentioned.length && group.kind === 'dm' && bots.length === 1) mentioned.push(...bots)
  // Codex mentions skills as `$name` (a leading `/name` is its own command); Claude reads `/name` anywhere.
  const sigil = mentioned.length && mentioned.every((b) => b.agentKind === 'codex') ? '$' : '/'
  const base = `/groups/${group.id}/candidates`
  const remoteFiles = useRemote<FileCandidatesDto>(
    token?.char === '@'
      ? `${base}/files?q=${encodeURIComponent(token.query)}${mentioned[0] ? `&botId=${mentioned[0].id}` : ''}`
      : null,
  )
  const commands = useRemote<CommandCandidatesDto>(
    token?.char === '/'
      ? `${base}/commands${mentioned.length ? `?botId=${mentioned.map((b) => b.id).join(',')}` : ''}`
      : null,
  )
  if (!token) return { token, names, sections: [] as Section[], items: [] as Candidate[] }

  const q = token.query.toLowerCase()
  const has = (s: string) => s.toLowerCase().includes(q)
  const files = remoteFiles?.value
  // Entries of the previous query stay visible while the new one loads, narrowed so a quick Enter can't pick a stale hit.
  const fileEntries = (files?.entries ?? []).filter((e) => remoteFiles?.fresh || has(e.path))
  const sections: Section[] =
    token.char === '@'
      ? [
          {
            label: t('成员 / Bot'),
            src: '',
            items: people
              .filter((p) => has(p.name))
              .map((p) => ({ ...p, label: p.name, mono: false, insert: `@${p.name}` })),
          },
          {
            label: t('文件'),
            src: files && files.source !== 'none' ? t('来源：{source}', { source: files.label }) : '',
            items: fileEntries.map((e) => ({
              key: `file:${e.path}`,
              icon: e.dir ? 'folder' : 'doc-text',
              label: e.path,
              mono: true,
              hint: fileHint(e),
              insert: `@${e.path}`,
            })),
          },
        ]
      : [
          {
            label: t('系统命令'),
            src: '',
            items: (commands?.value.system ?? [])
              .filter((c) => has(c.name))
              .map((c) => ({
                key: `cmd:${c.name}`,
                icon: 'terminal',
                label: `/${c.name}`,
                mono: true,
                hint: c.hint,
                insert: `/${c.name}`,
              })),
          },
          {
            label: t('插件'),
            src: '',
            items: plugins
              .filter((p) => has(p.manifest.title) || has(p.manifest.name))
              .map((p) => ({
                key: `plugin:${p.id}`,
                icon: CATEGORY[p.manifest.category].icon,
                label: p.manifest.title,
                mono: false,
                hint: t('打开创作面板'),
                insert: '',
                plugin: p.id,
              })),
          },
          {
            label: t('团队 Skill'),
            src: t('配置中心'),
            items: (commands?.value.skill ?? [])
              .filter((c) => has(c.name))
              .map((c) => ({
                key: `skill:${c.name}`,
                icon: 'star',
                label: `/${c.name}`,
                mono: true,
                hint: c.hint,
                insert: `${sigil}${c.name}`,
                skill: true,
              })),
          },
          {
            label: t('AGENT 命令'),
            src: t('ACP 上报'),
            items: (commands?.value.agent ?? [])
              .filter((c) => has(c.name))
              .map((c) => ({
                key: `agent:${c.botId}:${c.name}`,
                icon: 'cpu',
                label: c.name.startsWith('$') ? c.name : `/${c.name}`,
                mono: true,
                hint: c.hint,
                // Codex reports its skills as `$name`.
                ...(c.name.startsWith('$') ? { insert: c.name, skill: true } : { insert: `/${c.name}` }),
              })),
          },
        ]
  const shown = sections.filter((s) => s.items.length)
  return { token, names, sections: shown, items: shown.flatMap((s) => s.items) }
}

/** People (members and Bots) show their avatar; files and commands a glyph tile. */
function Lead({ c }: { c: Candidate }) {
  return c.icon === 'bot' || c.icon === 'person' ? (
    <span aria-hidden="true" className="mention-pop__lead">
      {c.icon === 'bot' ? <BotAvatar name={c.label} size={24} /> : <Avatar name={c.label} size={24} />}
    </span>
  ) : (
    <span aria-hidden="true" className="mention-pop__lead mention-pop__tile">
      <Icon name={c.icon} size={14} />
    </span>
  )
}

const POP_MAX = 360
const POP_MIN = 120
const POP_GAP = 8

/**
 * Height the upward popover may take: up to the top of what is visible, which on a phone is the visual viewport the
 * keyboard leaves, not the layout viewport.
 */
function useRoomAbove(ref: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState(POP_MAX)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const vv = window.visualViewport
    const measure = () => {
      const top = vv?.offsetTop ?? 0
      setRoom(Math.max(POP_MIN, Math.min(POP_MAX, el.getBoundingClientRect().bottom - top - POP_GAP)))
    }
    measure()
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    return () => {
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
    }
  }, [ref])
  return room
}

/** The @ / candidates on the Pane MentionPicker: glass list, section heads, avatar rows, highlight on the active row. */
export function CandidatePopover({
  id,
  char,
  sections,
  active,
  onPick,
}: {
  /** Options get `${id}-${index}` ids for the textarea's aria-activedescendant. */
  id: string
  char: '@' | '/'
  sections: Section[]
  active: Candidate | undefined
  onPick: (c: Candidate) => void
}) {
  const flat = sections.flatMap((s) => s.items)
  const list = useRef<HTMLDivElement>(null)
  const maxHeight = useRoomAbove(list)
  // Scrolls the list only: scrollIntoView would also scroll the page, which a mobile keyboard has already shifted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the highlight moves or the list resizes
  useLayoutEffect(() => {
    const el = list.current
    const row = el?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!el || !row) return
    const bottom = row.offsetTop + row.offsetHeight
    if (row.offsetTop < el.scrollTop) el.scrollTop = row.offsetTop
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [active, maxHeight])
  return (
    <div
      ref={list}
      id={id}
      style={{ maxHeight }}
      className="pn-mentionpicker mention-pop"
      role="listbox"
      aria-label={char === '/' ? t('/ 命令') : t('@ 候选')}
      data-testid="composer-popover"
    >
      {sections.map((s) => (
        <fieldset key={s.label} className="mention-pop__group" aria-label={s.label}>
          <div className="pn-mentionpicker__head mention-pop__head">
            <span>{s.label}</span>
            <span className="mention-pop__src">{s.src}</span>
          </div>
          {s.items.map((c) => (
            <button
              key={c.key}
              id={`${id}-${flat.indexOf(c)}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={active === c}
              className="pn-mentionpicker__item mention-pop__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c)}
            >
              <Lead c={c} />
              <span className={cx('pn-mentionpicker__name', c.mono && 'mention-pop__mono')} title={c.label}>
                {c.label}
              </span>
              {c.status ? (
                <span className="pn-mentionpicker__sub mention-pop__status">
                  <span className="mention-pop__dot" style={{ background: c.status.color }} />
                  {c.status.label}
                </span>
              ) : null}
              <span className="pn-mentionpicker__sub mention-pop__hint" title={c.hint}>
                {c.hint}
              </span>
            </button>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
