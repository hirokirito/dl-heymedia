// localStorage có thể ném lỗi (chế độ riêng tư, bị chặn) — mọi truy cập đều bọc try/catch
// và trang vẫn chạy bình thường khi không lưu được.
const PINS_KEY = 'heytools:pins:v1'

export function readPins(): string[] {
  try {
    const raw = window.localStorage.getItem(PINS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

export function writePins(ids: string[]): void {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(ids))
  } catch {
    // Không lưu được thì ghim chỉ có tác dụng trong phiên này.
  }
}
