import { LoudnessMeter } from './loudness'
import type { Analysis, LoudnessInfo } from './types'
import type { ProcessContext } from '../../shared/useFileQueue'

// Dự phòng khi WebCodecs (trong worker) từ chối giải mã âm thanh: dùng Web Audio decodeAudioData trên trang.
// Vẫn xử lý trên máy, nhưng phải đọc CẢ file vào RAM → chỉ áp dụng cho file vừa phải.
export const FALLBACK_MAX_BYTES = 1024 * 1024 * 1024 // 1 GB
export const FALLBACK_MAX_SECONDS = 30 * 60

export function canUseFallback(a: Analysis, file: File): { ok: boolean; reason?: string } {
  if (!a.audio || (a.loudness.status !== 'unsupported' && a.loudness.status !== 'error')) return { ok: false }
  if (typeof OfflineAudioContext === 'undefined') return { ok: false, reason: 'trình duyệt không có Web Audio' }
  if (file.size > FALLBACK_MAX_BYTES) return { ok: false, reason: 'file lớn hơn 1 GB' }
  if ((a.file.durationSec ?? 0) > FALLBACK_MAX_SECONDS) return { ok: false, reason: 'âm thanh dài hơn 30 phút' }
  return { ok: true }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export async function measureWithWebAudio(file: File, a: Analysis, { signal, onProgress }: ProcessContext): Promise<LoudnessInfo> {
  onProgress(-1, 'Đo loudness bằng Web Audio (dự phòng)')
  const data = await file.arrayBuffer()
  if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
  // Đặt sample rate của context = sample rate của file để decodeAudioData KHÔNG resample (resample làm lệch peak).
  const sampleRate = Math.min(384000, Math.max(8000, a.audio?.sampleRate ?? 48000))
  const ctx = new OfflineAudioContext(Math.max(1, a.audio?.channels ?? 2), 1, sampleRate)
  const buffer = await ctx.decodeAudioData(data)
  const meter = new LoudnessMeter(buffer.sampleRate, buffer.numberOfChannels)
  const planes = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const step = buffer.sampleRate // 1 giây mỗi lần, nhường luồng giao diện giữa các lần
  for (let start = 0; start < buffer.length; start += step) {
    if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
    const end = Math.min(buffer.length, start + step)
    meter.push(planes.map(p => p.subarray(start, end)))
    if ((start / step) % 5 === 0) {
      const p = end / buffer.length
      onProgress(p, `Đo loudness (dự phòng) ${Math.round(p * 100)}%`)
      await tick()
    }
  }
  return { status: 'ok', decodedBy: 'webaudio', ...meter.result() }
}
