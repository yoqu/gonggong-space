import type { GitCommit, GitCompareDto, GitShowDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { fullTime } from '../../../lib/time'
import { Button, EmptyState, Icon, type MenuItem, PopUpButton, Spinner } from '../../../ui'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { openTab } from '../../workbench/open'
import { type GitTarget, gitBase, gitUrls, useGitGet } from '../api'
import type { TreeChange } from '../ChangeTree'
import { type GitCommands, gitCommands } from '../commands'
import { parseRefs } from '../refs'
import { Split } from '../Split'
import { EMPTY_TREE } from '../StashView'
import { ChangesPane, defaultChange } from './ChangesPane'

/** Branches named before 显示全部. */
const BRANCHES_SHOWN = 6

/** A rebased or amended commit was committed later than authored. */
const committedApart = (c: GitCommit, d: GitShowDto) =>
  d.committer !== c.author ||
  d.committerEmail !== c.email ||
  Math.abs(Date.parse(d.committedAt) - Date.parse(c.at)) >= 60_000

/** IDEA's commit details: the whole message, hash, parents, author and committer, tags, branches containing it. */
function CommitInfo({
  commit,
  show,
  remotes,
  cmd,
  onJump,
}: {
  commit: GitCommit
  show: { data: GitShowDto | null; error: string | null }
  remotes: readonly string[]
  cmd: GitCommands
  onJump: (hash: string) => void
}) {
  const [allBranches, setAllBranches] = useState(false)
  const d = show.data?.commit.hash === commit.hash ? show.data : null
  const message = d?.body.trim() ?? ''
  const body = message.includes('\n') ? message.slice(message.indexOf('\n') + 1).trim() : ''
  const tags = parseRefs(commit.refs, remotes).filter((r) => r.kind === 'tag')
  const branches = d?.branches ?? []
  const committer = d && committedApart(commit, d) ? d : null
  return (
    <section className="glog-info" aria-label={t('提交详情')}>
      <h3 className="glog-info__subject">{commit.subject}</h3>
      {body ? <div className="glog-info__body">{body}</div> : null}
      <dl className="glog-info__meta">
        <dt>{t('哈希')}</dt>
        <dd className="glog-info__hashrow">
          <code className="glog-info__hash">{commit.hash}</code>
          <button
            type="button"
            className="glog-tool glog-tool--small"
            aria-label={t('复制提交哈希')}
            title={t('复制提交哈希')}
            onClick={() => cmd.copy(commit.hash)}
          >
            <Icon name="copy" size={12} />
          </button>
        </dd>
        {commit.parents.length ? (
          <>
            <dt>{t('父提交')}</dt>
            <dd>
              {commit.parents.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="glog-info__link"
                  aria-label={t('转到父提交 {hash}', { hash: p.slice(0, 7) })}
                  onClick={() => onJump(p)}
                >
                  {p.slice(0, 7)}
                </button>
              ))}
            </dd>
          </>
        ) : null}
        <dt>{t('作者')}</dt>
        <dd>
          <span>
            {commit.author} &lt;{commit.email}&gt;
          </span>
          <span className="glog-info__time">{fullTime(commit.at)}</span>
        </dd>
        {committer ? (
          <>
            <dt>{t('提交者')}</dt>
            <dd>
              <span>
                {committer.committer} &lt;{committer.committerEmail}&gt;
              </span>
              <span className="glog-info__time">{fullTime(committer.committedAt)}</span>
            </dd>
          </>
        ) : null}
        {tags.length ? (
          <>
            <dt>{t('标签')}</dt>
            <dd>
              {tags.map((tag) => (
                <span key={tag.name} className="glog-ref" data-ref="tag">
                  <Icon name="tag" size={10} />
                  <span className="glog-ref__text">{tag.name}</span>
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      {branches.length ? (
        <div className="glog-info__branches">
          <span className="glog-info__label">{t('包含于 {n} 个分支', { n: branches.length })}</span>
          {(allBranches ? branches : branches.slice(0, BRANCHES_SHOWN)).map((b) => (
            <span key={b} className="glog-info__branch" data-testid="commit-branch">
              {b}
            </span>
          ))}
          {!allBranches && branches.length > BRANCHES_SHOWN ? (
            <button type="button" className="glog-info__more" onClick={() => setAllBranches(true)}>
              {t('显示全部')}
            </button>
          ) : null}
        </div>
      ) : null}
      {show.error ? <div className="glog-note glog-note--error">{show.error}</div> : null}
    </section>
  )
}

/**
 * A commit's changed files (against the first parent, or the parent picked for a merge) over its details, as in IDEA,
 * beside the picked file's diff. On a phone the details (then the files) and the diff take the tab in turn: `file`
 * set shows its diff.
 */
export function CommitDetails({
  target,
  commit,
  show,
  remotes,
  file,
  historyPath,
  narrow,
  onFile,
  onJump,
  onBack,
}: {
  target: GitTarget
  commit: GitCommit
  show: { data: GitShowDto | null; error: string | null }
  remotes: readonly string[]
  /** The file shown; null = the history's file or the first (on a phone: none). */
  file: string | null
  historyPath: string | null
  narrow: boolean
  onFile: (path: string | null) => void
  onJump: (hash: string) => void
  /** Phone: back to the list. */
  onBack: () => void
}) {
  const base = gitBase(target.groupId, target.botId)
  const cmd = gitCommands(target)
  const [parentAt, setParentAt] = useState(0)
  const from = commit.parents[parentAt] ?? EMPTY_TREE
  const compare = useGitGet<GitCompareDto>(gitUrls.compare(base, from, commit.hash, target.repo))
  const list = compare.data?.changes ?? null
  const picked =
    list?.find((c) => c.path === file) ?? (narrow || !list ? undefined : defaultChange(list, historyPath))

  // A deleted file is opened as its parent had it.
  const openVersion = (c: TreeChange) =>
    openTab({
      kind: 'file',
      source: { botId: target.botId, path: c.path, rev: c.change === 'deleted' ? from : commit.hash },
    })
  const showDiff = (c: TreeChange) =>
    openTab({
      kind: 'git-compare',
      botId: target.botId,
      repo: target.repo,
      from,
      to: commit.hash,
      file: c.path,
    })
  const fileItems = (c: TreeChange): MenuItem[] => [
    { value: 'diff', label: t('显示差异'), icon: 'doc-text' },
    // The file tab reads versions of the root repo only.
    { value: 'open', label: t('打开此版本'), icon: 'doc', disabled: !!target.repo },
    { value: 'local', label: t('与本地比较'), icon: 'git-compare', disabled: c.change === 'deleted' },
  ]
  const onFileItem = (value: string, c: TreeChange) => {
    if (value === 'diff') showDiff(c)
    else if (value === 'open') openVersion(c)
    else if (value === 'local')
      openTab({
        kind: 'git-compare',
        botId: target.botId,
        repo: target.repo,
        from: commit.hash,
        to: null,
        file: c.path,
      })
  }

  const info = <CommitInfo commit={commit} show={show} remotes={remotes} cmd={cmd} onJump={onJump} />
  const files = (
    <ChangesPane
      target={target}
      changes={list}
      error={compare.error}
      selected={picked?.path ?? null}
      onSelect={(c) => onFile(c.path)}
      onOpen={showDiff}
      fileItems={fileItems}
      onFileItem={onFileItem}
      group={t('提交 {hash}', { hash: commit.shortHash })}
      extra={
        commit.parents.length > 1 ? (
          <PopUpButton
            size="small"
            aria-label={t('比较的父提交')}
            value={String(parentAt)}
            onChange={(v) => setParentAt(Number(v))}
            options={commit.parents.map((p, i) => ({
              value: String(i),
              label: t('父提交 {n} · {hash}', { n: i + 1, hash: p.slice(0, 7) }),
            }))}
          />
        ) : null
      }
    />
  )
  const diff = picked ? (
    <GitFileDiff
      key={`${from}:${picked.path}`}
      url={gitUrls.diff(base, from, commit.hash, picked.path, target.repo, picked.oldPath)}
      path={picked.path}
      actions={
        target.repo ? undefined : (
          <Button size="small" variant="plain" icon="doc" onClick={() => openVersion(picked)}>
            {t('打开此版本')}
          </Button>
        )
      }
    />
  ) : list ? (
    <EmptyState compact icon="doc-text" title={list.length ? t('选择一个文件查看改动') : t('没有文件变化')} />
  ) : (
    <div className="glog-note">
      <Spinner />
    </div>
  )

  if (narrow && file)
    return (
      <div className="glog-page">
        <div className="glog-page__bar">
          <Button
            size="small"
            variant="plain"
            icon="chevron-left"
            aria-label={t('返回提交详情')}
            onClick={() => onFile(null)}
          >
            {commit.shortHash}
          </Button>
          <span className="glog-page__title" title={file}>
            {file}
          </span>
        </div>
        <div className="glog-diff">
          {picked || !list ? diff : <EmptyState compact icon="doc" title={t('这个提交没有改动此文件')} />}
        </div>
      </div>
    )
  if (narrow)
    return (
      <div className="glog-page">
        <div className="glog-page__bar">
          <Button size="small" variant="plain" icon="chevron-left" onClick={onBack}>
            {t('全部提交')}
          </Button>
        </div>
        <div className="glog-page__body">
          {info}
          {files}
        </div>
      </div>
    )
  return (
    <Split
      storageKey="gg.git.log.files"
      initial={340}
      min={240}
      label={t('调整列表宽度')}
      first={
        <Split
          dir="column"
          storageKey="gg.git.log.changes"
          initial={220}
          min={96}
          label={t('调整变更文件高度')}
          first={<div className="glog-detail">{files}</div>}
          second={<div className="glog-detail">{info}</div>}
        />
      }
      second={<div className="glog-diff">{diff}</div>}
    />
  )
}
