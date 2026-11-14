import type { FeishuOverviewBotDto, FeishuOverviewChatDto, FeishuOverviewDto } from '@gonggong/protocol'
import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Button, Icon, type MenuItem, Presence, Table, toast } from '../../ui'
import { FeishuAppTag } from './FeishuAppTag'
import { feishuHintText } from './FeishuIssueEvent'
import './feishu.css'

const FeishuScanDialog = lazy(() =>
  import('./FeishuScanDialog').then((m) => ({ default: m.FeishuScanDialog })),
)

type BotRow = FeishuOverviewBotDto & { id: string }
type ChatRow = FeishuOverviewChatDto & { id: string }

/** Why a bot's app is not working, in one line: the connection error first, then the pending dev config. */
const botReason = (b: FeishuOverviewBotDto) => b.app?.error ?? b.app?.configError ?? ''

const date = (iso: string) => new Date(iso).toLocaleDateString()

/** 管理后台 · 飞书 at a glance (GET /admin/feishu/overview). */
export const useFeishuOverview = () => useGet<FeishuOverviewDto>('/admin/feishu/overview')

/** The four setup steps, each the same check as the forms below it; folded into one line once done. */
export function FeishuProgress({ data }: { data: FeishuOverviewDto }) {
  const steps = [
    { title: t('对外地址'), done: !!data.publicUrl },
    { title: t('接入主应用'), done: data.main?.status === 'connected' },
    { title: t('审核通过'), done: data.main?.review === 'approved' },
    { title: t('成员可用'), done: data.othersLinked },
  ]
  const loginUrl = `${data.publicUrl || location.origin}/login`
  return (
    <section className="admin-params">
      <h2 className="admin-params__title">{t('接入进度')}</h2>
      {steps.every((s) => s.done) ? (
        <div className="feishu-steps__ok">
          <Icon name="checkmark-circle" size={16} />
          {t('飞书已接通 · {n} 人已绑定飞书账号', { n: data.linkedUsers })}
        </div>
      ) : (
        <ol className="feishu-progress" aria-label={t('飞书接入进度')}>
          {steps.map((s, i) => (
            <li key={s.title} className={s.done ? 'feishu-progress__step--done' : undefined}>
              <span className="feishu-progress__title">
                {s.done ? <Icon name="checkmark-circle" size={14} /> : <span>{i + 1}</span>}
                {s.title}
              </span>
              {!s.done && i === 3 ? (
                <Button
                  size="small"
                  onClick={() =>
                    void copyText(loginUrl).then(
                      () => toast({ type: 'success', message: t('已复制登录地址') }),
                      toastError,
                    )
                  }
                >
                  {t('复制登录地址，发给同事验证')}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Every bot's own app with the fix for it (scan, 更新权限, 重试 right here: a sysadmin manages any bot's app), and
 * every group linked to a Feishu chat with the latest failure.
 */
export function FeishuOverviewTables({ data, reload }: { data: FeishuOverviewDto; reload: () => void }) {
  const [all, setAll] = useState(false)
  const [scan, setScan] = useState<{ botId: string; update: boolean } | null>(null)
  const shown = (all ? data.bots : data.bots.filter((b) => b.app)).map((b) => ({ ...b, id: b.botId }))

  const actions = (b: BotRow): MenuItem[] =>
    !b.app
      ? [{ label: t('接入#bot'), value: 'create' }]
      : [
          ...(b.app.review === 'pending' ? [{ label: t('重试'), value: 'retry' }] : []),
          { label: t('更新权限'), value: 'update' },
        ]

  const act = async (value: string, b: BotRow) => {
    if (value !== 'retry') return setScan({ botId: b.botId, update: value === 'update' })
    try {
      await api.post(`/bots/${b.botId}/feishu/configure`, {})
      reload()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    }
  }

  return (
    <>
      <section className="admin-params">
        <h2 className="admin-params__title">{t('Bot')}</h2>
        <Table<BotRow>
          aria-label={t('Bot 的飞书应用')}
          rows={shown}
          multiple={false}
          rowActions={actions}
          onRowAction={(v, b) => void act(v, b)}
          emptyText={t('还没有 Bot 接入飞书')}
          columns={[
            { key: 'name', title: 'Bot' },
            { key: 'teamName', title: t('团队'), secondary: true },
            { key: 'ownerName', title: t('主人'), secondary: true },
            {
              key: 'app',
              title: t('飞书状态'),
              render: (b) => (
                <span className="feishu-overview__state">
                  <FeishuAppTag app={b.app} />
                  {botReason(b) ? <span className="feishu-overview__reason">{botReason(b)}</span> : null}
                </span>
              ),
            },
          ]}
        />
        {data.bots.some((b) => !b.app) ? (
          <Button size="small" variant="plain" onClick={() => setAll(!all)}>
            {all ? t('只看已接入的') : t('显示全部（{n}）', { n: data.bots.length })}
          </Button>
        ) : null}
      </section>

      <section className="admin-params">
        <h2 className="admin-params__title">{t('飞书群')}</h2>
        <Table<ChatRow>
          aria-label={t('已关联的飞书群')}
          rows={data.chats.map((c) => ({ ...c, id: c.groupId }))}
          multiple={false}
          emptyText={t('还没有群关联飞书群')}
          columns={[
            { key: 'groupName', title: t('共工群') },
            { key: 'teamName', title: t('团队'), secondary: true },
            { key: 'chatName', title: t('飞书群') },
            { key: 'boundAt', title: t('关联时间'), secondary: true, render: (c) => date(c.boundAt) },
            {
              key: 'bots',
              title: t('Bot 入群'),
              render: (c) => `${c.botsInChat ?? '—'} / ${c.botsTotal}`,
            },
            {
              key: 'issue',
              title: t('最近失败原因'),
              render: (c) =>
                c.issue ? (
                  <span className="feishu-overview__reason" title={c.issue.message}>
                    {feishuHintText(c.issue.code)}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'open',
              title: '',
              render: (c) => (c.member ? <Link to={`/g/${c.groupId}`}>{t('打开群')}</Link> : null),
            },
          ]}
        />
      </section>

      <Presence>
        {scan ? (
          <Suspense fallback={null}>
            <FeishuScanDialog
              path={`/bots/${scan.botId}/feishu`}
              update={scan.update}
              onClose={() => setScan(null)}
              onDone={reload}
            />
          </Suspense>
        ) : null}
      </Presence>
    </>
  )
}
