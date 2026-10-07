import { Alert, Button, Form, FormRow, GroupBox, GroupRow, Input } from '@web/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { type BindLink, ipc } from '../ipc'
import { host } from '../lib/labels'
import { TitleBar } from '../shell/TitleBar'
import { refreshInfo } from '../store'

/**
 * First run, one screen (plan J5, J6): paste the 接入链接 or `gg login` command from the Web — or have it prefilled
 * from the clipboard or an opened link — check the server, then 绑定. Nothing binds without the click (plan J3).
 */
export function Onboarding({ link, onDone }: { link: { url: string } | null; onDone: () => void }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<BindLink | null>(null)
  const [invalid, setInvalid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Parses resolve out of order; only the latest input counts.
  const latest = useRef('')

  const update = useCallback(async (value: string) => {
    latest.current = value
    setText(value)
    setError('')
    if (!value.trim()) {
      setParsed(null)
      setInvalid('')
      return
    }
    try {
      const result = await ipc.parseLink(value)
      if (latest.current !== value) return
      setParsed(result)
      setInvalid('')
    } catch (e) {
      if (latest.current !== value) return
      setParsed(null)
      setInvalid(String(e))
    }
  }, [])

  useEffect(() => {
    if (link) update(link.url)
  }, [link, update])

  // Coming back from the browser with a freshly copied link fills an empty input; a link being reviewed stays put.
  useEffect(() => {
    const fromClipboard = async () => {
      if (latest.current.trim()) return
      const clip = (await ipc.readClipboard().catch(() => '')).trim()
      if (!clip) return
      const ok = await ipc.parseLink(clip).then(
        () => true,
        () => false,
      )
      if (ok) update(clip)
    }
    fromClipboard()
    window.addEventListener('focus', fromClipboard)
    return () => window.removeEventListener('focus', fromClipboard)
  }, [update])

  const bind = async () => {
    if (!parsed) return
    setBusy(true)
    setError('')
    try {
      await ipc.login(parsed)
      await ipc.startDaemon()
      await refreshInfo()
      onDone()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <TitleBar lights scrolled={false} />
      <div className="dk-onboarding">
        <div className="dk-onboarding__panel">
          <img className="dk-onboarding__logo" src={logo} alt="" width={64} height={64} />
          <h1 className="dk-onboarding__title">{t('绑定到团队服务器')}</h1>
          <p className="dk-onboarding__desc">
            {t(
              '在 Web 端头像菜单选择「绑定新机器」，点「在客户端中打开」或复制接入链接粘贴到这里。绑定后本机归属于你，所有连接均由本机向外发起。',
            )}
          </p>
          <Form aria-label={t('绑定到团队服务器')}>
            <FormRow label={t('接入链接')} hint={invalid || undefined}>
              <Input
                aria-label={t('接入链接')}
                mono
                invalid={!!invalid}
                value={text}
                placeholder={t('粘贴网页上复制的接入链接或 gg login 命令')}
                onChange={(e) => update(e.target.value)}
              />
            </FormRow>
          </Form>
          {parsed ? (
            <GroupBox>
              <GroupRow label={t('服务器')} wideValue value={host(parsed.server)} />
              <GroupRow label={t('绑定码')} value={parsed.code} />
            </GroupBox>
          ) : null}
          {parsed ? <p className="dk-footnote">{t('请确认这是你们团队的服务器，再点「绑定」。')}</p> : null}
          {error ? <Alert variant="error" description={error} /> : null}
          <Button variant="primary" size="xlarge" fullWidth disabled={!parsed || busy} onClick={bind}>
            {busy ? t('绑定中…') : t('绑定')}
          </Button>
        </div>
      </div>
    </>
  )
}
