import { Component, lazy, Suspense, useMemo, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { BackLink, Page, PrivacyNote } from '../components/Layout'
import type { ToolsConfigState } from '../lib/config'
import { href, onLinkClick } from '../lib/router'
import { findTool, type ToolDef } from '../registry'
import { NotFound } from './NotFound'

class ToolErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('[hey-tools] tool crashed', error)
  }
  render() {
    if (this.state.failed) {
      return <p className="notice notice-fail" role="alert">Tool gặp lỗi và đã dừng. Tải lại trang để thử lại; file của bạn không bị gửi đi đâu.</p>
    }
    return this.props.children
  }
}

function ToolDisabled({ tool }: { tool: ToolDef }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name="lock" size={28} /></span>
      <h1>Tool này đang tắt</h1>
      <p className="lead">“{tool.name}” chưa được bật cho team. Nếu bạn cần dùng, nhắn admin để bật.</p>
      <a className="btn btn-primary" href={href('')} onClick={onLinkClick}>
        <Icon name="back" size={16} />Về danh sách tool
      </a>
    </div>
  )
}

function LoadedTool({ tool }: { tool: ToolDef }) {
  // Chỉ gọi import() khi tool đang bật và người dùng mở đúng trang của nó.
  const LazyTool = useMemo(() => lazy(tool.load), [tool])
  return (
    <>
      <BackLink />
      <div className="page-head tool-head">
        <div className="tool-title">
          <span className="tool-icon lg"><Icon name={tool.icon} size={24} /></span>
          <div>
            <h1>{tool.name}</h1>
            <p className="lead">{tool.description}</p>
          </div>
        </div>
        <PrivacyNote />
      </div>
      <ToolErrorBoundary>
        <Suspense fallback={<p className="muted" role="status">Đang tải tool…</p>}>
          <LazyTool />
        </Suspense>
      </ToolErrorBoundary>
    </>
  )
}

export function ToolPage({ id, config }: { id: string; config: ToolsConfigState }) {
  const tool = findTool(id)
  if (!tool) return <NotFound />

  return (
    <Page>
      {config.status === 'loading' && <p className="muted" role="status">Đang kiểm tra tool…</p>}
      {config.status === 'error' && (
        <p className="notice notice-fail" role="alert">Không kiểm tra được trạng thái tool ({config.message}). Thử tải lại trang.</p>
      )}
      {config.status === 'ready' && (config.enabled.has(tool.id) ? <LoadedTool tool={tool} /> : <ToolDisabled tool={tool} />)}
    </Page>
  )
}
