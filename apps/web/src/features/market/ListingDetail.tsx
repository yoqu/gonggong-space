import type {
  InstalledTargetHealthDto,
  InstallScope,
  ListingVersionDto,
  MarketListingDetailDto,
  ReusedSecretDto,
  ReviewStatus,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { ago, localDate } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  Icon,
  Link,
  Presence,
  PullDownButton,
  Spinner,
  Tabs,
  Tag,
  toast,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { mcpTarget } from '../plugins/model'
import { MODE_LABEL } from '../secrets/api'
import { ListingFiles } from './ListingFiles'
import {
  byline,
  CapabilityChips,
  capabilitiesOfListing,
  HEALTH_LABEL,
  installedText,
  isSystemPreset,
  ListingIcon,
  openPromptInGroup,
  readinessOfListing,
  SOURCE_LABEL,
} from './meta'
import { ReasonDialog } from './ReasonDialog'
import { VersionDiff } from './VersionDiff'
import '../config/config.css'
import './market.css'
import './market-detail.css'

export { byline, installedText, ListingIcon, SOURCE_LABEL }

export type DetailTab = 'overview' | 'changelog' | 'dev'

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  draft: t('草稿'),
  pending: t('待审核'),
  approved: t('已通过'),
  rejected: t('已驳回'),
}
const REVIEW_TONE = { draft: 'gray', pending: 'orange', approved: 'green', rejected: 'red' } as const

export const ReviewTag = ({ status }: { status: ReviewStatus }) => (
  <Tag tone={REVIEW_TONE[status]}>{REVIEW_LABEL[status]}</Tag>
)

/** SKILL.md's YAML header is metadata already shown above; rendered as Markdown it reads as a stray heading. */
const stripFrontMatter = (md: string) => md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Plugin detail view (880px centered on `--window-bg` when standalone, or embedded in a review pane/dialog).
 * Plain-language Overview & Changelog; all technical MCP / Skill / env / files and secret reuse notices live
 * strictly inside the 开发者信息 tab.
 */
