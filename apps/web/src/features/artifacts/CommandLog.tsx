import type { ArtifactHistoryItem } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { Spinner } from '../../ui'
import { RunStatusIcon } from '../chat/RunGraphics'
import { openTab } from '../workbench/open'
import { focusArtifact } from './store'

/**
 * 命令记录: what members told bots to do with this artifact and what came of it (GET /api/artifacts/:id/history),
 * reloaded whenever the artifact's head or running state changes.
 */
export function CommandLog({
  artifactId,
  groupId,
  refreshKey,
}: {
  artifactId: string
  groupId: string
  /** Changes when the log may have changed (a new head, a run starting or ending). */
  refreshKey: string
}) {
  const [items, setItems] = useState<ArtifactHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const inRouter = useInRouterContext()
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey only triggers a reload
  useEffect(() => {
    let live = true
    api
      .get<ArtifactHistoryItem[]>(`/artifacts/${artifactId}/history`)
      .then((r) => {
        if (!live) return
        setItems(r)
        setError('')
      })
      .catch((e) => live && setError(errorText(e)))
    return () => {
      live = false
    }
  }, [artifactId, refreshKey])

  if (error && !items) return <p className="art-log__empty">{error}</p>
  if (!items)
    return (
      <p className="art-log__empty">
        <Spinner size={12} />
      </p>
    )
  if (!items.length) return <p className="art-log__empty">{t('还没有发给 AI 的命令')}</p>
  return (
    <ol className="art-log" data-testid="art-log">
      {items.map((m) => (
        <li key={m.messageId} className="art-log__item">
          <div className="art-log__head">
            <span className="art-log__who">{m.authorName}</span>
            <time dateTime={m.createdAt}>{ago(m.createdAt)}</time>
            {inRouter ? <LocateMessage groupId={groupId} messageId={m.messageId} /> : null}
          </div>
          <p className="art-log__body">{m.body}</p>
          {m.screens.length ? (
            <button
              type="button"
              className="art-log__screens"
              onClick={() => focusArtifact(artifactId, { screenIds: m.screens.map((s) => s.id) })}
            >
              {m.screens.map((s) => s.title).join('、')}
            </button>
          ) : null}
          {m.runs.map((r) => (
            <div key={r.id} className="art-log__run">
              <div className="art-log__run-head">
                <RunStatusIcon status={r.status} spelled />
                <span className="art-log__bot">{r.botName}</span>
                {r.versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="art-log__version"
                    title={v.candidate ? t('候选') : undefined}
                    onClick={() => focusArtifact(artifactId, { versionId: v.id })}
                  >
                    v{v.n}
                    {v.candidate ? '*' : ''}
                  </button>
                ))}
                <button
                  type="button"
                  className="art-log__link"
                  onClick={() => openTab({ kind: 'run', runId: r.id, view: 'process', file: null })}
                >
                  {t('执行过程')}
                </button>
              </div>
              {r.summary ? <p className="art-log__summary">{r.summary}</p> : null}
            </div>
          ))}
        </li>
      ))}
    </ol>
  )
}

/** 定位消息: back to the group's chat, scrolled to the message (ChatView `?msg=`). */
function LocateMessage({ groupId, messageId }: { groupId: string; messageId: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="art-log__link"
      onClick={() => navigate(`/g/${groupId}?msg=${messageId}`)}
    >
      {t('定位消息')}
    </button>
  )
}
