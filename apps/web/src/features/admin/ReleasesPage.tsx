import {
  type AdminMachineDto,
  type DaemonRelease,
  parseReleaseFile,
  RELEASE_PLATFORMS,
  type ReleaseKind,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  type DropFile,
  DropZone,
  Presence,
  Spinner,
  Table,
  Tag,
  Textarea,
  toast,
} from '../../ui'
import { fmtSize, postForm } from '../attachments/api'
import { OS_LABEL } from '../machines/model'
import { AdminPage } from './AdminPage'

type Build = DaemonRelease['builds'][string]
interface Row {
  id: string
  builds?: Build
  cast?: Build
  desktop?: Build
  update?: Build
  signature?: Build
  machines: number
}

const KINDS = ['builds', 'cast', 'desktop', 'update', 'signature'] as const
const KIND_LABEL: Record<ReleaseKind, string> = {
  builds: t('共工客户端'),
  cast: t('实时画面组件'),
  desktop: t('桌面端'),
  update: t('桌面端更新包'),
  signature: t('桌面端更新签名'),
}

function platformText(key: string) {
  const os = key.slice(0, key.indexOf('-')) as keyof typeof OS_LABEL
  return `${OS_LABEL[os] ?? os} ${key.slice(os.length + 1)}`
}

function BuildCell({ build, needed }: { build?: Build; needed: boolean }) {
  if (!build) return <span className={needed ? 'admin-table__warn' : undefined}>{t('未发布')}</span>
  return (
    <span title={build.url}>
      <Tag tone="green">{t('已发布')}</Tag> <code>{build.sha256.slice(0, 12)}</code>
    </span>
  )
}

/** The desktop app updates from this server once the platform has a package (the setup.exe on Windows) and its signature. */
function UpdateCell({ row }: { row: Row }) {
  const pkg = row.id.startsWith('windows') ? row.desktop : row.update
  if (!pkg && !row.signature) return <span>{t('未发布')}</span>
  if (!row.signature) return <span className="admin-table__warn">{t('缺少签名')}</span>
  if (!pkg) return <span className="admin-table__warn">{t('缺少更新包')}</span>
  return <Tag tone="green">{t('已发布')}</Tag>
}

