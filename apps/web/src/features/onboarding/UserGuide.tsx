import type { FeishuIdentityView, TeamOnboardingDto, UserOnboarding } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useIsBuilder } from '../../app/builder'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { storedTeam } from '../../lib/team'
import { useGet } from '../../lib/useGet'
import { Button, Dialog, GroupBox, GroupRow, Presence, ProgressIndicator, Spinner } from '../../ui'
import { uuid } from '../chat/MessageComposer'
import { postMessage } from '../chat/pending'
import { feishuStartUrl } from '../feishu/login'
import { useGuide } from './store'
import './onboarding.css'

const STEPS = [t('你所在的群和可以 @ 的 Bot'), t('试着问一个问题'), t('在飞书里怎么用')]

const record = (guide: 'done' | 'skipped') =>
  api.patch<UserOnboarding>('/me/onboarding', { guide }).catch((e: Error) => console.warn('onboarding:', e))

/**
 * First-login guide for 使用者 (not builders): pops up once the workspace is loaded, they are in a group and the
 * server says it was never finished or skipped. `ready`: groups and bots are loaded, so builder status is settled.
 */
export function UserGuide({ ready }: { ready: boolean }) {
  const builder = useIsBuilder()
  const open = useGuide((s) => s.open)
  // In no group yet, every step would only say "wait for an admin": the main-area welcome covers that instead.
  const inGroup = useWorkspace((s) => s.groups.some((g) => g.kind === 'group'))
  const checked = useRef(false)
  useEffect(() => {
    if (!ready || builder || !inGroup || checked.current) return
    checked.current = true
    api.get<UserOnboarding>('/me/onboarding').then(
      (o) => {
        if (!o.guide) useGuide.getState().show()
      },
      () => {},
    )
  }, [ready, builder, inGroup])
  return <Presence>{open ? <GuideDialog /> : null}</Presence>
}

function GuideDialog() {
  const [step, setStep] = useState(0)
  // Which way the last move went, so the next page slides in from that side.
  const [back, setBack] = useState(false)
  const go = (next: number) => {
    setBack(next < step)
    setStep(next)
  }
  const me = useSession((s) => s.user)
  const teamId = useSession((s) => storedTeam() ?? s.tenancy?.teams[0]?.id ?? null)
  const { data: starter } = useGet<TeamOnboardingDto>(teamId ? `/teams/${teamId}/onboarding` : null)
  const { data: feishu } = useGet<FeishuIdentityView>('/me/feishu')
  const groups = useWorkspace((s) => s.groups).filter((g) => g.kind === 'group')
  const bots = useWorkspace((s) => s.bots)
  const navigate = useNavigate()
  // The example being sent: it alone spins, the others wait.
  const [asking, setAsking] = useState<string | null>(null)
  const hide = useGuide((s) => s.hide)

  const leave = (guide: 'done' | 'skipped') => {
    void record(guide)
    hide()
  }
  const joined = !!starter?.groupId && groups.some((g) => g.id === starter.groupId)
  const ask = async (question: string) => {
    if (!starter?.groupId || !starter.botName) return
    setAsking(question)
    try {
      await postMessage(starter.groupId, {
        body: `@${starter.botName} ${question}`,
        clientId: uuid(),
        attachmentIds: [],
        quote: null,
        appendTo: null,
      })
    } catch (e) {
      setAsking(null)
      toastError(e)
      return
    }
    leave('done')
    navigate(`/g/${starter.groupId}`)
  }

  const last = step === STEPS.length - 1
  return (
    <Dialog
      open
      width={520}
      title={t('新手指引')}
      closeOnScrim={false}
      onClose={() => leave('skipped')}
      footer={
        <span className="guide__progress">
          <span>{t('第 {n}/3 步', { n: step + 1 })}</span>
          <ProgressIndicator value={((step + 1) / STEPS.length) * 100} aria-label={t('引导进度')} />
        </span>
      }
      actions={[
        ...(last ? [] : [{ label: t('跳过#guide'), onClick: () => leave('skipped') }]),
        ...(step > 0 ? [{ label: t('上一步'), onClick: () => go(step - 1) }] : []),
        last
          ? { label: t('完成'), variant: 'primary' as const, onClick: () => leave('done') }
          : { label: t('下一步'), variant: 'primary' as const, onClick: () => go(step + 1) },
      ]}
    >
      <div key={step} className="guide__step" data-back={back || undefined}>
        <h3 className="guide__title">{STEPS[step]}</h3>
        {step === 0 ? (
          groups.length ? (
            <GroupBox>
              {groups.map((g) => (
                <GroupRow
                  key={g.id}
                  label={g.name}
                  description={g.botIds
                    .map((id) => bots.find((b) => b.id === id)?.name)
                    .filter(Boolean)
                    .map((name) => `@${name}`)
                    .join(' ')}
                />
              ))}
            </GroupBox>
          ) : (
            <p className="guide__lead">{t('你还没有加入任何群，等管理员或同事把你拉进群。')}</p>
          )
        ) : step === 1 ? (
          !starter ? (
            <Spinner />
          ) : joined && starter.botName ? (
            <>
              <p className="guide__lead">
                {t('点一个问题，会以你的名义发到「{group}」，{bot} 会在群里回复。', {
                  group: starter.groupName ?? '',
                  bot: starter.botName,
                })}
              </p>
              <div className="guide__examples">
                {starter.examples.map((q) => (
                  <Button
                    key={q}
                    loading={asking === q}
                    disabled={!!asking && asking !== q}
                    onClick={() => void ask(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="guide__lead">
              <strong>{t('请管理员把你拉进群')}</strong>
              <br />
              {t('进群后在输入框里 @ Bot 再写问题，Bot 就会回复你。')}
            </p>
          )
        ) : (
          <>
            <p className="guide__lead">
              {t('群绑定了飞书群时，直接在飞书群里 @ Bot 提问，回复会同步到共工。')}
            </p>
            <div className="guide__examples">
              {starter?.feishuUrl ? (
                <a className="ui-btn" href={starter.feishuUrl} target="_blank" rel="noreferrer">
                  {t('打开飞书群')}
                </a>
              ) : null}
              {feishu && !feishu.identity && me ? (
                <a className="ui-btn" href={feishuStartUrl('/', 'link')}>
                  {t('绑定飞书')}
                </a>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
