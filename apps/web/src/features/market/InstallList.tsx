import type { InstallableDto, InstallDto, ListingSummary } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  GroupBox,
  GroupRow,
  IconButton,
  Presence,
  RadioGroup,
  Switch,
  Tag,
} from '../../ui'
import '../config/config.css'

export const TYPE_LABEL: Record<ListingSummary['type'], string> = { skill: 'Skill', plugin: t('插件#type') }
const LAYER_LABEL: Record<ListingSummary['layer'], string> = {
  platform: t('平台层'),
  team: t('团队层'),
  group: t('群层'),
}

function StatusTag({ status }: { status: ListingSummary['status'] }) {
  if (status === 'unlisted') return <Tag tone="orange">{t('已下架')}</Tag>
  if (status === 'banned') return <Tag tone="red">{t('已封禁')}</Tag>
  return null
}

/**
 * The listings installed into one scope under `base` (`/groups/:id`, `/teams/:id`, `/teams/:id/repos/:repoId`):
 * switch, remove, and import another visible listing.
 */
export function InstallList({ base, readOnly = false }: { base: string; readOnly?: boolean }) {
  const { data, error, reload } = useGet<InstallDto[]>(`${base}/installs`)
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<InstallDto | null>(null)
  const put = (i: InstallDto, enabled: boolean) =>
    attempt(() =>
      api.put(`${base}/installs/${i.listing.id}`, { enabled, pinVersionId: i.pinVersionId }),
    ).then(reload)

  return (
    <>
      {error ? <Alert variant="error" title={t('配置加载失败')} description={error} /> : null}
      {data?.length === 0 ? (
        <div className="gs-note">{t('还没有引入条目')}</div>
      ) : (
        <GroupBox>
          {data?.map((i) => (
            <GroupRow
              key={i.listing.id}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{i.listing.title}</span>
                  <Tag tone="blue">{TYPE_LABEL[i.listing.type]}</Tag>
                  <Tag tone="gray">{LAYER_LABEL[i.listing.layer]}</Tag>
                  <Tag tone="gray">
                    {i.pinVersionId ? t('锁定 r{n}', { n: i.resolvedRevision }) : t('跟随最新')}
                  </Tag>
                  <StatusTag status={i.listing.status} />
                </span>
              }
              description={i.listing.description}
            >
              {readOnly ? (
                i.enabled ? null : (
                  <Tag tone="gray">{t('已停用')}</Tag>
                )
              ) : (
                <span className="cfg__controls">
                  <IconButton
                    title={t('移除 {name}', { name: i.listing.title })}
                    size="regular"
                    onClick={() => setRemoving(i)}
                  >
                    {'trash' as const}
                  </IconButton>
                  <Switch
                    ariaLabel={t('启用 {name}', { name: i.listing.title })}
                    checked={i.enabled}
                    onChange={(on) => void put(i, on)}
                  />
                </span>
              )}
            </GroupRow>
          ))}
        </GroupBox>
      )}
      {readOnly ? null : (
        <div className="cfg__foot">
          <span className="spacer" />
          <Button disabled={!data} onClick={() => setImporting(true)}>
            {t('从已有条目引入…')}
          </Button>
        </div>
      )}
      <Presence>
        {importing ? (
          <ImportDialog
            base={base}
            onClose={() => setImporting(false)}
            onDone={() => {
              setImporting(false)
              reload()
            }}
          />
        ) : removing ? (
          <ConfirmActionDialog
            title={t('移除 {name}？', { name: removing.listing.title })}
            message={t('只移除在这里的引入，条目本身保留，可随时再引入。')}
            consequences={[t('相关 Bot 下一轮起不再加载它')]}
            label={t('移除')}
            done={t('已移除 {name}', { name: removing.listing.title })}
            run={() => api.del(`${base}/installs/${removing.listing.id}`)}
            onDone={() => {
              setRemoving(null)
              reload()
            }}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** 「已引入」 under a Skill tab: the scope's installs below its hand-written skills. */
export function InstalledSection({ base, readOnly }: { base: string; readOnly?: boolean }) {
  return (
    <>
      <div className="cfg__eyebrow">{t('已引入')}</div>
      <div className="gs-note">
        {t('引入平台、团队已有的 Skill 与插件；与这一层已有的同名 Skill 不能同时存在。')}
      </div>
      <InstallList base={base} readOnly={readOnly} />
    </>
  )
}

export type Policy = 'follow' | 'pin'

/** 跟随最新 (default) or pin the version current at install time. */
export function VersionPolicy({
  value,
  onChange,
  revision,
}: {
  value: Policy
  onChange: (p: Policy) => void
  revision?: number
}) {
  return (
    <>
      <div className="cfg__eyebrow">{t('版本')}</div>
      <RadioGroup<Policy>
        aria-label={t('版本')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'follow', label: t('跟随最新') },
          {
            value: 'pin',
            label: revision === undefined ? t('锁定当前版本') : t('锁定当前版本 r{n}', { n: revision }),
          },
        ]}
      />
    </>
  )
}

function ImportDialog({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const { data, error: loadError } = useGet<InstallableDto[]>(`${base}/installable`)
  const [picked, setPicked] = useState<string | null>(null)
  const [policy, setPolicy] = useState<Policy>('follow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listing = data?.find((l) => l.id === picked)
  const submit = async () => {
    if (!listing) return
    setBusy(true)
    setError('')
    try {
      await api.put(`${base}/installs/${listing.id}`, {
        enabled: true,
        pinVersionId: policy === 'pin' ? listing.versionId : null,
      })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('从已有条目引入')}
      width={520}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('引入'), variant: 'primary', disabled: !listing || busy, onClick: () => void submit() },
      ]}
    >
      {loadError || error ? <Alert variant="error" title={loadError || error} /> : null}
      {data?.length === 0 ? (
        <div className="gs-note">{t('没有可引入的条目')}</div>
      ) : data ? (
        <>
          <div className="cfg__eyebrow">{t('条目')}</div>
          <RadioGroup
            aria-label={t('条目')}
            value={picked ?? undefined}
            onChange={setPicked}
            options={data.map((l) => ({
              value: l.id,
              label: `${l.title} · ${TYPE_LABEL[l.type]} · ${LAYER_LABEL[l.layer]} · r${l.revision}`,
            }))}
          />
          <VersionPolicy value={policy} onChange={setPolicy} revision={listing?.revision} />
        </>
      ) : null}
    </Dialog>
  )
}
