import type {
  AgentKind,
  ModelMap,
  ProviderPreset,
  ProviderSavedDto,
  ProviderView,
  SaveProviderReq,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import {
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

const GROUPS: { key: ProviderPreset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]
const TIERS = ['haiku', 'sonnet', 'opus'] as const
const FORM_ID = 'provider-form'

/** `KEY=VALUE` per line; throws on a line without `=`. */
function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf('=')
    if (at <= 0) throw new Error(t('额外环境变量每行一个 KEY=VALUE：{line}', { line }))
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return env
}

interface Fields {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models: Record<(typeof TIERS)[number], string>
  env: string
}

const fieldsOf = (p: Pick<ProviderPreset, 'name' | 'baseUrl' | 'model' | 'models' | 'env'>): Fields => ({
  name: p.name,
  baseUrl: p.baseUrl,
  apiKey: '',
  model: p.model ?? '',
  models: { haiku: p.models?.haiku ?? '', sonnet: p.models?.sonnet ?? '', opus: p.models?.opus ?? '' },
  env: Object.entries(p.env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n'),
})

const EMPTY = fieldsOf({ name: '', baseUrl: '', model: null, models: null, env: {} })

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
  const [f, setF] = useState<Fields>(editing ? fieldsOf(editing) : EMPTY)
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
    setF(p ? fieldsOf(p) : EMPTY)
    setError(null)
  }
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }))

  const save = async () => {
    if (!f.name.trim()) return setError(t('请填写名称'))
    if (!f.baseUrl.trim()) return setError(t('请填写 Base URL'))
    if (!editing && !f.apiKey.trim()) return setError(t('请填写 API Key'))
    let env: Record<string, string>
    try {
      env = parseEnv(f.env)
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
      baseUrl: f.baseUrl.trim(),
      ...(f.apiKey.trim() && { apiKey: f.apiKey.trim() }),
      model: f.model.trim(),
      ...(agent === 'claude' && { models, env }),
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
          <Button variant="plain" onClick={() => setF({ ...fieldsOf(preset), apiKey: f.apiKey })}>
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
        {preset ? null : baseUrl}
        <FormRow label="API Key" hint={editing ? t('留空则保留已保存的 Key') : t('Key 只保存在这台机器上')}>
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
            {agent === 'claude' ? (
              <>
                {TIERS.map((tier) => (
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
                ))}
                <FormRow label={t('额外环境变量')} align="top" hint={t('每行一个 KEY=VALUE')}>
                  <TextField
                    multiline
                    aria-label={t('额外环境变量')}
                    rows={3}
                    value={f.env}
                    onChange={(e) => set({ env: e.target.value })}
                  />
                </FormRow>
              </>
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
