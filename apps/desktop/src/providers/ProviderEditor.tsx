import type { AgentKind } from '@gonggong/protocol'
import {
  Button,
  Checkbox,
  ComboBox,
  Dialog,
  Disclosure,
  Form,
  FormRow,
  GroupBox,
  SearchField,
  SecureField,
  TextField,
} from '@web/ui'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc, type ModelMap, type Preset, type ProviderDraft, type ProviderView } from '../ipc'
import { formatEnv, parseEnv } from '../lib/env'
import { AGENTS } from '../lib/labels'
import { fail } from '../lib/ui'

const GROUPS: { key: Preset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]

const TIERS = ['haiku', 'sonnet', 'opus'] as const

interface Fields {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models: Required<Record<(typeof TIERS)[number], string>>
  env: string
}

function fieldsOf(p: Pick<Preset, 'name' | 'baseUrl' | 'model' | 'models' | 'env'>): Fields {
  return {
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: '',
    model: p.model ?? '',
    models: { haiku: p.models?.haiku ?? '', sonnet: p.models?.sonnet ?? '', opus: p.models?.opus ?? '' },
    env: formatEnv(p.env),
  }
}

const EMPTY: Fields = fieldsOf({ name: '', baseUrl: '', model: null, models: null, env: {} })

/** 新增 (vendor first, then only the key) or 编辑; the stored key is never shown, empty keeps it. */
export function ProviderEditor({
  agent,
  editing,
  onClose,
  onSaved,
}: {
  agent: AgentKind
  /** null = a new provider. */
  editing: ProviderView | null
  onClose: () => void
  onSaved: (id: string, setDefault: boolean) => void
}) {
  const [presets, setPresets] = useState<Preset[] | null>(null)
  /** undefined while picking the vendor; null = 自定义. */
  const [preset, setPreset] = useState<Preset | null | undefined>(editing ? null : undefined)
  const [f, setF] = useState<Fields>(editing ? { ...fieldsOf(editing), apiKey: '' } : EMPTY)
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => {
    ipc.providerPresets().then((all) => {
      const mine = all.filter((p) => p.agent === agent)
      setPresets(mine)
      if (editing?.presetId) setPreset(mine.find((p) => p.id === editing.presetId) ?? null)
    }, fail)
  }, [agent, editing])

  const pick = (p: Preset | null) => {
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
    const models: ModelMap | null = agent === 'claude' ? f.models : null
    const draft: ProviderDraft = {
      id: editing?.id ?? null,
      agent,
      presetId: editing ? editing.presetId : (preset?.id ?? null),
      name: f.name,
      baseUrl: f.baseUrl,
      apiKey: f.apiKey,
      model: f.model || null,
      models,
      env,
    }
    setSaving(true)
    try {
      onSaved(await ipc.saveProvider(draft), setDefault)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const title = editing ? t('编辑供应商') : t('新增 {agent} 供应商', { agent: AGENTS[agent].name })
  if (preset === undefined) {
    return (
      <Dialog open onClose={onClose} title={title} message={t('选择厂商，之后只需填写 API Key')} width={520}>
        <VendorPicker presets={presets} onPick={pick} />
      </Dialog>
    )
  }

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
        { label: t('保存'), variant: 'primary', type: 'submit', form: 'provider-form', disabled: saving },
      ]}
    >
      <Form id="provider-form" aria-label={title} onSubmit={save}>
        <FormRow label={t('厂商')}>
          <span className="dk-inline">
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
        <FormRow label="API Key" hint={editing ? t('留空则保留已保存的 Key') : undefined}>
          <span className="dk-inline dk-field-row">
            <SecureField
              aria-label="API Key"
              autoComplete="off"
              value={f.apiKey}
              placeholder={editing ? editing.apiKey : t('必填')}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            {keyUrl && preset ? (
              <Button
                size="small"
                variant="plain"
                onClick={() => ipc.openKeyPage(agent, preset.id).catch(fail)}
              >
                {t('获取 Key')}
              </Button>
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
            <span className="dk-danger">{error}</span>
          </FormRow>
        ) : null}
      </Form>
    </Dialog>
  )
}

function VendorPicker({ presets, onPick }: { presets: Preset[] | null; onPick: (p: Preset | null) => void }) {
  const [q, setQ] = useState('')
  const text = q.trim().toLowerCase()
  const match = (p: Preset) => !text || p.name.toLowerCase().includes(text) || p.id.includes(text)
  return (
    <div className="dk-vendors">
      <SearchField aria-label={t('搜索厂商')} placeholder={t('搜索厂商')} value={q} onChange={setQ} />
      {GROUPS.map((g) => {
        const list = presets?.filter((p) => p.group === g.key && match(p)) ?? []
        return list.length ? (
          <div key={g.key} className="dk-vendors__group">
            <span className="dk-sub">{g.label}</span>
            <GroupBox>
              {list.map((p) => (
                <button key={p.id} type="button" className="dk-row dk-row--button" onClick={() => onPick(p)}>
                  <span className="dk-row__main">
                    <span>{p.name}</span>
                    <span className="dk-sub dk-ellipsis">{p.baseUrl}</span>
                  </span>
                </button>
              ))}
            </GroupBox>
          </div>
        ) : null
      })}
      <GroupBox>
        <button type="button" className="dk-row dk-row--button" onClick={() => onPick(null)}>
          <span className="dk-row__main">
            <span>{t('自定义')}</span>
            <span className="dk-sub">{t('手动填写 Base URL')}</span>
          </span>
        </button>
      </GroupBox>
    </div>
  )
}
