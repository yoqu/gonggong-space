import {
  type AdminMachineDto,
  type DaemonRelease,
  parseReleaseFile,
  RELEASE_PLATFORMS,
  type ReleaseKind,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, AlertDialog, type DropFile, DropZone, Spinner, Table, Tag, toast } from '../../ui'
import { fmtSize, postForm } from '../attachments/api'
import { OS_LABEL } from '../machines/BindMachineDialog'
import { AdminPage } from './AdminPage'

type Build = DaemonRelease['builds'][string]
interface Row {
  id: string
  builds?: Build
  cast?: Build
  desktop?: Build
  machines: number
}

const KIND_LABEL: Record<ReleaseKind, string> = { builds: 'daemon', cast: 'gg-cast', desktop: t('桌面端') }

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
        set(i, {
          progress: undefined,
          error: t('不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64 或 Gonggong_0.2.0_aarch64.dmg'),
        })
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
      toast({
        type: 'success',
        message: t('已移除 {kind}（{platform}）', {
          kind: KIND_LABEL[removing.kind],
          platform: removing.platform,
        }),
      })
    } catch (e) {
      toastError(e)
    }
    setRemoving(null)
  }

  const count = (key: string) => machines.filter((m) => `${m.os}-${m.arch}` === key).length
  const keys = new Set<string>([
    ...RELEASE_PLATFORMS,
    ...Object.keys(release?.builds ?? {}),
    ...Object.keys(release?.cast ?? {}),
    ...Object.keys(release?.desktop ?? {}),
    ...machines.map((m) => `${m.os}-${m.arch}`),
  ])
  const rows: Row[] = [...keys].map((id) => ({
    id,
    builds: release?.builds[id],
    cast: release?.cast?.[id],
    desktop: release?.desktop?.[id],
    machines: count(id),
  }))

  return (
    <AdminPage
      title={t('客户端发布')}
      desc={t(
        '成员机器上的 daemon 连上后自动升级到这里的版本；gg-cast 在首次推送实时画面时按需下载；桌面端安装包与 Linux daemon 供成员在「绑定新机器」中下载。',
      )}
      subtitle={
        release === undefined
          ? undefined
          : release
            ? t('当前版本 {version}', { version: release.version })
            : t('尚未发布')
      }
    >
      {error ? <Alert variant="error" description={error} /> : null}
      <DropZone
        multiple
        onFiles={(files) => void upload(files)}
        title={t('拖入发布产物')}
        description={t(
          '运行 scripts/release.sh 后，把 dist/<版本>/ 里的 gonggong-*、gg-cast-* 与 Gonggong_*.dmg / Gonggong_*-setup.exe 拖到这里。文件名决定平台与版本；更高的版本会替换整个发布。',
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
              title: 'daemon',
              render: (r) => <BuildCell build={r.builds} needed={r.machines > 0} />,
            },
            {
              key: 'cast',
              title: t('gg-cast（实时画面）'),
              render: (r) => <BuildCell build={r.cast} needed={false} />,
            },
            {
              key: 'desktop',
              title: t('桌面端安装包'),
              render: (r) => <BuildCell build={r.desktop} needed={false} />,
            },
            { key: 'machines', title: t('机器#count'), width: 72, align: 'right' },
          ]}
          rowActions={(r) =>
            (['builds', 'cast', 'desktop'] as const)
              .filter((k) => r[k])
              .map((k) => ({
                label: t('移除 {kind}…', { kind: KIND_LABEL[k] }),
                value: k,
                destructive: true,
              }))
          }
          onRowAction={(kind, r) => setRemoving({ kind: kind as ReleaseKind, platform: r.id })}
        />
      )}
      {removing ? (
        <AlertDialog
          open
          title={t('要移除 {platform} 的 {kind} 吗？', {
            platform: removing.platform,
            kind: KIND_LABEL[removing.kind],
          })}
          message={
            {
              builds: t('该平台的机器将不再自动升级，直到重新上传。'),
              cast: t('该平台的机器将无法推送实时画面，直到重新上传。'),
              desktop: t('成员将无法在「绑定新机器」中下载该平台的安装包，直到重新上传。'),
            }[removing.kind]
          }
          onClose={() => setRemoving(null)}
          actions={[
            { label: t('取消'), onClick: () => setRemoving(null) },
            { label: t('移除'), variant: 'destructive', onClick: () => void remove() },
          ]}
        />
      ) : null}
    </AdminPage>
  )
}
