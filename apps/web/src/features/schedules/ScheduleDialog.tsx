import { formatInZone, type I18nText, type ScheduleDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import {
  Button,
  Dialog,
  GroupBox,
  IconButton,
  Input,
  PopUpButton,
  SegmentedControl,
  TextArea,
  TextField,
} from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { schedulesApi } from './store'
import './schedules.css'

type Mode = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'once' | 'custom'
const MODES: { value: Mode; label: string }[] = [
  { value: 'daily', label: t('每天') },
  { value: 'weekdays', label: t('每个工作日') },
  { value: 'weekly', label: t('每周') },
  { value: 'monthly', label: t('每月') },
  { value: 'once', label: t('仅一次') },
  { value: 'custom', label: t('自定义') },
]
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const pad = (n: number | string) => String(n).padStart(2, '0')

interface Draft {
  mode: Mode
  time: string
  weekday: string
  day: string
  /** `datetime-local` value, in the browser's time zone. */
  date: string
  cron: string
}

/** The editor fields of a saved timing: a preset when the expression is one, else the raw expression. */
function draftOf(s: ScheduleDto | undefined): Draft {
  const blank: Draft = { mode: 'weekdays', time: '09:00', weekday: '1', day: '1', date: '', cron: '' }
  if (!s) return blank
  if (s.runAt) {
    const d = new Date(s.runAt)
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    return { ...blank, mode: 'once', date }
  }
  const [m = '', h = '', dom = '', mon = '', dow = ''] = (s.cron ?? '').split(/\s+/)
  const fixed = /^\d+$/.test(m) && /^\d+$/.test(h) && mon === '*'
  const time = fixed ? `${pad(h)}:${pad(m)}` : blank.time
  if (fixed && dom === '*' && dow === '*') return { ...blank, mode: 'daily', time }
  if (fixed && dom === '*' && dow === '1-5') return { ...blank, mode: 'weekdays', time }
  if (fixed && dom === '*' && /^[0-6]$/.test(dow)) return { ...blank, mode: 'weekly', time, weekday: dow }
  if (fixed && /^\d+$/.test(dom) && dow === '*') return { ...blank, mode: 'monthly', time, day: dom }
  return { ...blank, mode: 'custom', cron: s.cron ?? '' }
}

function timingOf(d: Draft): { cron?: string; runAt?: string } {
  const [h = '0', m = '0'] = d.time.split(':')
  const at = `${Number(m)} ${Number(h)}`
  switch (d.mode) {
    case 'daily':
      return { cron: `${at} * * *` }
    case 'weekdays':
      return { cron: `${at} * * 1-5` }
    case 'weekly':
      return { cron: `${at} * * ${d.weekday}` }
    case 'monthly':
      return { cron: `${at} ${d.day} * *` }
    case 'once':
      return d.date ? { runAt: new Date(d.date).toISOString() } : {}
    case 'custom':
      return d.cron.trim() ? { cron: d.cron.trim() } : {}
  }
}

/** 新建 / 编辑定时任务: candidates in order (the first available one runs it), the timing and its next firings. */
export function ScheduleDialog({
  groupId,
  botIds,
  schedule,
  onClose,
}: {
  groupId: string
  /** The group's bots, offered as candidates. */
  botIds: string[]
  schedule?: ScheduleDto
  onClose: () => void
}) {
  const allBots = useWorkspace((s) => s.bots)
  const [name, setName] = useState(schedule?.name ?? '')
  const [prompt, setPrompt] = useState(schedule?.prompt ?? '')
  const [candidates, setCandidates] = useState<string[]>(schedule?.botIds ?? [])
  const [draft, setDraft] = useState(() => draftOf(schedule))
  const [preview, setPreview] = useState<{ error: I18nText | null; next: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const timezone = schedule && draft.mode !== 'once' ? schedule.timezone : BROWSER_TZ
  const timing = timingOf(draft)
  const key = JSON.stringify({ ...timing, timezone })

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the timing
  useEffect(() => {
    setPreview(null)
    if (!timing.cron && !timing.runAt) return
    let live = true
    const timer = setTimeout(() => {
      schedulesApi.preview({ ...timing, timezone }).then(
        (p) => live && setPreview(p),
        () => {},
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key])

  const set = (o: Partial<Draft>) => setDraft((d) => ({ ...d, ...o }))
  const nameOf = (id: string) => allBots.find((b) => b.id === id)?.name ?? t('已移出')
  const move = (i: number) =>
    setCandidates((c) =>
      c.map((id, j) => (j === i - 1 ? (c[i] as string) : j === i ? (c[i - 1] as string) : id)),
    )
  const ready = !!name.trim() && !!prompt.trim() && candidates.length > 0 && !!preview && !preview.error

  const save = async () => {
    setSaving(true)
    try {
      const body = { name: name.trim(), prompt: prompt.trim(), botIds: candidates, ...timing, timezone }
      if (schedule) await schedulesApi.update(schedule.id, body)
      else await schedulesApi.create(groupId, body)
      onClose()
    } catch (e) {
      toastError(e)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      width={540}
      closeOnBackdrop={false}
      title={schedule ? t('编辑定时任务') : t('新建定时任务')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={!ready || saving} onClick={() => void save()}>
            {schedule ? t('保存') : t('创建')}
          </Button>
        </>
      }
    >
      <div className="sc-form">
        <TextField
          label={t('名称')}
          value={name}
          maxLength={60}
          placeholder={t('如：每日 PR 汇总')}
          onChange={(e) => setName(e.target.value)}
        />
        <TextArea
          label={t('指令')}
          value={prompt}
          maxLength={4000}
          rows={4}
          placeholder={t('到点发给 Bot 的完整指令：要做什么、范围和产出')}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <section>
          <h3 className="sc-form__title">{t('候选 Bot · 到点由第一个可用的执行')}</h3>
          <GroupBox>
            {candidates.map((id, i) => (
              <div key={id} className="sc-bot">
                <span className="sc-bot__rank">{i + 1}</span>
                <BotAvatar id={id} name={nameOf(id)} size={22} />
                <span className="sc-bot__name">{nameOf(id)}</span>
                <IconButton
                  size="small"
                  title={t('上移 {name}', { name: nameOf(id) })}
                  disabled={i === 0}
                  onClick={() => move(i)}
                >
                  {'chevron-up' as const}
                </IconButton>
                <IconButton
                  size="small"
                  title={t('移除 {name}', { name: nameOf(id) })}
                  onClick={() => setCandidates(candidates.filter((x) => x !== id))}
                >
                  {'minus' as const}
                </IconButton>
              </div>
            ))}
            <div className="sc-bot sc-bot--add">
              {botIds
                .filter((id) => !candidates.includes(id))
                .map((id) => (
                  <Button
                    key={id}
                    size="small"
                    aria-label={t('添加 {name}', { name: nameOf(id) })}
                    onClick={() => setCandidates([...candidates, id])}
                  >
                    + {nameOf(id)}
                  </Button>
                ))}
              {botIds.every((id) => candidates.includes(id)) ? (
                <span className="sc-muted">{t('本群的 Bot 都已加入')}</span>
              ) : null}
            </div>
          </GroupBox>
        </section>

        <section>
          <h3 className="sc-form__title">{t('执行时间')}</h3>
          <SegmentedControl<Mode>
            aria-label={t('频率')}
            items={MODES}
            value={draft.mode}
            onChange={(mode) => set({ mode })}
          />
          <div className="sc-timing">
            {draft.mode === 'weekly' ? (
              <PopUpButton
                aria-label={t('星期')}
                value={draft.weekday}
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: t(d) }))}
                onChange={(weekday) => set({ weekday })}
              />
            ) : null}
            {draft.mode === 'monthly' ? (
              <Input
                aria-label={t('日期（每月第几日）')}
                type="number"
                min={1}
                max={31}
                value={draft.day}
                onChange={(e) => set({ day: e.target.value })}
              />
            ) : null}
            {draft.mode === 'once' ? (
              <Input
                aria-label={t('执行时刻')}
                type="datetime-local"
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            ) : draft.mode === 'custom' ? (
              <TextField
                label={t('cron 表达式')}
                mono
                value={draft.cron}
                placeholder="*/30 9-18 * * 1-5"
                hint={t('分 时 日 月 周（0 = 周日），时区 {tz}', { tz: timezone })}
                onChange={(e) => set({ cron: e.target.value })}
              />
            ) : (
              <Input
                aria-label={t('时间')}
                type="time"
                value={draft.time}
                onChange={(e) => set({ time: e.target.value })}
              />
            )}
          </div>
          <p className={preview?.error ? 'sc-preview sc-preview--error' : 'sc-preview'}>
            {preview?.error
              ? t.text(preview.error)
              : preview?.next.length
                ? t('接下来：{times}', {
                    times: preview.next.map((iso) => formatInZone(iso, timezone)).join(t('、')),
                  })
                : null}
          </p>
        </section>
      </div>
    </Dialog>
  )
}
