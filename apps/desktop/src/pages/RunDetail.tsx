import { ProcessView } from '@web/features/runs/ProcessView'
import { processSteps } from '@web/features/runs/steps'
import { Badge, Button, EmptyState, GroupBox, Icon, Spinner } from '@web/ui'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { ipc, type RunProcess } from '../ipc'
import { runBadge } from '../lib/labels'
import { Section } from '../lib/ui'
import { useHeading } from '../store'

/** Local IPC is cheap: polling keeps the view simple and also follows background tasks after the run ended. */
const POLL_MS = 1000
/** Once the run ended only background tasks still change it. */
const ENDED_POLL_MS = 5000
const OUTCOME = {
  completed: { text: t('已完成'), variant: 'success' },
  interrupted: { text: t('已中断'), variant: 'secondary' },
  failed: { text: t('失败'), variant: 'destructive' },
} as const

/** 概览 → one run: its process as this machine executed it, rendered like the web run rail. */
export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [process, setProcess] = useState<RunProcess | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // An unchanged poll keeps the old object, so the process is not rebuilt every second.
    let last = ''
    const load = () =>
      ipc.runProcess(runId).then(
        (p) => {
          if (!alive) return
          const json = JSON.stringify(p)
          if (json !== last) {
            last = json
            setProcess(p)
          }
          timer = setTimeout(load, p && p.endedMs === null ? POLL_MS : ENDED_POLL_MS)
        },
        () => {
          if (alive) timer = setTimeout(load, POLL_MS)
        },
      )
    load()
    return () => {
      alive = false
      clearTimeout(timer)
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
  const title = run?.botName
  const subtitle = run && t('{group} · {user} 触发', { group: run.groupName, user: run.triggeredBy })
  useEffect(() => {
    if (title) useHeading.setState({ heading: { title, subtitle } })
  }, [title, subtitle])
  useEffect(() => () => useHeading.setState({ heading: null }), [])
  const badge = process?.outcome ? OUTCOME[process.outcome] : runBadge(run?.status ?? null)
  return (
    <>
      <div className="dk-row dk-detail__head">
        <Button size="small" variant="plain" onClick={onBack}>
          <Icon name="chevron-left" size={14} />
          {t('返回')}
        </Button>
        <span className="dk-flex" />
        {run ? <Badge variant={badge.variant}>{badge.text}</Badge> : null}
      </div>
      <Section title={t('运行过程')}>
        <GroupBox>
          {process === undefined ? (
            <div className="dk-row">
              <Spinner />
            </div>
          ) : process === null ? (
            <EmptyState compact icon="tray" title={t('该轮次的过程已不在本机保留')} />
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
