import type { InstallableDto, InstallDto, ListingSummary } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
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
  SearchField,
  Switch,
  Tag,
} from '../../ui'
import '../config/config.css'
import './market.css'

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

/** A pinned install whose listing has a newer version (a maintainer's self-test may run ahead of it). */
const newerFor = (i: InstallDto) =>
  i.pinVersionId && i.listing.status !== 'banned' && i.listing.revision > i.resolvedRevision
    ? i.listing.revision
    : null

/** What a banned or unlisted listing means for this install. */
function statusNote(i: InstallDto) {
  if (i.listing.status === 'banned')
    return i.banReason
      ? t('封禁原因：{reason}。下一轮起停止加载，建议移除', { reason: i.banReason })
      : t('已封禁，下一轮起停止加载，建议移除')
  if (i.listing.status === 'unlisted')
    return t('已下架：继续使用 r{n}，不会再有新版本', { n: i.resolvedRevision })
  return null
}

/**
 * The listings installed into one scope under `base` (`/groups/:id`, `/teams/:id`, `/teams/:id/repos/:repoId`):
 * switch, remove, and import another visible listing.
 */
export function InstallList({
  base,
  readOnly = false,
  onLeave,
}: {
  base: string
  readOnly?: boolean
  /** Offers 打开市场 to browse for more, closing the caller's dialog on the way. */
  onLeave?: () => void
}) {
  const { data, error, reload } = useGet<InstallDto[]>(`${base}/installs`)
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<InstallDto | null>(null)
  const put = (i: InstallDto, enabled: boolean, pinVersionId = i.pinVersionId) =>
    attempt(() => api.put(`${base}/installs/${i.listing.id}`, { enabled, pinVersionId })).then(reload)

  return (
    <>
      {error ? <Alert variant="error" title={t('配置加载失败')} description={error} /> : null}
      {data?.length === 0 ? (
        <div className="gs-note">
          {readOnly ? t('还没有引入条目') : t('还没有引入条目，可以去市场挑选 Skill 和插件')}
        </div>
      ) : (
        <GroupBox>
          {data?.map((i) => {
            const newer = newerFor(i)
            const note = statusNote(i)
            return (
              <GroupRow
                key={i.listing.id}
                className="cfg__item"
                label={
                  <span className="cfg__name-line">
                    <span className="cfg__name">{i.listing.title}</span>
                    <Tag tone="blue">{TYPE_LABEL[i.listing.type]}</Tag>
                    <Tag tone="gray">{LAYER_LABEL[i.listing.layer]}</Tag>
                    <Tag tone="gray">
                      {i.pinVersionId
                        ? t('锁定 r{n}', { n: i.resolvedRevision })
                        : t('跟随最新 · r{n}', { n: i.resolvedRevision })}
                    </Tag>
                    {newer ? <Tag tone="green">{t('有新版本 r{n}', { n: newer })}</Tag> : null}
                    <StatusTag status={i.listing.status} />
                  </span>
                }
                description={
                  <>
                    {i.listing.description}
                    {note ? (
                      <div className={i.listing.status === 'banned' ? 'cfg__danger' : undefined}>{note}</div>
                    ) : null}
                  </>
                }
              >
                {readOnly ? (
                  i.enabled ? null : (
                    <Tag tone="gray">{t('已停用')}</Tag>
                  )
                ) : (
                  <span className="cfg__controls">
                    {newer ? (
                      <Button size="small" onClick={() => void put(i, i.enabled, i.listing.versionId)}>
                        {t('升级到 r{n}', { n: newer })}
                      </Button>
                    ) : null}
                    {i.listing.status === 'banned' ? (
                      <Button size="small" variant="destructive" onClick={() => setRemoving(i)}>
                        {t('移除')}
                      </Button>
                    ) : (
                      <IconButton
                        title={t('移除 {name}', { name: i.listing.title })}
                        size="regular"
                        onClick={() => setRemoving(i)}
                      >
                        {'trash' as const}
                      </IconButton>
                    )}
                    <Switch
                      ariaLabel={t('启用 {name}', { name: i.listing.title })}
                      checked={i.enabled}
                      onChange={(on) => void put(i, on)}
                    />
                  </span>
                )}
              </GroupRow>
            )
          })}
        </GroupBox>
      )}
      {readOnly ? null : (
        <div className="cfg__foot">
          <span className="spacer" />
          {onLeave ? <OpenMarket onLeave={onLeave} /> : null}
          <Button disabled={!data} onClick={() => setImporting(true)}>
            {t('从已有条目引入…')}
          </Button>
        </div>
      )}
      <Presence>
        {importing ? (
          <ImportDialog
            base={base}
            onLeave={onLeave}
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

/** Opens the market, or one listing's detail there (`?listing=`), after closing the caller's dialog. */
function OpenMarket({ onLeave, listingId }: { onLeave: () => void; listingId?: string }) {
  const navigate = useNavigate()
  return (
    <Button
      variant="plain"
      icon="tag"
      onClick={() => {
        onLeave()
        navigate(listingId ? `/market?listing=${listingId}` : '/market')
      }}
    >
      {listingId ? t('在市场中查看详情') : t('打开市场')}
    </Button>
  )
}

/** 「已引入」 under a Skill tab: the scope's installs below its hand-written skills. */
export function InstalledSection({
  base,
  readOnly,
  onLeave,
}: {
  base: string
  readOnly?: boolean
  onLeave?: () => void
}) {
  return (
    <>
      <div className="cfg__eyebrow">{t('已引入')}</div>
      <div className="gs-note">
        {t('引入平台、团队已有的 Skill 与插件；与这一层已有的同名 Skill 不能同时存在。')}
      </div>
      <InstallList base={base} readOnly={readOnly} onLeave={onLeave} />
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

function ImportDialog({
  base,
  onLeave,
  onClose,
  onDone,
}: {
  base: string
  onLeave?: () => void
  onClose: () => void
  onDone: () => void
}) {
  const { data, error: loadError } = useGet<InstallableDto[]>(`${base}/installable`)
  const [picked, setPicked] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [policy, setPolicy] = useState<Policy>('follow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listing = data?.find((l) => l.id === picked)
  const needle = q.trim().toLowerCase()
  const shown = data?.filter((l) =>
    [l.title, l.name, l.description].some((x) => x.toLowerCase().includes(needle)),
  )
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
          <SearchField
            placeholder={t('搜索名称或描述')}
            aria-label={t('搜索条目')}
            value={q}
            onChange={setQ}
          />
          {shown?.length ? (
            <div className="cfg__pick">
              <RadioGroup
                aria-label={t('条目')}
                value={picked ?? undefined}
                onChange={setPicked}
                options={shown.map((l) => ({
                  value: l.id,
                  disabled: l.nameTaken,
                  label: (
                    <>
                      {`${l.title} · ${TYPE_LABEL[l.type]} · ${LAYER_LABEL[l.layer]} · r${l.revision}`}
                      {l.nameTaken ? (
                        <span className="mkt-targets__ask" aria-hidden="true">
                          <Tag tone="red">{t('同名冲突')}</Tag>
                        </span>
                      ) : null}
                      {l.description ? (
                        <span className="cfg__hint cfg__pick-desc">{l.description}</span>
                      ) : null}
                    </>
                  ),
                }))}
              />
            </div>
          ) : (
            <div className="gs-note">{t('没有匹配的条目')}</div>
          )}
          {shown?.some((l) => l.nameTaken) ? (
            <div className="gs-note">
              {t('标「同名冲突」的条目与这里已有的 Skill 同名，先移除那个再引入。')}
            </div>
          ) : null}
          {listing && onLeave ? <OpenMarket onLeave={onLeave} listingId={listing.id} /> : null}
          <VersionPolicy value={policy} onChange={setPolicy} revision={listing?.revision} />
        </>
      ) : null}
    </Dialog>
  )
}
