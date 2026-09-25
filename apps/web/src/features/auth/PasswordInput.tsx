import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { Icon, Input, type InputProps } from '../../ui'

/**
 * Password field with a reveal toggle and a Caps Lock hint (the most common cause of "wrong password").
 * The toggle sits outside the <label> so it never leaks into the input's accessible name.
 */
export function PasswordField({
  label,
  children,
  ...props
}: Omit<InputProps, 'type' | 'size' | 'children'> & {
  label: string
  children?: ReactNode
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const track = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="auth-pw">
        <Input
          {...props}
          id={id}
          size="large"
          type={shown ? 'text' : 'password'}
          onKeyDown={track}
          onKeyUp={track}
          onBlur={(e) => {
            setCaps(false)
            props.onBlur?.(e)
          }}
        />
        <button
          type="button"
          className="auth-pw__toggle"
          aria-label={shown ? '隐藏明文' : '显示明文'}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          <Icon name={shown ? 'eye-slash' : 'eye'} />
        </button>
      </span>
      <AnimatePresence initial={false}>
        {caps ? (
          <motion.span
            className="ui-field__hint auth-hint"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            ⇪ 大写锁定已开启
          </motion.span>
        ) : null}
      </AnimatePresence>
      {children}
    </div>
  )
}
