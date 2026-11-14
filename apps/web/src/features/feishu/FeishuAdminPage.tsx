import type { SystemParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, GroupBox, GroupRow, Switch, TextField, toast } from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { FeishuAppForm } from './FeishuAppForm'
import { FeishuOverviewTables, FeishuProgress, useFeishuOverview } from './FeishuOverview'

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * 管理后台 · 飞书: the setup progress on top, then the public URL (the sign-in callback, card links and the chat invite card need it, so
 * scanning waits for it), then the system-wide main app (飞书登录, mirroring people's messages), every bot's app and linked chat, then auto
 * sign-up.
 */
export function FeishuAdminPage() {
  const overview = useFeishuOverview()
  const [autoSignup, setAutoSignup] = useState<boolean | null>(null)
  const [publicUrl, setPublicUrl] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  useEffect(() => {
    api.get<SystemParams>('/admin/params').then((p) => {
      setAutoSignup(p.feishuAutoSignup)
      setPublicUrl(p.publicUrl ?? '')
      setUrlDraft(p.publicUrl || window.location.origin)
    }, toastError)
  }, [])

  const saveUrl = async () => {
    try {
      const next = await api.put<SystemParams>('/admin/params', {
        publicUrl: trimUrl(urlDraft),
      })
      setPublicUrl(next.publicUrl)
      setUrlDraft(next.publicUrl)
      overview.reload()
      toast({ type: 'success', message: t('对外地址已保存') })
    } catch (e) {
      toastError(e)
    }
  }

  const toggle = async (v: boolean) => {
    try {
      const next = await api.put<SystemParams>('/admin/params', { feishuAutoSignup: v })
      setAutoSignup(next.feishuAutoSignup)
      toast({ type: 'success', message: v ? t('已开启飞书自动开户') : t('已关闭飞书自动开户') })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <AdminPage
      title={t('飞书')}
      desc={t(
        '主应用负责飞书一键登录，并把成员发给 Bot 的消息同步到飞书；每个 Bot 的飞书应用在 Bot 设置 › 飞书里接入。',
      )}
    >
      {overview.data ? <FeishuProgress data={overview.data} /> : null}
      {autoSignup !== null ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('对外地址')}</h2>
          <GroupBox>
            <GroupRow
              label={t('对外地址')}
              description={
                <>
                  {t(
                    '浏览器访问共工的地址，如 https://gonggong.example.com；飞书卡片中的链接和飞书登录回调都基于它。',
                  )}
                  {publicUrl ? null : (
                    <span className="feishu-url__unsaved">{t('尚未保存，预填的是当前网址')}</span>
                  )}
                </>
              }
            >
              <span className="gs-value-line">
                <TextField
                  aria-label={t('对外地址')}
                  placeholder="https://…"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                />
                <Button
                  size="small"
                  variant={publicUrl ? undefined : 'primary'}
                  aria-label={t('保存对外地址')}
                  disabled={trimUrl(urlDraft) === publicUrl}
                  onClick={() => void saveUrl()}
                >
                  {t('保存')}
                </Button>
              </span>
            </GroupRow>
            {publicUrl ? (
              <GroupRow
                label={t('重定向 URL')}
                description={t(
                  '在飞书开发者后台「安全设置 · 重定向 URL」中添加此地址，飞书登录才能回到共工。',
                )}
              >
                <code className="feishu-app__id">{`${publicUrl}/api/auth/feishu/callback`}</code>
              </GroupRow>
            ) : null}
          </GroupBox>
        </section>
      ) : null}
      {autoSignup !== null ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('主应用')}</h2>
          <GroupBox>
            <GroupRow
              className="feishu-creds"
              label={t('凭证')}
              description={t('在飞书开发者后台「凭证与基础信息」中获取；保存前会向飞书校验。')}
            >
              <FeishuAppForm
                path="/admin/feishu"
                removeLabel={t('移除主应用')}
                blocked={publicUrl ? undefined : t('先保存对外地址')}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
      {overview.data ? <FeishuOverviewTables data={overview.data} reload={overview.reload} /> : null}
      {autoSignup !== null ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('账号')}</h2>
          <GroupBox>
            <GroupRow
              label={t('飞书自动开户')}
              description={t('开启后，本企业成员首次飞书登录可直接新建共工账号，不受「开放自助注册」限制。')}
            >
              <Switch
                ariaLabel={t('飞书自动开户')}
                label={autoSignup ? t('已开启') : t('已关闭#off')}
                checked={autoSignup}
                onChange={(v) => void toggle(v)}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
    </AdminPage>
  )
}
