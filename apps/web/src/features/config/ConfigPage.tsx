import {
  GONGGONG_TOOLS,
  type InheritedMcpDto,
  type McpServer,
  type McpServerDto,
  type SecretDto,
} from '@gonggong/protocol'
import { type CSSProperties, useCallback, useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api, errorText } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  Form,
  FormRow,
  GroupBox,
  GroupRow,
  HelpButton,
  IconButton,
  Presence,
  SegmentedControl,
  Switch,
  Tabs,
  Tag,
  TextField,
  toast,
  UnsupportedArt,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { MarketReviewList } from '../market/ReviewList'
import { PluginLayerList } from '../plugins/PluginLayer'
import { SecretLayerList } from '../secrets/SecretLayer'
import { InheritedList } from './InheritedList'
import { type Pair, SECRET_REF, SecretPairs, secretRef } from './SecretPairs'
import { SkillLayerList } from './SkillLayer'
import './config.css'
import { t } from '../../i18n'

const TITLE = t('配置中心')
const DESC = t('仓库基线之上依次叠加平台层、团队层与群层 MCP，同名时下层覆盖上层；不修改仓库文件。')
/** Name of the daemon's built-in MCP server; the server rejects it too. */
const RESERVED = 'gonggong'
const BUILTIN_TOOLS = [
  t('向群成员提问'),
  ...Object.values(GONGGONG_TOOLS).map((tool) => t.text({ key: tool.title })),
].join(t('、'))

type CType = 'mcp' | 'skill' | 'plugin' | 'prompt' | 'secret' | 'review'
const LAYERS = [
  { value: 'platform' as const, label: t('平台层') },
  { value: 'team' as const, label: t('团队层'), disabled: true },
  { value: 'group' as const, label: t('群层'), disabled: true },
]
const CTYPES: { value: CType; label: string }[] = [
  { value: 'mcp', label: 'MCP' },
  { value: 'skill', label: 'Skill' },
  { value: 'plugin', label: t('插件') },
  { value: 'prompt', label: t('指令') },
  { value: 'secret', label: t('密钥') },
  { value: 'review', label: t('待审核') },
]

interface Item {
  /** Local key; the server id once saved. */
  key: string
  enabled: boolean
  config: McpServer
  saved: McpServerDto | null
}

const fromDto = (d: McpServerDto): Item => ({ key: d.id, enabled: d.enabled, config: d.config, saved: d })

const describeMcp = (c: McpServer) => {
  const keys = (r: Record<string, string>) => Object.keys(r).join(', ')
  if (c.transport === 'http')
    return [c.url, Object.keys(c.headers).length ? `headers ${keys(c.headers)}` : '']
      .filter(Boolean)
      .join(' · ')
  return [[c.command, ...c.args].join(' '), Object.keys(c.env).length ? `env ${keys(c.env)}` : '']
    .filter(Boolean)
    .join(' · ')
}

/** Platform and team MCP servers in effect for the group, each turned on or off for this group alone. */
export function InheritedMcpList({ groupId }: { groupId: string }) {
  return (
    <InheritedList<InheritedMcpDto>
      base={`/groups/${groupId}/inherited-mcp`}
      row={(m) => ({
        name: m.config.name,
        label: m.config.name,
        tags: [m.config.transport],
        description: describeMcp(m.config),
      })}
    />
  )
}

