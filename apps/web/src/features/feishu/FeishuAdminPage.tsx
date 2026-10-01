import type { SystemParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { GroupBox, GroupRow, Switch, toast } from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { FeishuAppForm } from './FeishuAppForm'

/** 管理后台 · 飞书: the system-wide main app (飞书登录, mirroring people's messages) and auto sign-up. */
export function FeishuAdminPage() {
  const [autoSignup, setAutoSignup] = useState<boolean | null>(null)
  useEffect(() => {
    api.get<SystemParams>('/admin/params').then((p) => setAutoSignup(p.feishuAutoSignup), toastError)
  }, [])

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
        '主应用负责飞书一键登录，并把成员发给 Bot 的消息同步到飞书；每个 Bot 的应用在 Bot 设置中绑定。',
      )}
    >
      <section className="admin-params">
        <h2 className="admin-params__title">{t('主应用')}</h2>
        <GroupBox>
          <GroupRow
            label={t('凭证')}
            description={t('在飞书开发者后台「凭证与基础信息」中获取；保存前会向飞书校验。')}
          >
            <FeishuAppForm path="/admin/feishu" removeLabel={t('移除主应用')} />
          </GroupRow>
        </GroupBox>
      </section>
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
