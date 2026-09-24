import { AIWS_TOOLS, type McpServer, type McpServerDto } from '@aiws/protocol'
import { MessageCircleQuestionMark, Plug, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Presence,
  Switch,
  Tabs,
  Textarea,
  toast,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { errorText } from '../auth/AuthCard'
import './config.css'

const TITLE = '配置中心'
const DESC = '仓库基线之上叠加服务器全局层与群层，冲突时服务器优先；不修改仓库文件。'
/** Name of the daemon's built-in MCP server; the server rejects it too. */
const RESERVED = 'aiws'
const BUILTIN_TOOLS = ['向群成员提问', ...Object.values(AIWS_TOOLS).map((t) => t.title)].join('、')

type CType = 'mcp' | 'skill' | 'prompt' | 'secret'
const LAYERS = [
  { value: 'global' as const, label: '服务器全局层' },
  { value: 'group' as const, label: '服务器群层', disabled: true },
]
const CTYPES: { value: CType; label: string }[] = [
  { value: 'mcp', label: 'MCP' },
  { value: 'skill', label: 'Skill' },
  { value: 'prompt', label: '指令' },
  { value: 'secret', label: '团队密钥' },
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
      toast({ type: 'error', title: '保存失败', message: errorText(e) })
    } finally {
      await load()
      setBusy(false)
    }
  }

  const enabledNames = items?.filter((i) => i.enabled).map((i) => i.config.name) ?? []

  return (
    <AdminPage title={TITLE} desc={DESC}>
      <div className="cfg__bar">
        <Tabs items={LAYERS} value="global" onChange={() => undefined} />
        <span className="spacer" />
        <Tabs size="sm" items={CTYPES} value={ctype} onChange={setCtype} />
      </div>
      {loadError ? (
        <Alert variant="error" title="配置加载失败" description={loadError}>
          <div className="cfg__retry">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="cfg">
        <div className="cfg__list">
          {ctype !== 'mcp' ? (
            <EmptyState
              title={`暂不支持 ${CTYPES.find((c) => c.value === ctype)?.label}`}
              description="目前只能配置服务器全局层的 MCP。MCP 的环境变量以明文保存在配置中。"
            />
          ) : (
            <>
              {items?.map((i) => (
                <div key={i.key} className="cfg__item" data-testid="cfg-item">
                  <Plug size={15} className="cfg__icon" />
                  <div className="cfg__main">
                    <div className="cfg__name-line">
                      <span className="cfg__name">{i.config.name}</span>
                      <Badge variant="info" size="xs">
                        全局层
                      </Badge>
                      {i.saved ? null : (
                        <Badge variant="warning" size="xs">
                          未保存
                        </Badge>
                      )}
                    </div>
                    <span className="cfg__desc">{describeMcp(i.config)}</span>
                  </div>
                  <IconButton
                    title={`删除 ${i.config.name}`}
                    onClick={() => {
                      if (i.saved) setRemoved((r) => [...r, i.key])
                      edit(items.filter((x) => x !== i))
                    }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                  <Switch
                    checked={i.enabled}
                    onChange={(enabled) => edit(items.map((x) => (x === i ? { ...x, enabled } : x)))}
                  />
                </div>
              ))}
              <div className="cfg__item" data-testid="cfg-item">
                <MessageCircleQuestionMark size={15} className="cfg__icon" />
                <div className="cfg__main">
                  <div className="cfg__name-line">
                    <span className="cfg__name">{RESERVED}</span>
                    <Badge variant="secondary" size="xs">
                      内置
                    </Badge>
                  </div>
                  <span className="cfg__desc">系统内置 · 始终注入，不受层级影响</span>
                  <span className="cfg__tools">{BUILTIN_TOOLS}</span>
                </div>
                <Switch checked disabled onChange={() => undefined} />
              </div>
              <div className="cfg__foot">
                <Checkbox label="强制相关 bot 下一轮开新会话" checked={force} onChange={setForce} />
                <span className="spacer" />
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  添加 MCP
                </Button>
                <Button variant="primary" size="sm" disabled={!dirty || busy} onClick={() => void save()}>
                  保存
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="cfg__preview">
          <div className="cfg__eyebrow">合并预览 · 全部 bot</div>
          {[
            { name: '服务器群层', pri: '优先级高', color: 'var(--color-selection-blue)', text: '暂未开放' },
            {
              name: '服务器全局层',
              pri: '中',
              color: 'var(--color-brand-info)',
              text: `mcp: ${enabledNames.join(', ') || '无'}`,
            },
            {
              name: 'bot 系统提示词',
              pri: '',
              color: 'var(--color-text-tertiary)',
              text: '各 bot 在 Bot 页设置',
            },
            {
              name: '仓库基线',
              pri: '低',
              color: 'var(--color-border-strong)',
              text: '.mcp.json · .claude/ · AGENTS.md',
            },
          ].map((l) => (
            <div key={l.name} className="cfg__layer" style={{ borderLeftColor: l.color }}>
              <div className="cfg__layer-head">
                <span className="cfg__layer-name">{l.name}</span>
                <span className="cfg__layer-pri">{l.pri}</span>
              </div>
              <span className="cfg__layer-items">{l.text}</span>
            </div>
          ))}
          <div className="cfg__note">
            合并在 daemon 内存完成；MCP 在新建会话时经 ACP 注入不落盘；skill 与指令写入 agent
            本地专用文件并加入 .git/info/exclude。内置 aiws（提问、聊天记录、群信息等）始终注入。
          </div>
          {savedForce === null ? null : (
            <Alert
              variant="success"
              title="已保存，全员下一轮新会话生效"
              description={
                savedForce
                  ? '已要求相关 bot 下一轮开新会话，卡片会提示原因。'
                  : '运行中的轮次不受影响；已有会话继续使用旧配置。'
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
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const submit = () => {
    const name = f.name.trim()
    if (!name) return setError('请填写名称')
    if (name === RESERVED) return setError(`${RESERVED} 是系统内置 MCP 的名称`)
    if (taken.includes(name)) return setError('MCP 名称已存在')
    if (transport === 'stdio') {
      if (!f.command.trim()) return setError('请填写命令')
      const args = f.args
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean)
      return onAdd({ transport, name, command: f.command.trim(), args, env: pairs(f.env, '=') })
    }
    if (!/^https?:\/\//.test(f.url.trim())) return setError('URL 需以 http:// 或 https:// 开头')
    onAdd({ transport, name, url: f.url.trim(), headers: pairs(f.headers, ':') })
  }

  return (
    <Dialog
      open
      title="添加 MCP"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit}>
            添加
          </Button>
        </>
      }
    >
      <div className="admin-form">
        <Tabs
          size="sm"
          items={[
            { value: 'stdio' as const, label: 'Stdio' },
            { value: 'http' as const, label: 'HTTP' },
          ]}
          value={transport}
          onChange={setTransport}
        />
        <Field label="名称">
          <Input mono value={f.name} onChange={set('name')} placeholder="wiki-search" autoFocus />
        </Field>
        {transport === 'stdio' ? (
          <>
            <Field label="命令">
              <Input mono value={f.command} onChange={set('command')} placeholder="npx" />
            </Field>
            <Field label="参数（每行一个）">
              <Textarea className="cfg__mono" rows={3} value={f.args} onChange={set('args')} />
            </Field>
            <Field label="环境变量（每行 KEY=VALUE）">
              <Textarea className="cfg__mono" rows={3} value={f.env} onChange={set('env')} />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input mono value={f.url} onChange={set('url')} placeholder="https://mcp.corp/wiki" />
            </Field>
            <Field label="请求头（每行 Key: Value）">
              <Textarea className="cfg__mono" rows={3} value={f.headers} onChange={set('headers')} />
            </Field>
          </>
        )}
        <span className="cfg__hint">环境变量与请求头以明文保存，只在新建会话时经 ACP 注入。</span>
        {error ? <Alert variant="error" title={error} /> : null}
      </div>
    </Dialog>
  )
}
