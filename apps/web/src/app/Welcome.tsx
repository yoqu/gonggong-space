import { m } from 'motion/react'
import { t } from '../i18n'
import { SPRING } from '../lib/motion'
import { Button, Icon, type IconName, Mascot } from '../ui'
import { becomeBuilder, useIsBuilder } from './builder'

/**
 * Main-area first run for someone in no group yet. Builders get the three steps from nothing to a working bot, tied
 * to real state; everyone else either sets up their own computer or waits to be added to a group.
 */
export function Welcome({
  name,
  bound,
  hasBot,
  onBindMachine,
  onNewBot,
  onNewGroup,
}: {
  name: string
  bound: boolean
  hasBot: boolean
  onBindMachine: () => void
  onNewBot: () => void
  onNewGroup: () => void
}) {
  const builder = useIsBuilder()
  const steps: {
    icon: IconName
    color: string
    title: string
    desc: string
    action: string
    done: boolean
    onClick: () => void
  }[] = [
    {
      icon: 'laptop',
      color: 'var(--system-blue)',
      title: t('绑定新机器'),
      desc: t('复制一句话发给本机的 Claude Code 或 Codex，它会自己安装、绑定这台机器并建好 Bot。'),
      action: t('开始绑定'),
      done: bound,
      onClick: onBindMachine,
    },
    {
      icon: 'bot',
      color: 'var(--system-indigo)',
      title: t('新建 Bot'),
      desc: t('选择机器上的 Claude Code、Codex 或 Gemini CLI，给它起个好认的名字。'),
      action: t('新建 Bot'),
      done: hasBot,
      onClick: onNewBot,
    },
    {
      icon: 'hashtag',
      color: 'var(--system-green)',
      title: t('发起第一次对话'),
      desc: t('和你的 Bot 私聊，或拉上同事建群，把任务交给它。'),
      action: t('发起会话'),
      done: false,
      onClick: onNewGroup,
    },
  ]
  const current = steps.findIndex((s) => !s.done)
  if (!builder)
    return (
      <section className="welcome" aria-label={t('开始使用')}>
        <Mascot action="wave" size={112} />
        <h1 className="welcome__title">{t('欢迎来到共工空间，{name}', { name })}</h1>
        <p className="welcome__lead">{t('Bot 在团队成员的电脑上干活，你在群里 @ 它下达任务。')}</p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            becomeBuilder()
            onBindMachine()
          }}
        >
          {t('接入我的电脑，搭自己的 Bot')}
        </Button>
        <p className="welcome__alt">{t('或等同事把你拉进群，在群里 @ Bot 直接提问就行。')}</p>
      </section>
    )
  return (
    <section className="welcome" aria-label={t('开始使用')}>
      <Mascot action="wave" size={112} />
      <h1 className="welcome__title">{t('欢迎来到共工空间，{name}', { name })}</h1>
      <p className="welcome__lead">
        {t('三步让你的第一个 Bot 开工。也可以等同事把你拉进群，直接参与协作。')}
      </p>
      <ol className="welcome__steps">
        {steps.map((s, i) => (
          <m.li
            key={s.title}
            className="welcome__step"
            data-state={s.done ? 'done' : i === current ? 'current' : 'todo'}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: 0.25 + i * 0.08 }}
          >
            <span className="welcome__mark">
              {s.done ? <Icon name="check" size={12} weight={2.4} /> : i + 1}
            </span>
            <span className="welcome__icon" style={{ color: s.done ? undefined : s.color }}>
              <Icon name={s.icon} size={24} />
            </span>
            <h2 className="welcome__step-title">{s.title}</h2>
            <p className="welcome__step-desc">{s.desc}</p>
            {s.done ? (
              <span className="welcome__done">{t('已完成')}</span>
            ) : (
              <Button variant={i === current ? 'primary' : 'default'} onClick={s.onClick}>
                {s.action}
              </Button>
            )}
          </m.li>
        ))}
      </ol>
    </section>
  )
}
