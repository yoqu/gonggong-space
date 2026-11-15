import type { ClientDownloads } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { Icon, type IconName } from '../../ui'

const GITHUB_RELEASES = 'https://github.com/yoqu/gonggong-space/releases/latest'

interface Option {
  platform: string
  label: string
  icon: IconName
  cli: boolean
  url: string
}

/** Published platforms in display order; Linux has no desktop app, so it gets the gg CLI. */
const PLATFORMS: { platform: string; label: string; icon: IconName; cli: boolean }[] = [
  { platform: 'macos-aarch64', label: t('macOS（Apple 芯片）'), icon: 'apple', cli: false },
  { platform: 'macos-x86_64', label: t('macOS（Intel）'), icon: 'apple', cli: false },
  { platform: 'windows-x86_64', label: 'Windows', icon: 'windows', cli: false },
  { platform: 'linux-x86_64', label: t('Linux x86_64（命令行）'), icon: 'linux', cli: true },
  { platform: 'linux-aarch64', label: t('Linux aarch64（命令行）'), icon: 'linux', cli: true },
]

interface UserAgentData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
}

/** Apple silicon Macs report an Intel user agent; their GPU gives them away where UA client hints are missing. */
function appleGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? /apple/i.test(String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL))) : null
  } catch {
    return null
  }
}

/** The `<os>-<arch>` of the browser's machine, or null on phones and unknown systems. */
async function detectPlatform(): Promise<string | null> {
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad/.test(ua)) return null
  const os = /Windows/.test(ua)
    ? 'windows'
    : /Macintosh|Mac OS X/.test(ua)
      ? 'macos'
      : /Linux/.test(ua)
        ? 'linux'
        : null
  if (!os) return null
  if (os === 'windows') return 'windows-x86_64'
  const hints = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  const arch = await hints
    ?.getHighEntropyValues?.(['architecture'])
    .then((v) => v.architecture)
    .catch(() => undefined)
  const arm = arch ? arch === 'arm' : os === 'macos' ? appleGpu() !== false : /aarch64|arm/i.test(ua)
  return `${os}-${arm ? 'aarch64' : 'x86_64'}`
}

/** 下载客户端 of 绑定新机器: the installer for the browser's system up front, the others one click away. */
export function ClientDownload({ open }: { open: boolean }) {
  const [downloads, setDownloads] = useState<ClientDownloads | null | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [recommended, setRecommended] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void api
      .get<ClientDownloads | null>('/client-downloads')
      .then(setDownloads)
      .catch(() => setDownloads(null))
    void detectPlatform().then((p) => {
      setRecommended(p)
      setSelected(p)
    })
  }, [open])

  const options: Option[] = PLATFORMS.flatMap((p) => {
    const url = (p.cli ? downloads?.builds : downloads?.desktop)?.[p.platform]?.url
    return url ? [{ ...p, url }] : []
  })
  if (downloads === undefined) return null
  const current = options.find((o) => o.platform === selected) ?? options[0]
  const guess = PLATFORMS.find((p) => p.platform === recommended)

  if (!downloads || !current)
    return (
      <div className="client-dl">
        <div className="client-dl__card">
          <span className="client-dl__icon">
            <Icon name={guess?.icon ?? 'github'} size={28} />
          </span>
          <span className="client-dl__text">
            <span className="client-dl__title">{t('下载共工空间客户端')}</span>
            <span className="client-dl__sub">{t('本空间尚未发布客户端，可从 GitHub 获取最新版本')}</span>
          </span>
          <a
            className="ui-btn ui-btn--primary client-dl__btn"
            href={GITHUB_RELEASES}
            target="_blank"
            rel="noreferrer"
          >
            {t('前往 GitHub 下载')}
          </a>
        </div>
      </div>
    )

  return (
    <div className="client-dl">
      <div className="client-dl__card">
        <span className="client-dl__icon">
          <Icon name={current.icon} size={28} />
        </span>
        <span className="client-dl__text">
          <span className="client-dl__title">{current.label}</span>
          <span className="client-dl__sub">
            {current.cli
              ? t('命令行客户端 · v{version}', { version: downloads.version })
              : t('桌面客户端 · v{version}', { version: downloads.version })}
          </span>
        </span>
        <a
          className="ui-btn ui-btn--primary client-dl__btn"
          href={current.url}
          download
          aria-label={t('下载 {name}', { name: current.label })}
        >
          {t('下载')}
        </a>
      </div>
      {options.length > 1 ? (
        <fieldset className="client-dl__options" aria-label={t('选择系统')}>
          {options.map((o) => (
            <label key={o.platform} className="client-dl__option">
              <input
                type="radio"
                name="client-platform"
                className="client-dl__radio"
                checked={o.platform === current.platform}
                onChange={() => setSelected(o.platform)}
              />
              <Icon name={o.icon} size={14} />
              <span>{o.label}</span>
              {o.platform === recommended ? <span className="client-dl__badge">{t('推荐')}</span> : null}
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}
