import type { ArtifactDto, ArtifactVisibility, WorkDto, WorkGroupDto, WorkType } from '@gonggong/protocol'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { ago, fullTime } from '../../lib/time'
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  type IconName,
  NoResultsArt,
  NoWorksArt,
  PopUpButton,
  SearchField,
  SegmentedControl,
  Sidebar,
  Skeleton,
  Spinner,
  Tag,
} from '../../ui'
import { useArtifactBots } from '../artifacts/CanvasBotPicker'
import { useArtifactPreview } from '../artifacts/store'
import { channelsApi } from '../groups/sections'
import { otherTeam, switchTeam } from '../teams/store'
import { TeamSwitcher } from '../teams/TeamSwitcher'
import { type NewChoice, NewWorkDialog, useNewWork } from './NewWork'
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
type Sort = 'recent' | 'created' | 'title'
type Layout = 'grid' | 'list'
type Section = 'all' | WorkType

const TYPES: { value: WorkType; label: string; icon: IconName; always?: boolean }[] = [
  { value: 'prototype', label: t('产品原型'), icon: 'smartphone', always: true },
  { value: 'slides', label: t('幻灯片'), icon: 'slides', always: true },
  { value: 'site', label: t('网页'), icon: 'globe', always: true },
  { value: 'whiteboard', label: t('白板'), icon: 'pencil' },
  { value: 'motion', label: t('动效#category'), icon: 'play' },
  { value: 'other', label: t('其他'), icon: 'folder' },
]
const TYPE_LABEL = Object.fromEntries(TYPES.map((x) => [x.value, x.label])) as Record<WorkType, string>
const EMPTY_SECTION: Partial<Record<WorkType, { title: string; description: string }>> = {
  prototype: { title: t('还没有产品原型'), description: t('直接向 AI 描述需求，几分钟生成可点击的产品原型') },
  slides: { title: t('还没有幻灯片'), description: t('挑一套模板，快速做出可翻页的汇报、路演或周报') },
  site: {
    title: t('还没有网页作品'),
    description: t('把 AI 生成的网页托管到这里，随时在线预览与分享，不受电脑开关机影响'),
  },
}

