import { m } from 'motion/react'
import { t } from '../i18n'
import { SPRING } from '../lib/motion'
import { Button, Icon, type IconName, Mascot } from '../ui'

/** Main-area first run for someone in no group yet: the three steps from nothing to a working bot, tied to real state. */
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
      title: t('绑定机器'),
      desc: t('在你的机器上安装共工空间客户端并打开接入链接，Bot 就在这台机器上运行。'),
      action: t('绑定机器'),
      done: bound,
      onClick: onBindMachine,
    },
    {
      icon: 'bot',
      color: 'var(--system-indigo)',
      title: t('新建 Bot'),
      desc: t('选择机器上的 Claude Code 或 Codex，给它起个好认的名字。'),
      action: t('新建 Bot'),
      done: hasBot,
      onClick: onNewBot,
    },
    {
      icon: 'hashtag',
      color: 'var(--system-green)',
      title: t('建群并 @ Bot'),
      desc: t('拉上同事、绑定仓库，在群里 @ 你的 Bot 分配任务。'),
      action: t('新建群'),
      done: false,
      onClick: onNewGroup,
    },
  ]
  const current = steps.findIndex((s) => !s.done)
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
