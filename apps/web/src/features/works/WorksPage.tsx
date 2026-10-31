import type { ArtifactVisibility, WorkDto, WorkGroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Button, EmptyState, Icon, MenuButton, SearchField, SegmentedControl, Spinner, Tag } from '../../ui'
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

/** 作品 shows in the app rail once one of my groups has a creation plugin on. */
export function useWorksShown() {
  const groups = useWorks((s) => s.groups)
  useEffect(() => {
    if (useWorks.getState().groups === null) void loadWorkGroups()
  }, [])
  return !!groups?.length
}

export const VISIBILITY_LABEL: Record<ArtifactVisibility, string> = {
  private: t('仅自己可见'),
  group: t('本群可见'),
  team: t('团队可见'),
}

type Scope = 'all' | 'mine' | 'team'

/** 作品: every artifact I may open, across my groups; `/works/:artifactId` views a read-only one. */
export function WorksPage() {
  const { artifactId } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const { groups, list, error } = useWorks()
  const [scope, setScope] = useState<Scope>('all')
  const [query, setQuery] = useState('')
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
        <div className="works__center">{list ? t('作品不存在或你没有权限查看') : <Spinner />}</div>
      </section>
    )

  const q = query.trim().toLowerCase()
  const shown = (list ?? []).filter(
    (w) =>
      (scope === 'all' || (scope === 'mine' ? w.createdBy === me : w.visibility === 'team')) &&
      (!q || `${w.title} ${w.groupTitle}`.toLowerCase().includes(q)),
  )
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
        <SearchField
          className="works__search"
          placeholder={t('搜索作品')}
          aria-label={t('搜索作品')}
          value={query}
          onChange={setQuery}
        />
        <MenuButton
          className="ui-btn ui-btn--primary ui-btn--small"
          aria-label={t('新建')}
          title={groups?.length ? t('选一个群，在群聊里创作') : t('还没有开启创作插件的群')}
          disabled={!groups?.length}
          align="end"
          items={(groups ?? []).map((g) => ({ label: g.title, value: g.id, icon: 'message' as const }))}
          onSelect={create}
        >
          <Icon name="plus" size={14} />
          {t('新建')}
        </MenuButton>
      </header>
      {error && !list ? (
        <div className="works__center">{error}</div>
      ) : !list ? (
        <div className="works__center">
          <Spinner />
        </div>
      ) : shown.length ? (
        <ul className="works__grid" aria-label={t('作品')}>
          {shown.map((w) => (
            <li key={w.id} className="works__card">
              <button
                type="button"
                className="works__shot"
                aria-label={t('打开 {title}', { title: w.title })}
                onClick={() => open(w)}
              >
                {w.thumbnailUrl ? (
                  <img src={w.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <Icon name="grid" size={28} />
                )}
              </button>
              <div className="works__body">
                <strong className="works__name" title={w.title}>
                  {w.title}
                </strong>
                <span className="works__meta">
                  {[w.groupTitle, w.creatorName, new Date(w.updatedAt).toLocaleDateString()]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="works__tags">
                  {w.pluginTitle ? <Tag>{w.pluginTitle}</Tag> : null}
                  <Tag
                    tone={w.visibility === 'team' ? 'blue' : 'gray'}
                    icon={w.visibility === 'private' ? 'lock' : undefined}
                  >
                    {VISIBILITY_LABEL[w.visibility]}
                  </Tag>
                  {w.access === 'view' ? <Tag tone="orange">{t('只读')}</Tag> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="grid"
          title={list.length ? t('没有符合条件的作品') : t('还没有作品')}
          description={list.length ? undefined : t('在群聊里发起创作，产出的原型和幻灯片会汇总到这里')}
        />
      )}
    </section>
  )
}

/** A work I may only look at (a team member outside its group): its preview, presentable, nothing to edit. */
function WorkViewer({ work, onBack }: { work: WorkDto; onBack: () => void }) {
  const { preview, error } = useArtifactPreview(work.id, null, true)
  return (
    <section className="works works--viewer" aria-label={work.title}>
      <header className="works__head">
        <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回作品')} onClick={onBack}>
          {t('作品')}
        </Button>
        <h1 className="works__title">{work.title}</h1>
        <span className="works__note">{t('只读 · 进入「{group}」后可修改', { group: work.groupTitle })}</span>
      </header>
      {preview ? (
        <iframe className="works__frame" title={work.title} src={preview.url} />
      ) : (
        <div className="works__center">{error || <Spinner />}</div>
      )}
    </section>
  )
}
