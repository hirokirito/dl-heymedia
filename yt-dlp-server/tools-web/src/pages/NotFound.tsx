import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { href, onLinkClick } from '../lib/router'

export function NotFound() {
  return (
    <Page>
      <div className="empty-state">
        <span className="empty-icon"><Icon name="help" size={28} /></span>
        <h1>Không có tool này</h1>
        <p className="lead">Đường dẫn có thể đã cũ hoặc gõ nhầm.</p>
        <a className="btn btn-primary" href={href('')} onClick={onLinkClick}>
          <Icon name="back" size={16} />Về danh sách tool
        </a>
      </div>
    </Page>
  )
}
