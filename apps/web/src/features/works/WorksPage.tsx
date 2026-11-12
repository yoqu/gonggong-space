import type { ArtifactVisibility, WorkDto, WorkGroupDto } from '@gonggong/protocol'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { ago, fullTime } from '../../lib/time'
import {
  Button,
  Dialog,
  EmptyState,
  Icon,
  MenuButton,
  NoResultsArt,
  NoWorksArt,
  PopUpButton,
  Presence,
  SearchField,
  SegmentedControl,
  Skeleton,
  Spinner,
  Tag,
} from '../../ui'
import { useArtifactPreview } from '../artifacts/store'
import { openCreation } from '../plugins/store'
import './works.css'

interface Works {
  /** The groups with a creation plugin on; null until loaded. */
  groups: WorkGroupDto[] | null
  list: WorkDto[] | null
  error: string
}
const useWorks = create<Works>()(() => ({ groups: null, list: null, error: '' }))

/** Tests: forget what was loaded. */
export const resetWorks = () => useWorks.setState({ groups: null, list: null, error: '' })

export async function loadWorkGroups() {
  try {
    useWorks.setState({ groups: await api.get<WorkGroupDto[]>('/works/groups') })
  } catch {
    useWorks.setState({ groups: [] })
  }
}

async function loadWorks() {
  try {
    useWorks.setState({ list: await api.get<WorkDto[]>('/works'), error: '' })
  } catch (e) {
    useWorks.setState({ error: errorText(e) })
  }
}

/** 作品 shows in the app rail once one of my groups has a creation plugin on, or a work is shared with me. */
export function useWorksShown() {
  const groups = useWorks((s) => s.groups)
  const list = useWorks((s) => s.list)
  useEffect(() => {
    if (useWorks.getState().groups === null) void loadWorkGroups()
    if (useWorks.getState().list === null) void loadWorks()
  }, [])
  return !!groups?.length || !!list?.length
}

export const VISIBILITY_LABEL: Record<ArtifactVisibility, string> = {
  private: t('仅自己可见'),
  group: t('本群可见'),
  team: t('团队可见'),
  all: t('全员可见'),
}

type Scope = 'all' | 'mine' | 'team'
type Sort = 'recent' | 'title'

const COVERS = 6
/** A stable cover tint for a work without a thumbnail, so the grid is not a wall of identical gray boxes. */
const coverOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % COVERS

