import wasmAsset from 'mediainfo.js/MediaInfoModule.wasm?url'
import type { ProcessContext } from '../../shared/useFileQueue'
import type { Analysis, WorkerMessage } from './types'
import { canUseFallback, measureWithWebAudio } from './webAudioFallback'

// Dùng chung cho Video Checker và Kiểm tra audio.
export type AnalyzeOptions = { skipThumbs?: boolean }

// Phân tích trong worker; nếu WebCodecs từ chối giải mã âm thanh thì thử lại bằng Web Audio trên trang.
export async function analyzeFile(file: File, ctx: ProcessContext, options: AnalyzeOptions = {}): Promise<Analysis> {
  const result = await analyzeInWorker(file, ctx, options)
  const fallback = canUseFallback(result, file)
  if (!fallback.ok) {
    if (fallback.reason && (result.loudness.status === 'unsupported' || result.loudness.status === 'error')) {
      result.notes.push(`Không thử giải mã dự phòng bằng Web Audio vì ${fallback.reason}.`)
    }
    return result
  }
  const firstReason = result.loudness.status === 'unsupported' || result.loudness.status === 'error' ? result.loudness.reason : ''
  try {
    result.loudness = await measureWithWebAudio(file, result, ctx)
    result.notes.push(`Âm thanh được giải mã bằng Web Audio (dự phòng) vì: ${firstReason}`)
  } catch (err) {
    if (ctx.signal.aborted) throw err
    result.loudness = { status: 'error', reason: `${firstReason} Thử Web Audio cũng không giải mã được (${err instanceof Error ? err.message : 'lỗi'}).` }
  }
  return result
}

// Mỗi file chạy trong worker riêng; huỷ = terminate, dừng ngay cả khi đang giải mã.
function analyzeInWorker(file: File, { signal, onProgress }: ProcessContext, options: AnalyzeOptions): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module', name: 'video-checker' })
    const finish = () => {
      worker.terminate()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      reject(new DOMException('Đã huỷ', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort)
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data
      if (msg.type === 'progress') onProgress(msg.progress, msg.stage)
      else if (msg.type === 'result') { finish(); resolve(msg.result) }
      else { finish(); reject(new Error(msg.message)) }
    }
    worker.onerror = event => {
      finish()
      reject(new Error(event.message || 'Worker gặp lỗi'))
    }
    const forceFallback = new URLSearchParams(window.location.search).get('vc-fallback') === '1'
    worker.postMessage({ file, wasmUrl: new URL(wasmAsset, window.location.href).href, forceFallback, skipThumbs: options.skipThumbs })
  })
}

