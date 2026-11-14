import { Link } from 'react-router'
import { t } from '../i18n'
import { EmptyState } from '../ui'

export function NotFound() {
  return (
    <div className="not-found">
      <EmptyState
        bare
        title={t('页面不存在')}
        description={t('链接可能已失效，或你没有访问权限。')}
        actions={
          <Link to="/" className="ui-btn ui-btn--primary ui-btn--md">
            {t('返回消息')}
          </Link>
        }
      />
    </div>
  )
}
