import type { FeishuWebAppDto, SystemParams } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, Button, GroupBox, GroupRow, Spinner, Switch, TextField, toast, useFlash } from '../../ui'
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
  const [paramsError, setParamsError] = useState('')
  const [paramsLoading, setParamsLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [webApp, setWebApp] = useState(false)
  const [togglingWebApp, setTogglingWebApp] = useState(false)
  const [publicUrl, setPublicUrl] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [urlSaved, flashUrlSaved] = useFlash()

  const loadParams = useCallback(() => {
    setParamsLoading(true)
    setParamsError('')
    return api
      .get<SystemParams>('/admin/params')
      .then((p) => {
        setAutoSignup(p.feishuAutoSignup)
        setWebApp(p.feishuWebApp)
        setPublicUrl(p.publicUrl ?? '')
        setUrlDraft(p.publicUrl || window.location.origin)
      })
      .catch((e) => setParamsError(errorText(e)))
      .finally(() => setParamsLoading(false))
  }, [])
  useEffect(() => {
    void loadParams()
  }, [loadParams])

  const saveUrl = async () => {
    setSavingUrl(true)
    try {
      const next = await api.put<SystemParams>('/admin/params', {
        publicUrl: trimUrl(urlDraft),
      })
      setPublicUrl(next.publicUrl)
      setUrlDraft(next.publicUrl)
      overview.reload()
      flashUrlSaved()
    } catch (e) {
      toastError(e)
    } finally {
      setSavingUrl(false)
    }
  }

  const toggle = async (v: boolean) => {
    if (toggling) return
    setToggling(true)
    try {
      const next = await api.put<SystemParams>('/admin/params', { feishuAutoSignup: v })
      setAutoSignup(next.feishuAutoSignup)
      toast({ type: 'success', message: v ? t('已开启飞书自动开户') : t('已关闭飞书自动开户') })
    } catch (e) {
      toastError(e)
    } finally {
      setToggling(false)
    }
  }

  const toggleWebApp = async (enabled: boolean) => {
    if (togglingWebApp) return
    setTogglingWebApp(true)
    try {
      const next = await api.put<FeishuWebAppDto>('/admin/feishu/web-app', { enabled })
      setWebApp(next.enabled)
      if (next.manual)
        toast({
          type: 'warning',
          message: t('飞书不允许共工修改该应用，请在开发者后台手动开启网页应用，主页填写 {url}', {
            url: publicUrl,
          }),
        })
      else
        toast({
          type: 'success',
          message: enabled ? t('已提交版本发布，飞书管理员审核通过后生效') : t('已关闭在飞书内打开'),
        })
    } catch (e) {
      toastError(e)
    } finally {
      setTogglingWebApp(false)
    }
  }

  const mainAppId = overview.data?.main?.appId

  return (
    <AdminPage
      title={t('飞书')}
      desc={t(
        '主应用负责飞书一键登录，并把成员发给 Bot 的消息同步到飞书；每个 Bot 的飞书应用在 Bot 设置 › 飞书里接入。',
      )}
    >
      {paramsError ? (
        <Alert
          variant="error"
          description={paramsError}
          retrying={paramsLoading}
          onRetry={() => void loadParams()}
        />
      ) : null}
      {overview.error ? (
        <Alert
          variant="error"
          description={overview.error}
          retrying={overview.loading}
          onRetry={overview.reload}
        />
      ) : null}
      {autoSignup === null && !paramsError && paramsLoading ? <Spinner size={18} /> : null}
      {overview.data ? <FeishuProgress data={overview.data} /> : null}
      {autoSignup !== null ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('对外地址')}</h2>
          <GroupBox>
            <GroupRow
              className="feishu-url-row"
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
              <span className="feishu-url-line">
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
                  loading={savingUrl}
                  done={urlSaved}
                  onClick={() => void saveUrl()}
                >
                  {savingUrl ? t('保存中…') : urlSaved ? t('已保存') : t('保存')}
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
              stacked
              label={t('凭证')}
              description={t('在飞书开发者后台「凭证与基础信息」中获取；保存前会向飞书校验。')}
            >
              <FeishuAppForm
                path="/admin/feishu"
                removeLabel={t('移除主应用')}
                blocked={publicUrl ? undefined : t('先保存对外地址')}
                onChange={overview.reload}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
      {autoSignup !== null && mainAppId && publicUrl ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('飞书网页应用')}</h2>
          <GroupBox>
            <GroupRow
              label={t('在飞书内打开共工链接')}
              description={t(
                '开启时为主应用开通网页应用（主页为对外地址）并提交版本发布，飞书管理员审核通过后，飞书卡片里的共工链接在飞书标签页中打开。',
              )}
            >
              <Switch
                ariaLabel={t('在飞书内打开共工链接')}
                label={webApp ? t('已开启') : t('已关闭#off')}
                checked={webApp}
                disabled={togglingWebApp}
                onChange={(v) => void toggleWebApp(v)}
              />
            </GroupRow>
            <GroupRow
              label="AppLink"
              description={t(
                '在飞书开发者后台「网页应用 › 搜索结果快捷入口」填写此链接，成员在飞书里搜索快捷入口的完整名称即可打开共工（仅电脑端）。',
              )}
            >
              <code className="feishu-app__id">{`https://applink.feishu.cn/client/web_app/open?appId=${mainAppId}`}</code>
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
                disabled={toggling}
                onChange={(v) => void toggle(v)}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
    </AdminPage>
  )
}
