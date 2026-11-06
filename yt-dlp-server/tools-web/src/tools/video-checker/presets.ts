import type { Verdict } from '../../shared/QueueList'
import type { Analysis } from './types'

// Preset khởi đầu — Sang sẽ chỉnh. Chỉ cần sửa ở đây, giao diện và CSV tự theo.
export type Preset = {
  id: string
  name: string
  summary: string
  resolution?: { width: number; height: number }
  loudness?: { target: number; tolerance: number } // LUFS ± LU
  truePeakMax?: number // dBTP
}

export const PRESETS: Preset[] = [
  { id: 'clip-doc', name: 'Clip dọc', summary: '1080×1920 · −14 LUFS ±2 LU', resolution: { width: 1080, height: 1920 }, loudness: { target: -14, tolerance: 2 }, truePeakMax: -1 },
  { id: 'restream', name: 'Restream', summary: '1920×1080 · −14 LUFS ±2 LU', resolution: { width: 1920, height: 1080 }, loudness: { target: -14, tolerance: 2 }, truePeakMax: -1 },
  { id: 'tu-do', name: 'Tự do', summary: 'Chỉ đo, không chấm Đạt/Không đạt' }
]

export type Check = { verdict: Verdict; text: string }

const fmt = (n: number, digits = 1) => n.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/^-/, '−')

// Mỗi tiêu chí trả về một dòng có lý do. Thiếu dữ liệu → "Không xác định", không đoán.
export function evaluate(a: Analysis, preset: Preset): { verdict: Verdict | null; checks: Check[] } {
  const checks: Check[] = []

  if (preset.resolution) {
    const { width, height } = preset.resolution
    const v = a.video
    if (!v) checks.push({ verdict: 'fail', text: 'File không có video' })
    else if (v.displayWidth === null || v.displayHeight === null) checks.push({ verdict: 'unknown', text: 'Không đọc được độ phân giải' })
    else if (v.displayWidth === width && v.displayHeight === height) checks.push({ verdict: 'pass', text: `Độ phân giải ${width}×${height} đúng preset` })
    else checks.push({ verdict: 'fail', text: `Độ phân giải ${v.displayWidth}×${v.displayHeight}, preset cần ${width}×${height}` })
  }

  if (preset.loudness) {
    const { target, tolerance } = preset.loudness
    const lo = target - tolerance
    const hi = target + tolerance
    const l = a.loudness
    if (l.status === 'no-audio') checks.push({ verdict: 'warn', text: 'File không có âm thanh' })
    else if (l.status !== 'ok') checks.push({ verdict: 'unknown', text: `Chưa đo được loudness: ${l.reason}` })
    else if (l.integratedLufs === null) checks.push({ verdict: 'warn', text: 'Âm thanh im lặng hoặc quá nhỏ (dưới −70 LUFS). Video tải từ mạng xã hội thường bị nền tảng gỡ nhạc vì bản quyền.' })
    else if (l.integratedLufs >= lo && l.integratedLufs <= hi) checks.push({ verdict: 'pass', text: `Loudness ${fmt(l.integratedLufs)} LUFS, nằm trong ${fmt(lo, 0)} … ${fmt(hi, 0)} LUFS` })
    else checks.push({ verdict: 'warn', text: `Loudness ${fmt(l.integratedLufs)} LUFS, ${l.integratedLufs < lo ? 'thấp hơn' : 'cao hơn'} ngưỡng ${fmt(l.integratedLufs < lo ? lo : hi, 0)} LUFS` })

    if (preset.truePeakMax !== undefined && l.status === 'ok' && l.truePeakDbtp !== null) {
      checks.push(l.truePeakDbtp <= preset.truePeakMax
        ? { verdict: 'pass', text: `True peak ${fmt(l.truePeakDbtp)} dBTP, không vượt ${fmt(preset.truePeakMax, 0)} dBTP` }
        : { verdict: 'warn', text: `True peak ${fmt(l.truePeakDbtp)} dBTP, vượt ${fmt(preset.truePeakMax, 0)} dBTP (có thể bị méo khi nền tảng nén lại)` })
    }
  }

  if (preset.resolution && a.video?.frameRateMode === 'VFR') checks.push({ verdict: 'warn', text: 'Khung hình thay đổi (VFR)' })
  if (preset.resolution && a.video?.hdr && a.video.hdr !== 'SDR') checks.push({ verdict: 'warn', text: `Video HDR (${a.video.hdr})` })

  if (!checks.length) return { verdict: null, checks }
  const verdict: Verdict = checks.some(c => c.verdict === 'fail') ? 'fail'
    : checks.some(c => c.verdict === 'unknown') ? 'unknown'
    : checks.some(c => c.verdict === 'warn') ? 'warn'
    : 'pass'
  return { verdict, checks }
}