/** One MCP layer's draft list under `base` (`/admin/mcp`, `/teams/:id/mcp`, `/groups/:id/mcp`), saved as a batch. */
export function useMcpLayer(base: string) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [force, setForce] = useState(false)
  const [savedForce, setSavedForce] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems((await api.get<McpServerDto[]>(base)).map(fromDto))
      setRemoved([])
      setLoadError('')
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [base])
  useEffect(() => {
    void load()
  }, [load])

  const edit = (next: Item[]) => {
    setItems(next)
    setSavedForce(null)
  }

  const save = async () => {
    if (!items) return
    setBusy(true)
    try {
      for (const id of removed) await api.del(`${base}/${id}?forceNewSession=${force}`)
      for (const i of items) {
        const body = { enabled: i.enabled, config: i.config, forceNewSession: force }
        if (!i.saved) await api.post(base, body)
        else if (i.enabled !== i.saved.enabled) await api.patch(`${base}/${i.saved.id}`, body)
      }
      setSavedForce(force)
      setForce(false)
    } catch (e) {
      toast({ type: 'error', title: t('保存失败'), message: errorText(e) })
    } finally {
      await load()
      setBusy(false)
    }
  }

  return {
    /** Secrets of the same layer, which env / headers values reference. */
    secretsBase: base.replace(/\/mcp$/, '/secrets'),
    items,
    edit,
    remove: (i: Item) => {
      if (i.saved) setRemoved((r) => [...r, i.key])
      edit((items ?? []).filter((x) => x !== i))
    },
    dirty: removed.length > 0 || !!items?.some((i) => !i.saved || i.enabled !== i.saved.enabled),
    enabledNames: items?.filter((i) => i.enabled).map((i) => i.config.name) ?? [],
    force,
    setForce,
    savedForce,
    busy,
    loadError,
    load,
    save,
  }
}

type McpLayer = ReturnType<typeof useMcpLayer>

