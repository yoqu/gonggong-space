import { type MySecretDto, SECRET_MIN_LENGTH } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Checkbox,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  NoSecretsArt,
  Presence,
  SecureField,
  Spinner,
  Switch,
  Tag,
} from '../../ui'
import { MODE_LABEL, secretsApi, valueState } from './api'
import '../config/config.css'

export const FOREIGN = t('允许在他人机器上的 Bot 使用')
export const FOREIGN_NOTE = t('机器主人能读到 Bot 进程的环境变量，所以默认只注入到你自己机器上的 Bot。')

/** 设置 · 我的密钥: definitions of my teams and groups that take my own value (`shared_overridable` / `personal`). */
export function MySecrets() {
  const { data, error, reload } = useGet<MySecretDto[]>('/me/secrets')
  const [filling, setFilling] = useState<MySecretDto | null>(null)
  const [clearing, setClearing] = useState<MySecretDto | null>(null)
  if (error) return <Alert variant="error" title={t('密钥加载失败')} description={error} />
  if (!data) return <Spinner />
  if (!data.length)
    return (
      <EmptyState
        compact
        illustration={<NoSecretsArt />}
        title={t('没有需要你填写的密钥')}
        description={t('团队或群里有「每人自填」「统一值可个人覆盖」的密钥时会列在这里。')}
      />
    )
  const places = [...new Set(data.map((d) => d.where))]
  const toggle = async (d: MySecretDto, on: boolean) => {
    await attempt(() => secretsApi.setMine(d.secret.id, { allowForeignMachines: on }))
    reload()
  }
  return (
    <>
      <div className="gs-note">
        {t('值加密保存在服务器，只有你能写入，管理员也看不到；Bot 由你触发时注入。')}
      </div>
      {places.map((where) => (
        <section key={where} className="settings-section">
          <h3 className="settings-section__title">{where}</h3>
          <GroupBox>
            {data
              .filter((d) => d.where === where)
              .map((d) => (
                <GroupRow
                  key={d.secret.id}
                  className="cfg__item"
                  label={
                    <span className="cfg__name-line">
                      <span className="cfg__name">{d.secret.name}</span>
                      <Tag tone="gray">{MODE_LABEL[d.secret.mode]}</Tag>
                    </span>
                  }
                  description={
                    <>
                      {d.secret.description ? <div>{d.secret.description}</div> : null}
                      <div>{d.mine ? valueState(d.mine) : t('未填写')}</div>
                    </>
                  }
                >
                  <span className="cfg__controls">
                    {d.mine ? (
                      <>
                        <Switch
                          ariaLabel={`${FOREIGN} ${d.secret.name}`}
                          checked={d.mine.allowForeignMachines}
                          onChange={(on) => void toggle(d, on)}
                        />
                        <Button size="small" onClick={() => setClearing(d)}>
                          {t('清除')}
                        </Button>
                      </>
                    ) : null}
                    <Button size="small" onClick={() => setFilling(d)}>
                      {d.mine ? t('更新…') : t('填写…')}
                    </Button>
                  </span>
                </GroupRow>
              ))}
          </GroupBox>
        </section>
      ))}
      <div className="gs-foot">{t('开关「{label}」：{note}', { label: FOREIGN, note: FOREIGN_NOTE })}</div>
      <Presence>
        {filling ? (
          <FillMine
            item={filling}
            onClose={() => setFilling(null)}
            onDone={() => {
              setFilling(null)
              reload()
            }}
          />
        ) : clearing ? (
          <ConfirmActionDialog
            title={t('清除我的 {name}？', { name: clearing.secret.name })}
            message={t('清除后由你触发的运行不再注入你的值。')}
            consequences={
              clearing.secret.mode === 'personal'
                ? [t('需要这个密钥的 Bot 会提示你重新填写')]
                : [t('改用该层的统一值')]
            }
            label={t('清除')}
            done={t('已清除')}
            run={() => secretsApi.clearMine(clearing.secret.id)}
            onDone={() => {
              setClearing(null)
              reload()
            }}
            onClose={() => setClearing(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

export function FillMine({
  item,
  onClose,
  onDone,
}: {
  item: MySecretDto
  onClose: () => void
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  const [foreign, setForeign] = useState(item.mine?.allowForeignMachines ?? false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await secretsApi.setMine(item.secret.id, { value, allowForeignMachines: foreign })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('填写 {name}', { name: item.secret.name })}
      message={item.secret.description || undefined}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('保存'),
          variant: 'primary',
          onClick: () => void submit(),
          disabled: busy || value.length < SECRET_MIN_LENGTH,
        },
      ]}
    >
      <SecureField
        label={t('值')}
        autoComplete="new-password"
        hint={item.mine ? t('当前：{state}', { state: valueState(item.mine) }) : t('至少 8 个字符')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Checkbox label={FOREIGN} checked={foreign} onChange={setForeign} />
      <div className="gs-desc">{FOREIGN_NOTE}</div>
      {error ? <Alert variant="error" title={error} /> : null}
    </Dialog>
  )
}
