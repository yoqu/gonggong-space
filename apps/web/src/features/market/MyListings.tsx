import type {
  CheckUpstreamRes,
  ListingVisibility,
  MyListingDto,
  PublishPreflightRes,
  PublishRes,
  SkillFile,
  UpdateListingReq,
  UpstreamMovedDto,
} from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt, toastError } from '../../lib/errors'
import { storedTeam } from '../../lib/team'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Presence,
  RadioGroup,
  SegmentedControl,
  Spinner,
  Tag,
  TextArea,
  TextField,
  toast,
} from '../../ui'
import { FolderInput } from '../config/SkillLayer'
import { folderSkillFiles, zipSkillFiles } from '../config/skillFiles'
import { ListingIcon, ReviewTag } from './ListingDetail'
import { TYPE_LABEL } from './status'
import '../config/config.css'
import '../groups/groups.css'

const VISIBILITY_LABEL: Record<ListingVisibility, string> = { public: t('公开'), team: t('仅本团队') }

type Filter = 'all' | 'listed' | 'pending' | 'todo'

/** Draft, rejected or banned: waits for the author to act. */
const needsMe = (l: MyListingDto) =>
  l.status === 'banned' || l.latest.reviewStatus === 'draft' || l.latest.reviewStatus === 'rejected'

const matches = (l: MyListingDto, f: Filter) =>
  f === 'all' ||
  (f === 'listed'
    ? l.status === 'listed' && !!l.listedVersionId
    : f === 'pending'
      ? l.latest.reviewStatus === 'pending'
      : needsMe(l))

