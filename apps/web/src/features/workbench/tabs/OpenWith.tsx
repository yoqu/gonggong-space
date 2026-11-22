import type { OpenApp, OpenAppsDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { api, errorText } from '../../../lib/api'
import { useGet } from '../../../lib/useGet'
import { Icon, MenuButton, toast } from '../../../ui'
import cursor from '../apps/cursor.png'
import finder from '../apps/finder.png'
import idea from '../apps/idea.png'
import iterm from '../apps/iterm.svg'
import terminal from '../apps/terminal.png'
import vscode from '../apps/vscode.png'
import warp from '../apps/warp.svg'

const APPS: Record<OpenApp, { name: string; icon: string | null }> = {
  finder: { name: t('访达'), icon: finder },
  cursor: { name: 'Cursor', icon: cursor },
  idea: { name: 'IntelliJ IDEA', icon: idea },
  vscode: { name: 'VS Code', icon: vscode },
  warp: { name: 'Warp', icon: warp },
  iterm: { name: 'iTerm', icon: iterm },
  terminal: { name: t('终端'), icon: terminal },
  files: { name: t('文件管理器'), icon: null },
}

const KEY = 'gg.openWith'

function loadSaved(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function savePick(app: OpenApp) {
  try {
    localStorage.setItem(KEY, app)
  } catch {
    // storage unavailable (private mode): choice lasts for this render only
  }
}

const AppIcon = ({ app }: { app: OpenApp }) => {
  const icon = APPS[app].icon
  return icon ? <img className="open-with__icon" src={icon} alt="" /> : <Icon name="folder" size={16} />
}

/**
 * 用本地应用打开: the bot's machine opens its workspace in the app picked (last pick remembered). Shown only to the
 * machine's owner while it is online — the server refuses the listing otherwise.
 */
export function OpenWith({ groupId, botId }: { groupId: string; botId: string }) {
  const base = `/groups/${groupId}/bots/${botId}`
  const { data } = useGet<OpenAppsDto>(`${base}/open-apps`)
  const [saved, setSaved] = useState(loadSaved)
  const apps = data?.apps ?? []
  if (!apps.length) return null
  const current = apps.find((a) => a === saved) ?? (apps[0] as OpenApp)

  const open = async (app: OpenApp) => {
    try {
      await api.post(`${base}/open`, { app })
    } catch (e) {
      toast({ type: 'error', title: t('无法用 {app} 打开', { app: APPS[app].name }), message: errorText(e) })
    }
  }
  const pick = (app: OpenApp) => {
    savePick(app)
    setSaved(app)
    void open(app)
  }

  return (
    <div className="open-with">
      <button
        type="button"
        className="open-with__main"
        title={t('用 {app} 打开', { app: APPS[current].name })}
        aria-label={t('用 {app} 打开', { app: APPS[current].name })}
        onClick={() => void open(current)}
      >
        <AppIcon app={current} />
      </button>
      <MenuButton
        className="open-with__more"
        aria-label={t('选择打开方式')}
        align="end"
        items={apps.map((a) => ({
          value: a,
          label: a === current ? t('{app}（默认）', { app: APPS[a].name }) : APPS[a].name,
          icon: <AppIcon app={a} />,
        }))}
        onSelect={(v) => pick(v as OpenApp)}
      >
        <Icon name="chevron-down" size={12} />
      </MenuButton>
    </div>
  )
}
