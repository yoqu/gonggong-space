import { Link } from 'react-router'
import { EmptyState } from '../ui'

export function NotFound() {
  return (
    <div className="not-found">
      <EmptyState
        bare
        title="页面不存在"
        description="链接可能已失效，或你没有访问权限。"
        actions={
          <Link to="/" className="ui-btn ui-btn--primary ui-btn--md">
            返回消息
          </Link>
        }
      />
    </div>
  )
}