/** 作品: every artifact I may open, across my groups; `/works/:artifactId` views a read-only one. */
export function WorksPage() {
  const { artifactId } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const { groups, list, error } = useWorks()
  const [scope, setScope] = useState<Scope>('all')
  const [group, setGroup] = useState('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const [noCreation, setNoCreation] = useState(false)
  useEffect(() => {
    void loadWorks()
    if (useWorks.getState().groups === null) void loadWorkGroups()
  }, [])

  const viewing = artifactId ? list?.find((w) => w.id === artifactId) : undefined
  if (artifactId)
    return viewing ? (
      <WorkViewer work={viewing} onBack={() => navigate('/works')} />
    ) : (
      <section className="works" aria-label={t('作品')}>
        <div className="works__center">
          {list ? (
            <EmptyState
              icon="lock"
              title={t('作品不存在或你没有权限查看')}
              action={
                <Button size="small" onClick={() => navigate('/works')}>
                  {t('返回作品')}
                </Button>
              }
            />
          ) : (
            <Spinner />
          )}
        </div>
      </section>
    )

  const all = list ?? []
  const sources = [...new Map(all.map((w) => [w.groupId, w.groupTitle])).entries()]
  const q = query.trim().toLowerCase()
  const shown = all
    .filter(
      (w) =>
        (scope === 'all' ||
          (scope === 'mine' ? w.createdBy === me : w.visibility === 'team' || w.visibility === 'all')) &&
        (group === 'all' || w.groupId === group) &&
        (!q || `${w.title} ${w.groupTitle} ${w.creatorName ?? ''}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, 'zh') : 0))
  const filtered = scope !== 'all' || group !== 'all' || !!q
  const clear = () => {
    setScope('all')
    setGroup('all')
    setQuery('')
  }
  const open = (w: WorkDto) =>
    navigate(w.access === 'edit' ? `/g/${w.groupId}?artifact=${w.id}` : `/works/${w.id}`)
  const create = (groupId: string) => {
    navigate(`/g/${groupId}`)
    openCreation({ groupId })
  }

  return (
    <section className="works" aria-label={t('作品')}>
      <header className="works__head">
        <h1 className="works__title">{t('作品')}</h1>
        {list?.length ? <span className="works__count">{list.length}</span> : null}
        <span className="spacer" />
        {groups && !groups.length ? (
          <Button size="small" variant="primary" icon="plus" onClick={() => setNoCreation(true)}>
            {t('新建')}
          </Button>
        ) : (
          <MenuButton
            className="ui-btn ui-btn--primary ui-btn--small"
            aria-label={t('新建')}
            title={t('选一个群，在群聊里创作')}
            disabled={!groups}
            align="end"
            items={(groups ?? []).map((g) => ({ label: g.title, value: g.id, icon: 'message' as const }))}
            onSelect={create}
          >
            <Icon name="plus" size={14} />
            {t('新建')}
          </MenuButton>
        )}
      </header>
      {list?.length ? (
        <div className="works__bar">
          <SegmentedControl<Scope>
            aria-label={t('范围')}
            size="small"
            value={scope}
            onChange={setScope}
            items={[
              { value: 'all', label: t('全部') },
              { value: 'mine', label: t('我创建的') },
              { value: 'team', label: t('已共享') },
            ]}
          />
          {sources.length > 1 ? (
            <PopUpButton
              aria-label={t('来自群')}
              size="small"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: t('全部群') },
                ...sources.map(([id, title]) => ({ value: id, label: title })),
              ]}
            />
          ) : null}
          <PopUpButton<Sort>
            aria-label={t('排序')}
            size="small"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: t('最近更新') },
              { value: 'title', label: t('按名称') },
            ]}
          />
          <span className="spacer" />
          <SearchField
            className="works__search"
            placeholder={t('搜索作品、群或创建人')}
            aria-label={t('搜索作品')}
            value={query}
            onChange={setQuery}
          />
        </div>
      ) : null}
      {error && !list ? (
        <div className="works__center">
          <EmptyState
            icon="warning"
            title={error}
            action={
              <Button size="small" onClick={() => void loadWorks()}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : !list ? (
        <Skeleton variant="block" count={6} height={220} className="works__grid" />
      ) : shown.length ? (
        <ul className="works__grid" aria-label={t('作品')}>
          {shown.map((w, i) => (
            <li key={w.id} className="works__card" style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                className="works__open"
                aria-label={t('打开 {title}', { title: w.title })}
                onClick={() => open(w)}
              >
                <span className="works__shot" data-cover={w.thumbnailUrl ? undefined : coverOf(w.id)}>
                  {w.thumbnailUrl ? (
                    <img src={w.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="works__initial" aria-hidden="true">
                      {[...w.title][0]}
                    </span>
                  )}
                  {w.access === 'view' ? (
                    <span className="works__badge">
                      <Icon name="eye" size={12} />
                      {t('只读')}
                    </span>
                  ) : null}
                </span>
                <span className="works__body">
                  <strong className="works__name" title={w.title}>
                    {w.title}
                  </strong>
                  <span className="works__meta">
                    {[w.groupTitle, w.creatorName].filter(Boolean).join(' · ')}
                  </span>
                  <span className="works__tags">
                    {w.pluginTitle ? <Tag>{w.pluginTitle}</Tag> : null}
                    <Tag
                      tone={w.visibility === 'team' || w.visibility === 'all' ? 'blue' : 'gray'}
                      icon={w.visibility === 'private' ? 'lock' : undefined}
                    >
                      {VISIBILITY_LABEL[w.visibility]}
                    </Tag>
                    <time className="works__time" dateTime={w.updatedAt} title={fullTime(w.updatedAt)}>
                      {ago(w.updatedAt)}
                    </time>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="works__center">
          <EmptyState
            illustration={list.length ? <NoResultsArt /> : <NoWorksArt />}
            title={list.length ? t('没有符合条件的作品') : t('还没有作品')}
            description={list.length ? undefined : t('在群聊里发起创作，产出的原型和幻灯片会汇总到这里')}
            action={
              filtered && list.length ? (
                <Button size="small" onClick={clear}>
                  {t('清除筛选')}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      <Presence>
        {noCreation ? (
          <Dialog
            open
            title={t('还没有开启创作插件的群')}
            width={440}
            onClose={() => setNoCreation(false)}
            actions={[
              { label: t('知道了'), onClick: () => setNoCreation(false) },
              { label: t('去市场找插件'), variant: 'primary', onClick: () => navigate('/market') },
            ]}
          >
            <div className="gs-note">
              {t(
                '创作要在开启了创作插件（如产品原型、幻灯片）的群里进行：请群管理员在「群设置 · 插件」里开启；还没有合适的插件，可以去市场挑选并引入到群。',
              )}
            </div>
          </Dialog>
        ) : null}
      </Presence>
    </section>
  )
}

/** A work I may only look at (a team member outside its group): its preview, presentable, nothing to edit. */
function WorkViewer({ work, onBack }: { work: WorkDto; onBack: () => void }) {
  const { preview, error } = useArtifactPreview(work.id, null, true)
  const frame = useRef<HTMLIFrameElement>(null)
  return (
    <section className="works works--viewer" aria-label={work.title}>
      <header className="works__head">
        <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回作品')} onClick={onBack}>
          {t('作品')}
        </Button>
        <div className="works__titles">
          <h1 className="works__title">{work.title}</h1>
          <span className="works__note">
            {work.visibility === 'all'
              ? t('只读 · 来自「{group}」', { group: work.groupTitle })
              : t('只读 · 进入「{group}」后可修改', { group: work.groupTitle })}
          </span>
        </div>
        {preview ? (
          <>
            <Button size="small" icon="expand" onClick={() => void frame.current?.requestFullscreen?.()}>
              {t('全屏演示')}
            </Button>
            <Button
              size="small"
              variant="plain"
              icon="external"
              aria-label={t('在新窗口打开')}
              title={t('在新窗口打开')}
              onClick={() => window.open(preview.url, '_blank', 'noopener')}
            />
          </>
        ) : null}
      </header>
      {preview ? (
        <iframe ref={frame} className="works__frame" title={work.title} src={preview.url} allowFullScreen />
      ) : (
        <div className="works__center">{error || <Spinner />}</div>
      )}
    </section>
  )
}
