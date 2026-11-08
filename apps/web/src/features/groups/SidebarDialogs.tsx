import type { ChannelDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import {
  Avatar,
  Button,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Icon,
  Input,
  SegmentedControl,
  Select,
  Spinner,
  Tag,
} from '../../ui'
import { channelKind } from './channel'
import { channelsApi } from './sections'
import './groups.css'

/** 新建分区 / 重命名分区: `save` gets the trimmed name. */
export function SectionNameDialog({
  initial = '',
  team,
  parent,
  onSave,
  onClose,
}: {
  initial?: string
  /** A 团队分区, seen by everyone in the team. */
  team?: boolean
  /** Name of the section a new one nests under. */
  parent?: string
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ok = !!name.trim() && name.trim() !== initial
  // One request at a time: a double click or Enter repeat must not create two sections.
  const save = () => {
    if (!ok || busy) return
    setBusy(true)
    onSave(name.trim()).then(onClose, (e) => {
      toastError(e)
      setBusy(false)
    })
  }
  return (
    <Dialog
      open
      width={400}
      title={
        initial
          ? team
            ? t('重命名团队分区')
            : t('重命名分区')
          : parent
            ? t('新建子分区')
            : team
              ? t('新建团队分区')
              : t('新建分区')
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={save}>
            {initial ? t('保存') : t('创建')}
          </Button>
        </>
      }
    >
      {parent ? <p className="section-dialog__hint">{t('放在「{name}」下', { name: parent })}</p> : null}
      {team ? (
        <p className="section-dialog__hint">{t('团队所有成员都能看到；群管理员可把自己的群归入其中')}</p>
      ) : null}
      <Input
        aria-label={t('分区名称')}
        value={name}
        maxLength={40}
        placeholder={t('如：发版与运维')}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
        }}
      />
    </Dialog>
  )
}

/** 浏览频道: the team's public channels; join one, or open one already joined. */
type Show = 'all' | 'joined' | 'other'
type Order = 'name' | 'members' | 'active'

const SEARCH_DEBOUNCE_MS = 200

const sorters: Record<Order, (a: ChannelDto, b: ChannelDto) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  members: (a, b) => b.memberCount - a.memberCount,
  active: (a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
}

/** 浏览频道: the team's public channels and my private groups, filtered and sorted (Slack's channel browser). */
export function BrowseChannelsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [list, setList] = useState<ChannelDto[] | null>(null)
  const [joining, setJoining] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [order, setOrder] = useState<Order>('active')
  useEffect(() => {
    let live = true
    // Typing waits for a pause instead of querying on every keystroke.
    const id = setTimeout(
      () => channelsApi.list(q).then((l) => live && setList(l), toastError),
      q ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [q])
  const open = (id: string) => {
    onClose()
    navigate(`/g/${id}`)
  }
  const join = async (id: string) => {
    setJoining(id)
    try {
      await channelsApi.join(id)
      open(id)
    } catch (e) {
      toastError(e)
      setJoining('')
    }
  }
  const shown = (list ?? [])
    .filter((c) => show === 'all' || c.joined === (show === 'joined'))
    .sort(sorters[order])
  return (
    <Dialog open width={560} title={t('浏览频道')} onClose={onClose}>
      <Input
        aria-label={t('搜索频道')}
        value={q}
        placeholder={t('搜索频道')}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="browse-channels__bar">
        <SegmentedControl
          aria-label={t('显示')}
          size="small"
          items={[
            { value: 'all', label: t('全部') },
            { value: 'joined', label: t('已加入') },
            { value: 'other', label: t('未加入') },
          ]}
          value={show}
          onChange={setShow}
        />
        <span className="spacer" />
        <Select
          label={t('排序')}
          options={[
            { value: 'active', label: t('最近活跃') },
            { value: 'members', label: t('人数最多') },
            { value: 'name', label: t('名称') },
          ]}
          value={order}
          onChange={setOrder}
        />
      </div>
      {!list ? (
        <Spinner />
      ) : shown.length ? (
        <GroupBox className="browse-channels">
          {shown.map((c) => {
            const kind = channelKind(c.visibility)
            return (
              <GroupRow
                key={c.id}
                className="browse-channels__row"
                label={
                  <span className="browse-channels__name">
                    <Avatar name={c.name} src={c.avatar ?? undefined} shape="square" size={28} />
                    <Icon name={kind.icon} size={12} label={kind.label} />
                    {c.name}
                    {c.joined ? <Tag tone="gray">{t('已加入')}</Tag> : null}
                  </span>
                }
                description={
                  <span className="browse-channels__meta">
                    <span>
                      {[
                        t('{n} 人', { n: c.memberCount }),
                        t('{name} 创建', { name: c.createdByName }),
                        c.lastActivityAt ? t('最近活跃 {time}', { time: ago(c.lastActivityAt) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {c.notice ? <span className="browse-channels__notice">{c.notice}</span> : null}
                  </span>
                }
              >
                {c.joined ? (
                  <Button size="small" onClick={() => open(c.id)}>
                    {t('打开')}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="primary"
                    loading={joining === c.id}
                    disabled={!!joining}
                    aria-label={t('加入 {name}', { name: c.name })}
                    onClick={() => void join(c.id)}
                  >
                    {t('加入')}
                  </Button>
                )}
              </GroupRow>
            )
          })}
        </GroupBox>
      ) : (
        <EmptyState
          compact
          icon="globe"
          title={q.trim() || show !== 'all' ? t('没有匹配的频道') : t('还没有公开频道')}
          description={
            q.trim() || show !== 'all' ? undefined : t('群管理员可在群设置的「成员」里把群设为公开频道')
          }
        />
      )}
    </Dialog>
  )
}
