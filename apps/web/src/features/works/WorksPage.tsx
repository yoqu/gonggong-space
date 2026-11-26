import type { ArtifactDto, ArtifactVisibility, WorkDto, WorkGroupDto } from '@gonggong/protocol'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { ago, fullTime } from '../../lib/time'
import {
  Button,
  Dialog,
  EmptyState,
  Icon,
  NoResultsArt,
  NoWorksArt,
  PopUpButton,
  SearchField,
  SegmentedControl,
  Skeleton,
  Spinner,
  Tag,
} from '../../ui'
import { useArtifactBots } from '../artifacts/CanvasBotPicker'
import { useArtifactPreview } from '../artifacts/store'
import { channelsApi } from '../groups/sections'
import { otherTeam, switchTeam } from '../teams/store'
import { TeamSwitcher } from '../teams/TeamSwitcher'
import { useNewWork } from './NewWork'
import { WorkEditor } from './WorkEditor'
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

async function loadWorkGroups() {
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

/** 作品 shows in the app rail once I can create (an AI open for works, a group with a creation plugin on) or see one. */
export function useWorksShown() {
  const bots = useArtifactBots()
  const groups = useWorks((s) => s.groups)
  const list = useWorks((s) => s.list)
  useEffect(() => {
    if (useWorks.getState().groups === null) void loadWorkGroups()
    if (useWorks.getState().list === null) void loadWorks()
  }, [])
  return !!bots.length || !!groups?.length || !!list?.length
}

const VISIBILITY_LABEL: Record<ArtifactVisibility, string> = {
  private: t('仅自己可见'),
  group: t('本群可见'),
  team: t('团队可见'),
}

type Scope = 'all' | 'mine' | 'team'
type Sort = 'recent' | 'title'

const SHARED_DM = '__dm__'
const isSharedDm = (w: WorkDto) => w.groupKind === 'dm' && w.access === 'view'
const sourceKey = (w: WorkDto) => (isSharedDm(w) ? SHARED_DM : w.groupId)
const sourceTitle = (w: WorkDto) => (isSharedDm(w) ? t('私聊') : w.groupTitle)
const cardVisibility = (w: WorkDto): ArtifactVisibility =>
  w.groupKind === 'dm' && w.visibility === 'group' ? 'private' : w.visibility

/**
 * Opening `/works/:artifactId` when it is not in the current team's works list: if the caller can read it in
 * another of their teams, switch to that team straight away (like `useGroupOutsideList`).
 */
function useForeignWork(artifactId: string | undefined, missing: boolean) {
  const [checkedId, setCheckedId] = useState<string | null>(null)
  useEffect(() => {
    if (!artifactId || !missing) return
    let live = true
    api.get<ArtifactDto>(`/artifacts/${artifactId}`).then(
      (a) => {
        if (!live) return
        if (otherTeam(a.teamId ?? null) && a.teamId) {
          switchTeam(a.teamId, `/works/${a.id}`)
          return
        }
        void loadWorks().finally(() => {
          if (live) setCheckedId(artifactId)
        })
      },
      () => {
        if (live) setCheckedId(artifactId)
      },
    )
    return () => {
      live = false
    }
  }, [artifactId, missing])
  return !!artifactId && missing && checkedId !== artifactId
}

const COVERS = 6
/** A stable cover tint for a work without a thumbnail, so the grid is not a wall of identical gray boxes. */
const coverOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % COVERS

/** 作品: every artifact I may open in the current team; `/works/:artifactId` views a read-only one. */
export function WorksPage() {
  const { artifactId } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const { groups, list, error } = useWorks()
  const [scope, setScope] = useState<Scope>('all')
  const [group, setGroup] = useState('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const newWork = useNewWork(() => void loadWorks())
  useEffect(() => {
    void loadWorks()
    if (useWorks.getState().groups === null) void loadWorkGroups()
  }, [])

  const viewing = artifactId ? list?.find((w) => w.id === artifactId) : undefined
  const checkingForeign = useForeignWork(artifactId, list !== null && !viewing)
  const back = useCallback(() => {
    navigate('/works')
    void loadWorks()
  }, [navigate])
  if (artifactId)
    return viewing?.access === 'edit' ? (
      <WorkEditor key={viewing.id} work={viewing} onBack={back} />
    ) : viewing?.access === 'view' ? (
      <WorkViewer work={viewing} onBack={back} />
    ) : (
      <section className="works" aria-label={t('作品')}>
        <div className="works__center">
          {list && !viewing && !checkingForeign ? (
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
  const sources = [
    ...new Map(
      all
        .map((w) => [sourceKey(w), isSharedDm(w) ? t('来自私聊') : w.groupTitle] as const)
        .filter(([, label]) => !!label),
    ).entries(),
  ]
  const q = query.trim().toLowerCase()
  const shown = all
    .filter(
      (w) =>
        (scope === 'all' || (scope === 'mine' ? w.createdBy === me : w.visibility === 'team')) &&
        (group === 'all' || sourceKey(w) === group) &&
        (!q || `${w.title} ${sourceTitle(w)} ${w.creatorName ?? ''}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, 'zh') : 0))
  const filtered = group !== 'all' || !!q
  const clear = () => {
    setGroup('all')
    setQuery('')
  }
  const open = (w: WorkDto) => navigate(`/works/${w.id}`)

  return (
    <section className="works" aria-label={t('作品')}>
      <header className="works__head">
        <TeamSwitcher redirectPath="/works" />
        <h1 className="works__title">{t('作品')}</h1>
        {list?.length ? <span className="works__count">{list.length}</span> : null}
        <span className="spacer" />
        <Button
          size="small"
          variant="primary"
          icon="plus"
          loading={newWork.busy}
          onClick={() => void newWork.create()}
        >
          {t('新建')}
        </Button>
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
              { value: 'team', label: t('团队共享') },
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
          {shown.map((w, i) => {
            const vis = cardVisibility(w)
            const source = sourceTitle(w)
            return (
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
                    {w.creatorName ? (
                      <span className="works__badge works__badge--creator" title={t('创建者')}>
                        <Icon name="person" size={12} />
                        <span className="works__creator">{w.creatorName}</span>
                      </span>
                    ) : null}
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
                    <span className="works__meta works__meta--row">
                      {source ? (
                        <>
                          <span className="works__source" title={source}>
                            {source}
                          </span>
                          <span className="works__sep" aria-hidden="true">
                            ·
                          </span>
                        </>
                      ) : null}
                      <time className="works__time" dateTime={w.updatedAt} title={fullTime(w.updatedAt)}>
                        {ago(w.updatedAt)}
                      </time>
                    </span>
                    <span className="works__tags">
                      {w.site ? (
                        <Tag>{t('托管网页')}</Tag>
                      ) : w.pluginTitle ? (
                        <Tag>{w.pluginTitle}</Tag>
                      ) : null}
                      <Tag
                        tone={vis === 'team' ? 'blue' : 'gray'}
                        icon={vis === 'private' ? 'lock' : undefined}
                      >
                        {VISIBILITY_LABEL[vis]}
                      </Tag>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="works__center">
          <EmptyState
            illustration={filtered ? <NoResultsArt /> : <NoWorksArt />}
            title={
              filtered
                ? t('没有符合条件的作品')
                : scope === 'team'
                  ? t('还没有团队共享的作品')
                  : t('还没有作品')
            }
            description={
              filtered
                ? undefined
                : scope === 'team'
                  ? t('团队内设为「团队可见」的作品会出现在这里')
                  : t('在群里发起创作，产出的原型和幻灯片会汇总到这里')
            }
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
    </section>
  )
}

/** A work I may only look at (a team member outside its group): its preview, presentable, nothing to edit. */
function WorkViewer({ work, onBack }: { work: WorkDto; onBack: () => void }) {
  const { preview, error } = useArtifactPreview(work.id, null, true)
  const frame = useRef<HTMLIFrameElement>(null)
  const [joining, setJoining] = useState(false)
  const canJoin = work.access === 'view' && work.groupKind === 'group' && work.groupVisibility === 'public'
  const note =
    work.groupKind === 'dm'
      ? work.creatorName
        ? t('只读 · 来自 {name} 的私聊', { name: work.creatorName })
        : t('只读 · 来自私聊')
      : canJoin
        ? t('只读 · 来自公开群「{group}」，加入后可修改', { group: work.groupTitle })
        : t('只读 · 来自「{group}」（仅群成员可修改）', { group: work.groupTitle })
  const joinAndEdit = async () => {
    setJoining(true)
    const joined = await attempt(() => channelsApi.join(work.groupId))
    setJoining(false)
    if (!joined) return
    void loadWorks()
  }
  return (
    <section className="works works--viewer" aria-label={work.title}>
      <header className="works__head">
        <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回作品')} onClick={onBack}>
          {t('作品')}
        </Button>
        <div className="works__titles">
          <h1 className="works__title">{work.title}</h1>
          <span className="works__note">{note}</span>
        </div>
        {canJoin ? (
          <Button size="small" variant="primary" loading={joining} onClick={() => void joinAndEdit()}>
            {t('加入群并编辑')}
          </Button>
        ) : null}
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
