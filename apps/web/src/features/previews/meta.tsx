import type { PreviewDto, ServiceDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import type { TagTone } from '../../ui'
import type { PreviewTechInfo } from './merge'

export const PREVIEW_BADGE: Record<PreviewDto['status'], { text: string; tone: TagTone }> = {
  online: { text: t('在线'), tone: 'green' },
  stopped: { text: t('服务已停止'), tone: 'orange' },
  offline: { text: t('离线'), tone: 'gray' },
}

export const SERVICE_STATE: Record<ServiceDto['status'], { text: string; tone: TagTone }> = {
  starting: { text: t('启动中'), tone: 'orange' },
  running: { text: t('运行中'), tone: 'green' },
  exited: { text: t('已退出'), tone: 'gray' },
  failed: { text: t('启动失败'), tone: 'red' },
}

export function previewKindLabel(p: Pick<PreviewDto, 'kind' | 'serviceId' | 'port'>) {
  if (p.kind === 'static') return t('静态页面')
  if (p.kind === 'gui') return t('桌面应用')
  if (p.kind === 'miniprogram') return t('小程序')
  return p.serviceId ? t('网页应用') : p.port ? t('外部端口 {port}', { port: p.port }) : t('外部端口')
}

export const startPreview = (previewId: string) => api.post(`/previews/${previewId}/start`)

export function PreviewTechDetails({
  tech,
  className = 'pv-tech',
}: {
  tech: PreviewTechInfo
  className?: string
}) {
  return (
    <div className={className}>
      {tech.port !== null ? <span>{t('端口 {port}', { port: `127.0.0.1:${tech.port}` })}</span> : null}
      {tech.path ? <span>{t('路径 {path}', { path: tech.path })}</span> : null}
      {tech.serviceName ? <span>{t('服务 {name}', { name: tech.serviceName })}</span> : null}
      {tech.command ? <span>$ {tech.command}</span> : null}
    </div>
  )
}
