import type { DevtoolsBlocker } from '@gonggong/protocol'
import { t } from '../../i18n'
import { ProgressIndicator } from '../../ui'
import './devtools-guide.css'

const GUIDE: Record<DevtoolsBlocker, { title: string; steps: string[] }> = {
  port: {
    title: t('请开启微信开发者工具的服务端口'),
    steps: [t('打开微信开发者工具'), t('菜单栏「设置 → 安全设置」'), t('打开「服务端口」')],
  },
  auth: {
    title: t('请在微信开发者工具里允许共工空间访问'),
    steps: [t('切换到微信开发者工具'), t('在「Gonggong」授权弹窗中点击「允许」')],
  },
  trust: {
    title: t('请在微信开发者工具里信任此项目'),
    steps: [
      t('切换到微信开发者工具'),
      t('在「您信任此项目的作者吗？」弹窗中点击「信任并运行」'),
      t('若没有弹窗，请查看开发者工具的编译输出'),
    ],
  },
}

/** The steps the machine's owner takes in the WeChat devtools, over a looping sketch of them; picked up on its own. */
export function DevtoolsGuide({ blocker, owner }: { blocker: DevtoolsBlocker; owner?: string }) {
  const g = GUIDE[blocker]
  return (
    <div className="dg" role="status">
      <div className="dg__art" aria-hidden="true">
        {blocker === 'port' ? <PortSketch /> : <DialogSketch blocker={blocker} />}
      </div>
      <div className="dg__title">{g.title}</div>
      {owner ? <div className="dg__owner">{owner}</div> : null}
      <ol className="dg__steps">
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="dg__wait">
        <ProgressIndicator variant="spinner" aria-label={t('正在等待')} />
        {t('完成后自动继续')}
      </div>
    </div>
  )
}

function PortSketch() {
  return (
    <div className="dg-win">
      <div className="dg-win__bar">
        <i />
        <i />
        <i />
        <span>{t('设置')}</span>
      </div>
      <div className="dg-win__body">
        <div className="dg-win__side">
          <span>{t('通用')}</span>
          <span>{t('外观')}</span>
          <span className="dg-win__on">{t('安全设置')}</span>
          <span>{t('代理')}</span>
        </div>
        <div className="dg-win__main">
          <div className="dg-row">
            <span>{t('服务端口')}</span>
            <span className="dg-toggle" />
          </div>
          <div className="dg-row dg-row--dim">
            <span>{t('CLI 访问令牌')}</span>
            <span className="dg-toggle dg-toggle--off" />
          </div>
        </div>
      </div>
      <span className="dg-cursor dg-cursor--port" />
    </div>
  )
}

function DialogSketch({ blocker }: { blocker: 'auth' | 'trust' }) {
  return (
    <div className="dg-win dg-win--dialog">
      <div className="dg-dialog__title">
        {blocker === 'auth' ? t('「Gonggong」请求访问微信开发者工具') : t('您信任此项目的作者吗？')}
      </div>
      <div className="dg-dialog__buttons">
        <span>{blocker === 'auth' ? t('拒绝') : t('取消')}</span>
        <span className="dg-dialog__primary">{blocker === 'auth' ? t('允许') : t('信任并运行')}</span>
      </div>
      <span className="dg-cursor dg-cursor--dialog" />
    </div>
  )
}

/** A mini program's live view while its devtools start and compile it. */
export function DevtoolsLoading() {
  return (
    <div className="dg" role="status">
      <ProgressIndicator
        variant="spinner"
        aria-label={t('正在打开微信开发者工具')}
        style={{ width: 28, height: 28 }}
      />
      <div className="dg__title">{t('正在打开微信开发者工具…')}</div>
      <div className="dg__owner">{t('启动开发者工具并编译小程序，首次可能需要几十秒')}</div>
    </div>
  )
}
