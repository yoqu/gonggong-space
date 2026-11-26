import { useNavigate } from 'react-router'
import { t } from '../i18n'
import { Button, DeniedArt, EmptyState } from '../ui'

export function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="not-found">
      <EmptyState
        bare
        illustration={<DeniedArt />}
        title={t('页面不存在')}
        description={t('链接可能已失效，或你没有访问权限。')}
        actions={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('返回消息')}
          </Button>
        }
      />
    </div>
  )
}
