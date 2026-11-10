import {
  type AgentKind,
  type AgentSettingValues,
  type DirListingDto,
  fieldsFor,
  type ModelMap,
  type OfficialProviderReq,
  type OfficialSettings,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ProviderView,
  type SaveProviderReq,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import {
  Alert,
  Button,
  Checkbox,
  ComboBox,
  Dialog,
  Disclosure,
  Form,
  FormRow,
  GroupBox,
  Link,
  SearchField,
  SecureField,
  Skeleton,
  TextField,
} from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { DirPicker, join } from '../workspaces/DirPicker'
import { envText, fieldTexts, joinProviderEnv, parseEnv, splitEnv, textOf } from './agentSettings'
import { ProviderSettingRows } from './ProviderSettings'

const GROUPS: { key: ProviderPreset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]
const TIERS = ['haiku', 'sonnet', 'opus'] as const
/** The API each agent CLI speaks: 共工 converts nothing, so the provider has to offer it. */
const PROTOCOL: Record<AgentKind, string> = {
  claude: 'Anthropic Messages',
  codex: 'OpenAI Responses',
  gemini: 'Google Gemini',
}
const URL_HINT: Record<AgentKind, string> = {
  claude: 'https://…/anthropic',
  codex: 'https://…/v1',
  gemini: 'https://generativelanguage.googleapis.com',
}
const FORM_ID = 'provider-form'
const OFFICIAL_FORM_ID = 'official-form'

const SMALL_FAST = 'ANTHROPIC_SMALL_FAST_MODEL'

/** 「pp」 for `/Users/me/.pp/`: the name a profile gets until one is typed. */
const profileName = (dir: string) =>
  (
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  ).replace(/^\./, '')

/** Provider-layer settings as controls, the other variables as text; `base` is what each control started from. */
interface EnvFields {
  env: string
  settings: Record<string, string>
  base: AgentSettingValues
}

function envFields(agent: AgentKind, env: Record<string, string>): EnvFields {
  const fields = fieldsFor(agent, 'provider')
  const { values, other } = splitEnv(env, fields)
  return { env: envText(other), settings: fieldTexts(fields, values), base: values }
}

interface Fields extends EnvFields {
  name: string
  configDir: string
  executablePath: string
  baseUrl: string
  apiKey: string
  model: string
  models: Record<(typeof TIERS)[number], string>
  proxy: string
  args: string
}

const fieldsOf = (
  p: Pick<ProviderPreset, 'agent' | 'name' | 'baseUrl' | 'model' | 'models' | 'env'>,
): Fields => ({
  name: p.name,
  configDir: '',
  executablePath: '',
  baseUrl: p.baseUrl,
  apiKey: '',
  model: p.model ?? '',
  models: { haiku: p.models?.haiku ?? '', sonnet: p.models?.sonnet ?? '', opus: p.models?.opus ?? '' },
  ...envFields(p.agent, p.env),
  proxy: '',
  args: '',
})

const empty = (agent: AgentKind) =>
  fieldsOf({ agent, name: '', baseUrl: '', model: null, models: null, env: {} })

/** The other variables' value of `name`, if they parse and set it. */
function otherValue(text: string, name: string) {
  try {
    return parseEnv(text)[name]
  } catch {
    return undefined
  }
}

/** Drops `name`'s line from the other variables. */
const withoutVar = (text: string, name: string) =>
  text
    .split('\n')
    .filter((l) => l.split('=')[0]?.trim() !== name)
    .join('\n')

/**
 * 新增 (vendor first, then only the key) or 编辑 a provider of this machine. The stored key is never shown: it is
 * sent only when typed, so an empty field keeps it.
 */
export function ProviderEditor({
  machineId,
  agent,
  profiles,
  editing,
  onClose,
  onSaved,
}: {
  machineId: string
  agent: AgentKind
  /** The daemon can run a local Claude config directory (`claudeProfile`). */
  profiles: boolean
  /** null = a new provider. */
  editing: ProviderView | null
  onClose: () => void
  onSaved: (saved: ProviderSavedDto, setDefault: boolean) => void
}) {
  const [presets, setPresets] = useState<ProviderPreset[] | null>(null)
  /** undefined while picking the vendor; null = 自定义. */
  const [preset, setPreset] = useState<ProviderPreset | null | undefined>(editing ? null : undefined)
  const [f, setF] = useState<Fields>(
    editing
      ? {
          ...fieldsOf(editing),
          configDir: editing.configDir ?? '',
          executablePath: editing.executablePath ?? '',
          proxy: editing.proxy ?? '',
          args: editing.args.join('\n'),
        }
      : empty(agent),
  )
  const [localProfile, setLocalProfile] = useState(Boolean(editing?.configDir))
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])

  // The home's hidden Claude directories (`~/.claude-work`, `~/.qorz-claude`), not the official login's own
  // `~/.claude`; browsing still reaches any other.
  useEffect(() => {
    if (!localProfile) return
    let live = true
    api.get<DirListingDto>(`/machines/${machineId}/dirs?hidden=1`).then(
      (d) =>
        live &&
        setSuggested(
          d.entries
            .filter((e) => /^\..*claude/i.test(e.name) && e.name !== '.claude')
            .map((e) => join(d.path, e.name)),
        ),
      // Suggestions only: 浏览… shows why the machine cannot be read.
      () => {},
    )
    return () => {
      live = false
    }
  }, [machineId, localProfile])

  useEffect(() => {
    api.get<ProviderPreset[]>(`/machines/${machineId}/providers/presets?agent=${agent}`).then(
      (list) => {
        setPresets(list)
        if (editing?.presetId) setPreset(list.find((p) => p.id === editing.presetId) ?? null)
      },
      (e) => setError(errorText(e)),
    )
  }, [machineId, agent, editing])

  const pick = (p: ProviderPreset | null, profile = false) => {
    setPreset(p)
    setLocalProfile(profile)
    setF(p ? fieldsOf(p) : empty(agent))
    setError(null)
  }
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }))
  const setConfigDir = (configDir: string) =>
    setF((x) => ({
      ...x,
      configDir,
      ...((!x.name.trim() || x.name === profileName(x.configDir)) && { name: profileName(configDir) }),
    }))
  const fields = fieldsFor(agent, 'provider')
  const presetEnv = preset ? envFields(agent, preset.env) : null
  const modelWindow = preset?.modelContext?.[f.model.trim()]
  const restore = (id: string) => {
    const field = fields.find((x) => x.id === id)
    if (!field || !presetEnv) return
    const raw = presetEnv.base[id] ?? ''
    setF((x) => ({
      ...x,
      settings: { ...x.settings, [id]: textOf(field, raw) },
      base: { ...x.base, [id]: raw },
    }))
  }
  // A profile has no model mapping to move it to.
  const smallFast = agent === 'claude' && !localProfile ? otherValue(f.env, SMALL_FAST) : undefined

  const save = async () => {
    if (!f.name.trim()) return setError(t('请填写名称'))
    if (localProfile && !f.configDir.trim()) return setError(t('请填写配置目录'))
    if (!localProfile && !f.baseUrl.trim()) return setError(t('请填写 Base URL'))
    if (!localProfile && !editing && !f.apiKey.trim()) return setError(t('请填写 API Key'))
    let env: Record<string, string>
    try {
      env = joinProviderEnv({ fields, texts: f.settings, initial: f.base, other: f.env, modelWindow })
    } catch (e) {
      return setError((e as Error).message)
    }
    const models: ModelMap = Object.fromEntries(
      TIERS.flatMap((tier) => (f.models[tier].trim() ? [[tier, f.models[tier].trim()]] : [])),
    )
    // A profile's login and models come from its own directory: never send a key or URL a field once held, and
    // clear a model mapping an older editor stored.
    const body: SaveProviderReq = localProfile
      ? {
          agent,
          name: f.name.trim(),
          configDir: f.configDir.trim(),
          executablePath: f.executablePath.trim(),
          model: '',
          models: {},
          env,
          proxy: f.proxy.trim(),
          args: argLines(f.args),
        }
      : {
          agent,
          ...(!editing && preset && { presetId: preset.id }),
          name: f.name.trim(),
          baseUrl: f.baseUrl.trim(),
          ...(f.apiKey.trim() && { apiKey: f.apiKey.trim() }),
          model: f.model.trim(),
          env,
          proxy: f.proxy.trim(),
          ...(agent === 'claude' && { models, args: argLines(f.args) }),
        }
    setSaving(true)
    try {
      const saved = editing
        ? await api.put<ProviderSavedDto>(`/machines/${machineId}/providers/${editing.id}`, body)
        : await api.post<ProviderSavedDto>(`/machines/${machineId}/providers`, body)
      onSaved(saved, setDefault)
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  const title = editing ? t('编辑供应商') : t('新增 {agent} 供应商', { agent: AGENT_LABEL[agent] })
  if (preset === undefined)
    return (
      <Dialog open onClose={onClose} title={title} message={t('选择厂商，之后只需填写 API Key')} width={520}>
        {error ? <p className="mx-danger">{error}</p> : null}
        <VendorPicker
          presets={presets}
          onPick={pick}
          onProfile={agent === 'claude' && profiles ? () => pick(null, true) : undefined}
        />
      </Dialog>
    )

  const keyUrl = preset && (preset.apiKeyUrl ?? preset.websiteUrl)
  const baseUrl = (
    <FormRow label="Base URL">
      <TextField
        aria-label="Base URL"
        value={f.baseUrl}
        onChange={(e) => set({ baseUrl: e.target.value })}
        placeholder={URL_HINT[agent]}
      />
    </FormRow>
  )
  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={title}
      width={560}
      footer={
        editing && preset ? (
          <Button
            variant="plain"
            onClick={() => setF({ ...fieldsOf(preset), apiKey: f.apiKey, proxy: f.proxy, args: f.args })}
          >
            {t('恢复为预设值')}
          </Button>
        ) : undefined
      }
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', type: 'submit', form: FORM_ID, disabled: saving },
      ]}
    >
      <Form id={FORM_ID} aria-label={title} onSubmit={() => void save()}>
        <FormRow label={t('厂商')}>
          <span className="mx-inline">
            <span>{preset ? preset.name : localProfile ? t('该机器 Claude 配置目录') : t('自定义')}</span>
            {editing ? null : (
              <Button size="small" variant="plain" onClick={() => setPreset(undefined)}>
                {t('更换…')}
              </Button>
            )}
          </span>
        </FormRow>
        <FormRow label={t('名称')}>
          <TextField aria-label={t('名称')} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </FormRow>
        {localProfile ? null : (
          <FormRow
            label={t('协议')}
            hint={t('由 {agent} 决定，供应商需提供这种接口', { agent: AGENT_LABEL[agent] })}
          >
            <span>{PROTOCOL[agent]}</span>
          </FormRow>
        )}
        {localProfile ? (
          <>
            <FormRow
              label={t('配置目录')}
              hint={t('Agent 使用该目录自己的登录与 settings.json，可从列表选择或点「浏览…」')}
            >
              <span className="mx-inline mx-field-row">
                <ComboBox
                  aria-label={t('配置目录')}
                  options={suggested}
                  value={f.configDir}
                  placeholder={t('该机器上的绝对路径')}
                  onInput={setConfigDir}
                  onChange={setConfigDir}
                />
                <Button size="small" onClick={() => setBrowsing(true)}>
                  {t('浏览…')}
                </Button>
              </span>
            </FormRow>
            {browsing ? (
              <DirPicker
                machineId={machineId}
                title={t('选择配置目录')}
                start={f.configDir.trim() || null}
                hidden
                hint={t('进入配置目录后选择')}
                onPick={(configDir) => {
                  setConfigDir(configDir)
                  setBrowsing(false)
                }}
                onClose={() => setBrowsing(false)}
              />
            ) : null}
            <FormRow label={t('Claude 可执行文件')} hint={t('可选；留空使用该机器的 Agent 路径')}>
              <TextField
                aria-label={t('Claude 可执行文件')}
                value={f.executablePath}
                onChange={(e) => set({ executablePath: e.target.value })}
              />
            </FormRow>
          </>
        ) : (
          <>
            {preset ? null : baseUrl}
            <FormRow
              label="API Key"
              hint={editing ? t('留空则保留已保存的 Key') : t('Key 只保存在这台机器上')}
            >
              <span className="mx-inline mx-field-row">
                <SecureField
                  aria-label="API Key"
                  autoComplete="off"
                  value={f.apiKey}
                  placeholder={editing ? editing.apiKey : t('必填')}
                  onChange={(e) => set({ apiKey: e.target.value })}
                />
                {keyUrl ? (
                  <Link external href={keyUrl}>
                    {t('获取 Key')}
                  </Link>
                ) : null}
              </span>
            </FormRow>
            <FormRow label={t('模型')} hint={t('可从列表选择，也可直接输入')}>
              <ComboBox
                aria-label={t('模型')}
                options={preset?.modelOptions ?? []}
                value={f.model}
                placeholder={t('默认')}
                onInput={(model) => set({ model })}
                onChange={(model) => set({ model })}
              />
            </FormRow>
          </>
        )}
        {editing ? null : (
          <FormRow>
            <Checkbox label={t('设为该机器默认')} checked={setDefault} onChange={setSetDefault} />
          </FormRow>
        )}
        <FormRow>
          <Disclosure title={t('高级')} open={advanced} onToggle={setAdvanced} />
        </FormRow>
        {advanced ? (
          <>
            {preset ? baseUrl : null}
            {agent === 'claude' && !localProfile
              ? TIERS.map((tier) => (
                  <FormRow
                    key={tier}
                    label={t('{tier} 模型', { tier: `${tier[0]?.toUpperCase()}${tier.slice(1)}` })}
                  >
                    <TextField
                      aria-label={t('{tier} 模型', { tier })}
                      value={f.models[tier]}
                      onChange={(e) => set({ models: { ...f.models, [tier]: e.target.value } })}
                    />
                  </FormRow>
                ))
              : null}
            <ProviderSettingRows
              fields={fields}
              texts={f.settings}
              preset={presetEnv?.settings}
              modelWindow={modelWindow}
              onChange={(id, text) => set({ settings: { ...f.settings, [id]: text } })}
              onRestore={restore}
            />
            <ExtraRows
              proxy={f.proxy}
              env={f.env}
              args={agent === 'claude' ? f.args : undefined}
              envLabel={fields.length ? t('其他环境变量') : t('环境变量')}
              proxyHint={t('Agent 经此代理访问供应商，留空为直连')}
              onChange={set}
            />
            {smallFast !== undefined ? (
              <FormRow>
                <Alert
                  variant="warning"
                  description={t('{name} 已废弃，请改用 Haiku 模型映射', { name: SMALL_FAST })}
                >
                  <Button
                    size="small"
                    onClick={() =>
                      set({
                        env: withoutVar(f.env, SMALL_FAST),
                        models: { ...f.models, haiku: f.models.haiku || smallFast },
                      })
                    }
                  >
                    {t('改用 Haiku 映射')}
                  </Button>
                </Alert>
              </FormRow>
            ) : null}
          </>
        ) : null}
        {error ? (
          <FormRow>
            <span className="mx-danger" role="alert">
              {error}
            </span>
          </FormRow>
        ) : null}
      </Form>
    </Dialog>
  )
}

const argLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** `args`: Claude Code's command-line arguments; undefined for other agents. */
function ExtraRows({
  proxy,
  env,
  args,
  envLabel,
  proxyHint,
  onChange,
}: {
  proxy: string
  env: string
  args?: string
  envLabel: string
  proxyHint: string
  onChange: (patch: { proxy?: string; env?: string; args?: string }) => void
}) {
  return (
    <>
      <FormRow label={t('代理地址')} hint={proxyHint}>
        <TextField
          aria-label={t('代理地址')}
          placeholder="http://127.0.0.1:7890"
          value={proxy}
          onChange={(e) => onChange({ proxy: e.target.value })}
        />
      </FormRow>
      {args === undefined ? null : (
        <FormRow
          label={t('命令行参数')}
          align="top"
          hint={t(
            '启动 Claude Code 时附加，每行一个，如 --settings ~/team.json；--settings 合并进共工的设置，共工管理的参数（权限、模型、会话、MCP 等）不能设置',
          )}
        >
          <TextField
            multiline
            aria-label={t('命令行参数')}
            rows={2}
            placeholder="--settings ~/team.json"
            value={args}
            onChange={(e) => onChange({ args: e.target.value })}
          />
        </FormRow>
      )}
      <FormRow label={envLabel} align="top" hint={t('启动 Agent 时附加，每行一个 KEY=VALUE')}>
        <TextField
          multiline
          aria-label={envLabel}
          rows={3}
          value={env}
          onChange={(e) => onChange({ env: e.target.value })}
        />
      </FormRow>
    </>
  )
}

