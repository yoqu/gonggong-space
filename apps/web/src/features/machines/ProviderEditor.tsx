import {
  type AgentKind,
  type AgentSettingValues,
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
import { envText, fieldTexts, joinProviderEnv, parseEnv, splitEnv, textOf } from './agentSettings'
import { ProviderSettingRows } from './ProviderSettings'

const GROUPS: { key: ProviderPreset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]
const TIERS = ['haiku', 'sonnet', 'opus'] as const
const FORM_ID = 'provider-form'
const OFFICIAL_FORM_ID = 'official-form'

const SMALL_FAST = 'ANTHROPIC_SMALL_FAST_MODEL'

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
  editing,
  onClose,
  onSaved,
}: {
  machineId: string
  agent: AgentKind
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
        }
      : empty(agent),
  )
  const [localProfile, setLocalProfile] = useState(Boolean(editing?.configDir))
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => {
    api.get<ProviderPreset[]>(`/machines/${machineId}/providers/presets?agent=${agent}`).then(
      (list) => {
        setPresets(list)
        if (editing?.presetId) setPreset(list.find((p) => p.id === editing.presetId) ?? null)
      },
      (e) => setError(errorText(e)),
    )
  }, [machineId, agent, editing])

  const pick = (p: ProviderPreset | null) => {
    setPreset(p)
    setF(p ? fieldsOf(p) : empty(agent))
    setError(null)
  }
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }))
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
  const smallFast = agent === 'claude' ? otherValue(f.env, SMALL_FAST) : undefined

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
    const body: SaveProviderReq = {
      agent,
      ...(!editing && preset && { presetId: preset.id }),
      name: f.name.trim(),
      ...(localProfile
        ? { configDir: f.configDir.trim(), executablePath: f.executablePath.trim() }
        : { baseUrl: f.baseUrl.trim() }),
      ...(f.apiKey.trim() && { apiKey: f.apiKey.trim() }),
      model: f.model.trim(),
      env,
      proxy: f.proxy.trim(),
      ...(agent === 'claude' && { models }),
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
        <VendorPicker presets={presets} onPick={pick} />
      </Dialog>
    )

  const keyUrl = preset && (preset.apiKeyUrl ?? preset.websiteUrl)
  const baseUrl = (
    <FormRow label="Base URL">
      <TextField
        aria-label="Base URL"
        value={f.baseUrl}
        onChange={(e) => set({ baseUrl: e.target.value })}
        placeholder={agent === 'claude' ? 'https://…/anthropic' : 'https://…/v1'}
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
            onClick={() => setF({ ...fieldsOf(preset), apiKey: f.apiKey, proxy: f.proxy })}
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
            <span>{preset ? preset.name : t('自定义')}</span>
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
        {agent === 'claude' && !preset && !editing ? (
          <FormRow>
            <Checkbox
              label={t('使用本机 Claude 配置目录')}
              checked={localProfile}
              onChange={setLocalProfile}
            />
          </FormRow>
        ) : null}
        {localProfile ? (
          <>
            <FormRow label={t('配置目录')} hint={t('请输入本机绝对路径')}>
              <TextField
                aria-label={t('配置目录')}
                value={f.configDir}
                onChange={(e) => set({ configDir: e.target.value })}
              />
            </FormRow>
            <FormRow label={t('Claude 可执行文件')} hint={t('可选；留空使用本机 Agent 路径')}>
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
            <Checkbox label={t('设为本机默认')} checked={setDefault} onChange={setSetDefault} />
          </FormRow>
        )}
        <FormRow>
          <Disclosure title={t('高级')} open={advanced} onToggle={setAdvanced} />
        </FormRow>
        {advanced ? (
          <>
            {preset ? baseUrl : null}
            {agent === 'claude'
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

function ExtraRows({
  proxy,
  env,
  envLabel,
  proxyHint,
  onChange,
}: {
  proxy: string
  env: string
  envLabel: string
  proxyHint: string
  onChange: (patch: { proxy?: string; env?: string }) => void
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
    const args = f.args
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const body: OfficialProviderReq = {
      agent,
      env,
      proxy: f.proxy.trim(),
      ...(agent === 'claude' && { args }),
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
          envLabel={fields.length ? t('其他环境变量') : t('环境变量')}
          proxyHint={t('Agent 经此代理联网，留空为直连')}
          onChange={(patch) => setF((x) => ({ ...x, ...patch }))}
        />
        {agent === 'claude' ? (
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
              value={f.args}
              onChange={(e) => setF((x) => ({ ...x, args: e.target.value }))}
            />
          </FormRow>
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

function VendorPicker({
  presets,
  onPick,
}: {
  presets: ProviderPreset[] | null
  onPick: (p: ProviderPreset | null) => void
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
      <GroupBox>{row('custom', t('自定义'), t('手动填写 Base URL'), () => onPick(null))}</GroupBox>
    </div>
  )
}
