import { KNOWLEDGE_MAX_ENTRIES, type KnowledgeEntryDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import {
  Button,
  ConfirmActionDialog,
  EmptyState,
  GroupBox,
  Icon,
  MenuButton,
  type MenuItem,
  NoKnowledgeArt,
  NoResultsArt,
  Presence,
  SearchField,
  Tag,
} from '../../ui'
import { knowledgeApi, useKnowledge } from './api'
import { Author, KnowledgeEditor } from './KnowledgeEditor'
import { KnowledgeHistory } from './KnowledgeHistory'
import './knowledge.css'

const SEARCH_DELAY_MS = 300

type Open =
  | { kind: 'edit'; entry: KnowledgeEntryDto | null }
  | { kind: 'history'; entry: KnowledgeEntryDto }
  | { kind: 'delete'; entry: KnowledgeEntryDto }

function Row({
  e,
  canManage,
  onOpen,
  onReload,
}: {
  e: KnowledgeEntryDto
  canManage: boolean
  onOpen: (o: Open) => void
  onReload: () => void
}) {
  const items: MenuItem[] = [
    { value: 'edit', label: t('编辑'), icon: 'textformat' },
    { value: 'history', label: t('历史版本'), icon: 'clock' },
    ...(canManage
      ? [
          { value: 'pin', label: e.pinned ? t('取消置顶') : t('置顶'), icon: 'pin' as const },
          { separator: true as const },
          { value: 'delete', label: t('删除'), icon: 'trash' as const, destructive: true },
        ]
      : []),
  ]
  const select = (v: string) => {
    if (v === 'edit') onOpen({ kind: 'edit', entry: e })
    else if (v === 'history') onOpen({ kind: 'history', entry: e })
    else if (v === 'delete') onOpen({ kind: 'delete', entry: e })
    else if (v === 'pin')
      void attempt(() => knowledgeApi.update(e.id, { baseVersion: e.version, pinned: !e.pinned })).then(
        (ok) => ok && onReload(),
      )
  }
  return (
    <div className="kb-row" data-testid={`knowledge-${e.id}`}>
      <button type="button" className="kb-row__main" onClick={() => onOpen({ kind: 'edit', entry: e })}>
        <span className="kb-row__title">
          {e.pinned ? <Tag tone="orange">{t('置顶')}</Tag> : null}
          <span className="kb-row__name">{e.title}</span>
        </span>
        {e.excerpt ? <span className="kb-row__excerpt">{e.excerpt}</span> : null}
        <span className="kb-meta">
          {e.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          <Author by={e.updatedBy} />
          <span>{ago(e.updatedAt)}</span>
        </span>
      </button>
      <MenuButton aria-label={t('更多')} title={t('更多')} align="end" items={items} onSelect={select}>
        <Icon name="more" weight={2.6} />
      </MenuButton>
    </div>
  )
}

/** 群设置 · 知识库: any member reads, adds and edits entries; group admins pin and delete them. */
export function KnowledgeView({ groupId }: { groupId: string }) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])
  const { data, error, reload } = useKnowledge(groupId, q)
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)
  const full = !q && (data?.entries.length ?? 0) >= KNOWLEDGE_MAX_ENTRIES
  // Until there is an entry, 新建条目 lives in the empty state.
  const none = !q && !data?.entries.length
  const create = () => setOpen({ kind: 'edit', entry: null })

  return (
    <>
      <div className="gs-toolbar">
        <SearchField className="gs-search" placeholder={t('搜索知识库')} value={text} onChange={setText} />
        {none ? null : (
          <Button size="small" disabled={!data || full} onClick={create}>
            {t('新建条目')}
          </Button>
        )}
      </div>
      {error ? (
        <span className="gs-error">
          {t('知识库加载失败')}
          <Button size="small" onClick={reload}>
            {t('重试')}
          </Button>
        </span>
      ) : null}
      {data?.entries.length ? (
        <GroupBox>
          {data.entries.map((e) => (
            <Row key={e.id} e={e} canManage={data.canManage} onOpen={setOpen} onReload={reload} />
          ))}
        </GroupBox>
      ) : data && q ? (
        <EmptyState compact illustration={<NoResultsArt />} title={t('没有匹配的条目')} />
      ) : data ? (
        <EmptyState
          compact
          illustration={<NoKnowledgeArt />}
          title={t('还没有知识')}
          description={t('把群里需要所有 Bot 记住的事实、约定写在这里，Bot 每次运行都能读到，也会自己补充。')}
          action={
            <Button size="small" onClick={create}>
              {t('新建条目')}
            </Button>
          }
        />
      ) : null}
      <div className="gs-foot">
        {full
          ? t('已达 {max} 条上限，删除不再需要的条目后再新建。', { max: KNOWLEDGE_MAX_ENTRIES })
          : t(
              '任何成员都可新建和编辑，每次修改都保留版本可回滚；Bot 的修改标有「Bot」。置顶与删除仅群管理员。',
            )}
      </div>
      <Presence>
        {open?.kind === 'edit' ? (
          <KnowledgeEditor groupId={groupId} entryId={open.entry?.id} onSaved={reload} onClose={close} />
        ) : open?.kind === 'history' ? (
          <KnowledgeHistory entry={open.entry} onClose={close} />
        ) : open?.kind === 'delete' ? (
          <ConfirmActionDialog
            title={t('删除「{title}」？', { title: open.entry.title })}
            message={t('删除后无法恢复。')}
            consequences={[t('本群 Bot 下一轮起不再读到这条知识')]}
            label={t('删除')}
            done={t('已删除「{title}」', { title: open.entry.title })}
            run={() => knowledgeApi.remove(open.entry.id)}
            onDone={() => {
              close()
              reload()
            }}
            onClose={close}
          />
        ) : null}
      </Presence>
    </>
  )
}
