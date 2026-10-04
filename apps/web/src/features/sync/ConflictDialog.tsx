import type { SyncConflictDto, SyncDecision } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import {
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  GroupBox,
  Presence,
  SegmentedControl,
  Spinner,
  toast,
} from '../../ui'
import { DiffView } from '../diff/DiffParts'
import { lineDiff } from './diff'
import { syncApi } from './store'
import './sync.css'

type File = SyncConflictDto['files'][number]
type Choice = SyncDecision['choice']

const canMerge = (f: File) => !f.binary && !!f.mineHash && !!f.theirsHash

/** base → mine and base → theirs of one text file (§3.3 三方 diff 预览). */
function Preview({ groupId, c, f }: { groupId: string; c: SyncConflictDto; f: File }) {
  const [sides, setSides] = useState<[string, string, string] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const text = (hash: string | null) => (hash ? syncApi.text(groupId, c.id, hash) : Promise.resolve(''))
    Promise.all([text(f.baseHash), text(f.mineHash), text(f.theirsHash)]).then(setSides, (e) =>
      setError(errorText(e)),
    )
  }, [groupId, c.id, f])
  if (error) return <div className="sync-muted">{error}</div>
  if (!sides) return <Spinner />
  const [base, mine, theirs] = sides
  const view = (title: string, to: string) => (
    <div className="sync-conflict__side">
      <div className="sync-muted">{title}</div>
      <DiffView
        file={{ path: f.path, status: 'modified', add: 0, del: 0, binary: false, lines: lineDiff(base, to) }}
      />
    </div>
  )
  return (
    <div className="sync-conflict__preview">
      {view(t('我的改动（相对 v{v}）', { v: c.versionBase }), mine)}
      {view(t('最新版本的改动（v{v}）', { v: c.headVersion }), theirs)}
    </div>
  )
}

function FileRow({
  groupId,
  c,
  f,
  choice,
  onChoice,
}: {
  groupId: string
  c: SyncConflictDto
  f: File
  choice: Choice | undefined
  onChoice: (c: Choice) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sync-conflict__file" data-testid={`conflict-${f.path}`}>
      <div className="sync-row">
        <span className="sync-row__main">
          <span className="sync-row__title sync-mono">{f.path}</span>
          {f.binary ? <span className="sync-muted">{t('二进制文件')}</span> : null}
        </span>
        <span className="sync-row__meta">
          {f.binary ? null : (
            <Button size="small" variant="plain" onClick={() => setOpen(!open)}>
              {open ? t('收起预览') : t('预览')}
            </Button>
          )}
          <SegmentedControl<Choice>
            size="small"
            aria-label={t('{path} 的处理方式', { path: f.path })}
            value={choice}
            onChange={onChoice}
            items={[
              { value: 'mine', label: t('保留我的') },
              { value: 'theirs', label: t('采用最新') },
              { value: 'bot', label: t('交给 Bot 合并'), disabled: !canMerge(f) },
            ]}
          />
        </span>
      </div>
      {open ? <Preview groupId={groupId} c={c} f={f} /> : null}
    </div>
  )
}

/**
 * 处理冲突 (F11, §3.3): each conflicting file of the bot's held change gets 保留我的 / 采用最新 / 交给 Bot 合并 (text
 * only), or the whole change is discarded after a backup. For group admins and the bot's owner.
 */
export function ConflictDialog({
  groupId,
  botId,
  botName,
  onClose,
}: {
  groupId: string
  botId: string
  botName: string
  onClose: () => void
}) {
  const [conflict, setConflict] = useState<SyncConflictDto | null | undefined>()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  useEffect(() => {
    syncApi.conflicts(groupId).then(
      (list) => setConflict(list.find((c) => c.botId === botId) ?? null),
      (e) => {
        toastError(e)
        setConflict(null)
      },
    )
  }, [groupId, botId])

  const files = conflict?.files ?? []
  const decided = files.length > 0 && files.every((f) => choices[f.path])
  const merging = files.some((f) => choices[f.path] === 'bot')
  const submit = async () => {
    if (!conflict) return
    setBusy(true)
    try {
      await syncApi.resolve(
        groupId,
        conflict.id,
        files.map((f) => ({ path: f.path, choice: choices[f.path] as Choice })),
      )
      toast({
        type: 'success',
        message: merging ? t('已交给 {bot} 合并', { bot: botName }) : t('已提交处理'),
      })
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      width={720}
      title={t('处理 {bot} 的同步冲突', { bot: botName })}
      message={
        conflict
          ? t('基于 v{base} 的改动与 v{head} 冲突：{n} 个文件', {
              base: conflict.versionBase,
              head: conflict.headVersion,
              n: files.length,
            })
          : undefined
      }
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        conflict ? (
          <Button variant="destructive" disabled={busy} onClick={() => setDiscard(true)}>
            {t('整版丢弃')}
          </Button>
        ) : undefined
      }
      actions={
        conflict
          ? [
              { label: t('取消'), onClick: onClose },
              {
                label: t('提交'),
                variant: 'primary',
                disabled: !decided || busy,
                onClick: () => void submit(),
              },
            ]
          : undefined
      }
    >
      {conflict === undefined ? (
        <Spinner />
      ) : conflict === null ? (
        <EmptyState title={t('冲突已处理')} />
      ) : (
        <div className="sync-conflict">
          <GroupBox>
            {files.map((f) => (
              <FileRow
                key={f.path}
                groupId={groupId}
                c={conflict}
                f={f}
                choice={choices[f.path]}
                onChoice={(choice) => setChoices((s) => ({ ...s, [f.path]: choice }))}
              />
            ))}
          </GroupBox>
          {merging ? (
            <span className="sync-muted">
              {t('选「交给 Bot 合并」的文件会写入冲突标记，由 {bot} 发起一轮合并，结束后自动提交', {
                bot: botName,
              })}
            </span>
          ) : null}
          <span className="sync-muted">{t('保留我的：以我的内容为准；采用最新：放弃我对该文件的改动')}</span>
        </div>
      )}
      <Presence>
        {discard && conflict ? (
          <ConfirmActionDialog
            title={t('整版丢弃')}
            message={t('{bot} 这次的改动将全部放弃，工作区回到最新版本。', { bot: botName })}
            consequences={[t('被放弃的文件会先备份到本机'), t('备份可在本机桌面端的「工作区」页找到')]}
            label={t('整版丢弃')}
            done={t('已丢弃冲突改动')}
            run={() => syncApi.discard(groupId, conflict.id)}
            onDone={onClose}
            onClose={() => setDiscard(false)}
          />
        ) : null}
      </Presence>
    </Dialog>
  )
}
