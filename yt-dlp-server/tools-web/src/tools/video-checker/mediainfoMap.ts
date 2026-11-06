import type { AudioSpec, FileSpec, VideoSpec } from './types'

// Ánh xạ kết quả mediainfo.js (format "object") sang kiểu gọn của tool. Không có thì null.
type Track = Record<string, unknown> & { '@type'?: string }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().split(/[\s/]/)[0])
    return Number.isFinite(n) ? n : null
  }
  return null
}
const int = (v: unknown) => {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

const HDR_TRANSFERS = /PQ|2084|HLG|B67/i

export function mapMediaInfo(raw: unknown, sizeBytes: number): { file: FileSpec; video: VideoSpec | null; audio: AudioSpec | null } {
  const tracks: Track[] = ((raw as { media?: { track?: Track[] } })?.media?.track) ?? []
  const general = tracks.find(t => t['@type'] === 'General') ?? {}
  const video = tracks.find(t => t['@type'] === 'Video')
  const audio = tracks.find(t => t['@type'] === 'Audio')

  const file: FileSpec = {
    container: str(general.Format),
    sizeBytes,
    durationSec: num(general.Duration),
    overallBitrate: num(general.OverallBitRate),
    videoTracks: tracks.filter(t => t['@type'] === 'Video').length,
    audioTracks: tracks.filter(t => t['@type'] === 'Audio').length,
    recordedDate: str(general.Recorded_Date) ?? str(general.Encoded_Date),
    writingApp: str(general.Encoded_Application) ?? str(general.Encoded_Library_Name)
  }

  let videoSpec: VideoSpec | null = null
  if (video) {
    const width = int(video.Width)
    const height = int(video.Height)
    const rotation = num(video.Rotation)
    const rotated = rotation !== null && Math.round(Math.abs(rotation)) % 180 === 90
    const mode = str(video.FrameRate_Mode)?.toUpperCase()
    const transfer = str(video.transfer_characteristics)
    const hdrFormat = str(video.HDR_Format)
    const hdr = hdrFormat ?? (transfer ? (HDR_TRANSFERS.test(transfer) ? transfer : 'SDR') : null)
    videoSpec = {
      codec: str(video.Format),
      profile: [str(video.Format_Profile), str(video.Format_Level) && `L${str(video.Format_Level)}`].filter(Boolean).join('@') || null,
      width,
      height,
      rotation,
      displayWidth: width === null || height === null ? null : rotated ? height : width,
      displayHeight: width === null || height === null ? null : rotated ? width : height,
      fps: num(video.FrameRate),
      frameRateMode: mode === 'VFR' ? 'VFR' : mode === 'CFR' ? 'CFR' : null,
      fpsMin: num(video.FrameRate_Minimum),
      fpsMax: num(video.FrameRate_Maximum),
      bitDepth: int(video.BitDepth),
      chroma: str(video.ChromaSubsampling),
      colorPrimaries: str(video.colour_primaries),
      transfer,
      matrix: str(video.matrix_coefficients),
      hdr,
      scanType: str(video.ScanType),
      bitrate: num(video.BitRate)
    }
  }

  const audioSpec: AudioSpec | null = audio
    ? {
        codec: str(audio.Format),
        channels: int(audio.Channels),
        channelLayout: str(audio.ChannelLayout),
        sampleRate: num(audio.SamplingRate),
        bitDepth: int(audio.BitDepth),
        bitrate: num(audio.BitRate)
      }
    : null

  return { file, video: videoSpec, audio: audioSpec }
}
