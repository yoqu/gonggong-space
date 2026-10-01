import { GONGGONG_TOOLS, type McpServer, type McpServerDto } from '@gonggong/protocol'
import { type CSSProperties, useCallback, useEffect, useId, useState } from 'react'
import { api, errorText } from '../../lib/api'
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
import './config.css'
import { t } from '../../i18n'

const TITLE = t('配置中心')
const DESC = t('仓库基线之上叠加服务器全局层与群层，冲突时服务器优先；不修改仓库文件。')
/** Name of the daemon's built-in MCP server; the server rejects it too. */
const RESERVED = 'gonggong'
const BUILTIN_TOOLS = [
  t('向群成员提问'),
  ...Object.values(GONGGONG_TOOLS).map((tool) => t.text({ key: tool.title })),
].join(t('、'))

type CType = 'mcp' | 'skill' | 'prompt' | 'secret'
const LAYERS = [
  { value: 'global' as const, label: t('服务器全局层') },
  { value: 'group' as const, label: t('服务器群层'), disabled: true },
]
const CTYPES: { value: CType; label: string }[] = [
  { value: 'mcp', label: 'MCP' },
  { value: 'skill', label: 'Skill' },
  { value: 'prompt', label: t('指令') },
  { value: 'secret', label: t('团队密钥') },
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

/** 管理后台 · 配置中心: only the global MCP layer is editable (spec §7.1–7.4). */
export function ConfigPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [ctype, setCtype] = useState<CType>('mcp')
  const [force, setForce] = useState(false)
  const [savedForce, setSavedForce] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems((await api.get<McpServerDto[]>('/admin/mcp')).map(fromDto))
      setRemoved([])
      setLoadError('')
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const dirty = removed.length > 0 || !!items?.some((i) => !i.saved || i.enabled !== i.saved.enabled)
  const edit = (next: Item[]) => {
    setItems(next)
    setSavedForce(null)
  }

  const save = async () => {
    if (!items) return
    setBusy(true)
    try {
      for (const id of removed) await api.del(`/admin/mcp/${id}?forceNewSession=${force}`)
      for (const i of items) {
        const body = { enabled: i.enabled, config: i.config, forceNewSession: force }
        if (!i.saved) await api.post('/admin/mcp', body)
        else if (i.enabled !== i.saved.enabled) await api.patch(`/admin/mcp/${i.saved.id}`, body)
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

  const enabledNames = items?.filter((i) => i.enabled).map((i) => i.config.name) ?? []

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
        <Tabs items={LAYERS} value="global" onChange={() => undefined} />
        <span className="spacer" />
        <Tabs items={CTYPES} value={ctype} onChange={setCtype} />
      </div>
      {loadError ? (
        <Alert variant="error" title={t('配置加载失败')} description={loadError}>
          <div className="cfg__retry">
            <Button size="small" onClick={() => void load()}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="cfg">
        <div className="cfg__list">
          {ctype !== 'mcp' ? (
            <EmptyState
              illustration={<UnsupportedArt />}
              title={t('暂不支持 {type}', { type: CTYPES.find((c) => c.value === ctype)?.label ?? '' })}
              description={t('目前只能配置服务器全局层的 MCP。MCP 的环境变量以明文保存在配置中。')}
            />
          ) : (
            <>
              <GroupBox>
                {items?.map((i) => (
                  <GroupRow
                    key={i.key}
                    className="cfg__item"
                    label={
                      <span className="cfg__name-line">
                        <span className="cfg__name">{i.config.name}</span>
                        <Tag tone="blue">{t('全局层')}</Tag>
                        {i.saved ? null : <Tag tone="orange">{t('未保存')}</Tag>}
                      </span>
                    }
                    description={describeMcp(i.config)}
                  >
                    <span className="cfg__controls">
                      <IconButton
                        title={t('删除 {name}', { name: i.config.name })}
                        size="regular"
                        onClick={() => {
                          if (i.saved) setRemoved((r) => [...r, i.key])
                          edit(items.filter((x) => x !== i))
                        }}
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
                <Checkbox label={t('强制相关 Bot 下一轮开新会话')} checked={force} onChange={setForce} />
                <HelpButton
                  help={t(
                    '勾选后，受影响的 Bot 下一轮会放弃已有会话、按新配置重开，卡片会提示原因；不勾选则已有会话继续使用旧配置。',
                  )}
                />
                <span className="spacer" />
                <Button onClick={() => setAdding(true)}>{t('添加 MCP…')}</Button>
                <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
                  {t('保存')}
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="cfg__preview">
          <div className="cfg__eyebrow">{t('合并预览 · 全部 Bot')}</div>
          {[
            { name: t('服务器群层'), pri: t('优先级高'), color: 'var(--system-blue)', text: t('暂未开放') },
            {
              name: t('服务器全局层'),
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
              '合并在 daemon 内存完成；MCP 在新建会话时经 ACP 注入不落盘；skill 与指令写入 agent 本地专用文件并加入 .git/info/exclude。内置 gonggong（提问、聊天记录、群信息等）始终注入。',
            )}
          </div>
          {savedForce === null ? null : (
            <Alert
              variant="success"
              title={t('已保存，全员下一轮新会话生效')}
              description={
                savedForce
                  ? t('已要求相关 Bot 下一轮开新会话，卡片会提示原因。')
                  : t('运行中的轮次不受影响；已有会话继续使用旧配置。')
              }
            />
          )}
        </div>
      </div>
      <Presence>
        {adding && items ? (
          <AddMcpDialog
            taken={items.map((i) => i.config.name)}
            onClose={() => setAdding(false)}
            onAdd={(config) => {
              edit([...items, { key: `new:${config.name}`, enabled: true, config, saved: null }])
              setAdding(false)
            }}
          />
        ) : null}
      </Presence>
    </AdminPage>
  )
}

/** `KEY=VALUE` / `Key: Value` lines → record, split at the first separator. */
const pairs = (text: string, sep: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(sep))
      .map((l) => [l.slice(0, l.indexOf(sep)).trim(), l.slice(l.indexOf(sep) + 1).trim()]),
  )

function AddMcpDialog({
  taken,
  onClose,
  onAdd,
}: {
  taken: string[]
  onClose: () => void
  onAdd: (c: McpServer) => void
}) {
  const [transport, setTransport] = useState<McpServer['transport']>('stdio')
  const [f, setF] = useState({ name: '', command: '', args: '', env: '', url: '', headers: '' })
  const [error, setError] = useState('')
  const formId = useId()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const submit = () => {
    const name = f.name.trim()
    if (!name) return setError(t('请填写名称'))
    if (name === RESERVED) return setError(t('{name} 是系统内置 MCP 的名称', { name: RESERVED }))
    if (taken.includes(name)) return setError(t('MCP 名称已存在'))
    if (transport === 'stdio') {
      if (!f.command.trim()) return setError(t('请填写命令'))
      const args = f.args
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean)
      return onAdd({ transport, name, command: f.command.trim(), args, env: pairs(f.env, '=') })
    }
    if (!/^https?:\/\//.test(f.url.trim())) return setError(t('URL 需以 http:// 或 https:// 开头'))
    onAdd({ transport, name, url: f.url.trim(), headers: pairs(f.headers, ':') })
  }

  const lines = (text: string) => text.split('\n').filter((l) => l.trim()).length
  return (
    <Dialog
      open
      title={t('添加 MCP')}
      message={t('保存配置中心后，全员下一轮新会话生效。')}
      width={520}
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
      {transport === 'stdio' ? (
        <Disclosure
          variant="group"
          title={t('环境变量')}
          summary={lines(f.env) ? t('{n} 项', { n: lines(f.env) }) : t('未设置')}
        >
          <TextField
            multiline
            aria-label={t('环境变量')}
            hint={t('每行一个 KEY=VALUE；以明文保存，只在新建会话时经 ACP 注入。')}
            className="cfg__mono"
            rows={3}
            value={f.env}
            onChange={set('env')}
          />
        </Disclosure>
      ) : (
        <Disclosure
          variant="group"
          title={t('请求头')}
          summary={lines(f.headers) ? t('{n} 项', { n: lines(f.headers) }) : t('未设置')}
        >
          <TextField
            multiline
            aria-label={t('请求头')}
            hint={t('每行一个 Key: Value；以明文保存，只在新建会话时经 ACP 注入。')}
            className="cfg__mono"
            rows={3}
            value={f.headers}
            onChange={set('headers')}
          />
        </Disclosure>
      )}
      {error ? <Alert variant="error" title={error} /> : null}
    </Dialog>
  )
}
