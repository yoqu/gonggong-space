import { WEBHOOK_MAX_BOTS, type WebhookDto, type WebhookTokenDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { Button, ConfirmActionDialog, Dialog, Presence, TextArea, TextField, useDiscardGuard } from '../../ui'
import { CandidateBotPicker, selectedRunOptions } from '../bots/CandidateBotPicker'
import type { Picks } from '../chat/RunConfigChips'
import '../groups/groups.css'
import { webhooksApi } from './store'
import './webhooks.css'

/** One-time reveal of the plaintext webhook URL right after creation or token rotation. */
export function WebhookUrlDialog({ token, onClose }: { token: WebhookTokenDto; onClose: () => void }) {
  const url = `${window.location.origin}${token.path}`
  const sample = `curl -fsS -X POST -H "Content-Type: application/json" \\\n  -d '{"text":"**❌ 构建失败** #1","mention":true}' \\\n  "${url}"`
  return (
    <Dialog
      open
      width={560}
      closeOnBackdrop={false}
      title={t('Webhook 调用地址 · {name}', { name: token.webhook.name })}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('我已保存')}
          </Button>
        </>
      }
    >
      <div className="wh-url">
        <p className="wh-url__warn">
          {t('此链接包含密钥令牌，仅显示这一次；关闭后无法再次查看，如遗忘或泄露请重置令牌。')}
        </p>
        <div className="wh-url__box">
          <code className="wh-url__code" data-testid="webhook-url">
            {url}
          </code>
          <Button
            size="small"
            onClick={() => void copyWithToast(url, t('已复制调用地址'), t('复制失败，请手动选中复制'))}
          >
            {t('复制地址')}
          </Button>
        </div>
        <section>
          <h3 className="gs-section-title">{t('调用示例')}</h3>
          <pre className="wh-url__sample">{sample}</pre>
        </section>
      </div>
    </Dialog>
  )
}

/** Create or edit a group webhook; creation returns a one-time token via `onCreated`. */
export function WebhookDialog({
  groupId,
  botIds,
  webhook,
  onCreated,
  onClose,
}: {
  groupId: string
  botIds: string[]
  webhook?: WebhookDto
  onCreated?: (token: WebhookTokenDto) => void
  onClose: () => void
}) {
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const [name, setName] = useState(webhook?.name ?? '')
  const [prompt, setPrompt] = useState(webhook?.prompt ?? '')
  const [candidates, setCandidates] = useState<string[]>(webhook?.botIds ?? [])
  const [picks, setPicks] = useState<Picks>(webhook?.runOptions ?? {})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const snapshot = JSON.stringify([name, prompt, candidates, picks])
  const [initial] = useState(snapshot)
  const dirty = snapshot !== initial
  const guard = useDiscardGuard(dirty, onClose)
  const close = saving ? () => {} : guard.requestClose

  const ready = name.trim().length > 0 && candidates.length <= WEBHOOK_MAX_BOTS

  const save = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        botIds: candidates,
        runOptions: selectedRunOptions(candidates, picks),
        prompt: prompt.trim() ? prompt.trim() : null,
      }
      if (webhook) {
        await webhooksApi.update(webhook.id, body)
        onClose()
      } else {
        const created = await webhooksApi.create(groupId, body)
        onClose()
        onCreated?.(created)
      }
    } catch (e) {
      toastError(e)
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog
        open
        width={540}
        closeOnBackdrop={false}
        title={webhook ? t('编辑 Webhook') : t('新建 Webhook')}
        onClose={close}
        footer={
          <>
            {webhook ? (
              <Button variant="destructive" disabled={saving} onClick={() => setConfirmDelete(true)}>
                {t('删除')}
              </Button>
            ) : null}
            <span className="spacer" />
            <Button disabled={saving} onClick={close}>
              {t('取消')}
            </Button>
            <Button variant="primary" disabled={!ready} loading={saving} onClick={() => void save()}>
              {webhook ? t('保存') : t('创建')}
            </Button>
          </>
        }
      >
        <div className="gs-dialog-form" inert={saving}>
          <TextField
            label={t('名称')}
            value={name}
            maxLength={60}
            placeholder={t('如：Jenkins 部署')}
            onChange={(e) => setName(e.target.value)}
          />
          <TextArea
            label={t('触发 Bot 的附加指令（可选）')}
            value={prompt}
            maxLength={4000}
            rows={3}
            placeholder={t('留空则使用默认排查指令：读取附件日志、定位提交并给出原因或修复')}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <CandidateBotPicker
            scope="webhook"
            group={group}
            botIds={botIds}
            candidates={candidates}
            onCandidatesChange={setCandidates}
            picks={picks}
            onPicksChange={setPicks}
            max={WEBHOOK_MAX_BOTS}
            title={t('允许 @ 的候选 Bot（留空则仅发消息不触发 Bot）· 优先选在线且空闲的')}
            offlineWarning={t('所选候选 Bot 当前全部离线，触发时将跳过 @')}
          />
        </div>
      </Dialog>
      <Presence>
        {webhook && confirmDelete ? (
          <ConfirmActionDialog
            title={t('删除 Webhook「{name}」？', { name: webhook.name })}
            message={t('此操作不可恢复，外部系统（如 Jenkins）将无法继续通过该地址推送消息。')}
            consequences={[t('现有调用地址和令牌将立即失效')]}
            label={t('删除')}
            done={t('已删除 Webhook「{name}」', { name: webhook.name })}
            run={() => webhooksApi.remove(webhook)}
            onDone={onClose}
            onClose={() => setConfirmDelete(false)}
          />
        ) : null}
      </Presence>
      {guard.dialog}
    </>
  )
}
