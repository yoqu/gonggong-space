import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { t } from '../../i18n'
import { toast } from '../../ui'
import './login.css'

/** Why a 飞书登录 came back (`?feishu=` set by the server's callback). */
export const FEISHU_RESULT: Record<string, string> = {
  unavailable: t('飞书登录未启用'),
  expired: t('飞书登录已过期，请重新登录'),
  denied: t('已取消飞书授权'),
  failed: t('飞书登录失败，请稍后再试'),
  disabled: t('账号已停用，请联系系统管理员'),
  taken: t('该飞书身份已绑定其他账号'),
  linked: t('已绑定飞书'),
}

/** `silent`: inside the Feishu client an unlinked user is signed up (or matched by email) without the choose page. */
export const feishuStartUrl = (next: string, mode?: 'link' | 'silent') =>
  `/api/auth/feishu/start?${new URLSearchParams({ ...(mode && { mode }), next })}`

/** Running inside the Feishu / Lark client, where authorizing the main app needs no click. */
export const inFeishuClient = () => /\b(Lark|Feishu)\//.test(navigator.userAgent)

export function FeishuLoginButton({ next }: { next: string }) {
  return (
    <a className="ui-btn ui-btn--xlarge ui-btn--full feishu-login" href={feishuStartUrl(next)}>
      {t('飞书登录')}
    </a>
  )
}

/** After linking Feishu from 设置 the callback returns to the page with `?feishu=`; say how it went once. */
export function useFeishuLinkResult(signedIn: boolean) {
  const [params, setParams] = useSearchParams()
  const result = params.get('feishu')
  useEffect(() => {
    if (!signedIn || !result) return
    toast({
      type: result === 'linked' ? 'success' : 'error',
      message: FEISHU_RESULT[result] ?? FEISHU_RESULT.failed,
    })
    setParams(
      (p) => {
        p.delete('feishu')
        return p
      },
      { replace: true },
    )
  }, [signedIn, result, setParams])
}
