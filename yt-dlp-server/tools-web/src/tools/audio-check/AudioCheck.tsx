import { useCallback, useState } from 'react'
import { Icon } from '../../components/Icon'
import { formatBytes, toCsv } from '../../lib/format'
import { formatTime } from '../../lib/time'
import { saveText } from '../../shared/download'
import { DropZone } from '../../shared/DropZone'
import { QueueList, VerdictChip, type Verdict } from '../../shared/QueueList'
import { useFileQueue, type ProcessContext, type QueueItem } from '../../shared/useFileQueue'
import { analyzeFile } from '../video-checker/client'
import type { Analysis } from '../video-checker/types'

// Mục tiêu loudness phổ biến — Sang có thể chỉnh.
type Target = { id: string; name: string; lufs: number | null; tolerance: number; truePeakMax: number }
const TARGETS: Target[] = [
  { id: 'social', name: 'Mạng xã hội', lufs: -14, tolerance: 1, truePeakMax: -1 },
  { id: 'podcast', name: 'Podcast', lufs: -16, tolerance: 1, truePeakMax: -1 },
  { id: 'ebu', name: 'Phát sóng (EBU R128)', lufs: -23, tolerance: 0.5, truePeakMax: -1 },
  { id: 'free', name: 'Tự do (chỉ đo)', lufs: null, tolerance: 0, truePeakMax: 0 }
]

