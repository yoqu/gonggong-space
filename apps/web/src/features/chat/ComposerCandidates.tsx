import type { CommandCandidatesDto, FileCandidatesDto, GroupDto } from '@aiws/protocol'
import { Bot, Cpu, FileText, Folder, type LucideIcon, Terminal, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'

export interface Candidate {
  key: string
  icon: LucideIcon
  label: string
  /** Paths and commands use the mono font. */
  mono: boolean
  hint: string
  /** Replaces the typed `@query` / `/query`. */
  insert: string
}

interface Section {
  label: string
  src: string
  items: Candidate[]
}

const DEBOUNCE_MS = 150

/**
 * The token being completed right before the caret: `@query` anywhere; `/query` as the first word, or right after
 * leading mentions (`@bot /…`).
 */
function trigger(before: string, names: string[]) {
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { char: '@', query: at[1] ?? '' } as const
  let rest = before.trimStart()
  for (
    let n = names.find((x) => rest.startsWith(`@${x}`));
    n;
    n = names.find((x) => rest.startsWith(`@${x}`))
  )
    rest = rest.slice(n.length + 1).trimStart()
  const slash = /^\/(\S*)$/.exec(rest)
  return slash ? ({ char: '/', query: slash[1] ?? '' } as const) : null
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
  if (e.dir) return '文件夹'
  if (e.notInWorkspace) return '该文件不在你的工作区，可能需要拉取'
  return e.uncommitted ? '未提交' : ''
}

/** @ and / candidates of the composer (spec §8.7): grouped, with file sources and agent commands from the server. */
export function useCandidates(group: GroupDto, before: string | null) {
  const bots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const people = [
    ...bots.map((b) => ({ key: `bot:${b.id}`, icon: Bot, name: b.name, hint: b.ownerName })),
    ...group.members.map((m) => ({ key: `member:${m.userId}`, icon: User, name: m.name, hint: '成员' })),
  ]
  const token =
    before === null
      ? null
      : trigger(
          before,
          people.map((p) => p.name),
        )
  // Bots already mentioned, in the order they appear.
  const mentioned = (before === null ? [] : bots)
    .map((b) => ({ b, at: before?.indexOf(`@${b.name}`) ?? -1 }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)
    .map((x) => x.b)
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
  if (!token) return { token, sections: [] as Section[], items: [] as Candidate[] }

  const q = token.query.toLowerCase()
  const has = (s: string) => s.toLowerCase().includes(q)
  const files = remoteFiles?.value
  // Entries of the previous query stay visible while the new one loads, narrowed so a quick Enter can't pick a stale hit.
  const fileEntries = (files?.entries ?? []).filter((e) => remoteFiles?.fresh || has(e.path))
  const sections: Section[] =
    token.char === '@'
      ? [
          {
            label: '成员 / BOT',
            src: '',
            items: people
              .filter((p) => has(p.name))
              .map((p) => ({ ...p, label: p.name, mono: false, insert: `@${p.name}` })),
          },
          {
            label: '文件',
            src: files && files.source !== 'none' ? `来源：${files.label}` : '',
            items: fileEntries.map((e) => ({
              key: `file:${e.path}`,
              icon: e.dir ? Folder : FileText,
              label: e.path,
              mono: true,
              hint: fileHint(e),
              insert: `@${e.path}`,
            })),
          },
        ]
      : [
          {
            label: '系统命令',
            src: '',
            items: (commands?.value.system ?? [])
              .filter((c) => has(c.name))
              .map((c) => ({
                key: `cmd:${c.name}`,
                icon: Terminal,
                label: `/${c.name}`,
                mono: true,
                hint: c.hint,
                insert: `/${c.name}`,
              })),
          },
          {
            label: 'AGENT 命令',
            src: 'ACP 上报',
            items: (commands?.value.agent ?? [])
              .filter((c) => has(c.name))
              .map((c) => ({
                key: `agent:${c.botId}:${c.name}`,
                icon: Cpu,
                label: `/${c.name}`,
                mono: true,
                hint: c.hint,
                insert: `/${c.name}`,
              })),
          },
        ]
  const shown = sections.filter((s) => s.items.length)
  return { token, sections: shown, items: shown.flatMap((s) => s.items) }
}

export function CandidatePopover({
  char,
  sections,
  active,
  onPick,
}: {
  char: '@' | '/'
  sections: Section[]
  active: Candidate | undefined
  onPick: (c: Candidate) => void
}) {
  return (
    <div
      className="mention-pop"
      role="listbox"
      aria-label={char === '/' ? '/ 命令' : '@ 候选'}
      data-testid="composer-popover"
    >
      {sections.map((s) => (
        <fieldset key={s.label} className="mention-pop__group" aria-label={s.label}>
          <div className="mention-pop__label">
            <span>{s.label}</span>
            <span className="mention-pop__src">{s.src}</span>
          </div>
          {s.items.map((c) => (
            <button
              key={c.key}
              type="button"
              role="option"
              aria-selected={active === c}
              // Keyboard navigation through long lists (e.g. every Claude skill) keeps the active item in view.
              ref={active === c ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
              className={cx('mention-pop__item', active === c && 'mention-pop__item--active')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c)}
            >
              <c.icon size={13} className="mention-pop__icon" />
              <span className={cx('mention-pop__name', c.mono && 'mention-pop__mono')}>{c.label}</span>
              <span className="spacer" />
              <span className="mention-pop__hint" title={c.hint}>
                {c.hint}
              </span>
            </button>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
