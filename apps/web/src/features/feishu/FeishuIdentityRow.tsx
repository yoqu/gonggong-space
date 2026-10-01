import type { FeishuIdentityView } from '@gonggong/protocol'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import { Button, ConfirmActionDialog, GroupRow, Presence } from '../../ui'
import { useAuthOptions } from '../auth/options'
import { feishuStartUrl } from './login'
import './login.css'

/** 设置 · 账户 · 飞书: the linked Feishu identity (sign-in and @Bot in Feishu need it), or a link to bind one. */
export function FeishuIdentityRow() {
  const options = useAuthOptions()
  const { data, reload } = useGet<FeishuIdentityView>('/me/feishu')
  const { pathname, search } = useLocation()
  const [unlinking, setUnlinking] = useState(false)
  const identity = data?.identity ?? null
  if (!data || (!identity && !options?.feishuLogin)) return null
  return (
    <GroupRow label={t('飞书')} description={t('绑定后可飞书一键登录，并在飞书群里 @Bot')}>
      {identity ? (
        <span className="gs-value-line">
          <span className="feishu-choose__who">
            <span className="feishu-choose__name">{identity.name}</span>
            {identity.email ? <span className="feishu-choose__email">{identity.email}</span> : null}
          </span>
          <Button size="small" onClick={() => setUnlinking(true)}>
            {t('解绑')}
          </Button>
        </span>
      ) : (
        <a className="ui-btn ui-btn--small feishu-login" href={feishuStartUrl(pathname + search, 'link')}>
          {t('绑定飞书')}
        </a>
      )}
      <Presence>
        {unlinking ? (
          <ConfirmActionDialog
            title={t('解绑飞书')}
            message={t('确定解绑飞书身份 {name}？', { name: identity?.name ?? '' })}
            consequences={[t('将无法再用飞书登录'), t('在飞书群里 @Bot 将不再被识别为你')]}
            label={t('解绑飞书')}
            done={t('已解绑飞书')}
            run={() => api.del('/me/feishu').then(reload)}
            onClose={() => setUnlinking(false)}
          />
        ) : null}
      </Presence>
    </GroupRow>
  )
}
