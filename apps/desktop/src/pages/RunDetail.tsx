import { ActivityDock } from '@web/features/runs/ActivityDock'
import { IssueBanner } from '@web/features/runs/IssueBanner'
import { agentErrorIssue, interruptedIssue, type RunIssue } from '@web/features/runs/issue'
import { locateStep, ProcessView } from '@web/features/runs/ProcessView'
import { processSteps } from '@web/features/runs/steps'
import { Alert, Badge, Button, EmptyState, GroupBox, Icon, Spinner } from '@web/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { ipc, type ProcessPatch, type RunProcess } from '../ipc'
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

function processIssue(p: RunProcess): RunIssue | null {
  if (p.outcome === 'failed') return agentErrorIssue(p.error ?? '')
  return p.outcome === 'interrupted' && p.error ? interruptedIssue(p.error) : null
}

/** Applies a `runProcess` poll to the process shown so far: the same object back when nothing changed. */
export function mergeProcess(
  shown: RunProcess | null | undefined,
  patch: ProcessPatch | null,
): RunProcess | null {
  if (!patch) return null
  if (shown?.rev === patch.rev) return shown
  const { firstId, events, ...rest } = patch
  if (!shown) return { ...rest, events }
  // The patch starts at the last event shown, which may have grown; the daemon evicted those before `firstId`.
  const from = events[0]?.id ?? Number.POSITIVE_INFINITY
  const kept = firstId === null ? [] : shown.events.filter((e) => e.id >= firstId && e.id < from)
  return { ...rest, events: [...kept, ...events] }
}

/** 概览 → one run: its process as this machine executed it, rendered like the web run rail. */
export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [process, setProcess] = useState<RunProcess | null | undefined>(undefined)
  const [pollError, setPollError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const retry = useCallback(() => setRetryTick((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Each poll asks only for what changed since the process shown, so it is not rebuilt every second.
    let shown: RunProcess | null | undefined
    const load = () =>
      ipc.runProcess(runId, shown?.events.at(-1)?.id ?? null, shown?.rev ?? null).then(
        (patch) => {
          if (!alive) return
          shown = mergeProcess(shown, patch)
          setProcess(shown)
          setPollError('')
          setRetrying(false)
          timer = setTimeout(load, shown && shown.endedMs === null ? POLL_MS : ENDED_POLL_MS)
        },
        (e) => {
          if (!alive) return
          setPollError(e instanceof Error ? e.message : String(e))
          setRetrying(false)
          timer = setTimeout(load, POLL_MS)
        },
      )
    if (retryTick > 0) setRetrying(true)
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [runId, retryTick])
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
  const issue = process && processIssue(process)
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
      {issue ? <IssueBanner issue={issue} /> : null}
      {pollError ? (
        <Alert
          variant="error"
          title={t('读取运行过程失败')}
          description={pollError}
          retrying={retrying}
          onRetry={retry}
        />
      ) : null}
      <Section title={t('运行过程')}>
        <GroupBox>
          {process === undefined ? (
            pollError ? null : (
              <div className="dk-row">
                <Spinner />
              </div>
            )
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
                filterable
              />
            </div>
          )}
        </GroupBox>
      </Section>
      <div className="dk-dock">
        <ActivityDock steps={steps} onLocate={(key) => locateStep(document, key)} />
      </div>
    </>
  )
}
