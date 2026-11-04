import type {
  CheckUpstreamRes,
  ListingVisibility,
  MyListingDto,
  PublishRes,
  SkillFile,
  UpdateListingReq,
} from '@gonggong/protocol'
import { useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt, toastError } from '../../lib/errors'
import { storedTeam } from '../../lib/team'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
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
import { TYPE_LABEL } from './InstallList'
import { ReviewTag } from './ListingDetail'
import '../config/config.css'
import '../groups/groups.css'

const VISIBILITY_LABEL: Record<ListingVisibility, string> = { public: t('公开'), team: t('仅本团队') }

/** 我的发布: the listings I maintain, their latest version's review, and publishing new ones. */
export function MyListings() {
  const { data, error, reload } = useGet<MyListingDto[]>('/market/mine')
  const [publishing, setPublishing] = useState(false)
  const [submitting, setSubmitting] = useState<MyListingDto | null>(null)
  const patch = (l: MyListingDto, body: UpdateListingReq) =>
    attempt(() => api.patch(`/market/${l.id}`, body)).then(reload)
  const checkUpstream = async (l: MyListingDto) => {
    let res: CheckUpstreamRes
    try {
      res = await api.post<CheckUpstreamRes>(`/market/${l.id}/check-upstream`)
    } catch (e) {
      return toastError(e)
    }
    toast({
      type: res.changed ? 'success' : 'info',
      message: res.changed
        ? t('上游有更新（{commit}），已生成新草稿', { commit: res.commit.slice(0, 7) })
        : t('上游没有变化'),
    })
    if (res.changed) reload()
  }

  return (
    <div className="mkt-mine">
      <div className="cfg__foot">
        <span className="gs-note">{t('发布后先存为草稿，提交审核通过后才会出现在市场。')}</span>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setPublishing(true)}>
          {t('发布…')}
        </Button>
      </div>
      {error ? <Alert variant="error" title={error} /> : null}
      {!data ? (
        error ? null : (
          <Spinner />
        )
      ) : data.length ? (
        <GroupBox>
          {data.map((l) => (
            <GroupRow
              key={l.id}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{l.title}</span>
                  <Tag tone="blue">{TYPE_LABEL[l.type]}</Tag>
                  <Tag tone="gray">r{l.latest.revision}</Tag>
                  <ReviewTag status={l.latest.reviewStatus} />
                  <Tag tone="gray">{VISIBILITY_LABEL[l.visibility]}</Tag>
                  {l.status === 'banned' ? (
                    <Tag tone="red">{t('已封禁')}</Tag>
                  ) : !l.listedVersionId ? (
                    <Tag tone="gray">{t('未上架')}</Tag>
                  ) : l.status === 'listed' ? (
                    <Tag tone="green">{t('已上架')}</Tag>
                  ) : (
                    <Tag tone="orange">{t('已下架')}</Tag>
                  )}
                </span>
              }
              description={
                l.status === 'banned' && l.banReason
                  ? t('封禁原因：{reason}', { reason: l.banReason })
                  : l.latest.reviewStatus === 'rejected' && l.latest.reviewNote
                    ? t('驳回原因：{note}', { note: l.latest.reviewNote })
                    : l.description
              }
            >
              <span className="cfg__controls">
                {l.latest.reviewStatus === 'draft' || l.latest.reviewStatus === 'rejected' ? (
                  <Button size="small" onClick={() => setSubmitting(l)}>
                    {t('提交审核')}
                  </Button>
                ) : null}
                {l.ghSource ? (
                  <Button size="small" variant="plain" onClick={() => void checkUpstream(l)}>
                    {t('检查上游更新')}
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
              </span>
            </GroupRow>
          ))}
        </GroupBox>
      ) : (
        <div className="gs-note">{t('还没有发布过 Skill 或插件')}</div>
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
  const ready = !!teamId && (source === 'github' ? !!url.trim() : source === 'paste' ? !!pasted : !!files)
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      setSaved(
        source === 'github'
          ? await api.post<PublishRes>('/market/import/github', { teamId, visibility, url: url.trim() })
          : await api.post<PublishRes>('/market', {
              teamId,
              visibility,
              files: source === 'paste' ? pasted : files,
            }),
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
          <Alert
            variant="success"
            title={t('已保存「{name}」草稿 r{n}', {
              name: saved.listing.title,
              n: saved.listing.latest.revision,
            })}
          />
          {saved.warnings.length ? (
            <Alert
              variant="warning"
              title={t('请确认没有泄露密钥或本机路径')}
              description={
                <ul className="mkt-warnings">
                  {saved.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <SubmitForm
            listing={saved.listing}
            cancelLabel={t('稍后提交')}
            onCancel={onClose}
            onDone={onClose}
          />
        </>
      ) : (
        <>
          <div className="cfg__eyebrow">{t('团队')}</div>
          <RadioGroup
            aria-label={t('团队')}
            direction="row"
            value={teamId}
            onChange={setTeamId}
            options={teams.map((x) => ({ value: x.id, label: x.name }))}
          />
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
        </>
      )}
    </Dialog>
  )
}
