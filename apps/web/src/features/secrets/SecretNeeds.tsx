import { SECRET_MIN_LENGTH, type SecretNeedDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Checkbox, Dialog, SecureField, Tag } from '../../ui'
import { MODE_LABEL, secretsApi } from './api'
import { FOREIGN, FOREIGN_NOTE } from './MySecrets'
import '../config/config.css'
import './secrets.css'

/** What I can do about a need now; required ones count toward the banner. */
export const actionable = (n: SecretNeedDto) =>
  n.action !== null && (n.status === 'unfilled' || n.status === 'missing_def')

const KIND: Record<NonNullable<SecretNeedDto['action']>, string> = {
  fill_personal: t('个人密钥'),
  fill_new: t('个人密钥'),
  fill_shared: t('本群统一密钥 · 管理员'),
  create: t('待创建定义 · 管理员'),
}

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const fills = (n: SecretNeedDto) => n.action !== null && n.action !== 'create'

/** Bots of the group running on someone else's machine: my value needs FOREIGN to reach them. */
function useForeignBots(groupId: string) {
  const me = useSession((s) => s.user?.id)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const bots = useWorkspace((s) => s.bots)
  return bots.filter((b) => group?.botIds.includes(b.id) && b.ownerId !== me).map((b) => b.name)
}

/** One declared secret: its purpose, where to apply, my state, and the input for what I can do. */
function NeedRow({
  n,
  value,
  onValue,
  create,
  onCreate,
}: {
  n: SecretNeedDto
  value: string
  onValue: (v: string) => void
  create: boolean
  onCreate: (on: boolean) => void
}) {
  const { spec } = n
  return (
    <div className="sn-row" data-testid={`secret-need-${spec.name}`}>
      <div className="sn-row__head">
        <strong>{spec.title ?? spec.name}</strong>
        <code>{spec.name}</code>
        {spec.required ? null : <Tag tone="gray">{t('可选')}</Tag>}
        {n.action ? <Tag tone="blue">{KIND[n.action]}</Tag> : null}
        {n.status === 'ok' ? (
          <Tag tone="green">{n.mine ? t('已配置 · 尾号 {last4}', { last4: n.mine.last4 }) : t('已配置')}</Tag>
        ) : null}
        {n.status === 'blocked' ? <Tag tone="orange">{n.reason ?? t('不可用')}</Tag> : null}
      </div>
      {spec.description ? <div className="gs-desc">{spec.description}</div> : null}
      {spec.url ? (
        <a className="sn-row__link" href={spec.url} target="_blank" rel="noreferrer noopener">
          {t('前往 {host} 申请', { host: host(spec.url) })}
        </a>
      ) : null}
      {n.status === 'missing_def' && !n.action ? (
        <div className="gs-desc">{t('本群还没有这个密钥的定义，请管理员创建')}</div>
      ) : null}
      {n.action === 'create' ? (
        <Checkbox
          label={t('按声明创建定义（{mode}）', { mode: MODE_LABEL[n.target?.mode ?? spec.mode] })}
          checked={create}
          onChange={onCreate}
        />
      ) : null}
      {fills(n) && n.status !== 'ok' ? (
        <SecureField
          label={spec.name}
          autoComplete="new-password"
          placeholder={spec.placeholder}
          hint={t('至少 8 个字符')}
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      ) : null}
    </div>
  )
}

/**
 * 配置密钥 (plan Skill密钥声明 §6): the group's declared secrets grouped by skill, each with what I can do — fill
 * my own value, an admin's shared value, or make the missing definition from the declaration.
 */
export function NeedsDialog({
  groupId,
  needs,
  onClose,
  onDone,
}: {
  groupId: string
  needs: SecretNeedDto[]
  onClose: () => void
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [foreign, setForeign] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const others = useForeignBots(groupId)
  const key = (n: SecretNeedDto) => `${n.skill}/${n.spec.name}`
  // A name shared by two skills is one value: the first row of it takes the input.
  const seen = new Set<string>()
  const rows = needs.filter((n) => {
    const first = !seen.has(n.spec.name)
    seen.add(n.spec.name)
    return first
  })
  const todo = rows.filter((n) => n.status !== 'ok' && n.action)
  const personal = todo.some((n) => n.action === 'fill_personal' || n.action === 'fill_new')
  const filledIn = todo.filter((n) => fills(n) && (values[key(n)]?.length ?? 0) > 0)
  const creating = todo.filter((n) => n.action === 'create' && !skip[key(n)])
  const valid = filledIn.every((n) => (values[key(n)]?.length ?? 0) >= SECRET_MIN_LENGTH)
  const submit = async () => {
    setBusy(true)
    try {
      for (const n of creating) {
        const l = n.target!
        const base = l.scope === 'group' ? `/groups/${l.groupId}/secrets` : `/teams/${l.teamId}/secrets`
        const description = [n.spec.title, n.spec.description].filter(Boolean).join('：').slice(0, 500)
        await secretsApi.create(base, {
          name: n.spec.name,
          description,
          mode: l.mode,
          botIds: null,
          enabled: true,
          expiresAt: null,
        })
      }
      for (const n of filledIn) {
        const value = values[key(n)]!
        if (n.action === 'fill_personal')
          await secretsApi.setMine(n.def!.id, { value, allowForeignMachines: foreign })
        else if (n.action === 'fill_shared') await secretsApi.update(n.def!.id, { value })
        else
          await api.post(`/groups/${groupId}/secret-needs/personal`, {
            name: n.spec.name,
            value,
            allowForeignMachines: foreign,
          })
      }
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  const skills = [...new Set(rows.map((n) => n.skill))]
  const section = (list: SecretNeedDto[]) =>
    list.map((n) => (
      <NeedRow
        key={key(n)}
        n={n}
        value={values[key(n)] ?? ''}
        onValue={(v) => setValues({ ...values, [key(n)]: v })}
        create={!skip[key(n)]}
        onCreate={(on) => setSkip({ ...skip, [key(n)]: !on })}
      />
    ))
  return (
    <Dialog
      open
      title={t('配置密钥')}
      message={t('值加密保存；个人值在本团队所有使用同名密钥的群和 Skill 中通用，Bot 运行时以环境变量使用。')}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('保存'),
          variant: 'primary',
          onClick: () => void submit(),
          disabled: busy || !valid || filledIn.length + creating.length === 0,
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      {skills.map((skill) => {
        const mine = rows.filter((n) => n.skill === skill)
        const optional = mine.filter((n) => !n.spec.required)
        return (
          <section key={skill} className="sn-skill">
            <h4 className="sn-skill__title">{skill}</h4>
            {section(mine.filter((n) => n.spec.required))}
            {optional.length ? (
              <details className="sn-optional">
                <summary>{t('可选配置（{n}）', { n: optional.length })}</summary>
                {section(optional)}
              </details>
            ) : null}
          </section>
        )
      })}
      {personal ? (
        <>
          <Checkbox label={FOREIGN} checked={foreign} onChange={setForeign} />
          <div className="gs-desc">
            {others.length
              ? t('本群 {bots} 运行在其他成员的电脑上，打开后它才能使用你的密钥。', {
                  bots: others.join('、'),
                })
              : FOREIGN_NOTE}
          </div>
        </>
      ) : null}
    </Dialog>
  )
}
