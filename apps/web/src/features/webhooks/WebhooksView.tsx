import {
  type GroupDto,
  type RunStatus,
  WEBHOOK_MAX_PER_GROUP,
  type WebhookDto,
  type WebhookTokenDto,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { attempt, toastError } from '../../lib/errors'
import { Button, Dialog, EmptyState, GroupBox, Spinner, Switch, Tag } from '../../ui'
import { botsText } from '../schedules/model'
import { useBotNames } from '../schedules/store'
import '../schedules/schedules.css'
import { useWebhooks, webhooksApi } from './store'
import { WebhookDialog, WebhookUrlDialog } from './WebhookDialog'

const STATUS_TEXT: Partial<Record<RunStatus, string>> = {
  queued: t('排队中'),
  offline_wait: t('等待上线'),
  running: t('排查中'),
  awaiting_approval: t('待审批'),
  awaiting_answer: t('待回答'),
  completed: t('完成'),
  interrupted: t('中断'),
  forbidden: t('无权触发'),
  expired: t('离线作废'),
}

function lastCallText(w: WebhookDto) {
  if (!w.lastCalledAt) return t('尚未调用')
  const when = new Date(w.lastCalledAt).toLocaleString()
  const status = w.lastStatus ? STATUS_TEXT[w.lastStatus] : undefined
  return status ? t('最近调用 {at}（{status}）', { at: when, status }) : t('最近调用 {at}', { at: when })
}

function Row({ w, onEdit, onRotate }: { w: WebhookDto; onEdit: () => void; onRotate: () => void }) {
  const names = useBotNames(w.botIds)
  const [pending, setPending] = useState<boolean | null>(null)
  const toggle = async (enabled: boolean) => {
    setPending(enabled)
    await attempt(() => webhooksApi.update(w.id, { enabled }))
    setPending(null)
  }
  const bots = names.length ? botsText(w, names) : t('仅发消息，不 @ Bot')
  return (
    <div className="sc-row" data-testid={`webhook-${w.id}`}>
      <span className="sc-row__main">
        <span className="sc-row__title">
          {w.name}
          {w.createdByBotId ? <Tag tone="gray">{t('Bot 创建')}</Tag> : null}
          {!w.hasToken ? <Tag tone="orange">{t('待生成令牌')}</Tag> : null}
        </span>
        <span className="sc-muted">
          {bots} · {t('由 {name} 创建', { name: w.ownerName })}
        </span>
        <span className="sc-muted">
          {w.enabled ? t('启用中') : t('已停用')} · {lastCallText(w)}
        </span>
      </span>
      {w.canManage ? (
        <span className="sc-row__ops">
          <Button variant="plain" size="small" onClick={onRotate}>
            {w.hasToken ? t('重置令牌') : t('生成令牌')}
          </Button>
          <Button variant="plain" size="small" onClick={onEdit}>
            {t('编辑')}
          </Button>
          <Switch
            aria-label={t('启用「{name}」', { name: w.name })}
            checked={pending ?? w.enabled}
            disabled={pending !== null}
            onChange={(v) => void toggle(v)}
          />
        </span>
      ) : null}
    </div>
  )
}

/** Group settings · Webhook tab: members inspect; group admins create, edit, rotate and delete. */
export function WebhooksView({ group, readOnly }: { group: GroupDto; readOnly: boolean }) {
  const list = useWebhooks(group.id)
  const [editing, setEditing] = useState<WebhookDto | 'new' | null>(null)
  const [confirmRotate, setConfirmRotate] = useState<WebhookDto | null>(null)
  const [rotating, setRotating] = useState(false)
  const [revealed, setRevealed] = useState<WebhookTokenDto | null>(null)
  const botIds = useWorkspace((s) => s.groups.find((g) => g.id === group.id)?.botIds) ?? group.botIds

  const doRotate = async (w: WebhookDto) => {
    setRotating(true)
    try {
      const res = await webhooksApi.rotate(w.id)
      setConfirmRotate(null)
      setRevealed(res)
    } catch (e) {
      toastError(e)
    } finally {
      setRotating(false)
    }
  }

  if (!list) return <Spinner />
  return (
    <>
      {list.length ? (
        <>
          <div className="gs-toolbar">
            <span className="gs-toolbar__text">
              {t('{n} / {max} 个', { n: list.length, max: WEBHOOK_MAX_PER_GROUP })}
            </span>
            {readOnly ? null : (
              <Button
                size="small"
                disabled={list.length >= WEBHOOK_MAX_PER_GROUP}
                onClick={() => setEditing('new')}
              >
                {t('新建 Webhook')}
              </Button>
            )}
          </div>
          <GroupBox>
            {list.map((w) => (
              <Row
                key={w.id}
                w={w}
                onEdit={() => setEditing(w)}
                onRotate={() => (w.hasToken ? setConfirmRotate(w) : void doRotate(w))}
              />
            ))}
          </GroupBox>
        </>
      ) : (
        <EmptyState
          compact
          title={t('还没有 Webhook')}
          description={t(
            '给 Jenkins 或其他外部系统配置入站链接，构建失败时自动发消息到群并 @ 候选 Bot 排查。',
          )}
          action={
            readOnly ? undefined : (
              <Button size="small" onClick={() => setEditing('new')}>
                {t('新建 Webhook')}
              </Button>
            )
          }
        />
      )}
      {editing ? (
        <WebhookDialog
          groupId={group.id}
          botIds={botIds}
          webhook={editing === 'new' ? undefined : editing}
          onCreated={(token) => setRevealed(token)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmRotate ? (
        <Dialog
          open
          width={420}
          title={t('重置「{name}」的令牌？', { name: confirmRotate.name })}
          onClose={() => setConfirmRotate(null)}
          footer={
            <>
              <span className="spacer" />
              <Button onClick={() => setConfirmRotate(null)}>{t('取消')}</Button>
              <Button variant="destructive" loading={rotating} onClick={() => void doRotate(confirmRotate)}>
                {t('确认重置')}
              </Button>
            </>
          }
        >
          <p className="sc-muted">{t('旧的调用地址将立即失效，需要同步更新 Jenkins 等外部系统的配置。')}</p>
        </Dialog>
      ) : null}
      {revealed ? <WebhookUrlDialog token={revealed} onClose={() => setRevealed(null)} /> : null}
    </>
  )
}
