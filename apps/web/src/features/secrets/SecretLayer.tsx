import {
  type BotDto,
  type MySecretDto,
  SECRET_MIN_LENGTH,
  SECRET_NAME,
  type SecretDto,
  type SecretMode,
  type SecretScope,
} from '@gonggong/protocol'
import { useId, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { fullTime } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  CheckboxGroup,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  GroupBox,
  GroupRow,
  NoSecretsArt,
  Presence,
  PullDownButton,
  RadioGroup,
  SecureField,
  SegmentedControl,
  Switch,
  Tag,
  TextField,
} from '../../ui'
import { expired, MODE_HINT, MODE_LABEL, SCOPE_LABEL, secretsApi, valueState } from './api'
import { FillMine } from './MySecrets'
import '../config/config.css'

type Bot = Pick<BotDto, 'id' | 'name'>
type Action =
  | { kind: 'edit' | 'clear' | 'delete'; secret: SecretDto }
  | { kind: 'create' }
  | { kind: 'fill'; item: MySecretDto }

const MODES: SecretMode[] = ['shared', 'shared_overridable', 'personal']

/**
 * One layer's secrets under `base` (`/admin/secrets`, `/teams/:id/secrets`, `/groups/:id/secrets`): the layer's own
 * definitions, editable, then (group view) the inherited platform and team ones, read-only.
 */
export function SecretLayerList({
  base,
  scope,
  bots,
  editable = true,
}: {
  base: string
  scope: SecretScope
  /** Bots a definition may be limited to. */
  bots: Bot[]
  editable?: boolean
}) {
  const { data, error, reload } = useGet<SecretDto[]>(base)
  // My own values, so a member fills theirs here instead of going to 设置 · 我的密钥; a failure only hides that.
  const mine = useGet<MySecretDto[]>('/me/secrets')
  const mineOf = (s: SecretDto) => (s.overridden ? undefined : mine.data?.find((m) => m.secret.id === s.id))
  const [action, setAction] = useState<Action | null>(null)
  const own = data?.filter((s) => s.scope === scope) ?? []
  const inherited = data?.filter((s) => s.scope !== scope) ?? []
  const close = () => setAction(null)
  const create = () => setAction({ kind: 'create' })
  const done = () => {
    close()
    reload()
    mine.reload()
  }
  const botNames = (ids: string[] | null) =>
    ids === null ? t('全部') : ids.map((id) => bots.find((b) => b.id === id)?.name ?? id).join(t('、'))
  const overriddenBy = (s: SecretDto) =>
    data?.some((x) => x.scope === 'group' && x.name === s.name) ? t('已被本群覆盖') : t('已被团队层覆盖')

  const row = (s: SecretDto, own: boolean, my = mineOf(s)) => (
    <GroupRow
      key={s.id}
      className="cfg__item"
      label={
        <span className="cfg__name-line">
          <span className="cfg__name">{s.name}</span>
          <Tag tone={own ? 'blue' : 'gray'}>{SCOPE_LABEL[s.scope]}</Tag>
          <Tag tone="gray">{MODE_LABEL[s.mode]}</Tag>
          {s.enabled ? null : <Tag tone="gray">{t('已停用')}</Tag>}
          {s.overridden ? <Tag tone="orange">{overriddenBy(s)}</Tag> : null}
        </span>
      }
      description={
        <>
          <SecretFacts secret={s} bots={botNames(s.botIds)} />
          {my ? (
            <div>{t('我的值：{state}', { state: my.mine ? valueState(my.mine) : t('未填写') })}</div>
          ) : null}
        </>
      }
    >
      <span className="cfg__controls">
        {my ? (
          <Button size="small" onClick={() => setAction({ kind: 'fill', item: my })}>
            {my.mine ? t('更新我的值…') : t('填写我的值…')}
          </Button>
        ) : null}
        {own && editable ? (
          <PullDownButton
            variant="plain"
            size="small"
            icon="more"
            indicator={false}
            aria-label={t('管理 {name}', { name: s.name })}
            align="end"
            portal
            items={[
              { label: t('编辑…'), value: 'edit' },
              ...(s.value ? [{ label: t('清除统一值'), value: 'clear' }] : []),
              { separator: true as const },
              { label: t('删除'), value: 'delete', destructive: true },
            ]}
            onSelect={(v) => setAction({ kind: v as 'edit' | 'clear' | 'delete', secret: s })}
          />
        ) : null}
      </span>
    </GroupRow>
  )

  return (
    <>
      {error ? <Alert variant="error" title={t('密钥加载失败')} description={error} /> : null}
      {data && !own.length ? (
        <EmptyState
          compact
          illustration={<NoSecretsArt />}
          title={t('暂无密钥')}
          description={editable ? t('新建后 Bot 运行时以同名环境变量读取。') : undefined}
          action={editable ? <Button onClick={create}>{t('新建密钥…')}</Button> : undefined}
        />
      ) : null}
      {own.length ? <GroupBox>{own.map((s) => row(s, true))}</GroupBox> : null}
      {editable ? (
        <div className="cfg__foot">
          <span className="gs-desc">{t('值加密保存，存入后任何人都看不到明文，只能覆盖或清除。')}</span>
          <span className="spacer" />
          {own.length ? <Button onClick={create}>{t('新建密钥…')}</Button> : null}
        </div>
      ) : null}
      {inherited.length ? (
        <>
          <div className="cfg__eyebrow">{t('继承自团队/平台')}</div>
          <GroupBox>{inherited.map((s) => row(s, false))}</GroupBox>
        </>
      ) : null}
      <Presence>
        {action?.kind === 'create' || action?.kind === 'edit' ? (
          <SecretDialog
            base={base}
            editing={action.kind === 'edit' ? action.secret : null}
            taken={own.map((s) => s.name)}
            bots={bots}
            onClose={close}
            onSaved={done}
          />
        ) : action?.kind === 'fill' ? (
          <FillMine item={action.item} onClose={close} onDone={done} />
        ) : action?.kind === 'clear' ? (
          <ConfirmActionDialog
            key="clear"
            title={t('清除 {name} 的统一值？', { name: action.secret.name })}
            message={t('清除后需要重新填写才能使用统一值。')}
            consequences={[t('依赖统一值的 Bot 下一轮起拿不到这个密钥')]}
            label={t('清除')}
            done={t('已清除统一值')}
            run={() => secretsApi.update(action.secret.id, { value: null })}
            onDone={done}
            onClose={close}
          />
        ) : action?.kind === 'delete' ? (
          <ConfirmActionDialog
            key="delete"
            title={t('删除密钥 {name}？', { name: action.secret.name })}
            message={t('定义、统一值和成员填写的个人值一并删除，不可恢复。')}
            consequences={[t('Bot 下一轮起不再注入这个环境变量'), t('引用它的 MCP 将缺少这个值')]}
            label={t('删除')}
            done={t('密钥已删除')}
            run={() => secretsApi.remove(action.secret.id)}
            onDone={done}
            onClose={close}
          />
        ) : null}
      </Presence>
    </>
  )
}

