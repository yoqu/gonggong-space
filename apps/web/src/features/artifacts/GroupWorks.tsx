import type { ArtifactDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { Button, Icon, Popover, SearchField, Spinner } from '../../ui'
import { setEditing } from './editing'
import { loadGroupArtifacts, useGroupArtifacts } from './groupArtifacts'
import { openArtifact } from './store'
import './group-works.css'

/**
 * 作品 in the group tab bar: the group's artifacts, latest update first, so one is found without scrolling back to
 * its card. 继续对话 makes it the composer's 正在编辑; 打开 shows its canvas.
 */
export function GroupWorksTab({ groupId }: { groupId: string }) {
  const list = useGroupArtifacts(groupId)
  const [q, setQ] = useState('')
  if (!list.length) return null
  const shown = q.trim() ? list.filter((a) => a.title.toLowerCase().includes(q.trim().toLowerCase())) : list
  return (
    <Popover
      portal
      width={340}
      aria-label={t('本群作品')}
      onOpenChange={(open) => {
        if (open) void loadGroupArtifacts(groupId)
        else setQ('')
      }}
      trigger={
        <button type="button" className="gtab" data-testid="group-works">
          <Icon name="grid" size={13} />
          <span className="gtab__title">{t('作品')}</span>
          <span className="gworks__count">{list.length}</span>
        </button>
      }
    >
      {(close) => (
        <div className="gworks">
          {list.length > 5 ? (
            <SearchField placeholder={t('搜索作品')} value={q} onChange={setQ} className="gworks__search" />
          ) : null}
          <ul className="gworks__list">
            {shown.map((a) => (
              <WorkRow key={a.id} a={a} groupId={groupId} close={close} />
            ))}
            {!shown.length ? <li className="gworks__empty">{t('没有匹配的作品')}</li> : null}
          </ul>
        </div>
      )}
    </Popover>
  )
}

function WorkRow({ a, groupId, close }: { a: ArtifactDto; groupId: string; close: () => void }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === (a.runner?.botId ?? a.botId)))
  const runner =
    a.runner &&
    (a.runner.status === 'running'
      ? t('{name} 运行中', { name: bot?.name ?? 'Bot' })
      : a.runner.status === 'awaiting_answer'
        ? t('{name} 等待回答', { name: bot?.name ?? 'Bot' })
        : t('{name} 等待审批', { name: bot?.name ?? 'Bot' }))
  const open = () => {
    close()
    openArtifact(a.id, a.title)
  }
  return (
    <li className="gworks__row">
      <button type="button" className="gworks__shot" tabIndex={-1} onClick={open} aria-hidden="true">
        {a.head?.thumbnailUrl ? (
          <img src={a.head.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <Icon name="grid" size={16} />
        )}
      </button>
      <div className="gworks__main">
        <span className="gworks__title" title={a.title}>
          {a.title}
        </span>
        <span className="gworks__meta">
          {runner ? (
            <span className="gworks__run">
              <Spinner size={10} />
              {runner}
            </span>
          ) : null}
          {a.head ? <span>{`v${a.head.n}`}</span> : <span>{t('生成中')}</span>}
          <span>{ago(a.updatedAt)}</span>
        </span>
      </div>
      <div className="gworks__acts">
        <Button
          size="small"
          variant="primary"
          onClick={() => {
            close()
            setEditing(groupId, { artifactId: a.id, title: a.title })
          }}
        >
          {t('继续对话')}
        </Button>
        <Button size="small" onClick={open}>
          {t('打开')}
        </Button>
      </div>
    </li>
  )
}