/** The layer's servers with enable switches, the built-in row, the force option and 保存 (spec §7.4). */
export function McpLayerList({ layer, tag }: { layer: McpLayer; tag: string }) {
  const [adding, setAdding] = useState(false)
  const { items, edit } = layer
  return (
    <>
      {layer.loadError ? (
        <Alert variant="error" title={t('配置加载失败')} description={layer.loadError}>
          <div className="cfg__retry">
            <Button size="small" onClick={() => void layer.load()}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <GroupBox>
        {items?.map((i) => (
          <GroupRow
            key={i.key}
            className="cfg__item"
            label={
              <span className="cfg__name-line">
                <span className="cfg__name">{i.config.name}</span>
                <Tag tone="blue">{tag}</Tag>
                {i.saved ? null : <Tag tone="orange">{t('未保存')}</Tag>}
              </span>
            }
            description={describeMcp(i.config)}
          >
            <span className="cfg__controls">
              <IconButton
                title={t('删除 {name}', { name: i.config.name })}
                size="regular"
                onClick={() => layer.remove(i)}
              >
                {'trash' as const}
              </IconButton>
              <Switch
                ariaLabel={t('启用 {name}', { name: i.config.name })}
                checked={i.enabled}
                onChange={(enabled) => edit(items.map((x) => (x === i ? { ...x, enabled } : x)))}
              />
            </span>
          </GroupRow>
        ))}
        <GroupRow
          className="cfg__item"
          label={
            <span className="cfg__name-line">
              <span className="cfg__name">{RESERVED}</span>
              <Tag tone="gray">{t('内置')}</Tag>
            </span>
          }
          description={
            <>
              {t('系统内置 · 始终注入，不受层级影响')}
              <br />
              {BUILTIN_TOOLS}
            </>
          }
        >
          <Switch
            ariaLabel={t('启用 {name}', { name: RESERVED })}
            checked
            disabled
            onChange={() => undefined}
          />
        </GroupRow>
      </GroupBox>
      <div className="cfg__foot">
        <Checkbox label={t('强制相关 Bot 下一轮开新会话')} checked={layer.force} onChange={layer.setForce} />
        <HelpButton
          help={t(
            '勾选后，受影响的 Bot 下一轮会放弃已有会话、按新配置重开，卡片会提示原因；不勾选则已有会话继续使用旧配置。',
          )}
        />
        <span className="spacer" />
        <Button disabled={!items} onClick={() => setAdding(true)}>
          {t('添加 MCP…')}
        </Button>
        <Button variant="primary" disabled={!layer.dirty || layer.busy} onClick={() => void layer.save()}>
          {t('保存')}
        </Button>
      </div>
      <Presence>
        {adding && items ? (
          <AddMcpDialog
            secretsBase={layer.secretsBase}
            taken={items.map((i) => i.config.name)}
            onClose={() => setAdding(false)}
            onAdd={(config) => {
              edit([...items, { key: `new:${config.name}`, enabled: true, config, saved: null }])
              setAdding(false)
            }}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** Shown once a layer was saved: what happens to running turns and sessions. */
export function McpSaved({ force }: { force: boolean | null }) {
  if (force === null) return null
  return (
    <Alert
      variant="success"
      title={t('已保存，全员下一轮新会话生效')}
      description={
        force
          ? t('已要求相关 Bot 下一轮开新会话，卡片会提示原因。')
          : t('运行中的轮次不受影响；已有会话继续使用旧配置。')
      }
    />
  )
}

/** 管理后台 · 配置中心: the platform MCP layer (spec §7.1–7.4); teams and groups edit theirs in their settings. */
export function ConfigPage() {
  const layer = useMcpLayer('/admin/mcp')
  const [search] = useSearchParams()
  const [ctype, setCtype] = useState<CType>(
    CTYPES.find((c) => c.value === search.get('type'))?.value ?? 'mcp',
  )
  const bots = useWorkspace((s) => s.bots)
  const { items, enabledNames } = layer

  return (
    <AdminPage
      title={TITLE}
      desc={DESC}
      subtitle={
        items
          ? t('自定义 MCP {n} 个 · 已启用 {enabled} 个', { n: items.length, enabled: enabledNames.length })
          : undefined
      }
    >
      <div className="cfg__bar">
        <Tabs items={LAYERS} value="platform" onChange={() => undefined} />
        <span className="spacer" />
        <Tabs items={CTYPES} value={ctype} onChange={setCtype} />
      </div>
      <div className="cfg">
        <div className="cfg__list">
          {ctype === 'skill' ? (
            <SkillLayerList base="/admin/skills" tag={t('平台层')} />
          ) : ctype === 'plugin' ? (
            <PluginLayerList base="/admin/plugins" />
          ) : ctype === 'review' ? (
            <MarketReviewList path="/market/reviews" />
          ) : ctype === 'secret' ? (
            <SecretLayerList base="/admin/secrets" scope="platform" bots={bots} />
          ) : ctype !== 'mcp' ? (
            <EmptyState
              illustration={<UnsupportedArt />}
              title={t('暂不支持 {type}', { type: CTYPES.find((c) => c.value === ctype)?.label ?? '' })}
              description={t('目前只能配置 MCP、Skill 与密钥。')}
            />
          ) : (
            <McpLayerList layer={layer} tag={t('平台层')} />
          )}
        </div>
        <div className="cfg__preview">
          <div className="cfg__eyebrow">{t('合并预览 · 全部 Bot')}</div>
          {[
            {
              name: t('群层'),
              pri: t('优先级高'),
              color: 'var(--system-blue)',
              text: t('群管理员在群设置中配置'),
            },
            {
              name: t('团队层'),
              pri: t('中'),
              color: 'var(--system-indigo)',
              text: t('团队管理员在团队设置中配置'),
            },
            {
              name: t('平台层'),
              pri: t('中'),
              color: 'var(--system-teal)',
              text: `mcp: ${enabledNames.join(', ') || t('无')}`,
            },
            {
              name: t('Bot 系统提示词'),
              pri: '',
              color: 'var(--system-gray)',
              text: t('各 Bot 在 Bot 页设置'),
            },
            {
              name: t('仓库基线'),
              pri: t('低'),
              color: 'var(--label-tertiary)',
              text: '.mcp.json · .claude/ · AGENTS.md',
            },
          ].map((l) => (
            <div key={l.name} className="cfg__layer" style={{ '--layer-color': l.color } as CSSProperties}>
              <div className="cfg__layer-head">
                <span className="cfg__layer-name">{l.name}</span>
                <span className="cfg__layer-pri">{l.pri}</span>
              </div>
              <span className="cfg__layer-items">{l.text}</span>
            </div>
          ))}
          <div className="cfg__note">
            {t(
              '合并在 daemon 内存完成；MCP 在新建会话时经 ACP 注入不落盘；skill 由 daemon 缓存在本机，Claude 以插件注入，Codex 在工作区建软链并加入 .git/info/exclude。内置 gonggong（提问、聊天记录、群信息等）始终注入。',
            )}
          </div>
          <McpSaved force={layer.savedForce} />
        </div>
      </div>
    </AdminPage>
  )
}

function AddMcpDialog({
  secretsBase,
  taken,
  onClose,
  onAdd,
}: {
  secretsBase: string
  taken: string[]
  onClose: () => void
  onAdd: (c: McpServer) => void
}) {
  const [transport, setTransport] = useState<McpServer['transport']>('stdio')
  const [f, setF] = useState({ name: '', command: '', args: '', url: '' })
  const [pairs, setPairs] = useState<Pair[]>([])
  const [error, setError] = useState('')
  const formId = useId()
  const { data: secrets } = useGet<SecretDto[]>(secretsBase)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const submit = () => {
    const name = f.name.trim()
    if (!name) return setError(t('请填写名称'))
    if (name === RESERVED) return setError(t('{name} 是系统内置 MCP 的名称', { name: RESERVED }))
    if (taken.includes(name)) return setError(t('MCP 名称已存在'))
    const filled = pairs.map((p) => ({ key: p.key.trim(), value: p.value.trim() })).filter((p) => p.key)
    const plain = filled.find((p) => !SECRET_REF.test(p.value))
    if (plain)
      return setError(t('{key} 的值只能引用密钥：{ref}', { key: plain.key, ref: secretRef(t('名称')) }))
    const record = Object.fromEntries(filled.map((p) => [p.key, p.value]))
    if (transport === 'stdio') {
      if (!f.command.trim()) return setError(t('请填写命令'))
      const args = f.args
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean)
      return onAdd({ transport, name, command: f.command.trim(), args, env: record })
    }
    if (!/^https?:\/\//.test(f.url.trim())) return setError(t('URL 需以 http:// 或 https:// 开头'))
    onAdd({ transport, name, url: f.url.trim(), headers: record })
  }

  const count = pairs.filter((p) => p.key.trim()).length
  return (
    <Dialog
      open
      title={t('添加 MCP')}
      message={t('保存后，相关 Bot 下一轮新会话生效。')}
      width={560}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('添加'), variant: 'primary', type: 'submit', form: formId },
      ]}
    >
      <Form id={formId} onSubmit={submit}>
        <FormRow label={t('传输方式')}>
          <SegmentedControl
            aria-label={t('传输方式')}
            size="small"
            items={[
              { value: 'stdio' as const, label: 'Stdio' },
              { value: 'http' as const, label: 'HTTP' },
            ]}
            value={transport}
            onChange={setTransport}
          />
        </FormRow>
        <FormRow label={t('名称')}>
          <TextField
            aria-label={t('名称')}
            mono
            value={f.name}
            onChange={set('name')}
            placeholder="wiki-search"
            autoFocus
          />
        </FormRow>
        {transport === 'stdio' ? (
          <>
            <FormRow label={t('命令')}>
              <TextField
                aria-label={t('命令')}
                mono
                value={f.command}
                onChange={set('command')}
                placeholder="npx"
              />
            </FormRow>
            <FormRow label={t('参数')} align="top" hint={t('每行一个。')}>
              <TextField
                multiline
                aria-label={t('参数')}
                className="cfg__mono"
                rows={3}
                value={f.args}
                onChange={set('args')}
              />
            </FormRow>
          </>
        ) : (
          <FormRow label="URL">
            <TextField
              aria-label="URL"
              mono
              value={f.url}
              onChange={set('url')}
              placeholder="https://mcp.corp/wiki"
            />
          </FormRow>
        )}
      </Form>
      <Disclosure
        variant="group"
        title={transport === 'stdio' ? t('环境变量') : t('请求头')}
        summary={count ? t('{n} 项', { n: count }) : t('未设置')}
      >
        <SecretPairs pairs={pairs} secrets={secrets ?? []} onChange={setPairs} />
      </Disclosure>
      {error ? <Alert variant="error" title={error} /> : null}
    </Dialog>
  )
}
