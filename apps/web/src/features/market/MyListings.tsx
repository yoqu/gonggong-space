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
import { cx } from '../../lib/cx'
import { attempt, toastError } from '../../lib/errors'
import { storedTeam } from '../../lib/team'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  Icon,
  NoPluginsArt,
  PopUpButton,
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
import { CapabilityChips, type MarketScene, SCENES } from './meta'
import { useRowLocks } from './rowLocks'
import '../config/config.css'
import '../groups/groups.css'
import './market-manage.css'

const VISIBILITY_LABEL: Record<ListingVisibility, string> = {
  public: t('公开社区'),
  team: t('仅本团队'),
}

type Filter = 'all' | 'listed' | 'pending' | 'todo'
type PublishTrack = 'light' | 'package'
type PackageSource = 'folder' | 'zip' | 'github'

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

/** Build a valid SKILL.md with YAML frontmatter from guided form fields. */
function buildGuidedSkillMd(opts: {
  title: string
  description: string
  scene: MarketScene
  example: string
  body: string
}): string | null {
  const title = opts.title.trim()
  const desc = opts.description.trim()
  if (!title || !desc) return null
  const asciiSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug =
    asciiSlug ||
    `plugin-${Array.from(title)
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)
      .toString(36)}`
  const lines = [
    '---',
    `name: ${slug}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(desc)}`,
    `scene: ${opts.scene}`,
  ]
  if (opts.example.trim()) lines.push(`examples: [${JSON.stringify(opts.example.trim())}]`)
  lines.push('---', '', opts.body.trim() || `# ${title}\n\n${desc}`)
  return lines.join('\n')
}

/**
 * 我的发布与上架: switches between listing management and the dual-track publish wizard
 * with live store card preview & pre-publish checklist.
 */
