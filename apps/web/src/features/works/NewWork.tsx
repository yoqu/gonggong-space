import type { NewWorkRes, NewWorkType, WorkStarterDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, Dialog, EmptyState, Icon, type IconName, Spinner, toast } from '../../ui'
import { lastWorkBot, pickDefaultBot, rememberCanvasBot, useArtifactBots } from '../artifacts/CanvasBotPicker'
import { previewUrl } from '../plugins/model'

/** 新建: an empty work opens on its canvas straight away; the Bot is picked under the canvas's input (last pick first). */
export function useNewWork(onCreated: () => Promise<unknown>) {
  const navigate = useNavigate()
  const options = useArtifactBots()
  const [busy, setBusy] = useState(false)
  const create = async (type: NewWorkType = 'prototype', templateId?: string) => {
    const botId = pickDefaultBot(options, lastWorkBot())?.id
    if (!botId) {
      toast({ type: 'error', message: t('当前团队暂无可用于创作作品的 Bot') })
      return false
    }
    setBusy(true)
    let res: NewWorkRes
    try {
      res = await api.post<NewWorkRes>('/works', { botId, type, templateId })
      rememberCanvasBot(res.artifactId, botId)
      await onCreated()
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
    navigate(`/works/${res.artifactId}`)
    return true
  }
  return { busy, create }
}

/** What 新建作品 offers; 网页 is made from a Bot's preview in a group, so it only explains how. */
export type NewChoice = NewWorkType | 'site'

const CHOICES: { value: NewChoice; icon: IconName; title: string; hint: string }[] = [
  {
    value: 'prototype',
    icon: 'smartphone',
    title: t('产品原型'),
    hint: t('可点击跳转的 App、小程序或网页原型'),
  },
  { value: 'slides', icon: 'slides', title: t('幻灯片'), hint: t('可翻页的汇报、路演和周报') },
  { value: 'site', icon: 'globe', title: t('网页'), hint: t('在线发布、随时可分享打开的网页') },
]

/** 新建作品: pick a type (and for 幻灯片 a template), then the empty work opens on its canvas. */
export function NewWorkDialog({
  open,
  initial,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean
  initial: NewChoice
  busy: boolean
  onClose: () => void
  onCreate: (type: NewWorkType, templateId?: string) => void
}) {
  const [choice, setChoice] = useState<NewChoice>(initial)
  const navigate = useNavigate()
  const [starters, setStarters] = useState<WorkStarterDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [template, setTemplate] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setChoice(initial)
    setTemplate(null)
  }, [open, initial])
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the load on 重试
  useEffect(() => {
    if (!open) return
    setStarters(null)
    setFailed(false)
    let live = true
    api.get<WorkStarterDto[]>('/works/starters').then(
      (s) => live && setStarters(s),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [open, attempt])
  // Creating cannot be called off: closing mid-way would still open the new work when it lands.
  const close = () => !busy && onClose()

  const starter = choice === 'site' ? null : starters?.find((s) => s.type === choice)
  const picked = starter?.templates.find((tp) => tp.id === template) ?? starter?.templates[0]
  const canCreate = !!starter && !busy
  return (
    <Dialog
      open={open}
      onClose={close}
      closeOnScrim={!busy}
      title={t('新建作品')}
      width={720}
      actions={
        choice === 'site'
          ? [
              { label: t('关闭'), onClick: onClose },
              { label: t('去群里试试'), variant: 'primary', onClick: () => navigate('/'), autoFocus: true },
            ]
          : [
              { label: t('取消'), onClick: close, disabled: busy },
              {
                label: choice === 'slides' ? t('创建幻灯片') : t('创建原型'),
                variant: 'primary',
                disabled: !canCreate,
                loading: busy,
                onClick: () => starter && onCreate(starter.type, picked?.id),
              },
            ]
      }
    >
      <div className="new-work">
        <div className="new-work__types" role="radiogroup" aria-label={t('作品类型')}>
          {CHOICES.map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: type cards are buttons with an icon and two lines, checked as radios
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={choice === c.value}
              className="new-work__type"
              onClick={() => setChoice(c.value)}
            >
              <Icon name={c.icon} size={20} />
              <span className="new-work__type-text">
                <strong>{c.title}</strong>
                <span>{c.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="new-work__detail">
          {choice === 'site' ? (
            <ol className="new-work__steps">
              <li>{t('在群里让 AI 做好网页并生成预览')}</li>
              <li>{t('点预览卡上的「托管到服务器」')}</li>
              <li>{t('完成后自动归入「网页」分类，随时可打开或分享给团队')}</li>
            </ol>
          ) : failed ? (
            <EmptyState
              icon="warning"
              title={t('加载失败')}
              action={
                <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
                  {t('重试')}
                </Button>
              }
            />
          ) : !starters ? (
            <Spinner />
          ) : !starter ? (
            <EmptyState
              icon="plug"
              title={choice === 'slides' ? t('幻灯片插件未启用') : t('产品原型插件未启用')}
              description={t('请联系团队管理员在「市场」中启用后再试')}
            />
          ) : choice === 'slides' ? (
            <>
              {picked?.description ? <p className="new-work__note">{picked.description}</p> : null}
              <ul className="new-work__templates" aria-label={t('选择模板')}>
                {starter.templates.map((tp) => (
                  <li key={tp.id}>
                    <button
                      type="button"
                      className="new-work__template"
                      aria-pressed={picked?.id === tp.id}
                      title={tp.description || undefined}
                      onClick={() => setTemplate(tp.id)}
                    >
                      <span className="new-work__preview">
                        {tp.preview ? (
                          <img src={previewUrl(starter.pluginId, tp.preview)} alt="" loading="lazy" />
                        ) : null}
                      </span>
                      <span className="new-work__template-title">{tp.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="new-work__note">
              {t('进入画布后直接描述需求，AI 会先生成第一版，之后可继续对话修改。')}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
