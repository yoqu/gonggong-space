import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, CloseButton, EmptyState, Icon, SegmentedControl, Textarea } from '../../ui'
import { Markdown } from '../chat/Markdown'
import { NEW_SHARED, referringScreens, type SharedRef, sharedChunks } from './rules'

/** The 共享规则.md node: the file rendered read-only, cut off with a fade; an editor can start one when there is none. */
export function SharedRulesNode({
  md,
  canEdit,
  onOpen,
  onCreate,
}: {
  md: string | null
  canEdit: boolean
  onOpen: () => void
  onCreate: () => void
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button and ⌘K open it from the keyboard
    // biome-ignore lint/a11y/noStaticElementInteractions: the card opens the shared rules
    <div className="art-doc art-doc--clipped art-shared-node" data-testid="art-shared-rules" onClick={onOpen}>
      <div className="art-doc__head">
        <Icon name="doc-text" size={14} />
        {t('共享规则.md')}
      </div>
      {md !== null ? (
        <Markdown text={md} />
      ) : (
        <EmptyState
          compact
          icon="doc-text"
          title={t('还没有共享规则')}
          description={t('几个页面都用到的规则写在这里，页面规则里用 S1 引用')}
          action={
            canEdit ? (
              <Button
                size="small"
                icon="plus"
                onClick={(e) => {
                  e.stopPropagation()
                  onCreate()
                }}
              >
                {t('新建')}
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

/**
 * 共享规则.md (design/app-screens-fzvz shared-rules): one Markdown document, rendered as is. Each `## S<n>` section
 * ends with the page rules referring to it (worked out, never written to the file).
 */
export function SharedRulesPanel({
  md,
  refs,
  canEdit,
  editing,
  focus,
  onSave,
  onRef,
  onClose,
}: {
  md: string | null
  refs: Record<string, SharedRef[]>
  canEdit: boolean
  /** Opens on the source (新建). */
  editing: boolean
  /** The section to show, per request. */
  focus: { id: string | null; n: number }
  onSave: (md: string) => Promise<boolean>
  onRef: (r: SharedRef) => void
  onClose: () => void
}) {
  const [view, setView] = useState<'preview' | 'source'>(editing && canEdit ? 'source' : 'preview')
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editing && canEdit) setView('source')
  }, [editing, canEdit])
  // biome-ignore lint/correctness/useExhaustiveDependencies: per focus request
  useEffect(() => {
    if (!focus.id || view !== 'preview') return
    body.current?.querySelector(`[data-section="${focus.id}"]`)?.scrollIntoView?.({ block: 'start' })
  }, [focus.n, view])
  const text = source ?? md ?? (canEdit ? NEW_SHARED : '')
  const save = async () => {
    setBusy(true)
    const ok = await onSave(text)
    setBusy(false)
    if (ok) {
      setSource(null)
      setView('preview')
    }
  }
  const name = t('共享规则.md')
  return (
    <aside className="art-panel art-panel--wide art-shared" aria-label={name}>
      <header className="art-panel__head">
        <Icon name="doc-text" size={16} />
        <h3>{name}</h3>
        <SegmentedControl<'preview' | 'source'>
          size="small"
          aria-label={t('视图')}
          items={[
            { value: 'preview', label: t('预览') },
            { value: 'source', label: t('编辑源码'), disabled: !canEdit },
          ]}
          value={view}
          onChange={setView}
        />
        <CloseButton onClick={onClose} />
      </header>
      <p className="art-shared__sub">{t('被 {n} 个页面引用', { n: referringScreens(refs) })}</p>
      <div ref={body} className="art-panel__body art-shared__body">
        {view === 'source' ? (
          <>
            <Textarea
              className="art-rules__source"
              aria-label={name}
              spellCheck={false}
              value={text}
              disabled={busy}
              onChange={(e) => setSource(e.target.value)}
            />
            <Button size="small" variant="primary" disabled={busy || text === md} onClick={() => void save()}>
              {t('保存')}
            </Button>
          </>
        ) : md === null ? (
          <EmptyState compact icon="doc-text" title={t('还没有共享规则')} />
        ) : (
          sharedChunks(md).map((c, i) => (
            <section
              // biome-ignore lint/suspicious/noArrayIndexKey: sections of one fixed text
              key={i}
              data-section={c.id ?? undefined}
              className={cx('art-shared__section', c.id && c.id === focus.id && 'art-shared__section--on')}
            >
              <Markdown text={c.text} />
              {c.id && refs[c.id]?.length ? (
                <p className="art-shared__refs" data-testid={`art-shared-refs-${c.id}`}>
                  {t('引用：')}
                  {refs[c.id]?.map((r, k) => (
                    <span key={`${r.screenId}#${r.n}`}>
                      {k ? '、' : null}
                      <button type="button" onClick={() => onRef(r)}>{`${r.title} #${r.n}`}</button>
                    </span>
                  ))}
                </p>
              ) : null}
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