export function MyListings({
  onOpen,
  initialMode = 'list',
  onModeChange,
}: {
  onOpen?: (l: MyListingDto) => void
  initialMode?: 'list' | 'create'
  onModeChange?: (mode: 'list' | 'create') => void
}) {
  const { data, error, reload } = useGet<MyListingDto[]>('/market/mine')
  const upstream = useGet<UpstreamMovedDto[]>(data?.some((l) => l.ghSource) ? '/market/mine/upstream' : null)
  const [mode, setMode] = useState<'list' | 'create'>(initialMode)
  const [submitting, setSubmitting] = useState<MyListingDto | null>(null)
  const [unlisting, setUnlisting] = useState<MyListingDto | null>(null)
  const patching = useRowLocks()
  const checking = useRowLocks()
  const [filter, setFilter] = useState<Filter>('all')
  const [modeSeen, setModeSeen] = useState({ mode, swapped: false })
  if (modeSeen.mode !== mode) setModeSeen({ mode, swapped: true })
  const modeSwap = modeSeen.swapped ? 'ui-panel-swap' : undefined

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  const switchMode = (next: 'list' | 'create') => {
    setMode(next)
    onModeChange?.(next)
  }

  const patch = async (l: MyListingDto, body: UpdateListingReq) => {
    const ok = await patching.run(l.id, () => attempt(() => api.patch(`/market/${l.id}`, body)))
    if (ok) reload()
  }

  const checkUpstream = async (l: MyListingDto) => {
    const res = await checking.run(l.id, () =>
      api.post<CheckUpstreamRes>(`/market/${l.id}/check-upstream`).catch((e) => {
        toastError(e)
        return null
      }),
    )
    if (!res) return
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

  if (mode === 'create') {
    return (
      <div key={mode} className={cx('mkt-content', modeSwap)}>
        <section className="mkt-head">
          <div className="mkt-head__titles">
            <h1 className="mkt-head__title">{t('发布插件到市场')}</h1>
            <p className="mkt-head__sub">
              {t('一段工作方法或一个完整工具包都可以发布；右侧可实时预览上架后的卡片效果。')}
            </p>
          </div>
          <Button onClick={() => switchMode('list')}>{t('返回我的发布')}</Button>
        </section>
        <PublishWizard
          onDone={() => {
            reload()
            switchMode('list')
          }}
        />
      </div>
    )
  }

  return (
    <div key={mode} className={cx('mkt-content mkt-content--narrow', modeSwap)}>
      <section className="mkt-head">
        <div className="mkt-head__titles">
          <h1 className="mkt-head__title">{t('我的发布')}</h1>
          <p className="mkt-head__sub">
            {t('你维护的团队插件和草稿都在这里，发布后先存草稿，审核通过即上架。')}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => switchMode('create')}>
          {t('发布新插件')}
        </Button>
      </section>

      {data?.length ? (
        <div className="mkt-section-head">
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
        </div>
      ) : null}

      {error ? <Alert variant="error" title={error} onRetry={reload} /> : null}

      {!data ? (
        error ? null : (
          <Spinner />
        )
      ) : data.length ? (
        shown.length ? (
          <div className="mkt-group-box">
            {shown.map((l) => (
              <div key={l.id} className="mkt-req-row">
                <ListingIcon type={l.type} size={38} listing={l} />
                <div>
                  <div className="cfg__name-line">
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
                  </div>
                  <div className="mkt-row__meta">
                    {[
                      VISIBILITY_LABEL[l.visibility],
                      t('更新于 {time}', { time: ago(l.latest.createdAt) }),
                    ].join(' · ')}
                  </div>
                  {l.status === 'banned' && l.banReason ? (
                    <div className="mkt-row__warn">{t('封禁原因：{reason}', { reason: l.banReason })}</div>
                  ) : l.latest.reviewStatus === 'rejected' && l.latest.reviewNote ? (
                    <div className="mkt-row__warn">
                      {t('驳回原因：{note}', { note: l.latest.reviewNote })}
                    </div>
                  ) : l.description ? (
                    <div className="mkt-row__meta">{l.description}</div>
                  ) : null}
                </div>
                <div className="mkt-row__controls">
                  {l.ghSource ? (
                    <Button
                      size="small"
                      className={movedOf(l) ? 'mkt-btn-soft' : undefined}
                      loading={checking.busy.has(l.id)}
                      disabled={checking.busy.has(l.id)}
                      onClick={() => void checkUpstream(l)}
                    >
                      {movedOf(l) ? t('同步上游更新') : t('检查上游更新')}
                    </Button>
                  ) : null}
                  {l.listedVersionId && l.status !== 'banned' ? (
                    <Button
                      size="small"
                      loading={l.status !== 'listed' && patching.busy.has(l.id)}
                      disabled={patching.busy.has(l.id)}
                      onClick={() =>
                        l.status === 'listed' ? setUnlisting(l) : void patch(l, { status: 'listed' })
                      }
                    >
                      {l.status === 'listed' ? t('下架') : t('重新上架')}
                    </Button>
                  ) : null}
                  {l.listedVersionId ? null : (
                    <Button
                      size="small"
                      variant="plain"
                      loading={patching.busy.has(l.id)}
                      disabled={patching.busy.has(l.id)}
                      onClick={() =>
                        void patch(l, { visibility: l.visibility === 'public' ? 'team' : 'public' })
                      }
                    >
                      {l.visibility === 'public' ? t('设为仅本团队') : t('设为公开')}
                    </Button>
                  )}
                  {onOpen ? (
                    <Button size="small" onClick={() => onOpen(l)}>
                      {t('详情')}
                    </Button>
                  ) : null}
                  {l.latest.reviewStatus === 'draft' || l.latest.reviewStatus === 'rejected' ? (
                    <Button size="small" variant="primary" onClick={() => setSubmitting(l)}>
                      {t('提交审核')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact icon="tag" title={t('没有这个状态的条目')} />
        )
      ) : (
        <div className="mkt-empty-box">
          <EmptyState
            illustration={<NoPluginsArt />}
            title={t('还没有发布过插件')}
            description={t(
              '支持写一段能力说明、上传文件夹或 ZIP，或导入 GitHub 仓库；同团队同名即发布新版本。',
            )}
            action={
              <Button variant="primary" onClick={() => switchMode('create')}>
                {t('发布新插件')}
              </Button>
            }
          />
        </div>
      )}

      <Presence>
        {submitting ? (
          <SubmitDialog
            listing={submitting}
            onClose={() => setSubmitting(null)}
            onDone={() => {
              setSubmitting(null)
              reload()
            }}
          />
        ) : unlisting ? (
          <ConfirmActionDialog
            title={t('下架「{name}」？', { name: unlisting.title })}
            message={t('下架后市场里不再显示这个条目，也不能新引入；可随时重新上架。')}
            consequences={[t('已引入的地方会保留当前版本并继续使用'), t('不会再收到后续新版本更新')]}
            label={t('下架')}
            done={t('已下架「{name}」', { name: unlisting.title })}
            run={() => api.patch(`/market/${unlisting.id}`, { status: 'unlisted' })}
            onDone={() => {
              setUnlisting(null)
              reload()
            }}
            onClose={() => setUnlisting(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

/** Dual-track publish wizard with live store card preview & pre-publish checklist. */
function PublishWizard({ onDone }: { onDone: () => void }) {
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const [teamId, setTeamId] = useState(teams.find((x) => x.id === storedTeam())?.id ?? teams[0]?.id ?? '')
  const [visibility, setVisibility] = useState<ListingVisibility>('team')
  const [track, setTrack] = useState<PublishTrack>('light')
  const [rawPaste, setRawPaste] = useState(false)

  // Track 1: Guided light plugin fields
  const [title, setTitle] = useState('')
  const [scene, setScene] = useState<MarketScene>('office')
  const [description, setDescription] = useState('')
  const [example, setExample] = useState('')
  const [body, setBody] = useState('')
  const [rawMd, setRawMd] = useState('')

  // Track 2: Package / GitHub
  const [pkgSource, setPkgSource] = useState<PackageSource>('folder')
  const [files, setFiles] = useState<SkillFile[] | null>(null)
  const [url, setUrl] = useState('')
  const [changelog, setChangelog] = useState('')
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const [error, setError] = useState('')

  const folder = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const readSeq = useRef(0)

  const readFiles = async (load: Promise<SkillFile[]>) => {
    const mine = ++readSeq.current
    try {
      const next = await load
      if (mine !== readSeq.current) return
      setFiles(next.length ? next : null)
      setError(next.length ? '' : t('没有读到文件'))
    } catch (e) {
      if (mine !== readSeq.current) return
      setFiles(null)
      setError(t('无法读取：{e}', { e: errorText(e) }))
    }
  }

  const lightMd = rawPaste ? rawMd.trim() : buildGuidedSkillMd({ title, description, scene, example, body })
  const upload: SkillFile[] | null =
    track === 'light'
      ? lightMd
        ? [{ path: 'SKILL.md', content: lightMd, encoding: 'utf8' }]
        : null
      : pkgSource === 'github'
        ? null
        : files

  const check = usePreflight(teamId, visibility, upload)
  const isGithub = track === 'package' && pkgSource === 'github'
  const ready = !!teamId && (isGithub ? !!url.trim() : !!check.result && check.result.kind !== 'unchanged')

  const save = async (andSubmit: boolean) => {
    if (busy || !ready) return
    setBusy(andSubmit ? 'submit' : 'draft')
    setError('')
    try {
      const saved = isGithub
        ? await api.post<PublishRes>('/market/import/github', { teamId, visibility, url: url.trim() })
        : await api.post<PublishRes>('/market', { teamId, visibility, files: upload })

      if (andSubmit && !saved.unchanged && saved.listing.latest.reviewStatus === 'draft') {
        await api.post(`/market/${saved.listing.id}/versions/${saved.listing.latest.id}/submit`, {
          changelog: changelog.trim(),
        })
        toast({
          type: 'success',
          message: t('已保存并提交审核「{name}」', { name: saved.listing.title }),
        })
      } else if (saved.unchanged) {
        toast({
          type: 'info',
          message: t('和最新上传的 r{n} 完全一样，没有生成新版本', { n: saved.listing.latest.revision }),
        })
      } else {
        toast({
          type: 'success',
          message: t('已保存「{name}」草稿 r{n}', {
            name: saved.listing.title,
            n: saved.listing.latest.revision,
          }),
        })
      }
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(null)
    }
  }

  const teamName = teams.find((x) => x.id === teamId)?.name ?? t('本团队')
  const previewTitle = check.result?.title || title.trim() || t('未命名插件')
  const previewDesc =
    check.result?.description || description.trim() || t('填写一句话简介，让同事一眼看懂它能帮什么忙。')
  const hasGoodMeta = Boolean(
    (check.result?.title || title.trim()) && (check.result?.description || description.trim()),
  )
  const hasWarnings = (check.result?.warnings.length ?? 0) > 0

  return (
    <div className="mkt-create-grid">
      <div className="mkt-create-panel">
        {error ? <Alert variant="error" title={error} /> : null}

        <div className="mkt-tracks" role="radiogroup" aria-label={t('发布方式')}>
          <label className={`mkt-track${track === 'light' ? ' mkt-track--on' : ''}`}>
            <input
              type="radio"
              name="mkt-publish-track"
              checked={track === 'light'}
              disabled={!!busy}
              onChange={() => {
                setTrack('light')
                setError('')
              }}
            />
            <strong className="mkt-row__name">{t('轻量能力（粘贴即可）')}</strong>
            <p className="mkt-track__desc">{t('把工作规范、写作模板或审查要点写成说明，1 分钟发布。')}</p>
          </label>
          <label className={`mkt-track${track === 'package' ? ' mkt-track--on' : ''}`}>
            <input
              type="radio"
              name="mkt-publish-track"
              checked={track === 'package'}
              disabled={!!busy}
              onChange={() => {
                setTrack('package')
                setError('')
              }}
            />
            <strong className="mkt-row__name">{t('完整插件包 / GitHub')}</strong>
            <p className="mkt-track__desc">{t('上传含外部服务、快捷指令或创作模板的目录、ZIP 或仓库。')}</p>
          </label>
        </div>

        {track === 'light' ? (
          <>
            <div className="mkt-section-head">
              <span className="cfg__eyebrow">{rawPaste ? t('粘贴说明原文') : t('插件说明')}</span>
              <span className="spacer" />
              <Button size="small" variant="plain" onClick={() => setRawPaste((v) => !v)}>
                {rawPaste ? t('切回表单填写') : t('直接粘贴原文')}
              </Button>
            </div>
            {rawPaste ? (
              <TextArea
                aria-label={t('插件说明原文')}
                placeholder={'---\nname: my-plugin\ndescription: …\n---\n'}
                rows={10}
                disabled={!!busy}
                value={rawMd}
                onChange={(e) => setRawMd(e.target.value)}
              />
            ) : (
              <>
                <div className="mkt-row2">
                  <TextField
                    label={t('插件名称')}
                    placeholder={t('例如：合同风险初审')}
                    disabled={!!busy}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <div className="ui-field">
                    <span className="ui-field__label">{t('场景分类')}</span>
                    <PopUpButton<MarketScene>
                      aria-label={t('场景分类')}
                      value={scene}
                      disabled={!!busy}
                      onChange={setScene}
                      options={SCENES.map((s) => ({ value: s.id, label: s.label }))}
                    />
                  </div>
                </div>
                <TextField
                  label={t('一句话简介（展示在市场卡片）')}
                  placeholder={t('例如：上传采购或合作协议，按法务清单标出付款与违约风险。')}
                  disabled={!!busy}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <TextField
                  label={t('试试这样问（选填，让同事一看就会用）')}
                  placeholder={t('例如：帮我按公司标准审一下这份供应商合同的违约条款')}
                  disabled={!!busy}
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                />
                <TextArea
                  label={t('具体规则与工作步骤')}
                  placeholder={t('告诉 Bot 遇到什么问题该按哪些步骤做、输出什么格式…')}
                  rows={6}
                  disabled={!!busy}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </>
            )}
          </>
        ) : (
          <>
            <SegmentedControl<PackageSource>
              aria-label={t('来源')}
              value={pkgSource}
              onChange={(s) => {
                readSeq.current++
                setPkgSource(s)
                setFiles(null)
                setError('')
              }}
              items={[
                { value: 'folder', label: t('文件夹'), disabled: !!busy },
                { value: 'zip', label: 'ZIP', disabled: !!busy },
                { value: 'github', label: t('GitHub 链接'), disabled: !!busy },
              ]}
            />
            {pkgSource === 'folder' ? (
              <div className="mkt-upload-zone">
                <Icon name="upload" size={20} />
                <div className="mkt-source">
                  <Button size="small" disabled={!!busy} onClick={() => folder.current?.click()}>
                    {t('选择文件夹…')}
                  </Button>
                  <FolderInput inputRef={folder} onFiles={(fs) => void readFiles(folderSkillFiles(fs))} />
                  {files ? <span>{t('已读取 {n} 个文件', { n: files.length })}</span> : null}
                </div>
                <span className="mkt-row__meta">
                  {t('支持选择包含插件清单或说明文件的目录；同团队同名即发布新版本。')}
                </span>
              </div>
            ) : pkgSource === 'zip' ? (
              <div className="mkt-upload-zone">
                <Icon name="upload" size={20} />
                <div className="mkt-source">
                  <Button size="small" disabled={!!busy} onClick={() => zip.current?.click()}>
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
                      if (f) void readFiles(zipSkillFiles(f))
                      e.target.value = ''
                    }}
                  />
                  {files ? <span>{t('已读取 {n} 个文件', { n: files.length })}</span> : null}
                </div>
                <span className="mkt-row__meta">
                  {t('上传打包好的 ZIP 压缩包；同团队同名即发布新版本。')}
                </span>
              </div>
            ) : (
              <TextField
                label={t('GitHub 链接')}
                placeholder="https://github.com/<owner>/<repo>/tree/<ref>/<path>"
                disabled={!!busy}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </>
        )}

        {teams.length > 1 ? (
          <div>
            <div className="cfg__eyebrow">{t('归属团队')}</div>
            <RadioGroup
              aria-label={t('团队')}
              direction="row"
              disabled={!!busy}
              value={teamId}
              onChange={setTeamId}
              options={teams.map((x) => ({ value: x.id, label: x.name }))}
            />
          </div>
        ) : null}

        <div>
          <div className="cfg__eyebrow">{t('可见范围')}</div>
          <RadioGroup<ListingVisibility>
            aria-label={t('可见范围')}
            direction="row"
            disabled={!!busy}
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'team', label: t('仅本团队（团队管理员审核）') },
              { value: 'public', label: t('公开到全平台（系统管理员审核）') },
            ]}
          />
        </div>

        <TextField
          label={t('更新说明（选填）')}
          placeholder={t('这个版本改了什么，审核人和同事都会看到')}
          disabled={!!busy}
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
        />

        {check.error ? (
          <Alert variant="error" title={check.error} retrying={check.loading} onRetry={check.retry} />
        ) : null}
        {check.result ? <Preflight result={check.result} visibility={visibility} /> : null}

        <div className="mkt-create-foot">
          <Button disabled={!ready || !!busy} loading={busy === 'draft'} onClick={() => void save(false)}>
            {t('存为草稿')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready || !!busy}
            loading={busy === 'submit'}
            onClick={() => void save(true)}
          >
            {t('保存并提交审核')}
          </Button>
        </div>
      </div>

      <aside className="mkt-preview-box" aria-label={t('商店卡片预览')}>
        <div className="mkt-preview-box__h">{t('上架后在市场里的样子')}</div>
        <article className="mkt-pcard">
          <div className="mkt-pcard__top">
            <ListingIcon type={check.result?.type ?? 'skill'} size={38} />
            <div className="mkt-pcard__who">
              <strong className="mkt-row__name">{previewTitle}</strong>
              <span className="mkt-pcard__src mkt-pcard__src--team">
                <Icon name="person-2" size={12} />
                {visibility === 'public' ? t('公开社区') : `${t('本团队')} · ${teamName}`}
              </span>
            </div>
          </div>
          <p className="mkt-pcard__desc">{previewDesc}</p>
          <CapabilityChips capabilities={['do']} readiness="ready" />
        </article>

        <div className="mkt-preview-box__h">{t('上架前自动体检')}</div>
        <ul className="mkt-check-list">
          <li>
            <span className={hasGoodMeta ? 'mkt-check-list__ok' : 'mkt-check-list__warn'}>
              <Icon name={hasGoodMeta ? 'check' : 'info'} size={14} />
            </span>
            <span>{t('清晰的中文名称与一句话简介')}</span>
          </li>
          <li>
            <span className={example.trim() ? 'mkt-check-list__ok' : 'mkt-check-list__warn'}>
              <Icon name={example.trim() ? 'check' : 'info'} size={14} />
            </span>
            <span>
              {example.trim() ? t('已提供「试试这样问」示例') : t('建议补充 1 条「试试这样问」示例')}
            </span>
          </li>
          <li>
            <span className={hasWarnings ? 'mkt-check-list__warn' : 'mkt-check-list__ok'}>
              <Icon name={hasWarnings ? 'warning' : 'check'} size={14} />
            </span>
            <span>
              {hasWarnings ? t('检测到潜在密钥或本机路径，请核查') : t('未检测到硬编码密钥或本机绝对路径')}
            </span>
          </li>
          <li>
            <span className="mkt-check-list__ok">
              <Icon name="shield-check" size={14} />
            </span>
            <span>
              {check.result?.type === 'plugin'
                ? t('完整插件包，将按权限自动检查')
                : t('纯说明型插件，无需电脑运行授权')}
            </span>
          </li>
        </ul>
      </aside>
    </div>
  )
}

function SubmitDialog({
  listing,
  onClose,
  onDone,
}: {
  listing: MyListingDto
  onClose: () => void
  onDone: () => void
}) {
  const [changelog, setChangelog] = useState(listing.latest.changelog ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    if (!busy) onClose()
  }
  const submit = async () => {
    if (busy) return
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
    <Dialog
      open
      title={t('提交审核 {name}', { name: listing.title })}
      width={480}
      closeOnScrim={false}
      onClose={close}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('提交审核'),
          variant: 'primary',
          disabled: busy,
          loading: busy,
          onClick: () => void submit(),
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <TextArea
        label={t('更新说明')}
        aria-label={t('更新说明')}
        placeholder={t('这个版本改了什么，审核人和引入者都会看到')}
        maxLength={2000}
        disabled={busy}
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
      />
    </Dialog>
  )
}

function usePreflight(teamId: string, visibility: ListingVisibility, files: SkillFile[] | null) {
  const [state, setState] = useState<{ result: PublishPreflightRes | null; error: string; loading: boolean }>(
    { result: null, error: '', loading: false },
  )
  const [tick, setTick] = useState(0)
  const retried = useRef(false)
  const body = files && teamId ? JSON.stringify({ teamId, visibility, files }) : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` retries
  useEffect(() => {
    const retry = retried.current
    retried.current = false
    setState((s) => ({ result: null, error: retry ? s.error : '', loading: !!body }))
    if (!body) return
    let live = true
    const id = setTimeout(
      () => {
        api.post<PublishPreflightRes>('/market/preflight', JSON.parse(body)).then(
          (result) => live && setState({ result, error: '', loading: false }),
          (e) => live && setState({ result: null, error: errorText(e), loading: false }),
        )
      },
      retry ? 0 : 300,
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [body, tick])
  return {
    ...state,
    retry: () => {
      retried.current = true
      setTick((n) => n + 1)
    },
  }
}

function Preflight({
  result: r,
  visibility,
}: {
  result: PublishPreflightRes
  visibility: ListingVisibility
}) {
  return (
    <>
      <Alert
        variant={r.kind === 'unchanged' ? 'warning' : 'info'}
        title={
          r.kind === 'new'
            ? t('将新建插件「{name}」，保存为草稿 r{n}', { name: r.title, n: r.revision })
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
      {r.warnings.length ? (
        <Alert
          variant="warning"
          title={t('请确认没有泄露密钥或本机路径')}
          description={
            <ul className="mkt-warnings">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
        />
      ) : null}
    </>
  )
}
