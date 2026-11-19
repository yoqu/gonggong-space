import {
  type SecretCard as Card,
  type MessageDto,
  SECRET_MIN_LENGTH,
  type SecretDto,
  type SecretNeedDto,
} from '@gonggong/protocol'
import { memo, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import { Alert, Button, ChatNotice, Checkbox, Dialog, Icon, Presence, SecureField, Tag } from '../../ui'
import { MODE_LABEL, secretsApi } from './api'
import { FOREIGN, FOREIGN_NOTE } from './MySecrets'
import './secrets.css'

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Who may fill an `admins` card as far as the client knows: a sysadmin, an admin of the group or of its team. The
 * definition's layer is not on the card, so the server has the last word.
 */
export function useCanManage(groupId: string) {
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

type DefineLayer = NonNullable<Card['define']>['layer']

/** Whether I may make what a `define` card asks for, as the server decides it: an admin of exactly that layer. */
export function useLayerAdmin(layer: DefineLayer | undefined) {
  const user = useSession((s) => s.user)
  const teamAdmin = useSession(
    (s) => !!s.tenancy?.teams.some((x) => x.id === layer?.teamId && x.role !== 'member'),
  )
  const group = useWorkspace((s) => s.groups.find((g) => g.id === layer?.groupId))
  if (!user || !layer) return false
  return layer.scope === 'team' ? teamAdmin : !!group?.members.some((m) => m.userId === user.id && m.isAdmin)
}

/** 等待 {admins} 创建 on a `define` card I may not act on. */
export const waitingFor = (d: NonNullable<Card['define']>) =>
  d.admins.length ? t('等待 {admins} 创建', { admins: d.admins.join('、') }) : t('等待填写')

/** A bot's 填写密钥 card (secret_request): the asker fills personal values, a layer admin fills shared ones. */
export const SecretCard = memo(function SecretCard({ m, card }: { m: MessageDto; card: Card }) {
  const mine = useSession((s) => s.user?.id === card.userId)
  const admin = useCanManage(m.groupId)
  const layerAdmin = useLayerAdmin(card.define?.layer)
  const canFill = card.audience === 'origin' ? mine : card.define ? layerAdmin : admin
  const [open, setOpen] = useState(false)
  const [filled, setFilled] = useState(false)
  const done = card.filled || filled
  return (
    <ChatNotice>
      <span className="tl-event" data-testid="secret-card">
        <Icon name="lock" size={13} />
        <span className="tl-event__text">{m.i18n ? t.text(m.i18n) : m.body}</span>
        {done ? (
          <Tag tone="green">{card.define ? t('已创建') : t('已填写')}</Tag>
        ) : canFill ? (
          <Button size="small" variant="primary" onClick={() => setOpen(true)}>
            {card.define ? t('按声明创建') : t('填写密钥')}
          </Button>
        ) : (
          <Tag tone="gray">{card.define ? waitingFor(card.define) : t('等待填写')}</Tag>
        )}
      </span>
      <Presence>
        {open && card.define ? (
          <DefineDialog
            card={card}
            onClose={() => setOpen(false)}
            onDone={() => {
              setFilled(true)
              setOpen(false)
            }}
          />
        ) : open ? (
          <FillDialog
            card={card}
            groupId={m.groupId}
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

/** A `define` card (plan Skill密钥声明 §7): what the skill declares, made as-is by an admin of the layer. */
export function DefineDialog({
  card,
  onClose,
  onDone,
}: {
  card: Card
  onClose: () => void
  onDone: () => void
}) {
  const d = card.define!
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await secretsApi.fill(card.id, { values: {} })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('按声明创建密钥')}
      message={
        d.layer.scope === 'group'
          ? t('Skill「{skill}」声明需要以下密钥，将在本群创建定义（不填值），创建后请成员各自填写。', {
              skill: d.skill,
            })
          : t('Skill「{skill}」声明需要以下密钥，将在团队层创建定义（不填值），创建后请成员各自填写。', {
              skill: d.skill,
            })
      }
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('创建'), variant: 'primary', onClick: () => void submit(), disabled: busy },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      {d.specs.map((s) => (
        <div key={s.name} className="sn-row">
          <div className="sn-row__head">
            <strong>{s.title ?? s.name}</strong>
            {s.title && s.title !== s.name ? <code>{s.name}</code> : null}
            <Tag tone="blue">{MODE_LABEL[s.mode]}</Tag>
          </div>
          {s.description ? <div className="gs-desc">{s.description}</div> : null}
        </div>
      ))}
    </Dialog>
  )
}

export function FillDialog({
  card,
  groupId,
  onClose,
  onDone,
}: {
  card: Card
  groupId?: string
  onClose: () => void
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Best-effort metadata from the group's declared needs and definitions; failure only omits the extra hints.
  const needs = useGet<SecretNeedDto[]>(groupId ? `/groups/${groupId}/secret-needs` : null)
  const defs = useGet<SecretDto[]>(groupId ? `/groups/${groupId}/secrets` : null)
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
      {card.names.map((n) => {
        const spec = needs.data?.find((x) => x.spec.name === n)?.spec
        const def = defs.data?.find((x) => x.name === n)
        const desc = spec?.description || def?.description
        const val = values[n] ?? ''
        const short = val.length > 0 && val.length < SECRET_MIN_LENGTH
        return (
          <div key={n} className="sn-row">
            {spec?.title && spec.title !== n ? (
              <div className="sn-row__head">
                <strong>{spec.title}</strong>
                <code>{n}</code>
              </div>
            ) : (
              <div className="sn-row__head">
                <strong>{n}</strong>
              </div>
            )}
            {desc ? <div className="gs-desc">{desc}</div> : null}
            {spec?.url ? (
              <a className="sn-row__link" href={spec.url} target="_blank" rel="noreferrer noopener">
                {t('前往 {host} 申请', { host: host(spec.url) })}
              </a>
            ) : null}
            <SecureField
              aria-label={n}
              autoComplete="new-password"
              placeholder={spec?.placeholder || t('输入 {name} 的值', { name: n })}
              hint={short ? undefined : t('至少 8 个字符')}
              error={short ? t('至少 8 个字符') : undefined}
              value={val}
              onChange={(e) => setValues({ ...values, [n]: e.target.value })}
            />
          </div>
        )
      })}
      {askForeign ? (
        <div className="sn-foreign">
          <Checkbox label={FOREIGN} checked={foreign} onChange={setForeign} />
          <div className="gs-desc">{FOREIGN_NOTE}</div>
        </div>
      ) : null}
    </Dialog>
  )
}
