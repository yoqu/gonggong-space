import type { BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { copyText } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { Button, Icon, RadioGroup, toast } from '../../ui'
import { Panel } from './SidePanel'
import { screenLink, useArtifactShare } from './share'

type Format = 'zip' | 'code' | 'brief' | 'share'

/** GET /api/artifacts/:id/export.zip — the version's files and the prototype shell, as `<slug>-v<n>.zip`. */
export const exportZipUrl = (artifactId: string, versionId: string) =>
  `/api/artifacts/${artifactId}/export.zip?version=${encodeURIComponent(versionId)}`

function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.click()
}

/**
 * Stitch's Export (capability list §9) for what 共工 hosts: the artifact as a zip, the screens' code, a PRD by the bot,
 * or the share link. It exports the whole artifact, so no selection is needed; Copy code takes the selected screens.
 */
export function ExportPanel({
  artifactId,
  versionId,
  screens,
  selected,
  bot,
  shareDenied,
  readFile,
  onBrief,
  onClose,
}: {
  artifactId: string
  versionId: string
  /** Every screen of the shown version. */
  screens: { id: string; title: string; file: string }[]
  /** The selected screens' ids; none: all of them. */
  selected: string[]
  bot: BotDto | null
  /** Why this member cannot turn sharing on; null when they can. */
  shareDenied: string | null
  readFile: (file: string) => Promise<string>
  onBrief: () => Promise<boolean>
  onClose: () => void
}) {
  const [format, setFormat] = useState<Format>('zip')
  const [busy, setBusy] = useState(false)
  const { share, busy: sharing, set } = useArtifactShare(artifactId)
  const picked = selected.length ? screens.filter((s) => selected.includes(s.id)) : screens
  const scope = selected.length
    ? t('所选的 {n} 个屏幕', { n: picked.length })
    : t('全部 {n} 个屏幕', { n: screens.length })

  const copyCode = async () => {
    setBusy(true)
    try {
      const parts = await Promise.all(
        picked.map(async (s) => `<!-- ${s.file} -->\n${await readFile(s.file)}`),
      )
      await copyText(parts.join('\n\n'))
      toast({ type: 'success', message: t('已复制 {n} 个屏幕的代码', { n: picked.length }) })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const copyLink = async () => {
    const s = share?.enabled ? share : await set(true)
    if (!s?.url) return
    await copyText(screenLink(s.url)).then(
      () => toast({ type: 'success', message: t('链接已复制') }),
      () => toast({ type: 'error', message: t('复制失败') }),
    )
  }
  const run = async () => {
    if (format === 'zip') return download(exportZipUrl(artifactId, versionId))
    if (format === 'code') return copyCode()
    if (format === 'share') return copyLink()
    setBusy(true)
    await onBrief()
    setBusy(false)
  }

  const FORMATS: Record<Format, { label: string; note: string; action: string }> = {
    zip: {
      label: '.zip',
      note: t('下载这个版本的全部文件和原型外壳，解压后用任意静态服务器打开 index.html 即可演示。'),
      action: t('导出'),
    },
    code: {
      label: t('复制代码'),
      note: t('把{scope}的 HTML 源码复制到剪贴板。', { scope }),
      action: t('复制'),
    },
    brief: {
      label: t('项目简报'),
      note: bot
        ? t('让 @{name} 根据产物写一份产品需求文档（PRD），保存为 brief.md，屏幕详情里的设计说明也会读它。', {
            name: bot.name,
          })
        : t('群里没有 Bot'),
      action: t('生成项目简报'),
    },
    share: {
      label: t('分享链接'),
      note: share?.enabled
        ? t('分享已开启，复制链接发给别人即可查看。')
        : (shareDenied ?? t('开启分享并复制链接：任何拿到链接的人都能查看，可随时在「分享」里关闭。')),
      action: share?.enabled ? t('复制链接') : t('开启并复制链接'),
    },
  }
  const f = FORMATS[format]
  const disabled =
    busy ||
    sharing ||
    (format === 'brief' && !bot) ||
    (format === 'share' && !share?.enabled && !!shareDenied) ||
    (format === 'code' && !picked.length)

  return (
    <Panel title={t('导出')} onClose={onClose}>
      <div className="art-export" data-testid="art-export">
        <p className="art-export__scope">
          <Icon name={selected.length && format === 'code' ? 'checkmark-circle' : 'grid'} size={14} />
          {!selected.length
            ? t('未选择屏幕时导出整个产物（{scope}）', { scope })
            : format === 'code'
              ? scope
              : t('导出整个版本（全部 {n} 个屏幕），与选中无关', { n: screens.length })}
        </p>
        <h4 className="art-panel__label">{t('格式')}</h4>
        <RadioGroup<Format>
          aria-label={t('格式')}
          value={format}
          onChange={setFormat}
          options={(Object.keys(FORMATS) as Format[]).map((k) => ({ value: k, label: FORMATS[k].label }))}
        />
        <p className="art-export__note">{f.note}</p>
      </div>
      <div className="art-el__foot">
        <Button variant="primary" loading={busy || sharing} disabled={disabled} onClick={() => void run()}>
          {f.action}
        </Button>
      </div>
    </Panel>
  )
}
