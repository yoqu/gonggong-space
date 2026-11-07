import { type SecretCard as Card, type MessageDto, SECRET_MIN_LENGTH } from '@gonggong/protocol'
import { memo, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Button, ChatNotice, Checkbox, Dialog, Icon, Presence, SecureField, Tag } from '../../ui'
import { secretsApi } from './api'
import { FOREIGN, FOREIGN_NOTE } from './MySecrets'

/**
 * Who may fill an `admins` card as far as the client knows: a sysadmin, an admin of the group or of its team. The
 * definition's layer is not on the card, so the server has the last word.
 */
function useCanManage(groupId: string) {
  const user = useSession((s) => s.user)
  const teams = useSession((s) => s.tenancy?.teams)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  if (!user) return false
  return (
    user.role === 'sysadmin' ||
    !!group?.members.some((m) => m.userId === user.id && m.isAdmin) ||
    !!teams?.some((x) => x.id === group?.teamId && x.role !== 'member')
  )
}

/** A bot's 填写密钥 card (secret_request): the asker fills personal values, a layer admin fills shared ones. */
export const SecretCard = memo(function SecretCard({ m, card }: { m: MessageDto; card: Card }) {
  const mine = useSession((s) => s.user?.id === card.userId)
  const admin = useCanManage(m.groupId)
  const canFill = card.audience === 'origin' ? mine : admin
  const [open, setOpen] = useState(false)
  const [filled, setFilled] = useState(false)
  const done = card.filled || filled
  return (
    <ChatNotice>
      <span className="tl-event" data-testid="secret-card">
        <Icon name="lock" size={13} />
        <span className="tl-event__text">{m.i18n ? t.text(m.i18n) : m.body}</span>
        {done ? (
          <Tag tone="green">{t('已填写')}</Tag>
        ) : canFill ? (
          <Button size="small" variant="primary" onClick={() => setOpen(true)}>
            {t('填写密钥')}
          </Button>
        ) : (
          <Tag tone="gray">{t('等待填写')}</Tag>
        )}
      </span>
      <Presence>
        {open ? (
          <FillDialog
            card={card}
            onClose={() => setOpen(false)}
            onDone={() => {
              setFilled(true)
              setOpen(false)
            }}
          />
        ) : null}
      </Presence>
    </ChatNotice>
  )
})

export function FillDialog({
  card,
  onClose,
  onDone,
}: {
  card: Card
  onClose: () => void
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Without it the value never reaches a bot on someone else's machine, so the card that asked for it offers it.
  const askForeign = card.audience === 'origin' && !!card.foreign
  const [foreign, setForeign] = useState(true)
  const ready = card.names.every((n) => (values[n]?.length ?? 0) >= SECRET_MIN_LENGTH)
  const submit = async () => {
    setBusy(true)
    try {
      await secretsApi.fill(card.id, askForeign ? { values, allowForeignMachines: foreign } : { values })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('填写密钥')}
      message={
        card.audience === 'origin'
          ? t('填写你自己的值，加密保存；Bot 运行时以环境变量使用，值不会出现在聊天记录和日志里。')
          : t(
              '填写统一值，对该层所有可用的 Bot 生效；Bot 运行时以环境变量使用，值不会出现在聊天记录和日志里。',
            )
      }
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', onClick: () => void submit(), disabled: !ready || busy },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      {card.names.map((n) => (
        <SecureField
          key={n}
          label={n}
          autoComplete="new-password"
          hint={t('至少 8 个字符')}
          value={values[n] ?? ''}
          onChange={(e) => setValues({ ...values, [n]: e.target.value })}
        />
      ))}
      {askForeign ? (
        <>
          <Checkbox label={FOREIGN} checked={foreign} onChange={setForeign} />
          <div className="gs-desc">{FOREIGN_NOTE}</div>
        </>
      ) : null}
    </Dialog>
  )
}
