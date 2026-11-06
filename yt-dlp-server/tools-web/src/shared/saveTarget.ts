import { BufferTarget, StreamTarget, type Target } from 'mediabunny'
import { saveBlob } from './download'

// Nơi ghi file kết quả của mediabunny.
// - File nhỏ: giữ trong RAM rồi tải về như bình thường.
// - File lớn và trình duyệt có hộp thoại "Lưu thành" (Chrome/Edge máy tính): ghi thẳng xuống đĩa,
//   không giữ cả file trong RAM.
export const STREAM_THRESHOLD = 512 * 1024 * 1024
export const MEMORY_LIMIT = 1.5 * 1024 * 1024 * 1024

type SavePicker = (options: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableStream & { close(): Promise<void>; abort(): Promise<void> }> }>

export function canStreamToDisk(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function'
}

export type SaveTarget = {
  target: Target
  mode: 'memory' | 'disk'
  // Gọi sau khi Output.finalize(): tải file (memory) hoặc đóng file đã ghi (disk).
  finish: () => Promise<void>
  abort: () => Promise<void>
}

// PHẢI gọi trong sự kiện bấm nút (hộp thoại Lưu thành cần thao tác của người dùng).
export async function openSaveTarget(filename: string, mimeType: string, estimatedBytes: number): Promise<SaveTarget> {
  if (estimatedBytes > STREAM_THRESHOLD && canStreamToDisk()) {
    const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
    const handle = await picker({ suggestedName: filename, types: ext ? [{ description: 'Kết quả', accept: { [mimeType]: [ext] } }] : undefined })
    const writable = await handle.createWritable()
    return {
      target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
      mode: 'disk',
      finish: async () => { /* StreamTarget tự đóng writable khi finalize */ },
      abort: async () => { await writable.abort().catch(() => {}) }
    }
  }
  if (estimatedBytes > MEMORY_LIMIT) {
    throw new Error(`Kết quả dự kiến khoảng ${(estimatedBytes / 1024 ** 3).toFixed(1)} GB, quá lớn để giữ trong RAM của trình duyệt này. Dùng Chrome hoặc Edge trên máy tính để ghi thẳng xuống ổ đĩa.`)
  }
  const target = new BufferTarget()
  return {
    target,
    mode: 'memory',
    finish: async () => {
      if (!target.buffer) throw new Error('Không có dữ liệu kết quả')
      saveBlob(new Blob([target.buffer], { type: mimeType }), filename)
    },
    abort: async () => {}
  }
}
