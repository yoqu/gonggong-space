import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ApiError, errorText } from '../../lib/api'
import {
  Alert,
  AlertDialog,
  Button,
  CloseButton,
  ColorWell,
  ConfirmActionDialog,
  EmptyState,
  Input,
  MenuButton,
  SegmentedControl,
  Select,
  Stepper,
  Tabs,
  Tag,
  Textarea,
  toast,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { ROLE_LABEL } from './DesignSystemNode'
import { frontMatterName, frontMatterValue, renderableMd, SEED_KEY, setFrontMatter } from './designMd'
import {
  applyDesignSystem,
  applyTokens,
  type DesignFiles,
  type DesignSystemPreset,
  designOps,
  invalidTokens,
  loadPresets,
  saveDesign,
} from './designSystem'
import { isHex, type Mode, modeOf, neutralRole, neutralScheme, seedScheme } from './palette'
import { readArtifactFile } from './store'
import { type ColorRole, colorRoles, type DesignTokens, parseTokens } from './tokens'
import './design-system-panel.css'

interface Draft {
  /** The version the draft started from: saving sends it as `baseVersionId`. */
  base: DesignFiles
  files: DesignFiles
  mode: Mode
  seed: string
  /** Saved: dropped once the new version is shown. */
  saved?: boolean
}

const isDirty = (d: Draft | null) =>
  !!d && !d.saved && (d.files.css !== d.base.css || d.files.md !== d.base.md)

const colorsOf = (css: string) =>
  Object.fromEntries(
    parseTokens(css)
      .vars.filter(([k]) => k.startsWith('--color-'))
      .map(([k, v]) => [k.slice('--color-'.length), v]),
  )
const asTokens = (colors: Record<string, string>) =>
  Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--color-${k}`, v]))

/** The version's DESIGN.md: undefined while it loads, null when there is none. */
function useDesignMd(artifactId: string, versionId: string | null, has: boolean) {
  const [md, setMd] = useState<{ versionId: string | null; text: string | null }>({
    versionId: null,
    text: null,
  })
  useEffect(() => {
    if (!versionId || !has) return
    let live = true
    readArtifactFile(artifactId, 'DESIGN.md', versionId).then(
      (text) => live && setMd({ versionId, text }),
      () => live && setMd({ versionId, text: null }),
    )
    return () => {
      live = false
    }
  }, [artifactId, versionId, has])
  if (!versionId) return undefined
  if (!has) return null
  return md.versionId === versionId ? md.text : undefined
}

/** The group's bot to run apply-design-system: the one that made the latest AI version, else the first. */
function useApplyBot(groupId: string | undefined, author: string | null) {
  return useWorkspace((s) => {
    const ids = s.groups.find((g) => g.id === groupId)?.botIds ?? []
    const bots = s.bots.filter((b) => ids.includes(b.id))
    return (bots.find((b) => b.name === author) ?? bots[0]) || null
  })
}

/**
 * The design-system editor of an artifact tab (Stitch capability list §5): the draft lives here so the canvas's
 * design-system node previews it, and so leaving the panel with unsaved changes can ask first.
 */
export function useDesignSystem(o: {
  artifactId: string
  groupId: string | undefined
  /** The shown version; null before the first one. */
  versionId: string | null
  /** The shown version's tokens.css; null while it loads or when it has none. */
  css: string | null
  hasDesignMd: boolean
  readOnly: boolean
  /** The latest AI version's author, to pick the bot for 「保存并让 AI 统一」. */
  author: string | null
}) {
  const md = useDesignMd(o.artifactId, o.versionId, o.hasDesignMd)
  const base = useMemo<DesignFiles | null>(
    () =>
      o.versionId && o.css !== null && md !== undefined ? { versionId: o.versionId, css: o.css, md } : null,
    [o.versionId, o.css, md],
  )
  const [draft, setDraft] = useState<Draft | null>(null)
  const [leaving, setLeaving] = useState<(() => void) | null>(null)
  const bot = useApplyBot(o.groupId, o.author)
  const dirty = isDirty(draft)

  // A new version drops a clean (or just saved) draft; a dirty one stays to be saved or discarded.
  useEffect(() => {
    setDraft((d) => (d && d.base.versionId !== base?.versionId && !isDirty(d) ? null : d))
  }, [base?.versionId])

  const shown =
    draft?.files ?? (o.css !== null ? { versionId: o.versionId ?? '', css: o.css, md: md ?? null } : null)
  const tokens = useMemo<DesignTokens | null>(
    () => (shown ? { ...parseTokens(shown.css), name: frontMatterName(shown.md) } : null),
    [shown],
  )

  return {
    tokens,
    /** The shown DESIGN.md (the draft's while editing); null when there is none or while it loads. */
    md: shown?.md ?? null,
    dirty,
    /** Runs `proceed` now, or after the member agrees to drop the unsaved changes. */
    guard: (proceed: () => void) => (isDirty(draft) ? setLeaving(() => proceed) : proceed()),
    panel: (close: () => void, tab: DesignTab = 'theme') => (
      <DesignSystemPanel
        key={tab}
        initialTab={tab}
        artifactId={o.artifactId}
        base={base}
        loading={o.css !== null && !base}
        draft={draft}
        setDraft={setDraft}
        readOnly={o.readOnly}
        bot={bot}
        onClose={close}
      />
    ),
    dialog: leaving ? (
      <AlertDialog
        open
        title={t('放弃未保存的设计系统改动？')}
        message={t('关闭后这些改动会丢失。')}
        onClose={() => setLeaving(null)}
        actions={[
          { label: t('继续编辑'), onClick: () => setLeaving(null) },
          {
            label: t('放弃改动'),
            variant: 'destructive',
            onClick: () => {
              setDraft(null)
              setLeaving(null)
              leaving()
            },
          },
        ]}
      />
    ) : null,
  }
}

const FONT_STACKS = [
  {
    label: 'PingFang SC',
    value:
      '"PingFang SC", -apple-system, "Helvetica Neue", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  {
    label: t('思源黑体 Source Han Sans'),
    value: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", sans-serif',
  },
  { label: 'HarmonyOS Sans', value: '"HarmonyOS Sans SC", "HarmonyOS Sans", "PingFang SC", sans-serif' },
  {
    label: t('系统默认'),
    value: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  { label: t('思源宋体（衬线）'), value: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif' },
]
const CUSTOM = 'custom'
const squash = (v: string) => v.replace(/\s+/g, ' ').trim()

/** Colours a role shows before its 「+n」. */
const ROLE_PREVIEW = 3

const NUMBER = /^(-?\d*\.?\d+)([a-z%]*)$/i

export type DesignTab = 'theme' | 'md'

function DesignSystemPanel({
  initialTab,
  artifactId,
  base,
  loading,
  draft,
  setDraft,
  readOnly,
  bot,
  onClose,
}: {
  initialTab: DesignTab
  artifactId: string
  base: DesignFiles | null
  loading: boolean
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  readOnly: boolean
  bot: { id: string; name: string } | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<DesignTab>(initialTab)
  const [expanded, setExpanded] = useState<ColorRole[]>([])
  const [presets, setPresets] = useState<DesignSystemPreset[]>([])
  const [preset, setPreset] = useState<DesignSystemPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null)

  useEffect(() => {
    let live = true
    loadPresets(artifactId).then(
      (list) => live && setPresets(list),
      () => {},
    )
    return () => {
      live = false
    }
  }, [artifactId])

  const header = (title: ReactNode) => (
    <header className="art-panel__head">
      {title}
      <CloseButton onClick={onClose} />
    </header>
  )
  if (!base)
    return (
      <aside className="art-panel art-panel--wide" aria-label={t('设计系统')}>
        {header(<h3>{t('设计系统')}</h3>)}
        <div className="art-panel__body">
          {loading ? null : (
            <EmptyState
              compact
              icon="palette"
              title={t('这个产物没有设计系统')}
              description={t('套用插件的设计系统，或让 AI 生成 tokens.css')}
            />
          )}
        </div>
      </aside>
    )

  const files = draft?.files ?? base
  const tk = parseTokens(files.css)
  const baseColors = colorsOf(base.css)
  const colors = colorsOf(files.css)
  const baseMode = modeOf(baseColors)
  const mode = draft?.mode ?? baseMode
  const savedSeed = frontMatterValue(base.md, SEED_KEY)
  const seed =
    draft?.seed ??
    (isHex(savedSeed)
      ? savedSeed
      : isHex(baseColors.primary ?? '')
        ? (baseColors.primary as string)
        : '#0088ff')
  const invalid = invalidTokens(files.css)
  const dirty = isDirty(draft)
  const locked = readOnly || busy

  const update = (next: Partial<Omit<Draft, 'base'>>) =>
    setDraft({ base, files, mode, seed, ...draft, saved: false, ...next })
  const setTokens = (changes: Record<string, string>) => update({ files: applyTokens(files, changes) })
  const setMode = (m: Mode) => {
    const neutrals = Object.fromEntries(Object.entries(baseColors).filter(([k]) => neutralRole(k)))
    setDraft({
      base,
      files: applyTokens(files, asTokens(m === baseMode ? neutrals : neutralScheme(seed, m, baseColors))),
      mode: m,
      seed,
    })
  }
  const derived = seedScheme(seed, mode)
  /**
   * A valid seed re-derives its colours at once (Stitch's Seed Color): the primary roles, and in a derived mode the
   * neutrals too. Only colours still at their saved value or at the previous seed's derivation follow; ones the member
   * set by hand stay.
   */
  const setSeed = (next: string) => {
    if (!isHex(next)) return update({ seed: next })
    const prev = isHex(seed) ? seed : next
    const derive = (c: string) => ({
      ...seedScheme(c, mode),
      ...(mode === baseMode ? {} : neutralScheme(c, mode, baseColors)),
    })
    const before = derive(prev)
    const same = (a: string | undefined, b: string | undefined) => !!a && a.toLowerCase() === b?.toLowerCase()
    const changes = Object.fromEntries(
      Object.entries(derive(next)).filter(
        ([k]) => k in colors && (same(colors[k], baseColors[k]) || same(colors[k], before[k])),
      ),
    )
    const derived = applyTokens(files, asTokens(changes))
    // Kept in DESIGN.md: reopened, the panel shows the seed picked, not the primary it derived.
    update({
      seed: next,
      files: derived.md === null ? derived : { ...derived, md: setFrontMatter(derived.md, [SEED_KEY], next) },
    })
  }

  const fail = (e: unknown) =>
    setError({
      text:
        e instanceof ApiError && e.status === 409
          ? t('产物已有新版本，或 AI 正在修改，改动没有保存。可以放弃改动后重新编辑。')
          : errorText(e),
      conflict: e instanceof ApiError && e.status === 409,
    })
  const save = async (andApply: boolean) => {
    setBusy(true)
    setError(null)
    const ops = designOps(base, files)
    try {
      if (ops.length) {
        await saveDesign(artifactId, (draft?.base ?? base).versionId, ops)
        if (draft) setDraft({ ...draft, saved: true })
      }
      if (andApply && bot) {
        await applyDesignSystem(artifactId, bot.id)
        toast({ type: 'success', message: t('已让 {bot} 按设计系统统一所有屏幕', { bot: bot.name }) })
      } else toast({ type: 'success', message: t('设计系统已保存') })
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }

  const name = frontMatterName(files.md)
  const fontVars = tk.vars.filter(([k]) => k.startsWith('--font-'))

  return (
    <aside className="art-panel art-panel--wide art-dsp" aria-label={t('设计系统')}>
      {header(
        <>
          <Input
            className="art-dsp__name"
            aria-label={t('设计系统名称')}
            placeholder={t('未命名设计系统')}
            value={name}
            disabled={locked}
            onChange={(e) =>
              update({ files: { ...files, md: setFrontMatter(files.md ?? '', ['name'], e.target.value) } })
            }
          />
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--small"
            aria-label={t('预设')}
            disabled={locked || !presets.length}
            align="end"
            items={presets.map((p) => ({
              label: p.title,
              value: p.id,
              title: p.description,
              icon: (
                <span className="art-dsp__chips">
                  {p.swatches.slice(0, 4).map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
              ),
            }))}
            onSelect={(id) => setPreset(presets.find((p) => p.id === id) ?? null)}
          >
            {t('预设')}
          </MenuButton>
        </>,
      )}
      <div className="art-dsp__tabs">
        <Tabs
          aria-label={t('设计系统')}
          items={[
            { value: 'theme', label: t('主题') },
            { value: 'md', label: 'DESIGN.md' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {readOnly ? <p className="art-dsp__note">{t('AI 修改中或查看历史版本时只读')}</p> : null}
      <div className="art-panel__body art-dsp__body">
        {tab === 'theme' ? (
          <>
            <Section
              title={t('模式')}
              extra={
                mode !== baseMode ? (
                  <Tag tone="blue" icon="sparkle">
                    {t('推导')}
                  </Tag>
                ) : null
              }
            >
              <SegmentedControl<Mode>
                aria-label={t('模式')}
                items={[
                  { value: 'light', label: t('浅色'), icon: 'sun', disabled: locked },
                  { value: 'dark', label: t('深色'), icon: 'moon', disabled: locked },
                ]}
                value={mode}
                onChange={setMode}
              />
              {mode !== baseMode ? (
                <p className="art-dsp__hint">{t('背景、表面、文字与描边色由种子色推导，可再逐项调整')}</p>
              ) : null}
            </Section>

            <Section title={t('种子色')}>
              <div className="art-dsp__seed">
                <ColorWell aria-label={t('种子色')} value={seed} onChange={(c) => !locked && setSeed(c)} />
                <Input
                  mono
                  aria-label={t('种子色十六进制')}
                  value={seed}
                  disabled={locked}
                  invalid={!isHex(seed)}
                  onChange={(e) => setSeed(e.target.value.trim())}
                />
              </div>
              <div className="art-dsp__derived" title={t('推导出的主色')}>
                {Object.entries(derived).map(([k, v]) => (
                  <span key={k} title={`${k} ${v}`} className={k in colors ? '' : 'art-dsp__derived--unused'}>
                    <i style={{ background: v }} />
                    {k}
                  </span>
                ))}
              </div>
              <p className="art-dsp__hint">{t('改种子色即重新推导主色；手动改过的颜色保持不变')}</p>
            </Section>

            <Section title={t('色板')}>
              {colorRoles(Object.entries(colors).map(([name, value]) => ({ name, value }))).map((g) => {
                const all = expanded.includes(g.role)
                const extra = g.items.length - ROLE_PREVIEW
                return (
                  <div key={g.role} className="art-dsp__role" data-testid={`art-dsp-role-${g.role}`}>
                    <div className="art-dsp__rolehead">
                      <span>{ROLE_LABEL[g.role]}</span>
                      {extra > 0 ? (
                        <button
                          type="button"
                          className="art-dsp__more"
                          aria-expanded={all}
                          onClick={() =>
                            setExpanded((x) => (all ? x.filter((r) => r !== g.role) : [...x, g.role]))
                          }
                        >
                          {all ? t('收起') : `+${extra}`}
                        </button>
                      ) : null}
                    </div>
                    <ul className="art-dsp__list">
                      {(all ? g.items : g.items.slice(0, ROLE_PREVIEW)).map(({ name: k, value: v }) => (
                        <li key={k} className="art-dsp__color">
                          {isHex(v) ? (
                            <ColorWell
                              aria-label={k}
                              value={v}
                              onChange={(c) => !locked && setTokens({ [`--color-${k}`]: c })}
                            />
                          ) : (
                            <span className="art-dsp__swatch" style={{ background: v }} />
                          )}
                          <span className="art-dsp__label">{k}</span>
                          <TokenInput
                            name={`--color-${k}`}
                            value={v}
                            invalid={invalid}
                            locked={locked}
                            onSet={setTokens}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </Section>

            {fontVars.length || tk.type.length ? (
              <Section title={t('字体')}>
                {fontVars.map(([k, v]) => {
                  const stack = FONT_STACKS.find((f) => squash(f.value) === squash(v))
                  return (
                    <div key={k} className="art-dsp__font">
                      <span className="art-dsp__label">{k.slice('--font-'.length)}</span>
                      <Select
                        label={t('{name} 字体', { name: k })}
                        disabled={locked}
                        options={[...FONT_STACKS, { label: t('自定义'), value: CUSTOM }]}
                        value={stack?.value ?? CUSTOM}
                        onChange={(next) => next !== CUSTOM && setTokens({ [k]: next })}
                      />
                      {stack ? null : (
                        <TokenInput
                          name={k}
                          value={v}
                          invalid={invalid}
                          locked={locked}
                          onSet={setTokens}
                          wide
                        />
                      )}
                    </div>
                  )
                })}
                {tk.type.length ? (
                  <table className="art-dsp__type">
                    <thead>
                      <tr>
                        <th>{t('样式')}</th>
                        <th>{t('字号')}</th>
                        <th>{t('字重')}</th>
                        <th>{t('行高')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tk.type.map((s) => (
                        <tr key={s.name}>
                          <td title={`.t-${s.name}`}>{s.name}</td>
                          {(['size', 'weight', 'leading'] as const).map((f) => (
                            <td key={f}>
                              {s[f] ? (
                                <NumberToken
                                  name={`--text-${s.name}-${f}`}
                                  value={s[f]}
                                  step={f === 'weight' ? 100 : 1}
                                  min={f === 'weight' ? 100 : 0}
                                  max={f === 'weight' ? 900 : 200}
                                  invalid={invalid}
                                  locked={locked}
                                  onSet={setTokens}
                                />
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </Section>
            ) : null}

            {tk.radii.length || tk.spacing.length ? (
              <Section title={t('圆角与间距')}>
                <div className="art-dsp__scales">
                  {[
                    ...tk.radii.map((r) => ({ ...r, token: `--rounded-${r.name}`, kind: t('圆角') })),
                    ...tk.spacing.map((r) => ({ ...r, token: `--space-${r.name}`, kind: t('间距') })),
                  ].map((r) => (
                    <div key={r.token} className="art-dsp__scale">
                      <span className="art-dsp__label" title={r.token}>
                        <small>{r.kind}</small>
                        {r.name}
                      </span>
                      <NumberToken
                        name={r.token}
                        value={r.value}
                        min={0}
                        max={9999}
                        invalid={invalid}
                        locked={locked}
                        onSet={setTokens}
                      />
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
          </>
        ) : readOnly ? (
          <div className="art-dsp__md">
            {files.md ? <Markdown text={renderableMd(files.md)} /> : <p>{t('没有 DESIGN.md')}</p>}
          </div>
        ) : (
          <Textarea
            className="art-dsp__source"
            aria-label="DESIGN.md"
            spellCheck={false}
            placeholder={t('还没有 DESIGN.md，保存后创建')}
            value={files.md ?? ''}
            disabled={busy}
            onChange={(e) => update({ files: { ...files, md: e.target.value } })}
          />
        )}
      </div>
      <footer className="art-dsp__foot">
        {error ? (
          <Alert variant="error" description={error.text}>
            {error.conflict ? (
              <Button
                size="small"
                onClick={() => {
                  setDraft(null)
                  setError(null)
                }}
              >
                {t('放弃改动')}
              </Button>
            ) : null}
          </Alert>
        ) : invalid.length ? (
          <Alert variant="warning" description={t('{names} 的值不合法', { names: invalid.join('、') })} />
        ) : null}
        <div className="art-dsp__actions">
          <Button disabled={locked || !dirty || !!invalid.length} onClick={() => void save(false)}>
            {t('保存')}
          </Button>
          <Button
            variant="primary"
            icon="sparkle"
            disabled={locked || !bot || !!invalid.length}
            title={bot ? t('保存后让 {bot} 按设计系统统一所有屏幕', { bot: bot.name }) : t('群里没有 Bot')}
            onClick={() => void save(true)}
          >
            {t('保存并让 AI 统一')}
          </Button>
        </div>
      </footer>
      {preset ? (
        <ConfirmActionDialog
          title={t('套用预设「{name}」？', { name: preset.title })}
          message={t('套用预设会覆盖当前主题')}
          consequences={[t('DESIGN.md 与 tokens.css 换成预设的内容，生成一个新版本'), t('可以用撤销恢复')]}
          label={t('套用')}
          done={t('已套用预设')}
          run={async () => {
            await saveDesign(artifactId, base.versionId, [{ kind: 'design-system', id: preset.id }])
            setDraft(null)
          }}
          onClose={() => setPreset(null)}
        />
      ) : null}
    </aside>
  )
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="art-dsp__section">
      <h4 className="art-panel__label">
        {title}
        {extra}
      </h4>
      {children}
    </section>
  )
}

interface TokenFieldProps {
  name: string
  value: string
  invalid: string[]
  locked: boolean
  onSet: (changes: Record<string, string>) => void
}

function TokenInput({ name, value, invalid, locked, onSet, wide }: TokenFieldProps & { wide?: boolean }) {
  return (
    <Input
      mono
      className={wide ? 'art-dsp__value art-dsp__value--wide' : 'art-dsp__value'}
      aria-label={t('{name} 的值', { name })}
      value={value}
      disabled={locked}
      invalid={invalid.includes(name)}
      onChange={(e) => onSet({ [name]: e.target.value })}
    />
  )
}

/** A numeric token keeps its unit (`16px`, `1.4`, `600`); anything else is edited as text. */
function NumberToken({
  step = 1,
  min,
  max,
  ...p
}: TokenFieldProps & { step?: number; min: number; max: number }) {
  const m = NUMBER.exec(p.value.trim())
  if (!m) return <TokenInput {...p} />
  const unit = m[2] ?? ''
  const decimals = (m[1]?.split('.')[1] ?? '').length
  return (
    <Stepper
      aria-label={t('{name} 的值', { name: p.name })}
      value={Number(m[1])}
      step={decimals ? 10 ** -decimals : step}
      min={min}
      max={max}
      unit={unit || undefined}
      width={52}
      disabled={p.locked}
      onChange={(n) => p.onSet({ [p.name]: `${n}${unit}` })}
    />
  )
}
