import { Check } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { SPRING } from '../../lib/motion'
import { Brand } from '../../ui'

// One wave period is 240 units; each layer's path spans 10 periods so shifting by one period loops seamlessly.
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

/** The mark's water, as the ground the whole stage stands on: slow layered swell, never behind the copy. */
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

type Line = {
  id: string
  who: string
  avatar: string
  tone: 'human' | 'claude' | 'codex'
  text: ReactNode
  run?: boolean
}

const SCRIPT: Line[] = [
  {
    id: 'l0',
    who: '王磊',
    avatar: '王',
    tone: 'human',
    text: (
      <>
        <b>@小王的 Claude</b> 登录页的表单校验有问题，帮忙修一下
      </>
    ),
  },
  { id: 'l1', who: '小王的 Claude', avatar: 'C', tone: 'claude', text: '', run: true },
  {
    id: 'l2',
    who: '小王的 Claude',
    avatar: 'C',
    tone: 'claude',
    text: (
      <>
        已修复并提交。<b>@李娜的 Codex</b> 帮忙 review 一下
      </>
    ),
  },
  { id: 'l3', who: '李娜的 Codex', avatar: 'X', tone: 'codex', text: '看过了，逻辑没问题，LGTM ✓' },
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

  // beat → how many chat lines and run steps are visible
  const lines = beat >= 7 ? 4 : beat >= 6 ? 3 : beat >= 2 ? 2 : beat >= 1 ? 1 : 0
  const steps = Math.min(Math.max(beat - 2, 0), 3)
  const done = beat >= 6

  return (
    <div className="relay" aria-hidden="true">
      <div className="relay__bar">
        <span className="relay__dot" />
        <span className="relay__group"># web-site 重构</span>
        <span className="relay__members">3 人 · 2 Bot</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={cycle}
          className="relay__body"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          {SCRIPT.slice(0, lines).map((l) => (
            <motion.div
              key={l.id}
              className="relay__msg"
              data-tone={l.tone}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={SPRING.smooth}
              layout
            >
              <span className="relay__avatar">{l.avatar}</span>
              <div className="relay__content">
                <span className="relay__who">
                  {l.who}
                  {l.tone !== 'human' ? <span className="relay__tag">Bot</span> : null}
                </span>
                {l.run ? (
                  <div className="relay__run" data-done={done || undefined}>
                    <span className="relay__status">{done ? '已完成' : '运行中'}</span>
                    {STEPS.slice(0, steps).map((s) => (
                      <motion.span
                        key={s}
                        className="relay__step"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={SPRING.snappy}
                      >
                        {s}
                      </motion.span>
                    ))}
                  </div>
                ) : (
                  <span className="relay__text">{l.text}</span>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** The password stage's counterpart of the relay demo: where the member is in their first-run path. */
function FirstRunSteps() {
  const steps = [
    { label: '用初始密码登录', state: 'done' },
    { label: '设置自己的密码', state: 'active' },
    { label: '绑定机器、新建 Bot，开始协作', state: 'todo' },
  ] as const
  return (
    <ol className="first-run" aria-label="首次登录进度">
      {steps.map((s, i) => (
        <li key={s.label} data-state={s.state}>
          <span className="first-run__mark">
            {s.state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  )
}

export function AuthStage({ variant }: { variant: 'login' | 'register' | 'password' }) {
  return (
    <section className="auth-stage">
      <Waves />
      <div className="auth-stage__top">
        <Brand size={30} motion="enter" subtitle="人与 Bot 的协作平台" />
      </div>
      <div className="auth-stage__copy">
        {variant !== 'password' ? (
          <>
            <h2 className="auth-stage__title">
              在群里 @ 一下，
              <br />
              队友的 Bot 就开工。
            </h2>
            <p className="auth-stage__lead">
              Claude Code / Codex 在各自的工作区里干活，接力完成同一个仓库，每一步都看得见。
            </p>
          </>
        ) : (
          <>
            <h2 className="auth-stage__title">
              最后一步，
              <br />
              设置只属于你的密码。
            </h2>
            <p className="auth-stage__lead">初始密码由管理员发放；修改后，其他设备上的登录会自动失效。</p>
          </>
        )}
      </div>
      {variant === 'password' ? <FirstRunSteps /> : <RelayDemo />}
    </section>
  )
}
