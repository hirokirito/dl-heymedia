import {
  ALL_FORMATS, BlobSource, Conversion, FlacOutputFormat, Input, MovOutputFormat, Mp3OutputFormat, Mp4OutputFormat,
  MkvOutputFormat, OggOutputFormat, Output, WavOutputFormat, WebMOutputFormat, type OutputFormat
} from 'mediabunny'
import { BufferTarget } from 'mediabunny'
import { MEMORY_LIMIT, openSaveTarget } from './saveTarget'

// Các thao tác "chép nguyên dữ liệu" (không mã hoá lại) dùng chung cho cắt video và tách âm thanh.

export function openInput(file: File): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
}

export type ContainerChoice = { format: OutputFormat; ext: string; mime: string; label: string }

// Video: giữ đúng "họ" container để codec chép được. ProRes/PCM → MOV, VP8/VP9/AV1/Opus → WebM, còn lại → MP4.
export function videoContainerFor(videoCodec: string | null, audioCodec: string | null, inputMime: string, streaming: boolean): ContainerChoice {
  const fastStart = streaming ? false : 'in-memory'
  const isPcm = !!audioCodec && /^(pcm|ulaw|alaw)/.test(audioCodec)
  if (videoCodec === 'prores' || isPcm || inputMime.includes('quicktime')) {
    return { format: new MovOutputFormat({ fastStart }), ext: 'mov', mime: 'video/quicktime', label: 'MOV' }
  }
  if (['vp8', 'vp9', 'av1'].includes(videoCodec ?? '') || ['opus', 'vorbis'].includes(audioCodec ?? '')) {
    return { format: new WebMOutputFormat(), ext: 'webm', mime: 'video/webm', label: 'WebM' }
  }
  if (!['avc', 'hevc', null].includes(videoCodec)) {
    return { format: new MkvOutputFormat(), ext: 'mkv', mime: 'video/x-matroska', label: 'MKV' }
  }
  return { format: new Mp4OutputFormat({ fastStart }), ext: 'mp4', mime: 'video/mp4', label: 'MP4' }
}

// Âm thanh: container "tự nhiên" của từng codec để chép nguyên (AAC → .m4a, MP3 → .mp3, …).
export function audioContainerFor(audioCodec: string | null, streaming: boolean): ContainerChoice {
  const c = audioCodec ?? ''
  if (c === 'aac') return { format: new Mp4OutputFormat({ fastStart: streaming ? false : 'in-memory' }), ext: 'm4a', mime: 'audio/mp4', label: 'M4A (AAC)' }
  if (c === 'mp3') return { format: new Mp3OutputFormat(), ext: 'mp3', mime: 'audio/mpeg', label: 'MP3' }
  if (c === 'opus' || c === 'vorbis') return { format: new OggOutputFormat(), ext: 'ogg', mime: 'audio/ogg', label: `OGG (${c})` }
  if (c === 'flac') return { format: new FlacOutputFormat(), ext: 'flac', mime: 'audio/flac', label: 'FLAC' }
  if (/^(pcm|ulaw|alaw)/.test(c)) return { format: new WavOutputFormat(), ext: 'wav', mime: 'audio/wav', label: 'WAV (PCM)' }
  return { format: new MkvOutputFormat(), ext: 'mka', mime: 'audio/x-matroska', label: `MKA (${c || 'không rõ'})` }
}

export type CopyJob = {
  file: File
  outputName: string // không có đuôi
  container: (streaming: boolean) => ContainerChoice
  trim?: { start: number; end: number }
  discardVideo?: boolean
  estimatedBytes: number
  signal: AbortSignal
  onProgress: (p: number) => void
  // Chuyển sang WAV: giải mã PCM thay vì chép (dùng cho "tách âm thanh dạng WAV").
  toWav?: boolean
  // 'download': tải về ngay (hoặc ghi đĩa nếu lớn); 'blob': trả Blob để trang tự hiển thị/ZIP.
  deliver?: 'download' | 'blob'
}

export type CopyResult = { filename: string; mode: 'memory' | 'disk'; discarded: string[]; blob?: Blob; label: string }

const DISCARD_REASONS: Record<string, string> = {
  discarded_by_user: 'bỏ theo lựa chọn',
  max_track_count_reached: 'container đầu ra không chứa thêm track',
  max_track_count_of_type_reached: 'container đầu ra không chứa thêm track loại này',
  unknown_source_codec: 'không nhận ra codec',
  undecodable_source_codec: 'trình duyệt không giải mã được',
  no_encodable_target_codec: 'không có codec đích phù hợp'
}

export async function runCopy(job: CopyJob): Promise<CopyResult> {
  const input = openInput(job.file)
  try {
    // Mở nơi ghi càng sớm càng tốt: hộp thoại "Lưu thành" chỉ mở được ngay sau khi người dùng bấm nút.
    const streaming = job.estimatedBytes > 512 * 1024 * 1024
    const container = job.container(streaming)
    const filename = `${job.outputName}.${container.ext}`
    let blobTarget: BufferTarget | null = null
    if (job.deliver === 'blob' && job.estimatedBytes > MEMORY_LIMIT) throw new Error('Kết quả quá lớn để giữ trong RAM của trình duyệt.')
    const target = job.deliver === 'blob'
      ? { target: (blobTarget = new BufferTarget()), mode: 'memory' as const, finish: async () => {}, abort: async () => {} }
      : await openSaveTarget(filename, container.mime, job.estimatedBytes)
    const output = new Output({ format: container.format, target: target.target })
    const conversion = await Conversion.init({
      input,
      output,
      trim: job.trim,
      video: job.discardVideo ? { discard: true } : undefined,
      audio: job.toWav ? { codec: 'pcm-s16' } : undefined,
      copy: job.toWav ? false : { mode: 'forced', boundaryPolicy: 'expand' },
      showWarnings: false
    })
    const discarded = conversion.discardedTracks
      .filter(d => d.reason !== 'discarded_by_user')
      .map(d => `${d.track.type === 'video' ? 'Video' : d.track.type === 'audio' ? 'Âm thanh' : 'Track'} (${d.track.codec ?? 'không rõ'}): ${DISCARD_REASONS[d.reason] ?? d.reason}`)
    if (!conversion.isValid) {
      await target.abort()
      throw new Error(discarded.length ? `Không chép được: ${discarded.join('; ')}` : 'Không có track nào chép được sang định dạng đầu ra.')
    }
    const onAbort = () => { void conversion.cancel() }
    job.signal.addEventListener('abort', onAbort)
    conversion.onProgress = p => job.onProgress(p)
    try {
      await conversion.execute()
    } catch (err) {
      await target.abort()
      if (job.signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      throw err
    } finally {
      job.signal.removeEventListener('abort', onAbort)
    }
    if (job.signal.aborted) throw new DOMException('Đã huỷ', 'AbortError')
    await target.finish()
    const blob = blobTarget?.buffer ? new Blob([blobTarget.buffer], { type: container.mime }) : undefined
    return { filename, mode: target.mode, discarded, blob, label: container.label }
  } finally {
    input.dispose()
  }
}
