import type { ChannelDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Avatar, Button, Dialog, EmptyState, GroupBox, GroupRow, Input, Spinner } from '../../ui'
import { channelsApi } from './sections'
import './groups.css'

/** 新建分区 / 重命名分区: `save` gets the trimmed name. */
export function SectionNameDialog({
  initial = '',
  onSave,
  onClose,
}: {
  initial?: string
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const ok = !!name.trim() && name.trim() !== initial
  const save = () => void onSave(name.trim()).then(onClose, toastError)
  return (
    <Dialog
      open
      width={400}
      title={initial ? t('重命名分区') : t('新建分区')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={!ok} onClick={save}>
            {initial ? t('保存') : t('创建')}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t('分区名称')}
        value={name}
        maxLength={40}
        placeholder={t('如：发版与运维')}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ok) save()
        }}
      />
    </Dialog>
  )
}

/** 浏览频道: the team's public channels; join one, or open one already joined. */
export function BrowseChannelsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [list, setList] = useState<ChannelDto[] | null>(null)
  const [joining, setJoining] = useState('')
  useEffect(() => {
    let live = true
    channelsApi.list(q).then((l) => live && setList(l), toastError)
    return () => {
      live = false
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
  return (
    <Dialog open width={520} title={t('浏览频道')} onClose={onClose}>
      <Input
        aria-label={t('搜索频道')}
        value={q}
        placeholder={t('搜索频道')}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
      />
      {!list ? (
        <Spinner />
      ) : list.length ? (
        <GroupBox className="browse-channels">
          {list.map((c) => (
            <GroupRow
              key={c.id}
              label={
                <span className="browse-channels__name">
                  <Avatar name={c.name} src={c.avatar ?? undefined} shape="square" size={28} />
                  {c.name}
                </span>
              }
              description={[t('{n} 人', { n: c.memberCount }), c.notice].filter(Boolean).join(' · ')}
            >
              {c.joined ? (
                <Button size="small" onClick={() => open(c.id)}>
                  {t('打开')}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="primary"
                  disabled={!!joining}
                  aria-label={t('加入 {name}', { name: c.name })}
                  onClick={() => void join(c.id)}
                >
                  {t('加入')}
                </Button>
              )}
            </GroupRow>
          ))}
        </GroupBox>
      ) : (
        <EmptyState
          compact
          icon="globe"
          title={q.trim() ? t('没有匹配的频道') : t('还没有公开频道')}
          description={q.trim() ? undefined : t('群管理员可在群设置的「成员」里把群设为公开频道')}
        />
      )}
    </Dialog>
  )
}
