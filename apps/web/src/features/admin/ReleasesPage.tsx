import {
  type AdminMachineDto,
  type DaemonRelease,
  parseReleaseFile,
  RELEASE_PLATFORMS,
  type ReleaseKind,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, AlertDialog, type DropFile, DropZone, Spinner, Table, Tag, toast } from '../../ui'
import { fmtSize, postForm } from '../attachments/api'
import { errorText } from '../auth/AuthCard'
import { OS_LABEL } from '../machines/BindMachineDialog'
import { AdminPage } from './AdminPage'

type Build = DaemonRelease['builds'][string]
interface Row {
  id: string
  builds?: Build
  cast?: Build
  machines: number
}

const KIND_LABEL: Record<ReleaseKind, string> = { builds: 'daemon', cast: 'gg-cast' }

function platformText(key: string) {
  const os = key.slice(0, key.indexOf('-')) as keyof typeof OS_LABEL
  return `${OS_LABEL[os] ?? os} ${key.slice(os.length + 1)}`
}

function BuildCell({ build, needed }: { build?: Build; needed: boolean }) {
  if (!build) return <span className={needed ? 'admin-table__warn' : undefined}>未发布</span>
  return (
    <span title={build.url}>
      <Tag tone="green">已发布</Tag> <code>{build.sha256.slice(0, 12)}</code>
    </span>
  )
}

/** 管理后台 · 客户端发布: the daemon and gg-cast builds online daemons download (plan D17), uploaded from dist/<version>/. */
export function ReleasesPage() {
  const [release, setRelease] = useState<DaemonRelease | null | undefined>(undefined)
  const [machines, setMachines] = useState<AdminMachineDto[]>([])
  const [uploads, setUploads] = useState<DropFile[]>([])
  const [removing, setRemoving] = useState<{ kind: ReleaseKind; platform: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<DaemonRelease | null>('/admin/daemon-release')
      .then(setRelease)
      .catch((e) => setError(errorText(e)))
    api
      .get<AdminMachineDto[]>('/admin/machines')
      .then(setMachines)
      .catch(() => {})
  }, [])

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
      if (!parseReleaseFile(file.name)) {
        set(i, { progress: undefined, error: '不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64' })
        continue
      }
      const form = new FormData()
      form.append('file', file)
      try {
        setRelease(
          await postForm<DaemonRelease>('/api/admin/daemon-release/files', form, (p) =>
            set(i, { progress: p }),
          ).done,
        )
        set(i, { progress: 100 })
      } catch (e) {
        set(i, { progress: undefined, error: errorText(e) })
      }
    }
  }

  async function remove() {
    if (!removing) return
    try {
      setRelease(await api.del<DaemonRelease>(`/admin/daemon-release/${removing.kind}/${removing.platform}`))
      toast({ type: 'success', message: `已移除 ${KIND_LABEL[removing.kind]}（${removing.platform}）` })
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    }
    setRemoving(null)
  }

  const count = (key: string) => machines.filter((m) => `${m.os}-${m.arch}` === key).length
  const keys = new Set<string>([
    ...RELEASE_PLATFORMS,
    ...Object.keys(release?.builds ?? {}),
    ...Object.keys(release?.cast ?? {}),
    ...machines.map((m) => `${m.os}-${m.arch}`),
  ])
  const rows: Row[] = [...keys].map((id) => ({
    id,
    builds: release?.builds[id],
    cast: release?.cast?.[id],
    machines: count(id),
  }))

  return (
    <AdminPage
      title="客户端发布"
      desc="成员机器上的 daemon 连上后自动升级到这里的版本；gg-cast 在首次推送实时画面时按需下载。"
      subtitle={release === undefined ? undefined : release ? `当前版本 ${release.version}` : '尚未发布'}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      <DropZone
        multiple
        onFiles={(files) => void upload(files)}
        title="拖入发布产物"
        description="运行 scripts/release.sh 后，把 dist/<版本>/ 里的 gonggong-* 与 gg-cast-* 文件拖到这里。文件名决定平台与版本；更高的版本会替换整个发布。"
        files={uploads}
        onRemove={(i) => setUploads((list) => list.filter((_, j) => j !== i))}
      />
      {release === undefined && !error ? (
        <Spinner size={18} />
      ) : (
        <Table<Row>
          aria-label="各平台发布文件"
          className="admin-grid"
          rows={rows}
          columns={[
            { key: 'platform', title: '平台', render: (r) => platformText(r.id) },
            { key: 'id', title: '标识', mono: true, secondary: true, width: 150 },
            {
              key: 'builds',
              title: 'daemon',
              render: (r) => <BuildCell build={r.builds} needed={r.machines > 0} />,
            },
            {
              key: 'cast',
              title: 'gg-cast（实时画面）',
              render: (r) => <BuildCell build={r.cast} needed={false} />,
            },
            { key: 'machines', title: '机器', width: 72, align: 'right' },
          ]}
          rowActions={(r) =>
            (['builds', 'cast'] as const)
              .filter((k) => r[k])
              .map((k) => ({ label: `移除 ${KIND_LABEL[k]}…`, value: k, destructive: true }))
          }
          onRowAction={(kind, r) => setRemoving({ kind: kind as ReleaseKind, platform: r.id })}
        />
      )}
      {removing ? (
        <AlertDialog
          open
          title={`要移除 ${removing.platform} 的 ${KIND_LABEL[removing.kind]} 吗？`}
          message={
            removing.kind === 'builds'
              ? '该平台的机器将不再自动升级，直到重新上传。'
              : '该平台的机器将无法推送实时画面，直到重新上传。'
          }
          onClose={() => setRemoving(null)}
          actions={[
            { label: '取消', onClick: () => setRemoving(null) },
            { label: '移除', variant: 'destructive', onClick: () => void remove() },
          ]}
        />
      ) : null}
    </AdminPage>
  )
}
