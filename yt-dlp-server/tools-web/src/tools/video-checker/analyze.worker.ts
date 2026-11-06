/// <reference lib="webworker" />
// Phân tích 1 file trong Web Worker: không chặn giao diện, huỷ = terminate worker (dừng ngay cả khi đang giải mã).
// File được đọc từng khúc bằng File.slice() — không tải cả file vào RAM, không gửi đi đâu.
import mediaInfoFactory from 'mediainfo.js'
import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input, PCM_AUDIO_CODECS, type InputAudioTrack, type InputVideoTrack } from 'mediabunny'
import { LoudnessMeter } from './loudness'
import { mapMediaInfo } from './mediainfoMap'
import type { Analysis, LoudnessInfo, Thumb, WorkerMessage, WorkerRequest } from './types'

const post = (msg: WorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)

let lastProgressAt = 0
function progress(value: number, stage: string, force = false) {
  const now = performance.now()
  if (!force && now - lastProgressAt < 200) return
  lastProgressAt = now
  post({ type: 'progress', progress: value, stage })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} quá ${Math.round(ms / 1000)} giây`)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

// Lỗi WebCodecs là tiếng Anh kỹ thuật; đổi sang câu dễ hiểu, giữ tên lỗi gốc trong ngoặc để tra cứu.
function friendlyDecodeError(err: unknown, codec: string | null): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  if (/unsupported configuration|isConfigSupported|NotSupportedError/i.test(raw)) {
    return `Bộ giải mã của trình duyệt từ chối âm thanh ${codec ?? ''} trong file này (${err instanceof Error ? err.name : 'lỗi'}).`.replace('  ', ' ')
  }
  return `Lỗi khi giải mã âm thanh: ${raw}`
}

async function readSpecs(file: File, wasmUrl: string) {
  const mediainfo = await mediaInfoFactory({ format: 'object', locateFile: () => wasmUrl })
  try {
    const raw = await mediainfo.analyzeData(file.size, async (chunkSize, offset) => {
      const buf = await file.slice(offset, offset + chunkSize).arrayBuffer()
      return new Uint8Array(buf)
    })
    return mapMediaInfo(raw, file.size)
  } finally {
    mediainfo.close()
  }
}

async function makeThumbs(track: InputVideoTrack, durationSec: number | null): Promise<{ thumbs: Thumb[]; note: string | null }> {
  if (!(await track.canDecode())) {
    return { thumbs: [], note: `Trình duyệt này không giải mã được video ${track.codec ?? 'không rõ codec'}; thông số vẫn đọc được. Thử Safari/Chrome trên máy có hỗ trợ phần cứng.` }
  }
  const start = await track.getFirstTimestamp()
  const end = durationSec ?? (await track.computeDuration())
  const landscape = track.displayWidth >= track.displayHeight
  const sink = new CanvasSink(track, landscape ? { width: 320, fit: 'contain' } : { height: 320, fit: 'contain' })
  const points: [string, number][] = [
    ['Đầu', start],
    ['Giữa', start + (end - start) / 2],
    ['Cuối', Math.max(start, end - 0.1)]
  ]
  const thumbs: Thumb[] = []
  for (const [label, time] of points) {
    try {
      const wrapped = await withTimeout(sink.getCanvas(time), 30_000, `Tạo thumbnail ${label.toLowerCase()}`)
      const canvas = wrapped?.canvas as OffscreenCanvas | undefined
      const blob = canvas ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }) : null
      thumbs.push({ label, timeSec: wrapped?.timestamp ?? time, blob })
    } catch (err) {
      thumbs.push({ label, timeSec: time, blob: null })
      console.warn('[video-checker] thumbnail', label, err)
    }
  }
  return { thumbs, note: thumbs.every(t => !t.blob) ? 'Không lấy được khung hình nào.' : null }
}

async function measureLoudness(track: InputAudioTrack, durationSec: number | null, codecName: string | null): Promise<LoudnessInfo> {
  if (!(await track.canDecode())) {
    return { status: 'unsupported', reason: `Bộ giải mã WebCodecs của trình duyệt không hỗ trợ âm thanh ${codecName ?? track.codec ?? 'không rõ codec'}.` }
  }
  const start = await track.getFirstTimestamp()
  const duration = durationSec ?? (await track.computeDuration())
  let meter: LoudnessMeter | null = null
  const sink = new AudioSampleSink(track)
  for await (const sample of sink.samples()) {
    try {
      if (!meter) meter = new LoudnessMeter(sample.sampleRate, sample.numberOfChannels)
      const planes: Float32Array[] = []
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
        planes.push(plane)
      }
      meter.push(planes)
      if (duration > 0) {
        const p = Math.min(0.999, Math.max(0, (sample.timestamp - start) / duration))
        progress(p, `Đo loudness ${Math.round(p * 100)}%`)
      }
    } finally {
      sample.close()
    }
  }
  if (!meter) return { status: 'error', reason: 'Track âm thanh không có mẫu nào.' }
  const isPcm = (PCM_AUDIO_CODECS as readonly string[]).includes(track.codec ?? '')
  return { status: 'ok', decodedBy: isPcm ? 'pcm' : 'webcodecs', ...meter.result() }
}

async function analyze({ file, wasmUrl, forceFallback }: WorkerRequest): Promise<Analysis> {
  const t0 = performance.now()
  progress(-1, 'Đang đọc thông số', true)
  let specs
  try {
    specs = await readSpecs(file, wasmUrl)
  } catch (err) {
    throw new Error(`Không đọc được cấu trúc file (${err instanceof Error ? err.message : 'lỗi không rõ'}). File có thể hỏng hoặc chưa xuất xong.`)
  }
  if (!specs.video && !specs.audio) {
    throw new Error('Không tìm thấy track video hay âm thanh. File có thể hỏng hoặc không phải file media.')
  }

  const notes: string[] = []
  const v = specs.video
  if (v?.frameRateMode === 'VFR') notes.push(`Video có tốc độ khung hình thay đổi (VFR${v.fpsMin && v.fpsMax ? `, ${v.fpsMin}–${v.fpsMax} fps` : ''}); một số phần mềm dựng có thể lệch tiếng.`)
  if (v?.rotation) notes.push(`Video có metadata xoay ${v.rotation}°; kích thước hiển thị là ${v.displayWidth}×${v.displayHeight}.`)
  if (v?.hdr && v.hdr !== 'SDR') notes.push(`Video HDR (${v.hdr}); màu có thể lệch khi đăng lên nền tảng chỉ hỗ trợ SDR.`)
  if (specs.file.audioTracks > 1) notes.push(`Có ${specs.file.audioTracks} track âm thanh; loudness chỉ đo track đầu tiên.`)
  if ((specs.audio?.channels ?? 0) > 2) notes.push('Âm thanh nhiều kênh: loudness tính theo thứ tự kênh chuẩn (L, R, C, LFE, Ls, Rs), bỏ LFE.')

  let input: Input | null = null
  let thumbs: Thumb[] = []
  let thumbsNote: string | null = null
  let loudness: LoudnessInfo = specs.audio ? { status: 'error', reason: 'Chưa đo' } : { status: 'no-audio' }
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()

    if (videoTrack) {
      progress(-1, 'Đang tạo thumbnail', true)
      try {
        ;({ thumbs, note: thumbsNote } = await makeThumbs(videoTrack, specs.file.durationSec))
      } catch (err) {
        thumbsNote = `Không tạo được thumbnail: ${err instanceof Error ? err.message : 'lỗi không rõ'}`
      }
    } else if (specs.video) {
      thumbsNote = 'Không mở được track video để lấy khung hình.'
    }

    if (audioTrack && forceFallback) {
      loudness = { status: 'unsupported', reason: 'Chế độ kiểm tra: bỏ qua WebCodecs.' }
    } else if (audioTrack) {
      progress(0, 'Đo loudness 0%', true)
      try {
        loudness = await measureLoudness(audioTrack, specs.file.durationSec, specs.audio?.codec ?? null)
      } catch (err) {
        loudness = { status: 'error', reason: friendlyDecodeError(err, specs.audio?.codec ?? audioTrack.codec) }
      }
    } else if (specs.audio) {
      loudness = { status: 'unsupported', reason: 'Không mở được track âm thanh để giải mã.' }
    }
  } catch (err) {
    // mediabunny không mở được định dạng (vd. MXF): vẫn trả thông số từ mediainfo.
    const reason = `Trình duyệt không mở được định dạng ${specs.file.container ?? 'này'} để giải mã (${err instanceof Error ? err.message : 'lỗi không rõ'}).`
    thumbsNote = reason
    if (specs.audio) loudness = { status: 'unsupported', reason }
  } finally {
    input?.dispose()
  }

  return { ...specs, loudness, thumbs, thumbsNote, notes, elapsedMs: performance.now() - t0 }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  analyze(event.data).then(
    result => post({ type: 'result', result }),
    err => post({ type: 'error', message: err instanceof Error ? err.message : 'Lỗi không rõ khi phân tích file' })
  )
}
