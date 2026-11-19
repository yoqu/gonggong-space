import { WEBHOOK_MAX_BOTS, type WebhookDto, type WebhookTokenDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, IconButton, TextArea, TextField, toast } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { PRESENCE } from '../bots/model'
import '../schedules/schedules.css'
import { webhooksApi } from './store'
import './webhooks.css'

/** One-time reveal of the plaintext webhook URL right after creation or token rotation. */
export function WebhookUrlDialog({ token, onClose }: { token: WebhookTokenDto; onClose: () => void }) {
  const url = `${window.location.origin}${token.path}`
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ type: 'success', message: msg })
    } catch {
      toast({ type: 'error', message: t('复制失败，请手动选中复制') })
    }
  }
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
          <Button size="small" onClick={() => void copy(url, t('已复制调用地址'))}>
            {t('复制地址')}
          </Button>
        </div>
        <section>
          <h3 className="sc-form__title">{t('调用示例')}</h3>
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
  const allBots = useWorkspace((s) => s.bots)
  const [name, setName] = useState(webhook?.name ?? '')
  const [prompt, setPrompt] = useState(webhook?.prompt ?? '')
  const [candidates, setCandidates] = useState<string[]>(webhook?.botIds ?? [])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const nameOf = (id: string) => allBots.find((b) => b.id === id)?.name ?? t('已移出')
  const isOnline = (id: string) => {
    const p = allBots.find((b) => b.id === id)?.presence
    return p === 'online' || p === 'running'
  }
  const move = (i: number) => {
    const prev = candidates[i - 1]
    const curr = candidates[i]
    if (!prev || !curr) return
    const next = [...candidates]
    next[i - 1] = curr
    next[i] = prev
    setCandidates(next)
  }

  const ready = name.trim().length > 0 && candidates.length <= WEBHOOK_MAX_BOTS

  const save = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        botIds: candidates,
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

  const remove = async () => {
    if (!webhook || deleting) return
    setDeleting(true)
    try {
      await webhooksApi.remove(webhook)
      toast({ type: 'success', message: t('已删除 Webhook「{name}」', { name: webhook.name }) })
      onClose()
    } catch (e) {
      toastError(e)
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open
      width={540}
      closeOnBackdrop={false}
      title={webhook ? t('编辑 Webhook') : t('新建 Webhook')}
      onClose={onClose}
      footer={
        <>
          {webhook ? (
            <Button variant="destructive" disabled={saving || deleting} onClick={() => void remove()}>
              {t('删除')}
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" disabled={!ready || saving || deleting} onClick={() => void save()}>
            {webhook ? t('保存') : t('创建')}
          </Button>
        </>
      }
    >
      <div className="sc-form">
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
        <section>
          <h3 className="sc-form__title">
            {t('允许 @ 的候选 Bot（留空则仅发消息不触发 Bot）· 优先选在线且空闲的')}
          </h3>
          <GroupBox>
            {candidates.map((id, i) => {
              const bot = allBots.find((b) => b.id === id)
              const online = isOnline(id)
              return (
                <div key={id} className="sc-bot">
                  <span className="sc-bot__rank">{i + 1}</span>
                  <BotAvatar id={id} name={nameOf(id)} size={22} />
                  <span className="sc-bot__name">
                    <span
                      className="sc-bot__dot"
                      style={{ background: bot ? PRESENCE[bot.presence].color : 'var(--system-gray)' }}
                      aria-hidden="true"
                    />
                    {nameOf(id)}
                    {!online ? <span className="sc-bot__off">{t('离线')}</span> : null}
                  </span>
                  <IconButton
                    size="small"
                    title={t('上移 {name}', { name: nameOf(id) })}
                    disabled={i === 0}
                    onClick={() => move(i)}
                  >
                    {'chevron-up' as const}
                  </IconButton>
                  <IconButton
                    size="small"
                    title={t('移除 {name}', { name: nameOf(id) })}
                    onClick={() => setCandidates(candidates.filter((x) => x !== id))}
                  >
                    {'minus' as const}
                  </IconButton>
                </div>
              )
            })}
            <div className="sc-bot sc-bot--add">
              {botIds
                .filter((id) => !candidates.includes(id))
                .map((id) => {
                  const bot = allBots.find((b) => b.id === id)
                  const online = isOnline(id)
                  return (
                    <Button
                      key={id}
                      size="small"
                      disabled={candidates.length >= WEBHOOK_MAX_BOTS}
                      aria-label={t('添加 {name}', { name: nameOf(id) })}
                      onClick={() => setCandidates([...candidates, id])}
                    >
                      <span
                        className="sc-bot__dot"
                        style={{ background: bot ? PRESENCE[bot.presence].color : 'var(--system-gray)' }}
                        aria-hidden="true"
                      />
                      + {nameOf(id)}
                      {!online ? <span className="sc-bot__off">{t('离线')}</span> : null}
                    </Button>
                  )
                })}
              {botIds.length === 0 ? (
                <span className="sc-muted">{t('本群还没有 Bot')}</span>
              ) : botIds.every((id) => candidates.includes(id)) ? (
                <span className="sc-muted">{t('本群的 Bot 都已加入')}</span>
              ) : null}
            </div>
          </GroupBox>
        </section>
      </div>
    </Dialog>
  )
}
