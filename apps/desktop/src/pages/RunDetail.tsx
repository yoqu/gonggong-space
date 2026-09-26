import { ProcessView } from '@web/features/runs/ProcessView'
import { processSteps } from '@web/features/runs/steps'
import { Badge, Button, EmptyState, GroupBox, Icon, Spinner } from '@web/ui'
import { useEffect, useMemo, useState } from 'react'
import { ipc, type RunProcess } from '../ipc'
import { runBadge } from '../lib/labels'
import { Section } from '../lib/ui'

/** Local IPC is cheap: polling keeps the view simple and also follows background tasks after the run ended. */
const POLL_MS = 1000
const OUTCOME = {
  completed: { text: '已完成', variant: 'success' },
  interrupted: { text: '已中断', variant: 'secondary' },
  failed: { text: '失败', variant: 'destructive' },
} as const

/** 概览 → one run: its process as this machine executed it, rendered like the web run rail. */
export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [process, setProcess] = useState<RunProcess | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = () =>
      ipc.runProcess(runId).then(
        (p) => alive && setProcess(p),
        () => {},
      )
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [runId])
  const live = !!process && process.endedMs === null
  const steps = useMemo(
    () =>
      processSteps(
        (process?.events ?? []).map((e) => ({
          id: e.id,
          at: new Date(e.atMs).toISOString(),
          event: e.event,
        })),
        [],
        live,
      ),
    [process, live],
  )
  const run = process?.run
  const badge = process?.outcome ? OUTCOME[process.outcome] : runBadge(run?.status ?? null)
  return (
    <>
      <div className="dk-row dk-detail__head">
        <Button size="small" variant="plain" onClick={onBack}>
          <Icon name="chevron-left" size={14} />
          返回
        </Button>
        {run ? (
          <span className="dk-row__main">
            <span className="dk-row__title">
              <span className="dk-strong">{run.botName}</span>
              <span className="dk-sub">
                {run.groupName} · {run.triggeredBy} 触发
              </span>
            </span>
          </span>
        ) : (
          <span className="dk-flex" />
        )}
        {run ? <Badge variant={badge.variant}>{badge.text}</Badge> : null}
      </div>
      <Section title="运行过程">
        <GroupBox>
          {process === undefined ? (
            <div className="dk-row">
              <Spinner />
            </div>
          ) : process === null ? (
            <EmptyState compact icon="tray" title="该轮次的过程已不在本机保留" />
          ) : (
            <div className="dk-process">
              <ProcessView
                steps={steps}
                root={null}
                live={live}
                startedAt={run ? new Date(run.startedMs).toISOString() : null}
                workedMs={process.endedMs && run ? process.endedMs - run.startedMs : null}
              />
            </div>
          )}
        </GroupBox>
      </Section>
    </>
  )
}
