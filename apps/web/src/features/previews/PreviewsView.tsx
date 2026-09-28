import { api } from '../../lib/api'
import { Button, EmptyState, GroupBox, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import './previews.css'
import { openUrl, usePreviews } from './store'

const SERVICE_STATE = { starting: '启动中', running: '运行中', exited: '已退出', failed: '启动失败' }

async function act(path: string) {
  try {
    await api.post(path)
  } catch (e) {
    toast({ type: 'error', message: errorText(e) })
  }
}

/** 群设置 · 预览与服务: what the group's bots published and host; the bot owner or a group admin may end them. */
export function PreviewsView({ groupId }: { groupId: string }) {
  const list = usePreviews(groupId)
  if (!list) return null
  return (
    <>
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">预览 {list.previews.length} 个</span>
      </div>
      {list.previews.length ? (
        <GroupBox>
          {list.previews.map((p) => (
            <div key={p.id} className="pv-row">
              <span className="pv-row__main">
                <a href={openUrl(p.id, p.path)} target="_blank" rel="noreferrer" className="pv-row__title">
                  {p.title}
                </a>
                <span className="pv-muted">
                  {p.botName} · {p.status === 'online' ? '在线' : '离线'}
                  {p.serviceName ? ` · 服务 ${p.serviceName}` : ''}
                </span>
              </span>
              {p.canManage ? (
                <Button variant="plain" size="small" onClick={() => void act(`/previews/${p.id}/close`)}>
                  关闭
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : (
        <EmptyState compact title="暂无预览" />
      )}
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">托管服务 {list.services.length} 个</span>
      </div>
      {list.services.length ? (
        <GroupBox>
          {list.services.map((s) => (
            <div key={s.id} className="pv-row">
              <span className="pv-row__main">
                <span className="pv-row__title">{s.name}</span>
                <span className="pv-muted pv-mono">
                  {SERVICE_STATE[s.status]}
                  {s.port ? ` · 端口 ${s.port}` : ''} · {s.cwd ? `${s.cwd}$ ` : '$ '}
                  {s.command}
                </span>
              </span>
              {s.canManage ? (
                <Button variant="plain" size="small" onClick={() => void act(`/services/${s.id}/stop`)}>
                  停止
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : (
        <EmptyState compact title="暂无托管服务" />
      )}
      <div className="gs-foot">
        Bot 用 service_start 启动的服务由它所在的机器托管，本轮结束后仍在运行；预览 24
        小时无人访问会自动关闭。停止服务会一并关闭它的预览。
      </div>
    </>
  )
}
