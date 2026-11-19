import type { ArtifactLinkDisplay, ArtifactLinkMetaRes, ArtifactLinkRatio } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Dialog, Input, RadioGroup, SegmentedControl } from '../../ui'
import { isFeishu, ratioItems, validUrl } from './webPage'
import './canvas-links.css'

const TITLE_MAX = 120
/** After a paste or leaving the field, the page's title is read this much later (a quick fix of the URL waits). */
const LOOKUP_MS = 300

export interface NewLink {
  url: string
  title: string
  display: ArtifactLinkDisplay
  ratio: ArtifactLinkRatio
}

/**
 * 添加链接: the URL (its title read by the server), how it shows (an embedded page, or a card for sites that forbid
 * framing) and the embed's starting ratio.
 */
export function AddLinkDialog({
  artifactId,
  url: initial,
  onAdd,
  onClose,
}: {
  artifactId: string
  /** A URL pasted on the canvas, or empty. */
  url: string
  onAdd: (link: NewLink) => Promise<boolean>
  onClose: () => void
}) {
  const [url, setUrl] = useState(initial)
  const [title, setTitle] = useState('')
  const [chosen, setChosen] = useState<ArtifactLinkDisplay>('embed')
  const [ratio, setRatio] = useState<ArtifactLinkRatio>('4:3')
  const [lookup, setLookup] = useState(initial)
  const [meta, setMeta] = useState<(ArtifactLinkMetaRes & { url: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const titled = useRef(false)
  const pasted = useRef(false)

  useEffect(() => {
    if (!validUrl(lookup)) return
    let live = true
    const timer = setTimeout(() => {
      api.post<ArtifactLinkMetaRes>(`/artifacts/${artifactId}/link-meta`, { url: lookup }).then(
        (m) => {
          if (!live) return
          setMeta({ ...m, url: lookup })
          if (m.title && !titled.current) setTitle(m.title.slice(0, TITLE_MAX))
        },
        // Unreadable is what a failed lookup means here: the member names the page.
        () => live && setMeta({ title: null, embeddable: true, url: lookup }),
      )
    }, LOOKUP_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [artifactId, lookup])

  const href = url.trim()
  const valid = validUrl(href)
  const known = meta?.url === href ? meta : null
  const denied = !!known && !known.embeddable
  const display = denied ? 'card' : chosen
  const noTitle = !!known && known.title === null && !title.trim()
  const add = async () => {
    setBusy(true)
    const ok = await onAdd({ url: href, title: title.trim(), display, ratio })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={t('添加链接')}
      width={520}
      footer={
        valid && display === 'embed' && isFeishu(href) ? (
          <span className="art-addlink__note">
            {t('飞书文档用你当前的飞书登录态加载，无权限时显示飞书登录页')}
          </span>
        ) : !valid ? (
          <span className="art-addlink__note">{t('请先填写有效链接和标题')}</span>
        ) : !title.trim() ? (
          <span className="art-addlink__note">{t('请先填写标题')}</span>
        ) : null
      }
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('添加到画布'),
          variant: 'primary',
          disabled: busy || !valid || !title.trim(),
          loading: busy,
          onClick: () => void add(),
        },
      ]}
    >
      <div className="art-addlink">
        <div className="art-addlink__field">
          <span className="art-addlink__label">
            {t('链接地址')}
            <span className="art-addlink__req" aria-hidden="true">
              *
            </span>
          </span>
          <Input
            aria-label={t('链接地址')}
            required
            placeholder="https://"
            value={url}
            maxLength={2000}
            invalid={!!lookup && !validUrl(lookup)}
            autoFocus
            onChange={(e) => {
              setUrl(e.target.value)
              if (pasted.current) setLookup(e.target.value.trim())
              pasted.current = false
            }}
            onPaste={() => {
              pasted.current = true
            }}
            onBlur={() => setLookup(href)}
          />
          {lookup && !validUrl(lookup) ? (
            <span className="art-addlink__hint art-addlink__hint--error">
              {t('只支持 http:// 或 https:// 开头的链接')}
            </span>
          ) : null}
        </div>
        <div className="art-addlink__field">
          <span className="art-addlink__label">
            {t('标题')}
            <span className="art-addlink__req" aria-hidden="true">
              *
            </span>
          </span>
          <Input
            aria-label={t('标题')}
            required
            placeholder={t('请输入标题')}
            className={cx(noTitle && 'art-addlink__warn')}
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              titled.current = true
              setTitle(e.target.value)
            }}
          />
          {noTitle ? <span className="art-addlink__hint">{t('无法读取标题，请手动填写')}</span> : null}
        </div>
        <div className="art-addlink__field">
          <span className="art-addlink__label">{t('显示方式')}</span>
          <RadioGroup<ArtifactLinkDisplay>
            direction="row"
            aria-label={t('显示方式')}
            value={display}
            onChange={setChosen}
            options={[
              {
                value: 'embed',
                disabled: denied,
                label: (
                  <span className="art-addlink__option">
                    <strong>{t('嵌入页面')}</strong>
                    <span>{denied ? t('该网站禁止被嵌入') : t('在卡片里直接加载内容，可调宽高')}</span>
                  </span>
                ),
              },
              {
                value: 'card',
                label: (
                  <span className="art-addlink__option">
                    <strong>{t('链接卡片')}</strong>
                    <span>{t('只显示标题，点击新标签打开')}</span>
                  </span>
                ),
              },
            ]}
          />
          {denied ? (
            <span className="art-addlink__hint">{t('该网站不允许被其他页面嵌入，只能添加为链接卡片')}</span>
          ) : null}
        </div>
        {display === 'embed' ? (
          <div className="art-addlink__field">
            <span className="art-addlink__label">
              {t('初始比例')}
              <span className="art-addlink__aside">{t('添加后拖右下角可调整')}</span>
            </span>
            <SegmentedControl
              size="small"
              aria-label={t('初始比例')}
              items={ratioItems()}
              value={ratio}
              onChange={setRatio}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
