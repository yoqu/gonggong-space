import type { GroupDto, SyncPreviewDto, SyncPreviewReason } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import {
  Button,
  ConfirmActionDialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Presence,
  Select,
  Spinner,
  Tag,
  type TagTone,
  toast,
} from '../../ui'
import { groupsApi } from '../groups/api'
import { syncApi, useSyncStatus } from './store'
import './sync.css'

const EXCLUDED: Record<SyncPreviewReason, string> = {
  cd: t('不参与（本机目录）'),
  dirty: t('不参与（有未提交的改动）'),
  offline: t('对齐（机器离线，上线后对齐）'),
  not_ready: t('对齐（工作区就绪后对齐）'),
  outdated: t('不参与（共工空间客户端版本过旧，请升级）'),
}

type Bot = SyncPreviewDto['bots'][number]

/** How the switch treats a bot: the base, aligned now or later, or left out. */
function plan(b: Bot, baseId: string | null): { label: string; tone: TagTone } {
  if (b.botId === baseId) return { label: t('基准'), tone: 'blue' }
  if (b.reason) return { label: EXCLUDED[b.reason], tone: b.plan === 'align' ? 'orange' : 'gray' }
  return { label: t('对齐'), tone: 'green' }
}

/** 切换为强制同步 (§3.5): pick the base Bot, see what happens to every Bot, confirm. */
function EnableWizard({ group, onCancel }: { group: GroupDto; onCancel: () => void }) {
  const [preview, setPreview] = useState<SyncPreviewDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [baseId, setBaseId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    setError(null)
    syncApi.preview(group.id).then(setPreview, (e) => setError(errorText(e)))
  }
  useEffect(load, [group.id])

  if (error)
    return (
      <EmptyState
        title={error}
        action={
          <>
            <Button size="small" onClick={load}>
              {t('重试')}
            </Button>
            <Button size="small" onClick={onCancel}>
              {t('取消')}
            </Button>
          </>
        }
      />
    )
  if (!preview) return <Spinner />
  const bases = preview.bots.filter((b) => b.canBase)
  const confirm = async () => {
    if (!baseId) return
    setBusy(true)
    try {
      await groupsApi.enableSync(group.id, baseId)
      toast({ type: 'success', message: t('正在切换为强制同步') })
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }
  return (
    <>
      <GroupBox>
        <GroupRow
          label={t('基准 Bot')}
          description={t('它当前的工作区文件（含未提交改动）生成第一个版本，其他 Bot 的工作区对齐到它')}
        >
          <Select
            label={t('基准 Bot')}
            placeholder={bases.length ? t('选择基准 Bot') : t('没有可作为基准的 Bot')}
            disabled={!bases.length}
            options={bases.map((b) => ({ value: b.botId, label: b.botName }))}
            value={baseId}
            onChange={setBaseId}
          />
        </GroupRow>
      </GroupBox>
      <div className="gs-note">{t('切换后各 Bot 的处理方式')}</div>
      <GroupBox>
        {preview.bots.map((b) => {
          const p = plan(b, baseId)
          return (
            <div key={b.botId} className="sync-row" data-testid={`plan-${b.botId}`}>
              <span className="sync-row__main">
                <span className="sync-row__title">
                  <span>{b.botName}</span>
                  {b.machineName ? <span className="sync-muted">{b.machineName}</span> : null}
                </span>
              </span>
              <Tag tone={p.tone}>{p.label}</Tag>
            </div>
          )
        })}
      </GroupBox>
      <div className="gs-note">
        {t(
          '对齐会把工作区覆盖为基准版本，被覆盖的文件先备份到本机。已在运行的轮次照分区模式跑完，期间的新触发等切换完成后再运行。',
        )}
      </div>
      <div className="sync-actions">
        <Button onClick={onCancel}>{t('取消')}</Button>
        <Button variant="primary" disabled={!baseId || busy} onClick={() => void confirm()}>
          {t('确认切换')}
        </Button>
      </div>
    </>
  )
}

/** 群设置 · 同步模式: the current mode, and for group admins the switch either way. */
export function SyncModeTab({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const isAdmin = group.members.some((m) => m.userId === me?.id && m.isAdmin)
  const status = useSyncStatus(group)
  const [wizard, setWizard] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const force = group.mode === 'force'

  if (wizard && !force) return <EnableWizard group={group} onCancel={() => setWizard(false)} />
  return (
    <div className="gs-mode">
      <GroupBox>
        <GroupRow
          label={t('当前模式')}
          description={
            force
              ? status?.switching
                ? t('正在切换：等待基准 Bot 提交工作区文件，新触发的轮次稍后运行')
                : status
                  ? `v${status.headVersion} · ${t('{a}/{b} 一致', { a: status.consistent, b: status.total })}`
                  : undefined
              : t('各 Bot 在自己的工作区独立工作，互不同步')
          }
        >
          <span className="gs-value">{GROUP_MODE_LABEL[group.mode]}</span>
        </GroupRow>
        {force ? (
          <GroupRow
            label={t('切回分区模式')}
            description={t('停止同步，各 Bot 保留当前文件各自发展；服务器存档保留 30 天')}
          >
            <Button disabled={!isAdmin} onClick={() => setDisabling(true)}>
              {t('切回分区模式')}
            </Button>
          </GroupRow>
        ) : (
          <GroupRow
            label={t('强制同步')}
            description={
              group.repo
                ? t('参与的 Bot 工作区保持一致：每轮结束后改动自动分发给其他 Bot（不同步 .git）')
                : t('绑定仓库后才能切换为强制同步')
            }
          >
            <Button disabled={!isAdmin || !group.repo} onClick={() => setWizard(true)}>
              {t('切换为强制同步')}
            </Button>
          </GroupRow>
        )}
      </GroupBox>
      {isAdmin ? null : <div className="gs-note">{t('仅群管理员可切换同步模式')}</div>}
      <Presence>
        {disabling ? (
          <ConfirmActionDialog
            title={t('切回分区模式')}
            message={t('「{name}」将停止强制同步。', { name: group.name })}
            consequences={[
              t('各 Bot 保留当前文件，此后各自独立工作'),
              t('同步版本存档保留 30 天后清除'),
              t('之后可以重新切换为强制同步，届时重新选择基准 Bot'),
            ]}
            label={t('切回分区模式')}
            done={t('已切回分区模式')}
            run={() => groupsApi.disableSync(group.id)}
            onClose={() => setDisabling(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
