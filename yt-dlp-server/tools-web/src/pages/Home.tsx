import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Page, PrivacyNote } from '../components/Layout'
import type { ToolsConfigState } from '../lib/config'
import { href, onLinkClick } from '../lib/router'
import { readPins, writePins } from '../lib/storage'
import { GROUP_LABELS, GROUP_ORDER, TOOLS, type ToolDef, type ToolGroup } from '../registry'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

function ToolCard({ tool, pinned, onTogglePin }: { tool: ToolDef; pinned: boolean; onTogglePin: () => void }) {
  return (
    <div className={`card tool-card${pinned ? ' is-pinned' : ''}`}>
      <span className="tool-icon"><Icon name={tool.icon} size={20} /></span>
      <div className="tool-text">
        <a className="tool-name" href={href(tool.id)} onClick={onLinkClick}>{tool.name}</a>
        <span className="tool-desc">{tool.description}</span>
      </div>
      <button
        type="button"
        className={`icon-btn pin${pinned ? ' is-on' : ''}`}
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? `Bỏ ghim ${tool.name}` : `Ghim ${tool.name}`}
      >
        <Icon name="pin" size={18} filled={pinned} />
      </button>
    </div>
  )
}

export function Home({ config }: { config: ToolsConfigState }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ToolGroup | 'all'>('all')
  const [pins, setPins] = useState<string[]>(() => readPins())

  const enabled = config.status === 'ready' ? TOOLS.filter(tool => config.enabled.has(tool.id)) : []

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return enabled.filter(tool =>
      (group === 'all' || tool.group === group) &&
      (!q || normalize(`${tool.name} ${tool.description} ${GROUP_LABELS[tool.group]}`).includes(q))
    )
  }, [enabled, query, group])

  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id]
    setPins(next)
    writePins(next)
  }

  const pinnedTools = visible.filter(tool => pins.includes(tool.id))
  const groupsWithTools = GROUP_ORDER.filter(g => enabled.some(tool => tool.group === g))

  return (
    <Page>
      <div className="page-head">
        <div>
          <h1>Hey Tools</h1>
          <p className="lead">Công cụ xử lý file cho team media, chạy ngay trên trình duyệt.</p>
        </div>
        <PrivacyNote />
      </div>

      {config.status === 'loading' && <p className="muted" role="status">Đang tải danh sách tool…</p>}
      {config.status === 'error' && (
        <p className="notice notice-fail" role="alert">Không tải được danh sách tool ({config.message}). Thử tải lại trang.</p>
      )}

      {config.status === 'ready' && enabled.length === 0 && (
        <p className="notice" role="status">Chưa có tool nào được bật. Admin bật tool ở trang Quản trị.</p>
      )}

      {enabled.length > 0 && (
        <>
          <div className="filters">
            <label className="search">
              <Icon name="search" size={18} />
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder="Tìm tool… (nén, PDF, LUFS)"
                aria-label="Tìm tool"
              />
            </label>
            {groupsWithTools.length > 1 && (
              <div className="pills" role="group" aria-label="Lọc theo nhóm">
                {(['all', ...groupsWithTools] as const).map(g => (
                  <button key={g} type="button" className="pill" aria-pressed={group === g} onClick={() => setGroup(g)}>
                    {g === 'all' ? 'Tất cả' : GROUP_LABELS[g]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {pinnedTools.length > 0 && (
            <section className="group">
              <div className="group-head">
                <h2 className="eyebrow">Đã ghim</h2>
                <span className="muted small">Lưu trên trình duyệt này</span>
              </div>
              <div className="tool-grid">
                {pinnedTools.map(tool => <ToolCard key={tool.id} tool={tool} pinned onTogglePin={() => togglePin(tool.id)} />)}
              </div>
            </section>
          )}

          {GROUP_ORDER.map(g => {
            const list = visible.filter(tool => tool.group === g)
            if (list.length === 0) return null
            return (
              <section className="group" key={g}>
                <h2 className="eyebrow">{GROUP_LABELS[g]} · {list.length}</h2>
                <div className="tool-grid">
                  {list.map(tool => <ToolCard key={tool.id} tool={tool} pinned={pins.includes(tool.id)} onTogglePin={() => togglePin(tool.id)} />)}
                </div>
              </section>
            )
          })}

          {visible.length === 0 && <p className="muted">Không có tool nào khớp “{query}”.</p>}
        </>
      )}
    </Page>
  )
}
