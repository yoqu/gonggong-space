import type { VersionDiffDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Alert, Spinner } from '../../ui'
import { DiffView } from '../diff/DiffParts'
import { lineDiff } from '../sync/diff'

const STATUS = { added: 'added', removed: 'deleted', modified: 'modified' } as const

/** A version's changed files against the listing's latest approved version before it, one unified diff each. */
export function VersionDiff({ listingId, versionId }: { listingId: string; versionId: string }) {
  const { data, error } = useGet<VersionDiffDto>(`/market/${listingId}/versions/${versionId}/diff`)
  if (!data) return error ? <Alert variant="error" title={error} /> : <Spinner />
  return (
    <div className="mkt-diff">
      <div className="gs-note">
        {data.base ? t('对比 r{n} 的变更', { n: data.base.revision }) : t('首个版本，全部为新增')}
      </div>
      {data.files.length ? null : <div className="gs-note">{t('没有文件变化')}</div>}
      {data.files.map((f) =>
        f.binary ? (
          <div key={f.path} className="diff">
            <div className="diff__head">
              <span className="diff__name">{f.path}</span>
            </div>
            <div className="gs-note">{t('二进制文件已变化')}</div>
          </div>
        ) : (
          <DiffView
            key={f.path}
            view="unified"
            file={{
              path: f.path,
              status: STATUS[f.status],
              add: 0,
              del: 0,
              binary: false,
              lines: lineDiff(f.before ?? '', f.after ?? ''),
            }}
          />
        ),
      )}
    </div>
  )
}