const LAYOUT_KEY = 'gg.works.layout'
const storedLayout = (): Layout => (localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid')
const byTime = (key: 'updatedAt' | 'createdAt') => (a: WorkDto, b: WorkDto) => b[key].localeCompare(a[key])
const SORTS: Record<Sort, (a: WorkDto, b: WorkDto) => number> = {
  recent: byTime('updatedAt'),
  created: byTime('createdAt'),
  title: (a, b) => a.title.localeCompare(b.title, 'zh'),
}

const SHARED_DM = '__dm__'
const STANDALONE = '__works__'
const isSharedDm = (w: WorkDto) => w.groupKind === 'dm' && w.access === 'view'
const isStandalone = (w: WorkDto) => w.groupKind === 'works'
const sourceKey = (w: WorkDto) => (isStandalone(w) ? STANDALONE : isSharedDm(w) ? SHARED_DM : w.groupId)
const sourceTitle = (w: WorkDto) => (isStandalone(w) ? '' : isSharedDm(w) ? t('私聊') : w.groupTitle)
const sourceLabel = (w: WorkDto) =>
  isStandalone(w) ? t('独立作品') : isSharedDm(w) ? t('来自私聊') : w.groupTitle
const cardVisibility = (w: WorkDto): ArtifactVisibility =>
  (w.groupKind === 'dm' || w.groupKind === 'works') && w.visibility === 'group' ? 'private' : w.visibility

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
  const { list, error } = useWorks()
  const [scope, setScope] = useState<Scope>('all')
  const [group, setGroup] = useState('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const [picked, setSection] = useState<Section>('all')
  const [layout, setLayoutState] = useState<Layout>(storedLayout)
  const setLayout = (v: Layout) => {
    localStorage.setItem(LAYOUT_KEY, v)
    setLayoutState(v)
  }
  const [creating, setCreating] = useState(false)
  const newWork = useNewWork(() => loadWorks())
  const startNew = () => setCreating(true)
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
      all.map((w) => [sourceKey(w), sourceLabel(w)] as const).filter(([, label]) => !!label),
    ).entries(),
  ]
  const q = query.trim().toLowerCase()
  const counts = new Map<WorkType, number>()
  for (const w of all) counts.set(w.type, (counts.get(w.type) ?? 0) + 1)
  const navTypes = TYPES.filter((x) => x.always || counts.get(x.value))
  // A type only listed while it has works falls back to 全部 once its last one is gone.
  const section: Section = picked === 'all' || navTypes.some((x) => x.value === picked) ? picked : 'all'
  const shown = all
    .filter(
      (w) =>
        (section === 'all' || w.type === section) &&
        (scope === 'all' || (scope === 'mine' ? w.createdBy === me : w.visibility === 'team')) &&
        (group === 'all' || sourceKey(w) === group) &&
        (!q || `${w.title} ${sourceTitle(w)} ${w.creatorName ?? ''}`.toLowerCase().includes(q)),
    )
    .sort(SORTS[sort])
  const filtered = group !== 'all' || !!q
  const sectionEmpty = section === 'all' ? undefined : EMPTY_SECTION[section]
  const newChoice: NewChoice = section === 'slides' || section === 'site' ? section : 'prototype'
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
        {list?.length || (error && !list) ? (
          <Button size="small" variant="primary" icon="plus" onClick={startNew}>
            {t('新建')}
          </Button>
        ) : null}
      </header>
      <NewWorkDialog
        open={creating}
        initial={newChoice}
        busy={newWork.busy}
        onClose={() => setCreating(false)}
        onCreate={(type, templateId) =>
          void newWork.create(type, templateId).then((done) => done && setCreating(false))
        }
      />
      {error && list ? (
        <div className="works__bar">
          <Alert variant="error" title={t('刷新失败')} description={error} onRetry={() => void loadWorks()} />
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
      ) : !list.length ? (
        <div className="works__center">
          <EmptyState
            illustration={<NoWorksArt />}
            title={t('还没有作品')}
            description={t('点下方「新建」直接开始创作，或在群里发起创作，产出的原型和幻灯片会汇总到这里')}
            action={
              <Button size="small" variant="primary" icon="plus" onClick={startNew}>
                {t('新建')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="works__main">
          <Sidebar
            className="works__nav"
            aria-label={t('作品分类')}
            selected={section}
            onSelect={(id) => setSection(id as Section)}
            sections={[
              {
                items: [
                  { id: 'all', label: t('全部作品'), icon: 'apps', badge: all.length },
                  ...navTypes.map((x) => ({
                    id: x.value,
                    label: x.label,
                    icon: x.icon,
                    badge: counts.get(x.value) || undefined,
                  })),
                ],
              },
            ]}
          />
          <div className="works__pane">
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
                  aria-label={t('来源')}
                  size="small"
                  value={group}
                  onChange={setGroup}
                  options={[
                    { value: 'all', label: t('全部来源') },
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
                  { value: 'created', label: t('最近创建') },
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
              <SegmentedControl<Layout>
                aria-label={t('布局')}
                size="small"
                value={layout}
                onChange={setLayout}
                items={[
                  { value: 'grid', icon: 'grid', 'aria-label': t('网格视图') },
                  { value: 'list', icon: 'list', 'aria-label': t('列表视图') },
                ]}
              />
            </div>
            {shown.length ? (
              layout === 'grid' ? (
                <ul className="works__grid" aria-label={t('作品')}>
                  {shown.map((w, i) => (
                    <WorkCard key={w.id} work={w} index={i} onOpen={open} />
                  ))}
                </ul>
              ) : (
                <ul className="works__list" aria-label={t('作品')}>
                  {shown.map((w) => (
                    <WorkRow key={w.id} work={w} onOpen={open} />
                  ))}
                </ul>
              )
            ) : (
              <div className="works__center">
                <EmptyState
                  illustration={filtered ? <NoResultsArt /> : <NoWorksArt />}
                  title={
                    filtered
                      ? q
                        ? t('没有找到「{query}」相关作品', { query: query.trim() })
                        : t('没有符合条件的作品')
                      : scope === 'team'
                        ? t('还没有团队共享的作品')
                        : scope === 'mine'
                          ? t('你还没有创建作品')
                          : (sectionEmpty?.title ?? t('还没有作品'))
                  }
                  description={
                    filtered
                      ? undefined
                      : scope === 'team'
                        ? t('团队内设为「团队可见」的作品会出现在这里')
                        : scope === 'mine'
                          ? t('点右上角「新建」或在群里发起创作，你创建的作品会出现在这里')
                          : sectionEmpty?.description
                  }
                  action={
                    filtered ? (
                      <Button size="small" onClick={clear}>
                        {t('清除筛选')}
                      </Button>
                    ) : scope === 'all' && section !== 'all' ? (
                      <Button size="small" variant="primary" icon="plus" onClick={startNew}>
                        {section === 'slides'
                          ? t('新建幻灯片')
                          : section === 'site'
                            ? t('查看托管步骤')
                            : section === 'prototype'
                              ? t('新建原型')
                              : t('新建')}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function WorkCard({
  work: w,
  index,
  onOpen,
}: {
  work: WorkDto
  index: number
  onOpen: (w: WorkDto) => void
}) {
  const vis = cardVisibility(w)
  const source = sourceTitle(w)
  return (
    <li className="works__card" style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className="works__open"
        aria-label={t('打开 {title}', { title: w.title })}
        onClick={() => onOpen(w)}
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
            {w.site ? <Tag>{t('托管网页')}</Tag> : w.pluginTitle ? <Tag>{w.pluginTitle}</Tag> : null}
            <Tag tone={vis === 'team' ? 'blue' : 'gray'} icon={vis === 'private' ? 'lock' : undefined}>
              {VISIBILITY_LABEL[vis]}
            </Tag>
          </span>
        </span>
      </button>
    </li>
  )
}

/** 列表 layout: one compact row a work, for scanning many. */
function WorkRow({ work: w, onOpen }: { work: WorkDto; onOpen: (w: WorkDto) => void }) {
  const vis = cardVisibility(w)
  const source = sourceLabel(w)
  return (
    <li className="works__row">
      <button
        type="button"
        className="works__row-open"
        aria-label={t('打开 {title}', { title: w.title })}
        onClick={() => onOpen(w)}
      >
        <span className="works__thumb" data-cover={w.thumbnailUrl ? undefined : coverOf(w.id)}>
          {w.thumbnailUrl ? <img src={w.thumbnailUrl} alt="" loading="lazy" /> : [...w.title][0]}
        </span>
        <strong className="works__name" title={w.title}>
          {w.title}
        </strong>
        <span className="works__cell">{TYPE_LABEL[w.type]}</span>
        <span className="works__cell works__cell--wide" title={source}>
          {source}
        </span>
        <span className="works__cell">{w.creatorName ?? ''}</span>
        <span className="works__cell">
          <Tag tone={vis === 'team' ? 'blue' : 'gray'} icon={vis === 'private' ? 'lock' : undefined}>
            {w.access === 'view' ? t('只读') : VISIBILITY_LABEL[vis]}
          </Tag>
        </span>
        <time className="works__time" dateTime={w.updatedAt} title={fullTime(w.updatedAt)}>
          {ago(w.updatedAt)}
        </time>
      </button>
    </li>
  )
}

/** A work I may only look at (a team member outside its group): its preview, presentable, nothing to edit. */
function WorkViewer({ work, onBack }: { work: WorkDto; onBack: () => void }) {
  const { preview, error, retry } = useArtifactPreview(work.id, null, true)
  const frame = useRef<HTMLIFrameElement>(null)
  const [joining, setJoining] = useState(false)
  const canJoin = work.access === 'view' && work.groupKind === 'group' && work.groupVisibility === 'public'
  const note =
    work.groupKind === 'works'
      ? work.creatorName
        ? t('只读 · {name} 的独立作品（仅创建人与协作者可修改）', { name: work.creatorName })
        : t('只读 · 独立作品（仅创建人与协作者可修改）')
      : work.groupKind === 'dm'
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
      ) : error ? (
        <div className="works__center">
          <EmptyState
            icon="warning"
            title={t('打不开作品预览')}
            description={error}
            action={
              <Button size="small" onClick={retry}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="works__center">
          <Spinner />
        </div>
      )}
    </section>
  )
}
