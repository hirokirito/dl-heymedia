import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { formatBytes } from '../lib/format'
import type { QueueItem } from './useFileQueue'

export type Verdict = 'pass' | 'warn' | 'fail' | 'unknown'

const VERDICT: Record<Verdict, { label: string; icon: 'check' | 'alert' | 'xCircle' | 'help' }> = {
  pass: { label: 'Đạt', icon: 'check' },
  warn: { label: 'Cảnh báo', icon: 'alert' },
  fail: { label: 'Không đạt', icon: 'xCircle' },
  unknown: { label: 'Không xác định', icon: 'help' }
}

// Nhãn trạng thái luôn có chữ + icon, không chỉ dựa vào màu.
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  return (
    <span className={`chip chip-${verdict}`}>
      <Icon name={v.icon} size={14} strokeWidth={2.5} />
      {v.label}
    </span>
  )
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const indeterminate = value < 0 || value > 1
  return (
    <div
      className={`progress${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
    >
      <div className="progress-fill" style={indeterminate ? undefined : { width: `${value * 100}%` }} />
    </div>
  )
}

type Props<R> = {
  items: QueueItem<R>[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onCancel: (id: string) => void
  onRemove: (id: string) => void
  // Dòng tóm tắt + nhãn kết quả cho file đã xong, do từng tool quyết định.
  describe?: (item: QueueItem<R>) => { summary: ReactNode; verdict?: Verdict }
}

export function QueueList<R>({ items, selectedId, onSelect, onCancel, onRemove, describe }: Props<R>) {
  return (
    <ul className="queue" aria-label="Hàng đợi">
      {items.map(item => {
        const info = item.status === 'done' && describe ? describe(item) : null
        const selectable = item.status === 'done' && onSelect
        const selected = selectedId === item.id
        return (
          <li key={item.id} className={`queue-row${selected ? ' is-selected' : ''}`}>
            <div className="queue-main">
              {selectable ? (
                <button type="button" className="queue-name as-link" onClick={() => onSelect(item.id)} aria-pressed={selected}>
                  {item.file.name}
                </button>
              ) : (
                <span className="queue-name">{item.file.name}</span>
              )}
              <span className="queue-meta">
                {formatBytes(item.file.size)}
                {' · '}
                {item.status === 'error' ? item.error : info ? info.summary : item.stage}
              </span>
              {item.status === 'running' && <ProgressBar value={item.progress} label={`Tiến độ ${item.file.name}`} />}
            </div>
            <div className="queue-side">
              {info?.verdict && <VerdictChip verdict={info.verdict} />}
              {item.status === 'error' && <VerdictChip verdict="fail" />}
              {item.status === 'cancelled' && <span className="muted small">Đã huỷ</span>}
              {(item.status === 'running' || item.status === 'queued') ? (
                <button type="button" className="btn btn-ghost" onClick={() => onCancel(item.id)}>
                  <Icon name="x" size={16} />Huỷ
                </button>
              ) : (
                <button type="button" className="icon-btn" onClick={() => onRemove(item.id)} aria-label={`Bỏ ${item.file.name} khỏi hàng đợi`}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
