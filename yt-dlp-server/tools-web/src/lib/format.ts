const numberVi = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${numberVi.format(value)} ${units[unit]}`
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Dấu phẩy và ngoặc kép trong CSV phải được bọc lại; thêm BOM để Excel đọc đúng UTF-8.
export function toCsv(rows: (string | number | null)[][]): string {
  const escape = (cell: string | number | null) => {
    if (cell === null) return ''
    const text = String(cell)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '﻿' + rows.map(row => row.map(escape).join(',')).join('\r\n')
}
