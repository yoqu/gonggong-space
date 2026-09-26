import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { resolveTheme, setTheme } from '../../app/theme'
import { SPRING } from '../../lib/motion'
import { Avatar, Brand, Icon, IconButton, Mascot, Message } from '../../ui'

export type AuthVariant = 'login' | 'register' | 'password'

export function ThemeToggle() {
  const [dark, setDark] = useState(() => resolveTheme() === 'dark')
  return (
    <IconButton
      title={dark ? '切换到浅色' : '切换到深色'}
      className="auth__theme"
      onClick={() => {
        setTheme(dark ? 'light' : 'dark')
        setDark(!dark)
      }}
    >
      {dark ? ('sun' as const) : ('moon' as const)}
    </IconButton>
  )
}

// One wave period is 240 units; each layer spans 10 periods so shifting by one period loops seamlessly.
const wave = (amp: number, y: number) => {
  let d = `M-240 ${y}`
  for (let x = -240; x < 2160; x += 240) d += ` q60 ${-amp} 120 0 t120 0`
  return `${d} V400 H-240 Z`
}
const LAYERS = [
  { d: wave(14, 250), dur: 26, className: 'auth-waves__far' },
  { d: wave(18, 290), dur: 18, className: 'auth-waves__mid' },
  { d: wave(12, 330), dur: 12, className: 'auth-waves__near' },
]

/** The mark's water as the ground of the stage: a slow swell in faint accent, never behind the copy. */
function Waves() {
  return (
    <svg
      className="auth-waves"
      viewBox="0 0 1200 400"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      {LAYERS.map((l) => (
        <path key={l.className} className={l.className} d={l.d} style={{ animationDuration: `${l.dur}s` }} />
      ))}
    </svg>
  )
}

type Line = { id: string; who: string; bot?: boolean; text?: ReactNode; run?: boolean }

const SCRIPT: Line[] = [
  {
    id: 'l0',
    who: '王磊',
    text: (
      <p>
        <span className="pn-mention">@小王的 Claude</span> 登录页的表单校验有问题，帮忙修一下
      </p>
    ),
  },
  { id: 'l1', who: '小王的 Claude', bot: true, run: true },
  {
    id: 'l2',
    who: '小王的 Claude',
    bot: true,
    text: (
      <p>
        已修复并提交。<span className="pn-mention">@李娜的 Codex</span> 帮忙 review 一下
      </p>
    ),
  },
  { id: 'l3', who: '李娜的 Codex', bot: true, text: <p>看过了，逻辑没问题，可以合并。</p> },
]
const STEPS = ['读取 LoginPage.tsx', '编辑 2 处校验逻辑', '运行测试 · 12 项通过']
// Cumulative ms at which each beat appears; the loop restarts after the last.
const BEATS = [400, 1500, 2300, 3100, 3900, 5000, 6600, 9400]

/** A looping, illustrative group chat: a person @s a bot, the bot works, then relays to another member's bot. */
function RelayDemo() {
  const reduced = useReducedMotion()
  const [beat, setBeat] = useState(reduced ? BEATS.length : 0)
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    if (reduced) return
    let timers: ReturnType<typeof setTimeout>[] = []
    const play = () => {
      setBeat(0)
      setCycle((c) => c + 1)
      timers = BEATS.map((ms, i) => setTimeout(() => setBeat(i + 1), ms))
      timers.push(setTimeout(play, (BEATS.at(-1) ?? 0) + 200))
    }
    play()
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [reduced])

  const lines = beat >= 7 ? 4 : beat >= 6 ? 3 : beat >= 2 ? 2 : beat >= 1 ? 1 : 0
  const steps = Math.min(Math.max(beat - 2, 0), 3)
  const done = beat >= 6

  return (
    <div className="relay" aria-hidden="true">
      <div className="relay__bar">
        <Avatar name="web-site 重构" size={24} shape="square" />
        <span className="relay__group">web-site 重构</span>
        <span className="relay__members">3 人 · 2 Bot</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={cycle}
          className="relay__body"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          {SCRIPT.slice(0, lines).map((l, i) => (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING.smooth}
              layout
            >
              <Message
                author={{ name: l.who, bot: l.bot }}
                continued={i > 0 && SCRIPT[i - 1]?.who === l.who}
                bare={l.run}
                actions={false}
              >
                {l.run ? (
                  <div className="relay__run" data-done={done || undefined}>
                    <span className="relay__status">
                      <Mascot
                        className="relay__mascot"
                        action={done ? 'done' : steps ? 'carry' : 'run'}
                        size={36}
                      />
                      {done ? '已完成' : '运行中'}
                    </span>
                    {STEPS.slice(0, steps).map((s) => (
                      <motion.span
                        key={s}
                        className="relay__step"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={SPRING.snappy}
                      >
                        <Icon name="arrow-turn-down-right" size={12} />
                        {s}
                      </motion.span>
                    ))}
                  </div>
                ) : (
                  l.text
                )}
              </Message>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const FIRST_RUN = [
  { label: '用初始密码登录', state: 'done' },
  { label: '设置自己的密码', state: 'active' },
  { label: '绑定机器、新建 Bot，开始协作', state: 'todo' },
] as const

/** The password stage's counterpart of the relay demo: where the member is in their first-run path. */
function FirstRunSteps() {
  return (
    <ol className="first-run" aria-label="首次登录进度">
      {FIRST_RUN.map((s, i) => (
        <li key={s.label} data-state={s.state}>
          <span className="first-run__mark">
            {s.state === 'done' ? <Icon name="check" size={12} weight={2.6} /> : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  )
}

/** Left half of the auth screens: brand, one line of copy and a live illustration (hidden on narrow screens). */
export function AuthStage({ variant }: { variant: AuthVariant }) {
  const password = variant === 'password'
  return (
    <section className="auth-stage">
      <Waves />
      <Brand size={28} motion="enter" subtitle="人与 Bot 的协作平台" />
      <div className="auth-stage__copy">
        <h2 className="auth-stage__title">
          {password ? (
            <>
              最后一步，
              <br />
              设置只属于你的密码。
            </>
          ) : (
            <>
              在群里 @ 一下，
              <br />
              队友的 Bot 就开工。
            </>
          )}
        </h2>
        <p className="auth-stage__lead">
          {password
            ? '初始密码由管理员发放；修改后，其他设备上的登录会自动失效。'
            : 'Claude Code / Codex 在各自的工作区里干活，接力完成同一个仓库，每一步都看得见。'}
        </p>
      </div>
      {password ? <FirstRunSteps /> : <RelayDemo />}
    </section>
  )
}
