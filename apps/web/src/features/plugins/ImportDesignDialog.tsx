import type { GroupDesignSystemDto } from '@gonggong/protocol'
import { type ChangeEvent, useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Dialog, DropZone, TextField } from '../../ui'
import { importDesignSystem } from './store'

/**
 * 导入我的设计 (Stitch's 「Start with your design」): a DESIGN.md pasted or uploaded, a reference site or a
 * repository, saved to the group so later creations can pick it too.
 */
export function ImportDesignDialog({
  groupId,
  onClose,
  onImported,
}: {
  groupId: string
  onClose: () => void
  onImported: (ds: GroupDesignSystemDto) => void
}) {
  const [designMd, setDesignMd] = useState('')
  const [url, setUrl] = useState('')
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const filled = (v: string) => v.trim() || undefined
  const body = { designMd: filled(designMd), url: filled(url), repo: filled(repo) }
  const empty = !body.designMd && !body.url && !body.repo

  const submit = async () => {
    setBusy(true)
    try {
      onImported(await importDesignSystem(groupId, body))
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      width={640}
      title={t('导入我的设计')}
      message={t('DESIGN.md 是描述产品外观的开放格式文档。导入后保存到本群，之后的创作都能选用。')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('继续'), variant: 'primary', disabled: empty || busy, onClick: () => void submit() },
      ]}
    >
      <div className="plg-import">
        <section className="plg-import__sec">
          <h4 className="plg-heading">{t('粘贴 DESIGN.md')}</h4>
          <TextField
            aria-label={t('粘贴 DESIGN.md')}
            multiline
            rows={6}
            placeholder={t('把 DESIGN.md 的内容粘贴到这里…')}
            value={designMd}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDesignMd(e.target.value)}
          />
          <DropZone
            compact
            accept=".md,text/markdown,text/plain"
            aria-label={t('上传 DESIGN.md 文件')}
            title={t('拖入 DESIGN.md 文件')}
            onFiles={([f]) => f?.text().then(setDesignMd, toastError)}
          />
        </section>
        <section className="plg-import__sec">
          <h4 className="plg-heading">{t('参考网站')}</h4>
          <TextField
            aria-label={t('参考网站')}
            placeholder="https://example.com"
            value={url}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setUrl(e.target.value)}
          />
        </section>
        <section className="plg-import__sec">
          <h4 className="plg-heading">{t('参考仓库')}</h4>
          <TextField
            aria-label={t('参考仓库')}
            placeholder={t('https://github.com/owner/repo 或工作区路径')}
            value={repo}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRepo(e.target.value)}
          />
          <div className="gs-note">{t('网站和仓库由 Bot 在每次创作时提取配色、字体和组件风格。')}</div>
        </section>
      </div>
    </Dialog>
  )
}
