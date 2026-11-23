import type { ArtifactVersionDto } from '@gonggong/protocol'
import { t } from '../../../i18n'
import { cx } from '../../../lib/cx'
import { ago } from '../../../lib/time'
import { Button, EmptyState, Tag } from '../../../ui'
import { Panel } from '../SidePanel'

const SOURCE: Record<ArtifactVersionDto['source'], string> = {
  run: t('AI 生成'),
  edit: t('手动编辑'),
  local: t('本机改动'),
  host: t('托管上传'),
}

/** Version history sidebar for Shell: browse past versions read-only and restore any version as head. */
export function HistorySidebar({
  versions,
  headId,
  shownId,
  readOnly,
  busy,
  onSelect,
  onRestore,
  onClose,
}: {
  versions: ArtifactVersionDto[]
  headId: string | null
  shownId: string | null
  readOnly: boolean
  busy: boolean
  onSelect: (versionId: string) => void
  onRestore: (versionId: string) => Promise<void>
  onClose: () => void
}) {
  const ordered = [...versions].sort((a, b) => b.n - a.n)
  return (
    <Panel title={t('版本历史')} onClose={onClose}>
      {ordered.length ? (
        <ol className="art-shell__history" data-testid="shell-history">
          {ordered.map((v) => {
            const isHead = v.id === headId
            const isShown = v.id === shownId
            return (
              <li
                key={v.id}
                data-testid={`shell-version-v${v.n}`}
                className={cx('art-shell__ver', isShown && 'art-shell__ver--active')}
              >
                <button type="button" className="art-shell__ver-main" onClick={() => onSelect(v.id)}>
                  <div className="art-shell__ver-top">
                    <strong>{isHead ? t('v{n}（当前）', { n: v.n }) : `v${v.n}`}</strong>
                    <Tag tone={isHead ? 'green' : undefined}>{SOURCE[v.source]}</Tag>
                  </div>
                  <div className="art-shell__ver-meta">
                    {[v.authorName, ago(v.createdAt)].filter(Boolean).join(' · ')}
                  </div>
                </button>
                {!readOnly && !isHead ? (
                  <Button size="small" variant="plain" disabled={busy} onClick={() => void onRestore(v.id)}>
                    {t('设为当前版本')}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <EmptyState compact icon="clock" title={t('还没有历史版本')} />
      )}
    </Panel>
  )
}