function SecretFacts({ secret: s, bots }: { secret: SecretDto; bots: string }) {
  const facts = [
    s.description,
    t('可用 Bot：{bots}', { bots }),
    s.expiresAt
      ? expired(s.expiresAt)
        ? t('已过期')
        : t('{date} 到期', { date: fullTime(s.expiresAt).slice(0, 10) })
      : '',
    s.mode === 'personal' ? '' : s.value ? valueState(s.value) : t('统一值未填写'),
    s.personalFilled.length
      ? t('已填个人值：{names}', { names: s.personalFilled.map((p) => p.name).join(t('、')) })
      : '',
  ].filter(Boolean)
  return (
    <>
      {facts.map((f) => (
        <div key={f}>{f}</div>
      ))}
    </>
  )
}

/** Local end of the picked day, so a secret expiring on the 31st still works that day. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).toISOString()

function SecretDialog({
  base,
  editing,
  taken,
  bots,
  onClose,
  onSaved,
}: {
  base: string
  editing: SecretDto | null
  taken: string[]
  bots: Bot[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [mode, setMode] = useState<SecretMode>(editing?.mode ?? 'shared')
  const [botIds, setBotIds] = useState<string[] | null>(editing?.botIds ?? null)
  const [expires, setExpires] = useState(editing?.expiresAt ? fullTime(editing.expiresAt).slice(0, 10) : '')
  const [enabled, setEnabled] = useState(editing?.enabled ?? true)
  const [value, setValue] = useState('')
  const [myValue, setMyValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = useId()

  const submit = async () => {
    if (!editing) {
      if (!SECRET_NAME.test(name)) return setError(t('名称只能用大写字母、数字和下划线，以字母开头'))
      if (taken.includes(name)) return setError(t('本层已有同名密钥'))
    }
    if (botIds?.length === 0) return setError(t('请至少选择一个 Bot'))
    const shared = mode !== 'personal' && value
    if (shared && value.length < SECRET_MIN_LENGTH) return setError(t('密钥至少 8 个字符'))
    const own = !editing && mode !== 'shared' && myValue
    if (own && myValue.length < SECRET_MIN_LENGTH) return setError(t('密钥至少 8 个字符'))
    const body = {
      description: description.trim(),
      mode,
      botIds,
      enabled,
      expiresAt: expires ? endOfDay(expires) : null,
      ...(shared ? { value } : {}),
    }
    setBusy(true)
    try {
      if (editing) await secretsApi.update(editing.id, body)
      else {
        const created = await secretsApi.create(base, { name, ...body })
        // The definition exists by now: a failed own value is toasted, the row still offers 填写我的值.
        if (own)
          await attempt(() => secretsApi.setMine(created.id, { value: myValue, allowForeignMachines: false }))
      }
      onSaved()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={editing ? t('编辑密钥') : t('新建密钥')}
      message={t('Bot 运行时以同名环境变量读取；改动下一轮生效。')}
      width={560}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', type: 'submit', form: formId, disabled: busy },
      ]}
    >
      <Form id={formId} onSubmit={() => void submit()}>
        <FormRow label={t('名称')} hint={editing ? undefined : t('环境变量名，如 FEISHU_DEVOPS_TOKEN')}>
          <TextField
            aria-label={t('名称')}
            mono
            value={name}
            disabled={!!editing}
            placeholder="FEISHU_DEVOPS_TOKEN"
            onChange={(e) => setName(e.target.value.toUpperCase())}
            autoFocus={!editing}
          />
        </FormRow>
        <FormRow label={t('用途')} align="top">
          <TextField
            multiline
            aria-label={t('用途')}
            rows={2}
            maxLength={500}
            placeholder={t('做什么用，怎么申请')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormRow>
        <FormRow label={t('模式')} align="top" hint={MODE_HINT[mode]}>
          <RadioGroup
            aria-label={t('模式')}
            direction="row"
            options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            value={mode}
            onChange={setMode}
          />
        </FormRow>
        <FormRow label={t('可用 Bot')} align="top">
          <SegmentedControl
            aria-label={t('可用 Bot')}
            size="small"
            items={[
              { value: 'all' as const, label: t('全部 Bot') },
              { value: 'some' as const, label: t('指定 Bot') },
            ]}
            value={botIds === null ? 'all' : 'some'}
            onChange={(v) => setBotIds(v === 'all' ? null : [])}
          />
          {botIds === null ? null : (
            <CheckboxGroup
              aria-label={t('指定 Bot')}
              options={bots.map((b) => ({ value: b.id, label: b.name }))}
              value={botIds}
              onChange={setBotIds}
            />
          )}
        </FormRow>
        <FormRow label={t('到期时间')} hint={t('留空则不过期')}>
          <TextField
            aria-label={t('到期时间')}
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </FormRow>
        <FormRow label={t('启用')}>
          <Switch ariaLabel={t('启用')} checked={enabled} onChange={setEnabled} />
        </FormRow>
        {mode === 'personal' ? null : (
          <FormRow
            label={t('统一值')}
            hint={
              editing?.value
                ? t('当前：{state}；留空则保持不变', { state: valueState(editing.value) })
                : t('可稍后填写；存入后不再显示明文')
            }
          >
            <SecureField
              aria-label={t('填写统一值')}
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </FormRow>
        )}
        {editing || mode === 'shared' ? null : (
          <FormRow
            label={t('我的值')}
            hint={
              mode === 'personal'
                ? t('可选；只在你触发时注入，其他成员各自填写')
                : t('可选；只对你生效，覆盖统一值')
            }
          >
            <SecureField
              aria-label={t('填写我的值')}
              autoComplete="new-password"
              value={myValue}
              onChange={(e) => setMyValue(e.target.value)}
            />
          </FormRow>
        )}
      </Form>
      {error ? <Alert variant="error" title={error} /> : null}
    </Dialog>
  )
}
