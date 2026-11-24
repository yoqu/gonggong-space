import type { KnowledgeEntryDto, KnowledgeVersionDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  AlertDialog,
  Button,
  Dialog,
  GroupBox,
  Presence,
  SegmentedControl,
  Tag,
  toast,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { DiffView } from '../diff/DiffParts'
import { lineDiff } from '../sync/diff'
import { knowledgeApi } from './api'
import { Author } from './KnowledgeEditor'

const ACTION_LABEL: Record<KnowledgeVersionDto['action'], string> = {
  create: t('创建#done'),
  update: t('编辑#done'),
  rollback: t('回滚#done'),
}

type View = 'diff' | 'content'

/** Every version, newest first: what each changed against the one before, its content, and 回滚到此版本. */
export function KnowledgeHistory({
  entry,
  onChanged,
  onClose,
}: {
  entry: KnowledgeEntryDto
  onChanged?: () => void
  onClose: () => void
}) {
  const versions = useGet<KnowledgeVersionDto[]>(`/knowledge/${entry.id}/versions`)
  const [viewing, setViewing] = useState<number | null>(null)
  const [view, setView] = useState<View>('diff')
  const [confirming, setConfirming] = useState<KnowledgeVersionDto | null>(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState('')
  const list = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)
  const shown = list.find((v) => v.version === viewing) ?? list[0]
  const before = shown && list.find((v) => v.version < shown.version)

  const confirmRollback = async () => {
    if (!confirming || rolling) return
    setRolling(true)
    setError('')
    try {
      await knowledgeApi.rollback(entry.id, confirming.version)
      toast({ type: 'success', message: t('已回滚到 v{n}', { n: confirming.version }) })
      setConfirming(null)
      setViewing(null)
      versions.reload()
      onChanged?.()
    } catch (e) {
      setError(errorText(e))
      setConfirming(null)
    } finally {
      setRolling(false)
    }
  }

  return (
    <>
      <Dialog
        open
        title={t('「{title}」的历史版本', { title: entry.title })}
        width={680}
        onClose={onClose}
        actions={[{ label: t('完成'), variant: 'primary', onClick: onClose }]}
      >
        {error || versions.error ? <Alert variant="error" title={error || versions.error} /> : null}
        <GroupBox>
          {list.map((v) => (
            <div key={v.version} className="kb-version">
              <span className="kb-row__main">
                <span className="kb-row__title">
                  {`v${v.version}`}
                  {v.current ? <Tag tone="green">{t('当前')}</Tag> : null}
                </span>
                <span className="kb-meta">
                  <span>{ACTION_LABEL[v.action]}</span>
                  <Author by={v.by} />
                  <span>{ago(v.at)}</span>
                </span>
              </span>
              <span className="kb-row__ops">
                <Button size="small" onClick={() => setViewing(v.version)}>
                  {t('查看')}
                </Button>
                <Button size="small" disabled={v.current || rolling} onClick={() => setConfirming(v)}>
                  {t('回滚到此版本')}
                </Button>
              </span>
            </div>
          ))}
        </GroupBox>
        {shown ? (
          <div className="kb-version__view">
            <div className="kb-form__bar">
              <SegmentedControl<View>
                size="small"
                aria-label={t('查看方式')}
                items={[
                  { value: 'diff', label: t('改动') },
                  { value: 'content', label: t('内容') },
                ]}
                value={view}
                onChange={setView}
              />
              <span className="kb-muted">
                {before ? t('v{a} → v{b}', { a: before.version, b: shown.version }) : `v${shown.version}`}
              </span>
            </div>
            {view === 'diff' ? (
              <DiffView
                file={{
                  path: shown.title,
                  status: before ? 'modified' : 'added',
                  add: 0,
                  del: 0,
                  binary: false,
                  lines: lineDiff(before?.body ?? '', shown.body),
                }}
              />
            ) : (
              <div className="kb-preview">
                <Markdown text={shown.body} />
              </div>
            )}
          </div>
        ) : null}
      </Dialog>
      <Presence>
        {confirming ? (
          <AlertDialog
            open
            title={t('要回滚到版本 v{version} 吗？', { version: confirming.version })}
            message={t('当前内容会被替换为此版本。现有版本仍会保留在历史记录中，可随时切回。')}
            onClose={() => {
              if (!rolling) setConfirming(null)
            }}
            actions={[
              { label: t('取消'), disabled: rolling, onClick: () => setConfirming(null) },
              {
                label: t('回滚到此版本'),
                variant: 'destructive',
                disabled: rolling,
                loading: rolling,
                onClick: () => void confirmRollback(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </>
  )
}