/** 管理后台 · 客户端发布: the daemon and gg-cast builds online daemons download (plan D17), uploaded from dist/<version>/. */
export function ReleasesPage() {
  const [release, setRelease] = useState<DaemonRelease | null | undefined>(undefined)
  const [machines, setMachines] = useState<AdminMachineDto[]>([])
  const [uploads, setUploads] = useState<DropFile[]>([])
  const [removing, setRemoving] = useState<{ kind: ReleaseKind; platform: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const loadRelease = useCallback(() => {
    setLoading(true)
    setError('')
    return api
      .get<DaemonRelease | null>('/admin/daemon-release')
      .then((r) => {
        setRelease(r)
        setNotes(r?.releaseNotes ?? '')
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void loadRelease()
    api
      .get<AdminMachineDto[]>('/admin/machines')
      .then(setMachines)
      .catch(() => {})
  }, [loadRelease])

  // Sequential: each upload read-modify-writes the one release record.
  async function upload(files: File[]) {
    const start = uploads.length
    const set = (i: number, f: Partial<DropFile>) =>
      setUploads((list) => list.map((u, j) => (j === start + i ? { ...u, ...f } : u)))
    setUploads((list) => [
      ...list,
      ...files.map((f) => ({ name: f.name, size: fmtSize(f.size), progress: 0 })),
    ])
    for (const [i, file] of files.entries()) {
      if (file.name !== 'RELEASE_NOTES.md' && !parseReleaseFile(file.name)) {
        set(i, {
          progress: undefined,
          error: t('不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64 或 Gonggong_0.2.0_aarch64.dmg'),
        })
        continue
      }
      const form = new FormData()
      form.append('file', file)
      try {
        const next = await postForm<DaemonRelease & { warning?: string }>(
          '/api/admin/daemon-release/files',
          form,
          (p) => set(i, { progress: p }),
        ).done
        setRelease(next)
        setNotes(next.releaseNotes ?? '')
        if (next.warning) toast({ type: 'warning', message: next.warning })
        set(i, { progress: 100 })
      } catch (e) {
        set(i, { progress: undefined, error: errorText(e) })
      }
    }
  }

  async function saveNotes() {
    const releaseNotes = notes.trim()
    if (!releaseNotes) {
      toast({ type: 'warning', message: t('请填写版本说明') })
      return
    }
    setSavingNotes(true)
    try {
      const next = await api.put<DaemonRelease>('/admin/daemon-release/notes', { releaseNotes })
      setRelease(next)
      setNotes(next.releaseNotes ?? '')
      setEditingNotes(false)
      toast({ type: 'success', message: t('版本说明已保存') })
    } catch (e) {
      toastError(e)
    } finally {
      setSavingNotes(false)
    }
  }

  const count = (key: string) => machines.filter((m) => `${m.os}-${m.arch}` === key).length
  const keys = new Set<string>([
    ...RELEASE_PLATFORMS,
    ...KINDS.flatMap((k) => Object.keys(release?.[k] ?? {})),
    ...machines.map((m) => `${m.os}-${m.arch}`),
  ])
  const rows: Row[] = [...keys].map((id) => ({
    id,
    ...Object.fromEntries(KINDS.map((k) => [k, release?.[k]?.[id]])),
    machines: count(id),
  }))

  return (
    <AdminPage
      title={t('客户端发布')}
      desc={t(
        '成员电脑上的共工客户端连上后会自动升级到这里的版本，实时画面组件会在首次使用时按需下载；桌面端安装包与命令行版供成员在「绑定新电脑」中下载，桌面端优先从这里检查更新，未发布签名包时改查 GitHub。',
      )}
      subtitle={
        release === undefined
          ? undefined
          : release
            ? t('当前版本 {version}', { version: release.version })
            : t('尚未发布')
      }
    >
      {error ? (
        <Alert variant="error" description={error}>
          <div style={{ marginTop: 'var(--space-8)' }}>
            <Button size="small" loading={loading} onClick={() => void loadRelease()}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      ) : null}
      {release ? (
        <div className="admin-release-notes">
          <div className="admin-release-notes__head">
            <h3>{t('版本说明')}</h3>
            {!editingNotes ? (
              <Button size="small" variant="plain" onClick={() => setEditingNotes(true)}>
                {t('编辑版本说明')}
              </Button>
            ) : (
              <span style={{ display: 'inline-flex', gap: 'var(--space-8)' }}>
                <Button
                  size="small"
                  disabled={savingNotes}
                  onClick={() => {
                    setNotes(release.releaseNotes ?? '')
                    setEditingNotes(false)
                  }}
                >
                  {t('取消')}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  disabled={savingNotes}
                  loading={savingNotes}
                  onClick={() => void saveNotes()}
                >
                  {savingNotes ? t('保存中…') : t('保存版本说明')}
                </Button>
              </span>
            )}
          </div>
          {editingNotes ? (
            <Textarea
              aria-label={t('版本说明')}
              rows={8}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('填写本版本的更新内容，支持 Markdown。')}
            />
          ) : release.releaseNotes ? (
            <pre className="admin-release-notes__body">{release.releaseNotes}</pre>
          ) : (
            <Alert
              variant="warning"
              description={t('未填写版本说明。桌面端和命令行客户端升级时不会显示具体更新内容。')}
            />
          )}
        </div>
      ) : null}
      <DropZone
        multiple
        onFiles={(files) => void upload(files)}
        title={t('拖入发布产物')}
        description={t(
          '运行 scripts/release.sh 后，把 dist/<版本>/ 里的 gonggong-*、gg-cast-* 与 Gonggong_*（安装包、更新包与 .sig 签名）拖到这里；RELEASE_NOTES.md 可作为本版本更新说明上传。文件名决定平台与版本；更高的版本会替换整个发布。',
        )}
        files={uploads}
        onRemove={(i) => setUploads((list) => list.filter((_, j) => j !== i))}
      />
      {release === undefined && !error ? (
        <Spinner size={18} />
      ) : (
        <Table<Row>
          aria-label={t('各平台发布文件')}
          className="admin-grid"
          rows={rows}
          columns={[
            { key: 'platform', title: t('平台'), render: (r) => platformText(r.id) },
            { key: 'id', title: t('标识'), mono: true, secondary: true, width: 150 },
            {
              key: 'builds',
              title: t('共工客户端'),
              render: (r) => <BuildCell build={r.builds} needed={r.machines > 0} />,
            },
            {
              key: 'cast',
              title: t('实时画面组件'),
              render: (r) => <BuildCell build={r.cast} needed={false} />,
            },
            {
              key: 'desktop',
              title: t('桌面端安装包'),
              render: (r) => <BuildCell build={r.desktop} needed={false} />,
            },
            { key: 'update', title: t('桌面端自动更新'), render: (r) => <UpdateCell row={r} /> },
            { key: 'machines', title: t('电脑#count'), width: 72, align: 'right' },
          ]}
          rowActions={(r) =>
            KINDS.filter((k) => r[k]).map((k) => ({
              label: t('移除 {kind}…', { kind: KIND_LABEL[k] }),
              value: k,
              destructive: true,
            }))
          }
          onRowAction={(kind, r) => setRemoving({ kind: kind as ReleaseKind, platform: r.id })}
        />
      )}
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('要移除 {platform} 的 {kind} 吗？', {
              platform: removing.platform,
              kind: KIND_LABEL[removing.kind],
            })}
            message={
              {
                builds: t('该平台的电脑将不再自动升级，直到重新上传。'),
                cast: t('该平台的电脑将无法推送实时画面，直到重新上传。'),
                desktop: t('成员将无法在「绑定新电脑」中下载该平台的安装包，直到重新上传。'),
                update: t('该平台的桌面端将改从 GitHub 检查更新，直到重新上传。'),
                signature: t('该平台的桌面端将改从 GitHub 检查更新，直到重新上传。'),
              }[removing.kind]
            }
            consequences={[t('已安装的客户端不会受影响，但新连接与更新检查将不再获取此产物')]}
            label={t('移除')}
            done={t('已移除 {kind}（{platform}）', {
              kind: KIND_LABEL[removing.kind],
              platform: removing.platform,
            })}
            run={async () => {
              setRelease(
                await api.del<DaemonRelease>(`/admin/daemon-release/${removing.kind}/${removing.platform}`),
              )
            }}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </Presence>
    </AdminPage>
  )
}
