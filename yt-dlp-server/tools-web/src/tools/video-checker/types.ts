import type { LoudnessResult } from './loudness'

// Mọi trường không đọc được đều là null (hiển thị "Không có dữ liệu"), không đoán.
export type FileSpec = {
  container: string | null
  sizeBytes: number
  durationSec: number | null
  overallBitrate: number | null // bit/s
  videoTracks: number
  audioTracks: number
  recordedDate: string | null
  writingApp: string | null
}

export type VideoSpec = {
  codec: string | null
  profile: string | null
  width: number | null // kích thước mã hoá
  height: number | null
  rotation: number | null // độ, theo metadata
  displayWidth: number | null // sau khi xoay — dùng để đối chiếu preset
  displayHeight: number | null
  fps: number | null
  frameRateMode: 'CFR' | 'VFR' | null
  fpsMin: number | null
  fpsMax: number | null
  bitDepth: number | null
  chroma: string | null
  colorPrimaries: string | null
  transfer: string | null
  matrix: string | null
  hdr: string | null // tên định dạng HDR, "SDR" hoặc null nếu không xác định
  scanType: string | null
  bitrate: number | null
}

export type AudioSpec = {
  codec: string | null
  channels: number | null
  channelLayout: string | null
  sampleRate: number | null
  bitDepth: number | null
  bitrate: number | null
}

export type Thumb = { label: string; timeSec: number; blob: Blob | null }

export type LoudnessInfo =
  | ({ status: 'ok'; decodedBy: 'webcodecs' | 'pcm' } & LoudnessResult)
  | { status: 'no-audio' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string }

export type Analysis = {
  file: FileSpec
  video: VideoSpec | null
  audio: AudioSpec | null
  loudness: LoudnessInfo
  thumbs: Thumb[]
  thumbsNote: string | null
  notes: string[]
  elapsedMs: number
}

// Worker ↔ trang
export type WorkerRequest = { file: File; wasmUrl: string }
export type WorkerMessage =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'result'; result: Analysis }
  | { type: 'error'; message: string }