export function ListingDetail({
  id,
  versionId,
  initialTab = 'overview',
  standalone = false,
  canInstallDirectly = true,
  reusedSecrets: extraReused,
  actions,
  onBack,
  onAdd,
  onManageInstalled,
  onConfigure,
  onData,
  onChanged,
}: {
  id: string
  versionId?: string
  initialTab?: DetailTab
  standalone?: boolean
  canInstallDirectly?: boolean
  reusedSecrets?: ReusedSecretDto[]
  actions?: (d: MarketListingDetailDto) => ReactNode
  onBack?: () => void
  onAdd?: (d: MarketListingDetailDto) => void
  onManageInstalled?: () => void
  onConfigure?: (
    d: MarketListingDetailDto,
    target: { scope: InstallScope; scopeId: string; label: string },
  ) => void
  onData?: (d: MarketListingDetailDto) => void
  onChanged?: () => void
}) {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useGet<MarketListingDetailDto>(
    `/market/${id}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`,
  )
  const [tab, setTab] = useState<DetailTab>(initialTab)
  // The first panel fades in with the page; only later tab switches get the panel swap.
  const [tabSwapped, setTabSwapped] = useState(false)
  const [banning, setBanning] = useState(false)
  const [unbanning, setUnbanning] = useState(false)
  const [diffOf, setDiffOf] = useState<ListingVersionDto | null>(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  useEffect(() => {
    if (data) onDataRef.current?.(data)
  }, [data])
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  if (!data)
    return (
      <div className={`mkt-detail-page${standalone ? '' : ' mkt-detail-page--embedded'}`}>
        {standalone && onBack ? (
          <button type="button" className="mkt-back" onClick={onBack}>
            <Icon name="chevron-left" size={15} />
            {t('插件市场')}
          </button>
        ) : null}
        {error ? <Alert variant="error" title={error} retrying={loading} onRetry={reload} /> : <Spinner />}
      </div>
    )

  const gh = data.ghSource
  const banned = data.status === 'banned'
  const caps = capabilitiesOfListing(data)
  const readiness = readinessOfListing(data)
  const hasExec = data.permissions.includes('exec')
  const hasNetwork = data.permissions.includes('network') || data.mcp.length > 0 || !!data.connector
  const examples = data.examples?.length ? data.examples : (data.connector?.examples ?? [])
  const reusedMap = new Map<string, ReusedSecretDto>()
  for (const r of [...(data.reusedSecrets ?? []), ...(extraReused ?? [])]) {
    reusedMap.set(`${r.name}:${r.existingScope}`, r)
  }
  const reused = [...reusedMap.values()]
  const installedGroup = data.installedIn?.find((x) => x.scope === 'group')
  const headerTargets: InstalledTargetHealthDto[] =
    data.installedHealth ??
    (data.installedIn ?? []).map((x) => ({
      ...x,
      enabled: true,
      health: 'ready',
      healthDetail: null,
    }))
  const readme = stripFrontMatter(data.readme)

  const unban = async () => {
    if (unbanning) return
    setUnbanning(true)
    try {
      const ok = await attempt(() => api.del(`/market/${data.id}/ban`))
      if (ok) {
        toast({ type: 'success', message: t('已解封「{name}」', { name: data.title }) })
        reload()
        onChanged?.()
      }
    } finally {
      setUnbanning(false)
    }
  }

  const customAction = actions?.(data)
  const canAdd =
    data.status === 'listed' &&
    !!data.listedVersionId &&
    data.listedRevision !== null &&
    !isSystemPreset(data)

  return (
    <div className={`mkt-detail-page${standalone ? '' : ' mkt-detail-page--embedded'}`}>
      {standalone && onBack ? (
        <button type="button" className="mkt-back" onClick={onBack}>
          <Icon name="chevron-left" size={15} />
          {t('插件市场')}
        </button>
      ) : null}

      {error ? <Alert variant="error" title={error} retrying={loading} onRetry={reload} /> : null}

      <section className="mkt-detail-top" aria-label={t('插件概览')}>
        <ListingIcon type={data.type} size={56} listing={data} />
        <div className="mkt-detail-who">
          <h1 className="mkt-detail-title">
            {data.title}
            <Tag tone={data.source === 'official' ? 'green' : data.source === 'team' ? 'blue' : 'gray'}>
              {SOURCE_LABEL[data.source]}
            </Tag>
            {banned ? <Tag tone="red">{t('已封禁')}</Tag> : null}
          </h1>
          {data.description ? <p className="mkt-detail-desc">{data.description}</p> : null}
          {headerTargets.length ? (
            <div className="mkt-detail-where">
              <span>{t('已在 {n} 处启用：', { n: headerTargets.length })}</span>
              {headerTargets.map((target) => {
                const label = target.scope === 'user' ? t('我的插件') : target.label
                const todo =
                  target.health === 'needs-secret' ||
                  target.health === 'needs-account' ||
                  target.health === 'needs-trust'
                const statusText = target.healthDetail || HEALTH_LABEL[target.health]
                return (
                  <button
                    key={`${target.scope}:${target.scopeId}`}
                    type="button"
                    className={`mkt-where-pill ${todo ? 'mkt-where-pill--todo' : 'mkt-where-pill--ok'}`}
                    onClick={() => {
                      if (todo && onConfigure)
                        onConfigure(data, { scope: target.scope, scopeId: target.scopeId, label })
                      else if (target.scope === 'group') navigate(`/g/${target.scopeId}`)
                      else onManageInstalled?.()
                    }}
                  >
                    <Icon name={todo ? 'lock' : 'check'} size={12} />
                    {`${label} · ${statusText}`}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="mkt-detail-acts">
          {customAction ? (
            customAction
          ) : canAdd && onAdd ? (
            <Button variant="primary" onClick={() => onAdd(data)}>
              {canInstallDirectly ? t('添加到…') : t('申请添加')}
            </Button>
          ) : null}
          {data.installedIn?.length && onManageInstalled ? (
            <Button onClick={onManageInstalled}>{t('管理已添加')}</Button>
          ) : null}
          {data.canReview ? (
            <div className="mkt-detail-acts__row">
              {banned ? (
                <Button size="small" loading={unbanning} disabled={unbanning} onClick={() => void unban()}>
                  {t('解封')}
                </Button>
              ) : (
                <PullDownButton
                  variant="ghost"
                  size="small"
                  icon="more"
                  indicator={false}
                  aria-label={t('管理 {name}', { name: data.name })}
                  align="end"
                  portal
                  items={[{ label: t('封禁'), value: 'ban', destructive: true }]}
                  onSelect={() => setBanning(true)}
                />
              )}
            </div>
          ) : null}
        </div>
      </section>

      {banned && data.banReason ? (
        <Alert
          variant="error"
          title={t('封禁原因：{reason}', { reason: data.banReason })}
          description={
            data.installedIn?.length ? t('已添加的地方下一轮起停止加载，可在「已添加」里移除') : undefined
          }
        />
      ) : null}

      <Tabs<DetailTab>
        aria-label={t('插件详情标签')}
        value={tab}
        onChange={(next) => {
          setTab(next)
          setTabSwapped(true)
        }}
        items={[
          { value: 'overview', label: t('概览') },
          {
            value: 'changelog',
            label: data.versions.length ? `${t('更新记录')} ${data.versions.length}` : t('更新记录'),
          },
          { value: 'dev', label: t('开发者信息') },
        ]}
      />

      {tab === 'overview' ? (
        <section
          key={tab}
          className={cx('mkt-detail-cols', tabSwapped && 'ui-panel-swap')}
          aria-label={t('概览')}
        >
          <div className="mkt-detail-main">
            {examples.length ? (
              <section className="mkt-panel" aria-label={t('试试这样问 Bot')}>
                <h2 className="mkt-panel__h">
                  <Icon name="bubble" size={15} />
                  {t('试试这样问 Bot')}
                </h2>
                <div className="mkt-try-list">
                  {examples.map((prompt) => (
                    <div key={prompt} className="mkt-try-row">
                      <span>“{prompt}”</span>
                      <Button
                        variant="plain"
                        size="small"
                        onClick={() => openPromptInGroup(prompt, installedGroup?.scopeId, navigate)}
                      >
                        {t('去试试')}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mkt-panel" aria-label={t('介绍#market')}>
              <h2 className="mkt-panel__h">
                <Icon name="doc-text" size={15} />
                {t('介绍#market')}
              </h2>
              <div className="mkt-detail-prose">
                {readme.trim() ? <Markdown text={readme} /> : <p>{data.description || t('（没有说明）')}</p>}
              </div>
            </section>
          </div>

          <aside className="mkt-panel mkt-detail-side">
            <section>
              <h3 className="mkt-detail-side__h">{t('包含能力')}</h3>
              <CapabilityChips capabilities={caps} />
              {caps.includes('connect') ? (
                <div className="mkt-info-row">
                  <span className="mkt-info-row__ic">
                    <Icon name="link" size={14} />
                  </span>
                  <div>{t('连接外部系统数据与操作')}</div>
                </div>
              ) : null}
              {caps.includes('create') ? (
                <div className="mkt-info-row">
                  <span className="mkt-info-row__ic">
                    <Icon name="palette" size={14} />
                  </span>
                  <div>{t('内置创作模板与交互画布')}</div>
                </div>
              ) : null}
              {caps.includes('do') ? (
                <div className="mkt-info-row">
                  <span className="mkt-info-row__ic">
                    <Icon name="sparkle" size={14} />
                  </span>
                  <div>
                    {data.commands?.length
                      ? t('{n} 个快捷指令', { n: data.commands.length })
                      : t('提供专项能力指南与快捷指令')}
                    {data.commands?.length ? (
                      <small className="mkt-info-row__sub">
                        {data.commands.map((c) => `/${c.name}`).join(' · ')}
                      </small>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="mkt-detail-side__h">{t('使用前准备')}</h3>
              {data.secretSpecs.length ? (
                data.secretSpecs.map((spec) => (
                  <div key={spec.name} className="mkt-info-row">
                    <span className="mkt-info-row__ic">
                      <Icon name="lock" size={14} />
                    </span>
                    <div>
                      {t('填写{name}', { name: spec.title || spec.name })}
                      <small className="mkt-info-row__sub">
                        {spec.mode === 'personal'
                          ? t('每人填自己的，加密保存')
                          : t('管理员统一配置，加密保存')}
                      </small>
                      {spec.url ? (
                        <Link external href={spec.url}>
                          {t('如何获取')}
                        </Link>
                      ) : null}
                      {installedGroup && onConfigure ? (
                        <div>
                          <Button
                            variant="plain"
                            size="small"
                            onClick={() => onConfigure(data, installedGroup)}
                          >
                            {t('立即填写')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : readiness === 'needs-account' ? (
                <div className="mkt-info-row">
                  <span className="mkt-info-row__ic">
                    <Icon name="link" size={14} />
                  </span>
                  <div>
                    {t('需连接外部账号')}
                    <small className="mkt-info-row__sub">{t('由电脑主人扫码或授权登录')}</small>
                    {data.connector?.docs ? (
                      <Link external href={data.connector.docs}>
                        {t('如何获取')}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : readiness === 'needs-trust' ? (
                <div className="mkt-info-row mkt-info-row--warn">
                  <span className="mkt-info-row__ic">
                    <Icon name="laptop" size={14} />
                  </span>
                  <div>
                    {t('需电脑主人授权')}
                    <small className="mkt-info-row__sub">{t('电脑主人首次确认允许运行后即可使用')}</small>
                  </div>
                </div>
              ) : (
                <div className="mkt-info-row mkt-info-row--safe">
                  <span className="mkt-info-row__ic">
                    <Icon name="check" size={14} />
                  </span>
                  <div>{t('开箱即用，无需额外配置')}</div>
                </div>
              )}
            </section>

            <section>
              <h3 className="mkt-detail-side__h">{t('安全与权限')}</h3>
              {hasNetwork ? (
                <div className="mkt-info-row">
                  <span className="mkt-info-row__ic">
                    <Icon name="globe" size={14} />
                  </span>
                  <div>{t('会向外部服务地址发送请求')}</div>
                </div>
              ) : null}
              {hasExec ? (
                <div className="mkt-info-row mkt-info-row--warn">
                  <span className="mkt-info-row__ic">
                    <Icon name="shield-warning" size={14} />
                  </span>
                  <div>{t('会在电脑上运行本地程序，需电脑主人确认')}</div>
                </div>
              ) : (
                <div className="mkt-info-row mkt-info-row--safe">
                  <span className="mkt-info-row__ic">
                    <Icon name="shield-check" size={14} />
                  </span>
                  <div>{t('不会在你的电脑上运行程序')}</div>
                </div>
              )}
            </section>

            <section>
              <h3 className="mkt-detail-side__h">{t('可以添加到')}</h3>
              <div className="mkt-info-row">
                <span className="mkt-info-row__ic">
                  <Icon name="check" size={14} />
                </span>
                <div>{data.type === 'skill' ? t('仅我使用、群、整个团队') : t('群、整个团队')}</div>
              </div>
            </section>

            <section>
              <h3 className="mkt-detail-side__h">{t('基本信息')}</h3>
              <div className="mkt-info-row">
                <span className="mkt-info-row__ic">
                  <Icon name="info" size={14} />
                </span>
                <div>
                  {byline(data)}
                  <small className="mkt-info-row__sub">
                    {data.listedRevision === null
                      ? t('{n} 次添加 · 更新于 {time}', { n: data.installs, time: ago(data.updatedAt) })
                      : t('r{rev} · {n} 次添加 · 更新于 {time}', {
                          rev: data.listedRevision,
                          n: data.installs,
                          time: ago(data.updatedAt),
                        })}
                  </small>
                </div>
              </div>
            </section>
          </aside>
        </section>
      ) : tab === 'changelog' ? (
        <section
          key={tab}
          className={cx('mkt-panel', tabSwapped && 'ui-panel-swap')}
          aria-label={t('更新记录')}
        >
          {data.versions.length ? (
            data.versions.map((v) => (
              <div key={v.id} className="mkt-log-row">
                <div className="mkt-log-rev">
                  <strong>r{v.revision}</strong>
                  <ReviewTag status={v.reviewStatus} />
                  <span className="mkt-log-time">{localDate(v.createdAt)}</span>
                </div>
                <div>
                  <div>{v.changelog || t('（无更新说明）')}</div>
                  {v.createdBy ? <div className="mkt-log-time">{v.createdBy}</div> : null}
                  {v.reviewNote ? (
                    <div className="mkt-row__warn">{t('审核意见：{note}', { note: v.reviewNote })}</div>
                  ) : null}
                </div>
                {data.canReview || data.canEdit ? (
                  <Button size="small" variant="plain" onClick={() => setDiffOf(v)}>
                    {t('查看变更')}
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="gs-note">{t('暂无更新记录')}</div>
          )}
        </section>
      ) : (
        <section
          key={tab}
          className={cx('mkt-panel', tabSwapped && 'ui-panel-swap')}
          aria-label={t('开发者信息')}
        >
          {reused.length ? (
            <div className="mkt-reuse-note" role="status">
              <Icon name="info" size={15} />
              <span>
                {t('已有同名凭据 {names}，添加时沿用已有定义，没有覆盖。', {
                  names: reused.map((r) => `${r.name}（${r.existingScopeLabel}）`).join(t('、')),
                })}
              </span>
            </div>
          ) : null}
          <dl className="mkt-kv">
            <dt>{t('包形态')}</dt>
            <dd>
              <span>
                {data.type === 'skill' ? 'Skill' : t('插件#type')}
                {data.mcp.length ? ` · ${t('{n} 个 MCP 服务', { n: data.mcp.length })}` : ''}
                {data.files.length ? ` · ${t('{n} 个文件', { n: data.files.length })}` : ''}
              </span>
            </dd>
            {data.mcp.length ? (
              <>
                <dt>{t('外部服务')}</dt>
                <dd>
                  {data.mcp.map((c) => (
                    <div key={c.name}>
                      <code className="mkt-code">{c.transport}</code>{' '}
                      <strong>{`${data.name}-${c.name}`}</strong>{' '}
                      <code className="mkt-code">{mcpTarget(c)}</code>
                    </div>
                  ))}
                </dd>
              </>
            ) : null}
            {data.secretSpecs.length ? (
              <>
                <dt>{t('环境变量')}</dt>
                <dd>
                  {data.secretSpecs.map((s) => (
                    <div key={s.name}>
                      <code className="mkt-code">{s.name}</code>{' '}
                      <span>
                        {s.title ? `${s.title} · ` : ''}
                        {MODE_LABEL[s.mode]} · {s.required ? t('必需') : t('可选')}
                      </span>
                      {s.url ? (
                        <>
                          {' '}
                          <Link external href={s.url}>
                            {t('前往 {host} 申请', { host: hostOf(s.url) })}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  ))}
                </dd>
              </>
            ) : null}
            <dt>{t('权限声明')}</dt>
            <dd>
              {data.permissions.length ? (
                <div>
                  {data.permissions.map((p) => (
                    <code key={p} className="mkt-code">
                      {p}
                    </code>
                  ))}
                </div>
              ) : (
                <span>{t('无特殊权限')}</span>
              )}
            </dd>
            {data.agents.length ? (
              <>
                <dt>{t('兼容引擎')}</dt>
                <dd>
                  <span>{data.agents.join(' · ')}</span>
                </dd>
              </>
            ) : null}
            {gh ? (
              <>
                <dt>{t('来源')}</dt>
                <dd>
                  <div>
                    <Link external href={gh.url}>
                      {[gh.url, gh.ref, gh.path].filter(Boolean).join(' · ')}
                    </Link>{' '}
                    <code className="mkt-code">@{gh.commit.slice(0, 7)}</code>
                  </div>
                </dd>
              </>
            ) : null}
          </dl>

          {data.files.length ? (
            <div className="mkt-dev-files">
              <div className="cfg__eyebrow">
                {t('文件')} <span className="mkt-detail__n">{data.files.length}</span>
              </div>
              <ListingFiles listingId={data.id} versionId={data.versionId} files={data.files} />
            </div>
          ) : null}
        </section>
      )}

      <Presence>
        {banning ? (
          <ReasonDialog
            title={t('封禁「{name}」', { name: data.title })}
            note={t('封禁后所有引入下一轮起停止加载，市场不再显示，也不能新引入。')}
            fieldLabel={t('封禁原因')}
            placeholder={t('维护者会看到这个原因')}
            confirmLabel={t('封禁')}
            done={t('已封禁「{name}」', { name: data.title })}
            run={(reason) => api.post(`/market/${data.id}/ban`, { reason })}
            onClose={() => setBanning(false)}
            onDone={() => {
              setBanning(false)
              reload()
              onChanged?.()
            }}
          />
        ) : diffOf ? (
          <Dialog
            open
            title={t('{name} r{n} 的变更', { name: data.title, n: diffOf.revision })}
            width={760}
            onClose={() => setDiffOf(null)}
          >
            <VersionDiff listingId={data.id} versionId={diffOf.id} />
          </Dialog>
        ) : null}
      </Presence>
    </div>
  )
}
