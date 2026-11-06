import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { fetchAdminConfig, HttpError, saveAdminConfig, type AdminConfig } from '../lib/config'
import { formatDateTime } from '../lib/format'
import { GROUP_LABELS, GROUP_ORDER, TOOLS } from '../registry'

type State =
  | { status: 'loading' }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: AdminConfig }

export function Admin() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminConfig(controller.signal)
      .then(config => setState({ status: 'ready', config }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          setState({ status: 'denied', message: err.message })
        } else {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Không tải được cấu hình' })
        }
      })
    return () => controller.abort()
  }, [])

  const toggle = async (id: string, next: boolean) => {
    if (state.status !== 'ready' || saving) return
    const previous = state.config
    const tools = { ...previous.tools, [id]: next }
    setSaving(id)
    setSaveError(null)
    setState({ status: 'ready', config: { ...previous, tools } }) // cập nhật ngay, hoàn tác nếu lỗi
    try {
      const saved = await saveAdminConfig(tools)
      setState({ status: 'ready', config: saved })
    } catch (err) {
      setState({ status: 'ready', config: previous })
      setSaveError(err instanceof Error ? `Chưa lưu được: ${err.message}` : 'Chưa lưu được thay đổi.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Page active="admin">
      <div className="page-head">
        <div>
          <h1>Bật/tắt tool</h1>
          <p className="lead">Tool đang tắt không hiện với team và không tải code. Thay đổi được lưu ngay khi gạt công tắc.</p>
        </div>
      </div>

      {state.status === 'loading' && <p className="muted" role="status">Đang tải cấu hình…</p>}

      {state.status === 'denied' && (
        <div className="notice notice-fail" role="alert">
          <strong>Chưa vào được trang quản trị.</strong> {state.message}
        </div>
      )}

      {state.status === 'error' && <p className="notice notice-fail" role="alert">Không tải được cấu hình: {state.message}</p>}

      {state.status === 'ready' && (() => {
        const { config } = state
        const unconfigured = TOOLS.filter(tool => !(tool.id in config.tools))
        return (
          <>
            <div className="card identity">
              <span className="ok-text"><Icon name="shield" size={18} /></span>
              <span className="identity-text">Đăng nhập qua Cloudflare Access: <strong>{config.viewer}</strong> · quyền admin</span>
              <span className="muted small">Server kiểm tra lại quyền mỗi lần lưu</span>
            </div>

            {unconfigured.length > 0 && (
              <p className="notice notice-warn" role="status">
                <Icon name="alert" size={18} />
                {unconfigured.length} tool mới chưa cấu hình, đang tắt mặc định: {unconfigured.map(t => t.name).join(', ')}.
              </p>
            )}

            {saveError && <p className="notice notice-fail" role="alert">{saveError}</p>}

            {GROUP_ORDER.map(group => {
              const list = TOOLS.filter(tool => tool.group === group)
              if (list.length === 0) return null
              const onCount = list.filter(tool => config.tools[tool.id] === true).length
              return (
                <section className="card admin-group" key={group}>
                  <div className="admin-group-head">
                    <h2 className="eyebrow">{GROUP_LABELS[group]} · {onCount}/{list.length} đang bật</h2>
                    <span className="muted small">
                      Lưu lần cuối {formatDateTime(config.updatedAt)}{config.updatedBy ? ` · ${config.updatedBy}` : ''}
                    </span>
                  </div>
                  {list.map(tool => {
                    const on = config.tools[tool.id] === true
                    const isNew = !(tool.id in config.tools)
                    return (
                      <div className="admin-row" key={tool.id}>
                        <span className={`tool-icon${on ? '' : ' is-off'}`}><Icon name={tool.icon} size={20} /></span>
                        <div className="admin-row-text">
                          <span className="admin-row-name">
                            {tool.name}
                            {isNew && <span className="chip chip-warn">Mới · chưa cấu hình</span>}
                          </span>
                          <span className="muted small">/tools/{tool.id}</span>
                        </div>
                        <span className={`small ${on ? 'ok-text' : 'muted'}`}>{saving === tool.id ? 'Đang lưu…' : on ? 'Đang bật' : 'Đang tắt'}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={tool.name}
                          className="switch"
                          disabled={saving !== null}
                          onClick={() => toggle(tool.id, !on)}
                        >
                          <span className="switch-track"><span className="switch-thumb" /></span>
                        </button>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </>
        )
      })()}
    </Page>
  )
}
