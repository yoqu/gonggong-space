import { useState } from 'react'
import { t } from '../../../i18n'
import { EmptyState, Lightbox } from '../../../ui'
import { fileIconName } from '../../files/FileViewer'
import { PageFrame, pageFailure } from '../../rich/HtmlRender'
import type { TabMeta, TabProps } from '../types'

/** A chat's html_render page at the workbench's width: the same sandboxed frame, scrolling inside the tab. */
export function PageTab({ tab }: TabProps<'page'>) {
  const [image, setImage] = useState<{ src: string; alt: string }>()
  const [failed, setFailed] = useState<'gone' | 'error' | null>(null)
  if (failed)
    return (
      <EmptyState
        icon="warning"
        title={failed === 'gone' ? t('页面内容已不存在') : t('页面加载失败')}
        description={
          failed === 'gone' ? t('「{title}」的文件已被清理或丢失', { title: tab.page.title }) : undefined
        }
      />
    )
  return (
    <>
      <PageFrame
        page={tab.page}
        className="html-render__tab"
        onImage={setImage}
        onLoaded={() => void pageFailure(tab.page).then(setFailed)}
      />
      {image && (
        <Lightbox src={image.src} alt={image.alt || tab.page.title} onClose={() => setImage(undefined)} />
      )}
    </>
  )
}

export function usePageTabMeta(tab: TabProps<'page'>['tab']): TabMeta {
  return { icon: fileIconName('page.html', 'text/html'), title: tab.page.title }
}