/** 我的发布: the listings I maintain, their latest version's review, and publishing new ones. */
export function MyListings({ onOpen }: { onOpen?: (l: MyListingDto) => void }) {
  const { data, error, reload } = useGet<MyListingDto[]>('/market/mine')
  // A hint only: when GitHub can't be asked, rows keep the plain 检查上游更新.
  const upstream = useGet<UpstreamMovedDto[]>(data?.some((l) => l.ghSource) ? '/market/mine/upstream' : null)
  const [publishing, setPublishing] = useState(false)
  const [submitting, setSubmitting] = useState<MyListingDto | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const patch = (l: MyListingDto, body: UpdateListingReq) =>
    attempt(() => api.patch(`/market/${l.id}`, body)).then(reload)
  const checkUpstream = async (l: MyListingDto) => {
    let res: CheckUpstreamRes
    try {
      res = await api.post<CheckUpstreamRes>(`/market/${l.id}/check-upstream`)
    } catch (e) {
      return toastError(e)
    }
    const commit = res.commit.slice(0, 7)
    toast({
      type: res.drafted ? 'success' : 'info',
      message: res.drafted
        ? t('上游有更新（{commit}），已生成新草稿', { commit })
        : res.changed
          ? t('上游有新提交（{commit}），但这个目录的文件没有变化', { commit })
          : t('上游没有变化'),
    })
    if (res.changed) {
      reload()
      upstream.reload()
    }
  }
  const movedOf = (l: MyListingDto) => upstream.data?.find((u) => u.listingId === l.id)
  const count = (f: Filter) => data?.filter((l) => matches(l, f)).length ?? 0
  const shown = data?.filter((l) => matches(l, filter)) ?? []

  return (
    <div className="mkt-mine">
      <div className="mkt-section-head">
        {data?.length ? (
          <SegmentedControl<Filter>
            aria-label={t('状态')}
            size="small"
            value={filter}
            onChange={setFilter}
            items={(
              [
                ['all', t('全部')],
                ['listed', t('已上架')],
                ['pending', t('待审核')],
                ['todo', t('待处理')],
              ] as const
            ).map(([value, label]) => ({ value, label: `${label} ${count(value)}` }))}
          />
        ) : (
          <span className="gs-note">{t('发布后先存为草稿，提交审核通过后才会出现在市场。')}</span>
        )}
        <span className="spacer" />
        <Button variant="primary" size="small" icon="plus" onClick={() => setPublishing(true)}>
          {t('发布…')}
        </Button>
      </div>
      {error ? <Alert variant="error" title={error} /> : null}
      {!data ? (
        error ? null : (
          <Spinner />
        )
      ) : data.length ? (
        shown.length ? (
          <GroupBox>
            {shown.map((l) => (
              <GroupRow
                key={l.id}
                className="cfg__item mkt-row"
                label={
                  <span className="mkt-row__head">
                    <ListingIcon type={l.type} size={28} />
                    <span className="mkt-row__titles">
                      <span className="cfg__name-line">
                        <strong className="mkt-row__name">{l.title}</strong>
                        <Tag tone="gray">r{l.latest.revision}</Tag>
                        <ReviewTag status={l.latest.reviewStatus} />
                        {l.status === 'banned' ? (
                          <Tag tone="red">{t('已封禁')}</Tag>
                        ) : !l.listedVersionId ? (
                          <Tag tone="gray">{t('未上架')}</Tag>
                        ) : l.status === 'listed' ? (
                          <Tag tone="green">{t('已上架')}</Tag>
                        ) : (
                          <Tag tone="orange">{t('已下架')}</Tag>
                        )}
                        {movedOf(l) ? (
                          <span
                            title={t('GitHub 上有新提交 {commit}', {
                              commit: movedOf(l)?.commit.slice(0, 7) ?? '',
                            })}
                          >
                            <Tag tone="blue">{t('上游有更新')}</Tag>
                          </span>
                        ) : null}
                      </span>
                      <span className="mkt-row__meta">
                        {[
                          TYPE_LABEL[l.type],
                          VISIBILITY_LABEL[l.visibility],
                          t('更新于 {time}', { time: ago(l.latest.createdAt) }),
                        ].join(' · ')}
                      </span>
                    </span>
                  </span>
                }
                description={
                  l.status === 'banned' && l.banReason ? (
                    <span className="mkt-row__warn">{t('封禁原因：{reason}', { reason: l.banReason })}</span>
                  ) : l.latest.reviewStatus === 'rejected' && l.latest.reviewNote ? (
                    <span className="mkt-row__warn">
                      {t('驳回原因：{note}', { note: l.latest.reviewNote })}
                    </span>
                  ) : (
                    l.description
                  )
                }
              >
                <span className="cfg__controls mkt-row__controls">
                  {l.ghSource ? (
                    <Button size="small" variant="plain" onClick={() => void checkUpstream(l)}>
                      {movedOf(l) ? t('同步上游更新') : t('检查上游更新')}
                    </Button>
                  ) : null}
                  {l.listedVersionId && l.status !== 'banned' ? (
                    <Button
                      size="small"
                      variant="plain"
                      onClick={() => void patch(l, { status: l.status === 'listed' ? 'unlisted' : 'listed' })}
                    >
                      {l.status === 'listed' ? t('下架') : t('重新上架')}
                    </Button>
                  ) : null}
                  {l.listedVersionId ? null : (
                    <Button
                      size="small"
                      variant="plain"
                      onClick={() =>
                        void patch(l, { visibility: l.visibility === 'public' ? 'team' : 'public' })
                      }
                    >
                      {l.visibility === 'public' ? t('设为仅本团队') : t('设为公开')}
                    </Button>
                  )}
                  {onOpen ? (
                    <Button size="small" variant="plain" onClick={() => onOpen(l)}>
                      {t('详情')}
                    </Button>
                  ) : null}
                  {l.latest.reviewStatus === 'draft' || l.latest.reviewStatus === 'rejected' ? (
                    <Button size="small" variant="primary" onClick={() => setSubmitting(l)}>
                      {t('提交审核')}
                    </Button>
                  ) : null}
                </span>
              </GroupRow>
            ))}
          </GroupBox>
        ) : (
          <EmptyState compact icon="tag" title={t('没有这个状态的条目')} />
        )
      ) : (
        <EmptyState
          icon="upload"
          title={t('还没有发布过 Skill 或插件')}
          description={t('支持文件夹、ZIP、粘贴 SKILL.md 或 GitHub 链接；同团队同名即发布新版本。')}
          action={
            <Button size="small" variant="primary" onClick={() => setPublishing(true)}>
              {t('发布…')}
            </Button>
          }
        />
      )}
      <Presence>
        {publishing ? (
          <PublishDialog
            onClose={() => {
              setPublishing(false)
              reload()
            }}
          />
        ) : submitting ? (
          <Dialog
            open
            title={t('提交审核 {name}', { name: submitting.title })}
            width={480}
            closeOnScrim={false}
            onClose={() => setSubmitting(null)}
          >
            <SubmitForm
              listing={submitting}
              onCancel={() => setSubmitting(null)}
              onDone={() => {
                setSubmitting(null)
                reload()
              }}
            />
          </Dialog>
        ) : null}
      </Presence>
    </div>
  )
}