/** The official login's proxy and extra variables; the CLI's own login and config stay as they are. */
export function OfficialEditor({
  machineId,
  agent,
  official,
  onClose,
  onSaved,
}: {
  machineId: string
  agent: AgentKind
  official: OfficialSettings | undefined
  onClose: () => void
  onSaved: (view: ProviderStoreView) => void
}) {
  const [f, setF] = useState({
    proxy: official?.proxy ?? '',
    args: official?.args.join('\n') ?? '',
    ...envFields(agent, official?.env ?? {}),
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const title = t('{agent} 官方登录设置', { agent: AGENT_LABEL[agent] })
  const fields = fieldsFor(agent, 'provider')

  const save = async () => {
    let env: Record<string, string>
    try {
      env = joinProviderEnv({ fields, texts: f.settings, initial: f.base, other: f.env })
    } catch (e) {
      return setError((e as Error).message)
    }
    const body: OfficialProviderReq = {
      agent,
      env,
      proxy: f.proxy.trim(),
      ...(agent === 'claude' && { args: argLines(f.args) }),
    }
    setSaving(true)
    try {
      onSaved(await api.put<ProviderStoreView>(`/machines/${machineId}/providers/official`, body))
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={title}
      message={t('登录与配置仍用这台机器上 CLI 自己的，以下设置在启动 Agent 时附加')}
      width={560}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', type: 'submit', form: OFFICIAL_FORM_ID, disabled: saving },
      ]}
    >
      <Form id={OFFICIAL_FORM_ID} aria-label={title} onSubmit={() => void save()}>
        <ProviderSettingRows
          fields={fields}
          texts={f.settings}
          onChange={(id, text) => setF((x) => ({ ...x, settings: { ...x.settings, [id]: text } }))}
        />
        <ExtraRows
          proxy={f.proxy}
          env={f.env}
          args={agent === 'claude' ? f.args : undefined}
          envLabel={fields.length ? t('其他环境变量') : t('环境变量')}
          proxyHint={t('Agent 经此代理联网，留空为直连')}
          onChange={(patch) => setF((x) => ({ ...x, ...patch }))}
        />
        {error ? (
          <FormRow>
            <span className="mx-danger" role="alert">
              {error}
            </span>
          </FormRow>
        ) : null}
      </Form>
    </Dialog>
  )
}

function VendorPicker({
  presets,
  onPick,
  onProfile,
}: {
  presets: ProviderPreset[] | null
  onPick: (p: ProviderPreset | null) => void
  /** Offers 该机器 Claude 配置目录; absent when the agent or daemon cannot run one. */
  onProfile?: () => void
}) {
  const [q, setQ] = useState('')
  const text = q.trim().toLowerCase()
  const match = (p: ProviderPreset) => !text || p.name.toLowerCase().includes(text) || p.id.includes(text)
  const row = (key: string, name: string, sub: string, onClick: () => void) => (
    <button key={key} type="button" className="mx-row mx-row--button" onClick={onClick}>
      <span className="mx-row__main">
        <span>{name}</span>
        <span className="mx-sub mx-ellipsis">{sub}</span>
      </span>
    </button>
  )
  return (
    <div className="mx-vendors">
      <SearchField aria-label={t('搜索厂商')} placeholder={t('搜索厂商')} value={q} onChange={setQ} />
      {presets ? null : <Skeleton count={3} />}
      {GROUPS.map((g) => {
        const list = presets?.filter((p) => p.group === g.key && match(p)) ?? []
        return list.length ? (
          <div key={g.key} className="mx-vendors__group">
            <span className="mx-sub">{g.label}</span>
            <GroupBox>{list.map((p) => row(p.id, p.name, p.baseUrl, () => onPick(p)))}</GroupBox>
          </div>
        ) : null
      })}
      <GroupBox>
        {row('custom', t('自定义'), t('手动填写 Base URL'), () => onPick(null))}
        {onProfile
          ? row(
              'profile',
              t('该机器 Claude 配置目录'),
              t('使用机器上另一个 Claude 配置目录自己的登录与设置，无需 API Key'),
              onProfile,
            )
          : null}
      </GroupBox>
    </div>
  )
}