const num = (v: number | null | undefined, digits = 1, unit = '') =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/^-/, '−')}${unit}`

type Judged = { verdict: Verdict | null; reasons: string[]; gain: number | null }

function judge(a: Analysis, t: Target): Judged {
  const l = a.loudness
  if (l.status === 'no-audio') return { verdict: 'fail', reasons: ['Không có âm thanh'], gain: null }
  if (l.status !== 'ok') return { verdict: 'unknown', reasons: [l.reason], gain: null }
  if (l.integratedLufs === null) return { verdict: 'warn', reasons: ['Im lặng hoặc quá nhỏ (dưới −70 LUFS)'], gain: null }
  if (t.lufs === null) return { verdict: null, reasons: [], gain: null }
  const gain = t.lufs - l.integratedLufs
  const reasons: string[] = []
  let verdict: Verdict = 'pass'
  if (Math.abs(gain) > t.tolerance) {
    verdict = 'warn'
    reasons.push(`Cần ${gain > 0 ? 'tăng' : 'giảm'} ${num(Math.abs(gain), 1, ' dB')} để đạt ${num(t.lufs, 0, ' LUFS')}`)
  }
  if (l.truePeakDbtp !== null && l.truePeakDbtp > t.truePeakMax) {
    verdict = 'warn'
    reasons.push(`True peak ${num(l.truePeakDbtp, 1, ' dBTP')} vượt ${num(t.truePeakMax, 0, ' dBTP')}`)
  } else if (l.truePeakDbtp !== null && gain > 0 && l.truePeakDbtp + gain > t.truePeakMax) {
    reasons.push(`Nếu tăng ${num(gain, 1, ' dB')} thì true peak lên ${num(l.truePeakDbtp + gain, 1, ' dBTP')}: cần limiter`)
  }
  return { verdict, reasons, gain }
}

export default function AudioCheck() {
  const process = useCallback((file: File, ctx: ProcessContext) => analyzeFile(file, ctx, { skipThumbs: true }), [])
  const queue = useFileQueue(process, { maxFiles: 10 })
  const [targetId, setTargetId] = useState('social')
  const target = TARGETS.find(t => t.id === targetId) ?? TARGETS[0]
  const done = queue.items.filter(i => i.status === 'done' && i.result) as (QueueItem<Analysis> & { result: Analysis })[]

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['file', 'ket_qua', 'ly_do', 'codec', 'sample_rate', 'so_kenh', 'bit_depth', 'bitrate', 'thoi_luong_giay', 'lufs', 'true_peak_dbtp', 'sample_peak_dbfs', 'gain_can_chinh_db']]
    const label = { pass: 'Đạt', warn: 'Cảnh báo', fail: 'Không đạt', unknown: 'Không xác định' } as const
    for (const i of done) {
      const a = i.result
      const j = judge(a, target)
      const l = a.loudness.status === 'ok' ? a.loudness : null
      const r = (x: number | null | undefined) => (x === null || x === undefined ? null : Number(x.toFixed(2)))
      rows.push([i.file.name, j.verdict ? label[j.verdict] : 'Chỉ đo', j.reasons.join('; ') || null, a.audio?.codec ?? null, a.audio?.sampleRate ?? null, a.audio?.channels ?? null, a.audio?.bitDepth ?? null, a.audio?.bitrate ?? null, r(a.file.durationSec), r(l?.integratedLufs), r(l?.truePeakDbtp), r(l?.samplePeakDbfs), r(j.gain)])
    }
    saveText(toCsv(rows), `kiem-tra-audio-${target.id}.csv`, 'text/csv;charset=utf-8')
  }

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <DropZone title="Thả file âm thanh hoặc video vào đây" hint="WAV, MP3, M4A, FLAC, OGG, MP4, MOV… · tối đa 10 file" accept="audio/*,video/*,.flac,.wav,.m4a,.mkv,.mov" onFiles={queue.addFiles} />
        {queue.rejected && <p className="notice notice-warn" role="status">{queue.rejected}</p>}
        {queue.items.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2 className="eyebrow">Hàng đợi · {queue.items.length} file</h2>
              <button type="button" className="btn btn-ghost" onClick={queue.clear}>Xoá hàng đợi</button>
            </div>
            <QueueList
              items={queue.items}
              onCancel={queue.cancel}
              onRemove={queue.remove}
              describe={item => {
                const a = item.result!
                const j = judge(a, target)
                const l = a.loudness.status === 'ok' ? a.loudness : null
                return {
                  summary: [l ? (l.integratedLufs === null ? 'im lặng' : num(l.integratedLufs, 1, ' LUFS')) : 'chưa đo được', l ? `TP ${num(l.truePeakDbtp, 1, ' dBTP')}` : null, ...j.reasons].filter(Boolean).join(' · '),
                  verdict: j.verdict ?? undefined
                }
              }}
            />
          </section>
        )}
        {done.length > 0 && (
          <section className="card table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Thông số âm thanh</caption>
              <thead>
                <tr><th>File</th><th>Codec</th><th>Sample rate</th><th>Kênh</th><th>Bit depth</th><th>Bitrate</th><th>Thời lượng</th><th>LUFS</th><th>True peak</th><th>Sample peak</th><th>Kết quả</th></tr>
              </thead>
              <tbody>
                {done.map(i => {
                  const a = i.result
                  const l = a.loudness.status === 'ok' ? a.loudness : null
                  const j = judge(a, target)
                  return (
                    <tr key={i.id}>
                      <td className="cell-name">{i.file.name}<span className="muted small">{formatBytes(i.file.size)}</span></td>
                      <td>{a.audio?.codec ?? '—'}</td>
                      <td>{a.audio?.sampleRate ? `${num(a.audio.sampleRate / 1000, a.audio.sampleRate % 1000 ? 1 : 0)} kHz` : '—'}</td>
                      <td>{a.audio?.channels ?? '—'}</td>
                      <td>{a.audio?.bitDepth ? `${a.audio.bitDepth}-bit` : '—'}</td>
                      <td>{a.audio?.bitrate ? `${Math.round(a.audio.bitrate / 1000)} kb/s` : '—'}</td>
                      <td>{a.file.durationSec !== null ? formatTime(a.file.durationSec, 1) : '—'}</td>
                      <td>{l ? (l.integratedLufs === null ? 'im lặng' : num(l.integratedLufs)) : '—'}</td>
                      <td>{l ? num(l.truePeakDbtp) : '—'}</td>
                      <td>{l ? num(l.samplePeakDbfs) : '—'}</td>
                      <td>{j.verdict ? <VerdictChip verdict={j.verdict} /> : <span className="muted small">Chỉ đo</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Mục tiêu loudness</h2>
          <fieldset className="vc-presets">
            <legend className="visually-hidden">Mục tiêu loudness</legend>
            {TARGETS.map(t => (
              <label key={t.id} className={`vc-preset${t.id === target.id ? ' is-on' : ''}`}>
                <input type="radio" name="ac-target" checked={t.id === target.id} onChange={() => setTargetId(t.id)} />
                <span>
                  <span className="vc-preset-name">{t.name}</span>
                  <span className="muted small">{t.lufs === null ? 'Không chấm, chỉ hiện số đo' : `${num(t.lufs, 0, ' LUFS')} ±${num(t.tolerance, t.tolerance % 1 ? 1 : 0)} LU · true peak ≤ ${num(t.truePeakMax, 0, ' dBTP')}`}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
        <section className="card stack">
          <h2 className="eyebrow">Xuất kết quả</h2>
          <button type="button" className="btn btn-primary" disabled={done.length === 0} onClick={exportCsv}>
            <Icon name="download" size={16} />Xuất CSV ({done.length} file)
          </button>
          <p className="muted small">Loudness theo ITU-R BS.1770-4, true peak nội suy 4×. Đo trên máy bạn, không tải file lên.</p>
        </section>
      </aside>
    </div>
  )
}
