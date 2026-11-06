// Thời gian dạng người đọc: "75", "1:15", "01:15,5", "1:02:03.25" → giây. Trả null nếu không hợp lệ.
export function parseTime(input: string): number | null {
  const text = input.trim().replace(',', '.')
  if (!text) return null
  const parts = text.split(':')
  if (parts.length > 3 || parts.some(p => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + Number(part)
  return Number.isFinite(seconds) ? seconds : null
}

// 75.5 → "01:15,50"; ≥ 1 giờ → "1:01:15,50".
export function formatTime(seconds: number, digits = 2): string {
  if (!Number.isFinite(seconds)) return '—'
  const sign = seconds < 0 ? '−' : ''
  const abs = Math.abs(seconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs - h * 3600 - m * 60
  const ss = s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0').replace('.', ',')
  return `${sign}${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${ss}`
}

// Tên file an toàn cho mốc thời gian: 75.5 → "00m15s500".
export function timeForFilename(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const rest = ms % 1000
  return `${h ? `${h}h` : ''}${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s${String(rest).padStart(3, '0')}`
}

export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}
