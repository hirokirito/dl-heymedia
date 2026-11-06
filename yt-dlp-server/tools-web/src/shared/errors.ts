// Đổi lỗi kỹ thuật thành câu tiếng Việt ngắn cho người dùng; chi tiết vẫn ở console.
export function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') return 'Đã huỷ'
    if (err.name === 'NotReadableError') return 'Không đọc được file. File có thể đã bị di chuyển hoặc đang bị khoá.'
    if (err.name === 'QuotaExceededError') return 'Trình duyệt hết bộ nhớ khi xử lý file này.'
  }
  if (err instanceof RangeError) return 'File quá lớn so với bộ nhớ trình duyệt cho phép.'
  console.error('[hey-tools]', err)
  if (err instanceof Error && err.message) return err.message
  return 'Có lỗi xảy ra khi xử lý file.'
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
}
