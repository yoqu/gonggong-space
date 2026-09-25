import { Bot, Check, Hash, Laptop } from 'lucide-react'
import { motion } from 'motion/react'
import { SPRING } from '../lib/motion'
import { Button, Logo } from '../ui'

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
  const steps = [
    {
      Icon: Laptop,
      title: '绑定机器',
      desc: '在你的机器上安装 gg 并用绑定码登录，Bot 就在这台机器上运行。',
      action: '绑定机器',
      done: bound,
      onClick: onBindMachine,
    },
    {
      Icon: Bot,
      title: '新建 Bot',
      desc: '选择机器上的 Claude Code 或 Codex，给它起个好认的名字。',
      action: '新建 Bot',
      done: hasBot,
      onClick: onNewBot,
    },
    {
      Icon: Hash,
      title: '建群并 @ Bot',
      desc: '拉上同事、绑定仓库，在群里 @ 你的 Bot 分配任务。',
      action: '新建群',
      done: false,
      onClick: onNewGroup,
    },
  ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <section className="welcome" aria-label="开始使用">
      <Logo size={48} motion="enter" />
      <h1 className="welcome__title">欢迎来到共工，{name}</h1>
      <p className="welcome__lead">三步让你的第一个 Bot 开工。也可以等同事把你拉进群，直接参与协作。</p>
      <ol className="welcome__steps">
        {steps.map((s, i) => (
          <motion.li
            key={s.title}
            className="welcome__step"
            data-state={s.done ? 'done' : i === current ? 'current' : 'todo'}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: 0.25 + i * 0.08 }}
          >
            <span className="welcome__mark">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            <s.Icon size={22} className="welcome__icon" aria-hidden="true" />
            <h2 className="welcome__step-title">{s.title}</h2>
            <p className="welcome__step-desc">{s.desc}</p>
            {s.done ? (
              <span className="welcome__done">已完成</span>
            ) : (
              <Button variant={i === current ? 'primary' : 'outline'} onClick={s.onClick}>
                {s.action}
              </Button>
            )}
          </motion.li>
        ))}
      </ol>
    </section>
  )
}
