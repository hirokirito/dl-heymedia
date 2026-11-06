import { useEffect, useRef, useState } from 'react'
import { EncodedPacketSink, type InputVideoTrack } from 'mediabunny'
import { Icon } from '../../components/Icon'
import { formatBytes } from '../../lib/format'
import { baseName, formatTime, parseTime, timeForFilename } from '../../lib/time'
import { DropZone } from '../../shared/DropZone'
import { describeError } from '../../shared/errors'
import { openInput, runCopy, videoContainerFor, type CopyResult } from '../../shared/mediaCopy'
import { ProgressBar } from '../../shared/QueueList'
import { canStreamToDisk, STREAM_THRESHOLD } from '../../shared/saveTarget'
import { VideoPreview } from '../../shared/VideoPreview'

type Info = { duration: number; videoCodec: string | null; audioCodec: string | null; mime: string; width: number; height: number }

export default function VideoTrim() {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [startText, setStartText] = useState('0:00')
  const [endText, setEndText] = useState('')
  const [keyStart, setKeyStart] = useState<number | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<CopyResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<{ dispose: () => void; track: InputVideoTrack | null } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { inputRef.current?.dispose(); abortRef.current?.abort() }, [])

  const pickFile = async (files: File[]) => {
    const f = files[0]
    inputRef.current?.dispose()
    setFile(f); setInfo(null); setLoadError(null); setResult(null); setRunError(null); setKeyStart(null)
    try {
      const input = openInput(f)
      const [video, audio, duration, mime] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(), input.computeDuration(), input.getMimeType()])
      inputRef.current = { dispose: () => input.dispose(), track: video }
      if (!video && !audio) throw new Error('Không có track video hay âm thanh.')
      setInfo({ duration, videoCodec: video?.codec ?? null, audioCodec: audio?.codec ?? null, mime, width: video?.displayWidth ?? 0, height: video?.displayHeight ?? 0 })
      setStartText('0:00')
      setEndText(formatTime(duration))
    } catch (err) {
      setLoadError(`Không mở được file: ${describeError(err)}`)
    }
  }

  const start = parseTime(startText)
  const end = parseTime(endText)
  const rangeError = !info ? null
    : start === null || end === null ? 'Mốc thời gian không hợp lệ. Dùng dạng 75, 1:15 hoặc 01:15,5.'
    : start >= end ? 'Điểm cuối phải sau điểm đầu.'
    : end > info.duration + 0.05 ? `Điểm cuối vượt thời lượng video (${formatTime(info.duration)}).`
    : null

  // Không mã hoá lại thì bản cắt phải bắt đầu ở keyframe: tìm keyframe gần nhất ở trước điểm đầu.
  useEffect(() => {
    const track = inputRef.current?.track
    if (!track || start === null || rangeError) { setKeyStart(null); return }
    let alive = true
    new EncodedPacketSink(track).getKeyPacket(start, { metadataOnly: true })
      .then(p => { if (alive) setKeyStart(p ? p.timestamp : null) })
      .catch(() => { if (alive) setKeyStart(null) })
    return () => { alive = false }
  }, [start, rangeError, info])

  const effectiveStart = keyStart ?? start ?? 0
  // MP4/MOV có edit list: phát đúng điểm đầu dù dữ liệu bắt đầu từ keyframe. WebM/MKV thì không.
  const containerLabel = info ? videoContainerFor(info.videoCodec, info.audioCodec, info.mime, false).label : ''
  const hasEditList = containerLabel === 'MP4' || containerLabel === 'MOV'
  const estimated = info && end !== null ? Math.round((file?.size ?? 0) * Math.max(0, end - effectiveStart) / Math.max(info.duration, 0.001)) : 0

  const run = async () => {
    if (!file || !info || start === null || end === null || rangeError) return
    const controller = new AbortController()
    abortRef.current = controller
    setResult(null); setRunError(null); setProgress(0)
    try {
      const r = await runCopy({
        file,
        outputName: `${baseName(file.name)}_cat_${timeForFilename(start)}-${timeForFilename(end)}`,
        container: streaming => videoContainerFor(info.videoCodec, info.audioCodec, info.mime, streaming),
        trim: { start, end },
        estimatedBytes: estimated,
        signal: controller.signal,
        onProgress: p => setProgress(p)
      })
      setResult(r)
    } catch (err) {
      if (!controller.signal.aborted) setRunError(describeError(err))
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  const setFromVideo = (which: 'start' | 'end') => {
    const t = videoRef.current?.currentTime
    if (t === undefined) return
    if (which === 'start') setStartText(formatTime(t)); else setEndText(formatTime(t))
  }

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <DropZone title={file ? 'Thả video khác để thay' : 'Thả 1 video vào đây hoặc bấm để chọn'} hint="Cắt nhanh, không mã hoá lại: giữ nguyên chất lượng và codec gốc · MP4, MOV, WebM, MKV" accept="video/*,.mkv,.mov" multiple={false} onFiles={pickFile} />
        {loadError && <p className="notice notice-fail" role="alert">{loadError}</p>}
        {file && info && (
          <section className="card stack">
            <div className="row-between">
              <h2 className="eyebrow">{file.name}</h2>
              <span className="muted small">{info.width ? `${info.width}×${info.height} · ` : ''}{formatTime(info.duration)} · {[info.videoCodec, info.audioCodec].filter(Boolean).join(' + ')}</span>
            </div>
            <VideoPreview ref={videoRef} file={file} />
          </section>
        )}
        {result && (
          <p className="notice" role="status">
            <Icon name="check" size={18} />
            {result.mode === 'disk' ? `Đã ghi ${result.filename} vào nơi bạn chọn.` : `Đã tạo ${result.filename} (${result.label}) và tải về.`}
            {result.discarded.length > 0 && ` Bỏ: ${result.discarded.join('; ')}.`}
          </p>
        )}
        {runError && <p className="notice notice-fail" role="alert">{runError}</p>}
      </div>

      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Đoạn cần giữ</h2>
          <label className="field">Điểm đầu
            <div className="field-inline">
              <input value={startText} onChange={e => setStartText(e.currentTarget.value)} disabled={!info} inputMode="decimal" />
              <button type="button" className="btn btn-ghost" disabled={!info} onClick={() => setFromVideo('start')}>Lấy vị trí đang xem</button>
            </div>
          </label>
          <label className="field">Điểm cuối
            <div className="field-inline">
              <input value={endText} onChange={e => setEndText(e.currentTarget.value)} disabled={!info} inputMode="decimal" />
              <button type="button" className="btn btn-ghost" disabled={!info} onClick={() => setFromVideo('end')}>Lấy vị trí đang xem</button>
            </div>
          </label>
          {rangeError && <p className="notice notice-warn">{rangeError}</p>}
          {info && !rangeError && start !== null && end !== null && (
            <div className="muted small stack-sm">
              <span>Độ dài: {formatTime(end - start)}{estimated ? ` · khoảng ${formatBytes(estimated)}` : ''}</span>
              {keyStart !== null && keyStart < start - 0.01 && (hasEditList ? (
                <span>Phát đúng từ {formatTime(start)}. File chứa thêm {formatTime(start - keyStart)} từ keyframe {formatTime(keyStart)} nhưng được ẩn (edit list) để không phải mã hoá lại; phần mềm rất cũ có thể vẫn hiện đoạn này.</span>
              ) : (
                <span>Định dạng {containerLabel} không ẩn được phần thừa: video sẽ bắt đầu từ keyframe {formatTime(keyStart)} (sớm hơn {formatTime(start - keyStart)}).</span>
              ))}
              {estimated > STREAM_THRESHOLD && (canStreamToDisk()
                ? <span>File lớn: trình duyệt sẽ hỏi nơi lưu và ghi thẳng xuống ổ đĩa.</span>
                : <span>File lớn: trình duyệt này phải giữ kết quả trong RAM. Nên dùng Chrome/Edge trên máy tính.</span>)}
            </div>
          )}
          {progress === null ? (
            <button type="button" className="btn btn-primary" disabled={!info || !!rangeError} onClick={run}>
              <Icon name="scissors" size={16} />Cắt và tải về
            </button>
          ) : (
            <>
              <ProgressBar value={progress} label="Tiến độ cắt" />
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}><Icon name="x" size={16} />Huỷ</button>
            </>
          )}
        </section>
      </aside>
    </div>
  )
}