/** The changelog and 提交审核 of a listing's latest version. */
function SubmitForm({
  listing,
  cancelLabel = t('取消'),
  onCancel,
  onDone,
}: {
  listing: MyListingDto
  cancelLabel?: string
  onCancel: () => void
  onDone: () => void
}) {
  const [changelog, setChangelog] = useState(listing.latest.changelog)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/market/${listing.id}/versions/${listing.latest.id}/submit`, {
        changelog: changelog.trim(),
      })
      toast({ type: 'success', message: t('已提交审核') })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <>
      {error ? <Alert variant="error" title={error} /> : null}
      <TextArea
        label={t('更新说明')}
        aria-label={t('更新说明')}
        placeholder={t('这个版本改了什么，审核人和引入者都会看到')}
        maxLength={2000}
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
      />
      <div className="cfg__foot">
        <span className="spacer" />
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {t('提交审核')}
        </Button>
      </div>
    </>
  )
}

type Source = 'folder' | 'zip' | 'paste' | 'github'

/** 发布到市场: pick a team and visibility, read the files from one of four sources, save a draft, then submit it. */
function PublishDialog({ onClose }: { onClose: () => void }) {
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const [teamId, setTeamId] = useState(teams.find((x) => x.id === storedTeam())?.id ?? teams[0]?.id ?? '')
  const [visibility, setVisibility] = useState<ListingVisibility>('team')
  const [source, setSource] = useState<Source>('folder')
  const [files, setFiles] = useState<SkillFile[] | null>(null)
  const [skillMd, setSkillMd] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<PublishRes | null>(null)
  const folder = useRef<HTMLDivElement>(null)
  const zip = useRef<HTMLInputElement>(null)

  const read = async (load: Promise<SkillFile[]>) => {
    try {
      const next = await load
      setFiles(next.length ? next : null)
      setError(next.length ? '' : t('没有读到文件'))
    } catch (e) {
      setError(t('无法读取：{e}', { e: errorText(e) }))
    }
  }
  const pasted: SkillFile[] | null = skillMd.trim()
    ? [{ path: 'SKILL.md', content: skillMd, encoding: 'utf8' }]
    : null
  const upload = source === 'paste' ? pasted : source === 'github' ? null : files
  const check = usePreflight(teamId, visibility, upload)
  const ready =
    !!teamId && (source === 'github' ? !!url.trim() : !!check.result && check.result.kind !== 'unchanged')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      setSaved(
        source === 'github'
          ? await api.post<PublishRes>('/market/import/github', { teamId, visibility, url: url.trim() })
          : await api.post<PublishRes>('/market', { teamId, visibility, files: upload }),
      )
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }

  return (
    <Dialog
      open
      title={t('发布到市场')}
      width={600}
      closeOnScrim={false}
      onClose={onClose}
      actions={
        saved
          ? undefined
          : [
              { label: t('取消'), onClick: onClose },
              {
                label: t('保存草稿'),
                variant: 'primary',
                disabled: !ready || busy,
                onClick: () => void save(),
              },
            ]
      }
    >
      {error ? <Alert variant="error" title={error} /> : null}
      {saved ? (
        <>
          {saved.unchanged ? (
            <Alert
              variant="info"
              title={t('和最新上传的 r{n} 完全一样，没有生成新版本', { n: saved.listing.latest.revision })}
            />
          ) : (
            <Alert
              variant="success"
              title={t('已保存「{name}」草稿 r{n}', {
                name: saved.listing.title,
                n: saved.listing.latest.revision,
              })}
            />
          )}
          <Warnings items={saved.warnings} />
          {saved.listing.latest.reviewStatus === 'draft' ||
          saved.listing.latest.reviewStatus === 'rejected' ? (
            <SubmitForm
              listing={saved.listing}
              cancelLabel={t('稍后提交')}
              onCancel={onClose}
              onDone={onClose}
            />
          ) : (
            <div className="cfg__foot">
              <span className="spacer" />
              <Button onClick={onClose}>{t('关闭')}</Button>
            </div>
          )}
        </>
      ) : (
        <>
          {teams.length > 1 ? (
            <>
              <div className="cfg__eyebrow">{t('团队')}</div>
              <RadioGroup
                aria-label={t('团队')}
                direction="row"
                value={teamId}
                onChange={setTeamId}
                options={teams.map((x) => ({ value: x.id, label: x.name }))}
              />
            </>
          ) : null}
          <div className="cfg__eyebrow">{t('可见范围')}</div>
          <RadioGroup<ListingVisibility>
            aria-label={t('可见范围')}
            direction="row"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'team', label: t('仅本团队') },
              { value: 'public', label: t('公开') },
            ]}
          />
          <div className="gs-note">
            {visibility === 'public' ? t('公开条目由平台管理员审核。') : t('仅本团队条目由团队管理员审核。')}
          </div>
          <div className="cfg__eyebrow">{t('来源')}</div>
          <SegmentedControl<Source>
            aria-label={t('来源')}
            value={source}
            onChange={(s) => {
              setSource(s)
              setFiles(null)
              setError('')
            }}
            items={[
              { value: 'folder', label: t('文件夹') },
              { value: 'zip', label: 'ZIP' },
              { value: 'paste', label: t('粘贴 SKILL.md') },
              { value: 'github', label: t('GitHub 链接') },
            ]}
          />
          {source === 'folder' ? (
            <div className="mkt-source" ref={folder}>
              <Button size="small" onClick={() => folder.current?.querySelector('input')?.click()}>
                {t('选择文件夹…')}
              </Button>
              <FolderInput onFiles={(fs) => void read(folderSkillFiles(fs))} />
              {files ? <span className="gs-note">{t('已读取 {n} 个文件', { n: files.length })}</span> : null}
            </div>
          ) : source === 'zip' ? (
            <div className="mkt-source">
              <Button size="small" onClick={() => zip.current?.click()}>
                {t('选择 zip…')}
              </Button>
              <input
                ref={zip}
                type="file"
                accept=".zip,application/zip"
                hidden
                aria-label={t('导入 zip')}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void read(zipSkillFiles(f))
                  e.target.value = ''
                }}
              />
              {files ? <span className="gs-note">{t('已读取 {n} 个文件', { n: files.length })}</span> : null}
            </div>
          ) : source === 'paste' ? (
            <TextArea
              aria-label="SKILL.md"
              placeholder={'---\nname: my-skill\ndescription: …\n---\n'}
              rows={10}
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
            />
          ) : (
            <TextField
              aria-label={t('GitHub 链接')}
              placeholder="https://github.com/<owner>/<repo>/tree/<ref>/<path>"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
          <div className="gs-note">
            {t(
              '文件夹或 ZIP 的根目录要有 SKILL.md（Skill）或 gonggong-plugin.json（插件）；同团队同名即发布新版本。',
            )}
          </div>
          {check.error ? <Alert variant="error" title={check.error} /> : null}
          {check.result ? <Preflight result={check.result} visibility={visibility} /> : null}
        </>
      )}
    </Dialog>
  )
}

/** POST /market/preflight for the files as they are picked or typed; null while there is nothing to check. */
function usePreflight(teamId: string, visibility: ListingVisibility, files: SkillFile[] | null) {
  const [state, setState] = useState<{ result: PublishPreflightRes | null; error: string }>({
    result: null,
    error: '',
  })
  const body = files && teamId ? JSON.stringify({ teamId, visibility, files }) : null
  useEffect(() => {
    setState({ result: null, error: '' })
    if (!body) return
    let live = true
    // Typing in 粘贴 SKILL.md settles before it asks.
    const id = setTimeout(() => {
      api.post<PublishPreflightRes>('/market/preflight', JSON.parse(body)).then(
        (result) => live && setState({ result, error: '' }),
        (e) => live && setState({ result: null, error: errorText(e) }),
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [body])
  return state
}

/** What saving the picked files will do, before saving them. */
function Preflight({
  result: r,
  visibility,
}: {
  result: PublishPreflightRes
  visibility: ListingVisibility
}) {
  const what = TYPE_LABEL[r.type]
  return (
    <>
      <Alert
        variant={r.kind === 'unchanged' ? 'warning' : 'info'}
        title={
          r.kind === 'new'
            ? t('将新建 {type}「{name}」，保存为草稿 r{n}', { type: what, name: r.title, n: r.revision })
            : r.kind === 'version'
              ? t('你已发布过「{name}」，将保存为新版本 r{n}', { name: r.title, n: r.revision })
              : t('和最新上传的 r{n} 完全一样，不会生成新版本', { n: r.revision })
        }
        description={r.description}
      >
        {r.kind !== 'new' && r.visibility !== visibility ? (
          <p className="ui-alert__desc">
            {t('可见范围沿用已有条目的「{v}」', { v: VISIBILITY_LABEL[r.visibility] })}
          </p>
        ) : null}
      </Alert>
      <Warnings items={r.warnings} />
    </>
  )
}

function Warnings({ items }: { items: string[] }) {
  return items.length ? (
    <Alert
      variant="warning"
      title={t('请确认没有泄露密钥或本机路径')}
      description={
        <ul className="mkt-warnings">
          {items.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      }
    />
  ) : null
}
