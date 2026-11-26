import {
  AGENT_META,
  type AgentKind,
  type ApiProtocol,
  fieldsFor,
  type OfficialProviderReq,
  type OfficialSettings,
  type ProviderPreset,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import {
  Alert,
  Dialog,
  Form,
  FormRow,
  GroupBox,
  SearchField,
  Skeleton,
  Tag,
  TextField,
  useDiscardGuard,
} from '../../ui'
import { PROTOCOL_LABEL } from '../agents/model'
import type { AgentsSource } from '../agents/source'
import { envText, fieldTexts, joinProviderEnv, splitEnv } from './agentSettings'
import { ProviderSettingRows } from './ProviderSettings'

const GROUPS: { key: ProviderPreset['group']; label: string }[] = [
  { key: 'cn', label: t('国内厂商') },
  { key: 'aggregator', label: t('聚合平台') },
  { key: 'global', label: t('海外') },
]
const OFFICIAL_FORM_ID = 'official-form'

export const argLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

export function ArgsRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

export function EnvRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
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
  const [initial] = useState(() => {
    const { values, other } = splitEnv(official?.env ?? {}, fields)
    return {
      proxy: official?.proxy ?? '',
      args: official?.args.join('\n') ?? '',
      env: envText(other),
      settings: fieldTexts(fields, values),
      base: values,
    }
  })
  const [f, setF] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const title = t('{agent} 官方登录设置', { agent: AGENT_META[agent].name })

  const dirty =
    f.proxy !== initial.proxy ||
    f.args !== initial.args ||
    f.env !== initial.env ||
    JSON.stringify(f.settings) !== JSON.stringify(initial.settings)
  const guard = useDiscardGuard(dirty, onClose)
  const safeClose = () => {
    if (!saving) guard.requestClose()
  }

  const save = async () => {
    if (saving) return
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
    setError(null)
    try {
      onSaved(await source.saveOfficial(body))
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={safeClose}
        closeOnBackdrop={false}
        title={title}
        message={t('登录与配置仍用这台电脑上 CLI 自己的，以下设置在启动 Agent 时附加')}
        width={560}
        actions={[
          { label: t('取消'), disabled: saving, onClick: safeClose },
          {
            label: t('保存'),
            variant: 'primary',
            type: 'submit',
            form: OFFICIAL_FORM_ID,
            disabled: saving,
            loading: saving,
          },
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
              <Alert variant="error" description={error} />
            </FormRow>
          ) : null}
        </Form>
      </Dialog>
      {guard.dialog}
    </>
  )
}

export function VendorPicker({
  presets,
  loading,
  error,
  onRetry,
  onPick,
  onProfile,
}: {
  presets: ProviderPreset[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
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
      {error ? <Alert variant="error" description={error} retrying={loading} onRetry={onRetry} /> : null}
      {!presets && !error ? <Skeleton count={3} /> : null}
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
              t('使用本机 Claude 配置目录（含默认 ~/.claude）里的登录与设置，无需 API Key'),
              onProfile,
            )
          : null}
      </GroupBox>
    </div>
  )
}
