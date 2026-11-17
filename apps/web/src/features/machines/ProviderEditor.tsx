import {
  AGENT_KINDS,
  AGENT_META,
  type AgentKind,
  type AgentSettingValues,
  API_PROTOCOLS,
  type ApiProtocol,
  agentMeta,
  agentTakes,
  clientRunsAgent,
  type EndpointInput,
  fieldsFor,
  type ModelMap,
  type OfficialProviderReq,
  type OfficialSettings,
  type PresetEndpoint,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ProviderView,
  type SaveProviderReq,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import {
  Alert,
  Button,
  Checkbox,
  ComboBox,
  Dialog,
  Disclosure,
  Divider,
  Form,
  FormRow,
  GroupBox,
  Link,
  SearchField,
  SecureField,
  Skeleton,
  Tag,
  TextField,
} from '../../ui'
import { PROTOCOL_AGENT, PROTOCOL_LABEL } from '../agents/model'
import type { AgentsSource } from '../agents/source'
import { envText, fieldTexts, joinProviderEnv, parseEnv, splitEnv, textOf } from './agentSettings'
import { ProviderSettingRows } from './ProviderSettings'

const GROUPS: { key: ProviderPreset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]
const TIERS = ['haiku', 'sonnet', 'opus'] as const
const URL_HINT: Record<ApiProtocol, string> = {
  anthropic: 'https://…/anthropic',
  openai: 'https://…/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  codebuddy: 'https://copilot.tencent.com',
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

const settingFields = (protocol: ApiProtocol) => fieldsFor(PROTOCOL_AGENT[protocol], 'provider')

function envFields(protocol: ApiProtocol, env: Record<string, string>): EnvFields {
  const fields = settingFields(protocol)
  const { values, other } = splitEnv(env, fields)
  return { env: envText(other), settings: fieldTexts(fields, values), base: values }
}

/** One protocol of the provider being edited. */
interface EndpointFields extends EnvFields {
  protocol: ApiProtocol
  baseUrl: string
  model: string
  models: Record<(typeof TIERS)[number], string>
  args: string
}

type EndpointLike = Pick<PresetEndpoint, 'protocol' | 'baseUrl' | 'model' | 'models' | 'env'> & {
  args?: string[]
}

const endpointFields = (e: EndpointLike): EndpointFields => ({
  protocol: e.protocol,
  baseUrl: e.baseUrl,
  model: e.model ?? '',
  models: { haiku: e.models?.haiku ?? '', sonnet: e.models?.sonnet ?? '', opus: e.models?.opus ?? '' },
  ...envFields(e.protocol, e.env),
  args: e.args?.join('\n') ?? '',
})

const blank = (protocol: ApiProtocol): EndpointLike => ({
  protocol,
  baseUrl: '',
  model: null,
  models: null,
  env: {},
})

interface Fields {
  name: string
  apiKey: string
  proxy: string
  configDir: string
  executablePath: string
  /** Every protocol the form knows (checked or not), so unchecking keeps what was typed. */
  endpoints: EndpointFields[]
  /** The protocols the provider will serve. */
  on: ApiProtocol[]
}

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

const argLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** The protocols offered for `preset` (its endpoints), or all of them for a custom one. */
const protocolsOf = (preset: ProviderPreset | null) =>
  preset ? preset.endpoints.map((e) => e.protocol) : [...API_PROTOCOLS]

function fromPreset(preset: ProviderPreset | null, single: boolean): Fields {
  const endpoints = protocolsOf(preset).map((p) =>
    endpointFields(preset?.endpoints.find((e) => e.protocol === p) ?? blank(p)),
  )
  const first = endpoints[0]?.protocol ?? 'anthropic'
  return {
    name: preset?.name ?? '',
    apiKey: '',
    proxy: '',
    configDir: '',
    executablePath: '',
    endpoints,
    on: preset && !single ? endpoints.map((e) => e.protocol) : [first],
  }
}

function fromView(p: ProviderView): Fields {
  const known = (protocol: ApiProtocol) => p.endpoints.find((e) => e.protocol === protocol)
  const profile = p.endpoints.find((e) => e.configDir)
  return {
    name: p.name,
    apiKey: '',
    proxy: p.proxy ?? '',
    configDir: profile?.configDir ?? '',
    executablePath: profile?.executablePath ?? '',
    endpoints: API_PROTOCOLS.map((x) => endpointFields(known(x) ?? blank(x))),
    on: p.endpoints.map((e) => e.protocol),
  }
}

/** The agents a provider serving `protocols` could be the default of (Claude Code alone for a profile). */
const defaultable = (features: readonly string[], protocols: ApiProtocol[], profile: boolean) =>
  AGENT_KINDS.filter(
    (a) =>
      agentMeta(a).login === 'provider' &&
      clientRunsAgent(features, a) &&
      (profile ? a === 'claude' : protocols.some((p) => agentTakes(a, p))),
  )

/**
 * 新增 (vendor first, then only the key) or 编辑 a provider of the machine: one vendor, an endpoint per protocol it
 * serves. The stored key is never shown: it is sent only when typed, so an empty field keeps it. An older client
 * keeps one protocol per provider.
 */
export function ProviderEditor({
  source,
  editing,
  onClose,
  onSaved,
}: {
  source: AgentsSource
  /** null = a new provider. */
  editing: ProviderView | null
  onClose: () => void
  onSaved: (saved: ProviderSavedDto) => void
}) {
  const single = !source.features.includes('protocolProviders')
  const profiles = source.features.includes('claudeProfile')
  const [presets, setPresets] = useState<ProviderPreset[] | null>(null)
  /** undefined while picking the vendor; null = 自定义. */
  const [preset, setPreset] = useState<ProviderPreset | null | undefined>(editing ? null : undefined)
  const [f, setF] = useState<Fields>(editing ? fromView(editing) : fromPreset(null, single))
  const [localProfile, setLocalProfile] = useState(!!editing?.endpoints.some((e) => e.configDir))
  const [setDefault, setSetDefault] = useState<AgentKind[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])

  useEffect(() => {
    if (!localProfile || !source.claudeDirs) return
    let live = true
    // Suggestions only: 浏览… shows why the machine cannot be read.
    source.claudeDirs().then(
      (dirs) => live && setSuggested(dirs),
      () => {},
    )
    return () => {
      live = false
    }
  }, [source, localProfile])

  useEffect(() => {
    source.presets().then(
      (list) => {
        setPresets(list)
        if (editing?.presetId) setPreset(list.find((p) => p.id === editing.presetId) ?? null)
      },
      (e) => setError(errorText(e)),
    )
  }, [source, editing])

  const pick = (p: ProviderPreset | null, profile = false) => {
    setPreset(p)
    setLocalProfile(profile)
    setF(fromPreset(p, single))
    setSetDefault([])
    setError(null)
  }
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }))
  const setEndpoint = (protocol: ApiProtocol, patch: Partial<EndpointFields>) =>
    setF((x) => ({
      ...x,
      endpoints: x.endpoints.map((e) => (e.protocol === protocol ? { ...e, ...patch } : e)),
    }))
  const toggle = (protocol: ApiProtocol, on: boolean) =>
    setF((x) => ({
      ...x,
      on: on
        ? single
          ? [protocol]
          : API_PROTOCOLS.filter((p) => p === protocol || x.on.includes(p))
        : x.on.filter((p) => p !== protocol),
    }))
  const setConfigDir = (configDir: string) =>
    setF((x) => ({
      ...x,
      configDir,
      ...((!x.name.trim() || x.name === profileName(x.configDir)) && { name: profileName(configDir) }),
    }))
  const presetEndpoint = (protocol: ApiProtocol) => preset?.endpoints.find((e) => e.protocol === protocol)
  const editingEndpoint = (protocol: ApiProtocol) => editing?.endpoints.find((e) => e.protocol === protocol)
  const active = localProfile
    ? f.endpoints.filter((e) => e.protocol === 'anthropic')
    : f.endpoints.filter((e) => f.on.includes(e.protocol))
  const offered = localProfile ? [] : editing ? [...API_PROTOCOLS] : protocolsOf(preset ?? null)
  const agentsFor = defaultable(
    source.features,
    active.map((e) => e.protocol),
    localProfile,
  )

  const endpointInput = (e: EndpointFields): EndpointInput => {
    const modelWindow = presetEndpoint(e.protocol)?.modelContext[e.model.trim()]
    const env = joinProviderEnv({
      fields: settingFields(e.protocol),
      texts: e.settings,
      initial: e.base,
      other: e.env,
      modelWindow,
    })
    const anthropic = e.protocol === 'anthropic'
    // A profile's login and models come from its own directory: never send a key or URL a field once held.
    if (localProfile)
      return {
        protocol: 'anthropic',
        configDir: f.configDir.trim(),
        executablePath: f.executablePath.trim(),
        model: '',
        models: {},
        env,
        args: argLines(e.args),
      }
    const models: ModelMap = Object.fromEntries(
      TIERS.flatMap((tier) => (e.models[tier].trim() ? [[tier, e.models[tier].trim()]] : [])),
    )
    return {
      protocol: e.protocol,
      baseUrl: e.baseUrl.trim(),
      model: e.model.trim(),
      env,
      ...(anthropic && { models, args: argLines(e.args) }),
    }
  }

  const save = async () => {
    if (!f.name.trim()) return setError(t('请填写名称'))
    if (localProfile && !f.configDir.trim()) return setError(t('请填写配置目录'))
    if (!active.length) return setError(t('请至少选择一种协议'))
    if (!localProfile && active.some((e) => !e.baseUrl.trim())) return setError(t('请填写 Base URL'))
    if (!localProfile && !editing && !f.apiKey.trim()) return setError(t('请填写 API Key'))
    let endpoints: EndpointInput[]
    try {
      endpoints = active.map(endpointInput)
    } catch (e) {
      return setError((e as Error).message)
    }
    const kept = new Set(endpoints.map((e) => e.protocol))
    const removeProtocols = (editing?.endpoints ?? []).map((e) => e.protocol).filter((p) => !kept.has(p))
    const chosen = setDefault.filter((a) => agentsFor.includes(a))
    const body: SaveProviderReq = {
      ...(!editing && preset && { presetId: preset.id }),
      name: f.name.trim(),
      ...(!localProfile && f.apiKey.trim() && { apiKey: f.apiKey.trim() }),
      proxy: f.proxy.trim(),
      endpoints,
      ...(removeProtocols.length && { removeProtocols }),
      setDefault: chosen,
      // An older client keeps the provider for one agent: the one it becomes the default of, if any.
      ...(single && chosen[0] && { agent: chosen[0] }),
    }
    setSaving(true)
    try {
      onSaved(await source.saveProvider(editing?.id ?? null, body))
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  const title = editing ? t('编辑供应商') : t('新增供应商')
  if (preset === undefined)
    return (
      <Dialog open onClose={onClose} title={title} message={t('选择厂商，之后只需填写 API Key')} width={520}>
        {error ? <p className="mx-danger">{error}</p> : null}
        <VendorPicker
          presets={presets}
          onPick={pick}
          onProfile={profiles ? () => pick(null, true) : undefined}
        />
      </Dialog>
    )

  const keyUrl = preset && (preset.apiKeyUrl ?? preset.websiteUrl)
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
            onClick={() =>
              setF((x) => ({
                ...x,
                name: preset.name,
                endpoints: x.endpoints.map((e) => {
                  const p = presetEndpoint(e.protocol)
                  return p ? { ...endpointFields(p), args: e.args } : e
                }),
              }))
            }
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
            <span>{preset ? preset.name : localProfile ? t('这台电脑的 Claude 配置目录') : t('自定义')}</span>
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
        {localProfile ? (
          <ProfileRows
            source={source}
            configDir={f.configDir}
            executablePath={f.executablePath}
            suggested={suggested}
            browsing={browsing}
            onBrowse={setBrowsing}
            onConfigDir={setConfigDir}
            onExecutable={(executablePath) => set({ executablePath })}
          />
        ) : (
          <>
            <FormRow
              label={t('协议')}
              hint={
                single
                  ? t('这台电脑的客户端版本较旧，一个供应商只能登记一种协议')
                  : t(
                      'Agent 只能用协议对得上的供应商：Claude Code 需要 Anthropic 兼容，Codex 需要 OpenAI 兼容',
                    )
              }
            >
              <span className="mx-inline mx-preset">
                {offered.map((p) => (
                  <Checkbox
                    key={p}
                    label={PROTOCOL_LABEL[p]}
                    checked={f.on.includes(p)}
                    onChange={(on) => toggle(p, on)}
                  />
                ))}
              </span>
            </FormRow>
            <FormRow
              label="API Key"
              hint={editing ? t('留空则保留已保存的 Key') : t('Key 只保存在这台电脑上')}
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
            {active.map((e) => (
              <EndpointRows
                key={e.protocol}
                endpoint={e}
                fromPreset={!!presetEndpoint(e.protocol)}
                options={
                  presetEndpoint(e.protocol)?.modelOptions ?? editingEndpoint(e.protocol)?.modelOptions ?? []
                }
                onChange={(patch) => setEndpoint(e.protocol, patch)}
              />
            ))}
          </>
        )}
        {editing || !agentsFor.length ? null : (
          <FormRow label={t('设为默认')} hint={t('这些 Agent 在这台电脑上默认使用它')}>
            <span className="mx-inline mx-preset">
              {agentsFor.map((a) => (
                <Checkbox
                  key={a}
                  label={AGENT_META[a].name}
                  checked={setDefault.includes(a)}
                  onChange={(on) => setSetDefault((x) => (on ? [...x, a] : x.filter((y) => y !== a)))}
                />
              ))}
            </span>
          </FormRow>
        )}
        <FormRow>
          <Disclosure title={t('高级')} open={advanced} onToggle={setAdvanced} />
        </FormRow>
        {advanced ? (
          <>
            <FormRow label={t('代理地址')} hint={t('Agent 经此代理访问供应商，留空为直连')}>
              <TextField
                aria-label={t('代理地址')}
                placeholder="http://127.0.0.1:7890"
                value={f.proxy}
                onChange={(e) => set({ proxy: e.target.value })}
              />
            </FormRow>
            {active.map((e) => (
              <EndpointAdvancedRows
                key={e.protocol}
                endpoint={e}
                profile={localProfile}
                showTitle={!localProfile && active.length > 1}
                preset={presetEndpoint(e.protocol)}
                onChange={(patch) => setEndpoint(e.protocol, patch)}
              />
            ))}
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

/** A local Claude profile: its directory (suggested, typed or browsed) and an optional executable. */
function ProfileRows({
  source,
  configDir,
  executablePath,
  suggested,
  browsing,
  onBrowse,
  onConfigDir,
  onExecutable,
}: {
  source: AgentsSource
  configDir: string
  executablePath: string
  suggested: string[]
  browsing: boolean
  onBrowse: (on: boolean) => void
  onConfigDir: (dir: string) => void
  onExecutable: (path: string) => void
}) {
  return (
    <>
      <FormRow
        label={t('配置目录')}
        hint={t('Agent 使用该目录自己的登录与 settings.json，可从列表选择或点「浏览…」')}
      >
        <span className="mx-inline mx-field-row">
          <ComboBox
            aria-label={t('配置目录')}
            options={suggested}
            value={configDir}
            placeholder={t('这台电脑上的绝对路径')}
            onInput={onConfigDir}
            onChange={onConfigDir}
          />
          {source.renderDirPicker ? (
            <Button size="small" onClick={() => onBrowse(true)}>
              {t('浏览…')}
            </Button>
          ) : null}
        </span>
      </FormRow>
      {browsing
        ? source.renderDirPicker?.({
            start: configDir.trim() || null,
            onPick: (dir) => {
              onConfigDir(dir)
              onBrowse(false)
            },
            onClose: () => onBrowse(false),
          })
        : null}
      <FormRow label={t('Claude 可执行文件')} hint={t('可选；留空使用这台电脑的 Agent 路径')}>
        <TextField
          aria-label={t('Claude 可执行文件')}
          value={executablePath}
          onChange={(e) => onExecutable(e.target.value)}
        />
      </FormRow>
    </>
  )
}

/** One protocol's basic block: Base URL (unless the preset already fills it) and model. */
function EndpointRows({
  endpoint: e,
  fromPreset,
  options,
  onChange,
}: {
  endpoint: EndpointFields
  /** The preset fills the URL: shown in 高级 instead. */
  fromPreset: boolean
  options: string[]
  onChange: (patch: Partial<EndpointFields>) => void
}) {
  const label = PROTOCOL_LABEL[e.protocol]
  return (
    <section className="ag-endpoint" aria-label={t('{protocol} 端点', { protocol: label })}>
      <Divider label={t('{protocol} 端点', { protocol: label })} />
      {fromPreset ? null : (
        <FormRow label="Base URL">
          <TextField
            aria-label={t('{protocol} Base URL', { protocol: label })}
            value={e.baseUrl}
            onChange={(ev) => onChange({ baseUrl: ev.target.value })}
            placeholder={URL_HINT[e.protocol]}
          />
        </FormRow>
      )}
      <FormRow label={t('模型')} hint={t('可从列表选择，也可直接输入')}>
        <ComboBox
          aria-label={t('{protocol} 模型', { protocol: label })}
          options={options}
          value={e.model}
          placeholder={t('默认')}
          onInput={(model) => onChange({ model })}
          onChange={(model) => onChange({ model })}
        />
      </FormRow>
    </section>
  )
}

/** One protocol's advanced settings: preset URL, model mapping, provider settings and variables. */
function EndpointAdvancedRows({
  endpoint: e,
  profile,
  showTitle,
  preset,
  onChange,
}: {
  endpoint: EndpointFields
  profile: boolean
  showTitle: boolean
  preset: PresetEndpoint | undefined
  onChange: (patch: Partial<EndpointFields>) => void
}) {
  const label = PROTOCOL_LABEL[e.protocol]
  const fields = settingFields(e.protocol)
  const presetEnv = preset ? envFields(e.protocol, preset.env) : null
  const modelWindow = preset?.modelContext[e.model.trim()]
  const anthropic = e.protocol === 'anthropic'
  // A profile has no model mapping to move it to.
  const smallFast = anthropic && !profile ? otherValue(e.env, SMALL_FAST) : undefined
  const restore = (id: string) => {
    const field = fields.find((x) => x.id === id)
    if (!field || !presetEnv) return
    const raw = presetEnv.base[id] ?? ''
    onChange({ settings: { ...e.settings, [id]: textOf(field, raw) }, base: { ...e.base, [id]: raw } })
  }
  return (
    <>
      {showTitle ? <Divider label={label} /> : null}
      {!profile && preset ? (
        <FormRow label="Base URL">
          <TextField
            aria-label={t('{protocol} Base URL', { protocol: label })}
            value={e.baseUrl}
            onChange={(ev) => onChange({ baseUrl: ev.target.value })}
            placeholder={URL_HINT[e.protocol]}
          />
        </FormRow>
      ) : null}
      {anthropic && !profile
        ? TIERS.map((tier) => (
            <FormRow
              key={tier}
              label={t('{tier} 模型', { tier: `${tier[0]?.toUpperCase()}${tier.slice(1)}` })}
            >
              <TextField
                aria-label={t('{tier} 模型', { tier })}
                value={e.models[tier]}
                onChange={(ev) => onChange({ models: { ...e.models, [tier]: ev.target.value } })}
              />
            </FormRow>
          ))
        : null}
      <ProviderSettingRows
        fields={fields}
        texts={e.settings}
        preset={presetEnv?.settings}
        modelWindow={modelWindow}
        onChange={(id, text) => onChange({ settings: { ...e.settings, [id]: text } })}
        onRestore={restore}
      />
      {anthropic ? <ArgsRow value={e.args} onChange={(args) => onChange({ args })} /> : null}
      <EnvRow
        label={fields.length ? t('其他环境变量') : t('环境变量')}
        value={e.env}
        onChange={(env) => onChange({ env })}
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
                onChange({
                  env: withoutVar(e.env, SMALL_FAST),
                  models: { ...e.models, haiku: e.models.haiku || smallFast },
                })
              }
            >
              {t('改用 Haiku 映射')}
            </Button>
          </Alert>
        </FormRow>
      ) : null}
    </>
  )
}

function ArgsRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormRow>
  )
}

function EnvRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FormRow label={label} align="top" hint={t('启动 Agent 时附加，每行一个 KEY=VALUE')}>
      <TextField
        multiline
        aria-label={label}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormRow>
  )
}

/** The official login's proxy and extra variables; the CLI's own login and config stay as they are. */
export function OfficialEditor({
  source,
  agent,
  official,
  onClose,
  onSaved,
}: {
  source: AgentsSource
  agent: AgentKind
  official: OfficialSettings | undefined
  onClose: () => void
  onSaved: (view: ProviderStoreView) => void
}) {
  const fields = fieldsFor(agent, 'provider')
  const [f, setF] = useState(() => {
    const { values, other } = splitEnv(official?.env ?? {}, fields)
    return {
      proxy: official?.proxy ?? '',
      args: official?.args.join('\n') ?? '',
      env: envText(other),
      settings: fieldTexts(fields, values),
      base: values,
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const title = t('{agent} 官方登录设置', { agent: AGENT_META[agent].name })

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
      onSaved(await source.saveOfficial(body))
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
      message={t('登录与配置仍用这台电脑上 CLI 自己的，以下设置在启动 Agent 时附加')}
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
        <FormRow label={t('代理地址')} hint={t('Agent 经此代理联网，留空为直连')}>
          <TextField
            aria-label={t('代理地址')}
            placeholder="http://127.0.0.1:7890"
            value={f.proxy}
            onChange={(e) => setF((x) => ({ ...x, proxy: e.target.value }))}
          />
        </FormRow>
        {agent === 'claude' ? (
          <ArgsRow value={f.args} onChange={(args) => setF((x) => ({ ...x, args }))} />
        ) : null}
        <EnvRow
          label={fields.length ? t('其他环境变量') : t('环境变量')}
          value={f.env}
          onChange={(env) => setF((x) => ({ ...x, env }))}
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
  /** Offers 该机器 Claude 配置目录; absent when the client cannot run one. */
  onProfile?: () => void
}) {
  const [q, setQ] = useState('')
  const text = q.trim().toLowerCase()
  const match = (p: ProviderPreset) => !text || p.name.toLowerCase().includes(text) || p.id.includes(text)
  const row = (
    key: string,
    name: string,
    sub: string,
    onClick: () => void,
    protocols: ApiProtocol[] = [],
  ) => (
    <button key={key} type="button" className="mx-row mx-row--button" onClick={onClick}>
      <span className="mx-row__main">
        <span className="mx-row__title">
          <span>{name}</span>
          <span className="ag-protocols">
            {protocols.map((p) => (
              <Tag key={p} tone="purple">
                {PROTOCOL_LABEL[p]}
              </Tag>
            ))}
          </span>
        </span>
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
            <GroupBox>
              {list.map((p) =>
                row(
                  p.id,
                  p.name,
                  p.endpoints[0]?.baseUrl ?? '',
                  () => onPick(p),
                  p.endpoints.map((e) => e.protocol),
                ),
              )}
            </GroupBox>
          </div>
        ) : null
      })}
      <GroupBox>
        {row('custom', t('自定义'), t('手动填写 Base URL'), () => onPick(null))}
        {onProfile
          ? row(
              'profile',
              t('这台电脑的 Claude 配置目录'),
              t('使用这台电脑上另一个 Claude 配置目录里的登录与设置，无需 API Key'),
              onProfile,
            )
          : null}
      </GroupBox>
    </div>
  )
}
