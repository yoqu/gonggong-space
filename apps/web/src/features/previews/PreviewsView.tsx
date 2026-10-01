import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Button, EmptyState, GroupBox } from '../../ui'
import './previews.css'
import { t } from '../../i18n'
import { openInWorkbench, openUrl, usePreviews } from './store'

const SERVICE_STATE = {
  starting: t('启动中'),
  running: t('运行中'),
  exited: t('已退出'),
  failed: t('启动失败'),
}

const act = (path: string) => attempt(() => api.post(path))

/**
 * 群设置 · 预览与服务: what the group's bots published and host; the bot owner or a group admin may end them.
 * `onOpen` runs after a preview opened in the workbench, so the settings get out of its way.
 */
export function PreviewsView({ groupId, onOpen }: { groupId: string; onOpen?: () => void }) {
  const list = usePreviews(groupId)
  if (!list) return null
  return (
    <>
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">{t('预览 {n} 个', { n: list.previews.length })}</span>
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
                  {p.botName} · {p.status === 'online' ? t('在线') : t('离线')}
                  {p.serviceName ? t(' · 服务 {name}', { name: p.serviceName }) : ''}
                </span>
              </span>
              {p.status === 'online' ? (
                <Button
                  variant="plain"
                  size="small"
                  onClick={() => {
                    if (openInWorkbench(p)) onOpen?.()
                  }}
                >
                  {t('在工作台打开')}
                </Button>
              ) : null}
              {p.canManage ? (
                <Button variant="plain" size="small" onClick={() => void act(`/previews/${p.id}/close`)}>
                  {t('关闭#close')}
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : (
        <EmptyState compact title={t('暂无预览')} />
      )}
      <div className="gs-toolbar">
        <span className="gs-toolbar__text">{t('托管服务 {n} 个', { n: list.services.length })}</span>
      </div>
      {list.services.length ? (
        <GroupBox>
          {list.services.map((s) => (
            <div key={s.id} className="pv-row">
              <span className="pv-row__main">
                <span className="pv-row__title">{s.name}</span>
                <span className="pv-muted pv-mono">
                  {SERVICE_STATE[s.status]}
                  {s.port ? t(' · 端口 {port}', { port: s.port }) : ''} · {s.cwd ? `${s.cwd}$ ` : '$ '}
                  {s.command}
                </span>
              </span>
              {s.canManage ? (
                <Button variant="plain" size="small" onClick={() => void act(`/services/${s.id}/stop`)}>
                  {t('停止')}
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : (
        <EmptyState compact title={t('暂无托管服务')} />
      )}
      <div className="gs-foot">
        {t(
          'Bot 用 service_start 启动的服务由它所在的机器托管，本轮结束后仍在运行；预览 24 小时无人访问会自动关闭。服务停止后预览卡片保留，Bot 重启服务或在卡片上点启动即可恢复。',
        )}
      </div>
    </>
  )
}
