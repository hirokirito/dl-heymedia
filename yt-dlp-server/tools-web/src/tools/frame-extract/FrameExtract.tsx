import { useEffect, useRef, useState } from 'react'
import { CanvasSink, type InputVideoTrack } from 'mediabunny'
import { Icon } from '../../components/Icon'
import { baseName, formatTime, parseTime, timeForFilename } from '../../lib/time'
import { saveBlob, saveZip } from '../../shared/download'
import { DropZone } from '../../shared/DropZone'
import { describeError } from '../../shared/errors'
import { openInput } from '../../shared/mediaCopy'
import { ProgressBar } from '../../shared/QueueList'
import { VideoPreview } from '../../shared/VideoPreview'

type Mode = 'list' | 'interval' | 'count'
type Frame = { time: number; blob: Blob; url: string; width: number; height: number }
type Info = { duration: number; width: number; height: number; codec: string | null; decodable: boolean }

const MAX_FRAMES = 300

function computeTimes(mode: Mode, list: string, every: string, count: string, duration: number): { times: number[]; error?: string } {
  let times: number[] = []
  if (mode === 'list') {
    const parts = list.split(/[\n;]+|,(?=\s)|\s{2,}/).map(s => s.trim()).filter(Boolean)
    for (const p of parts) {
      const t = parseTime(p)
      if (t === null) return { times: [], error: `Mốc "${p}" không hợp lệ. Dùng dạng 75, 1:15 hoặc 01:15,5.` }
      times.push(t)
    }
  } else if (mode === 'interval') {
    const step = parseTime(every)
    if (!step || step <= 0) return { times: [], error: 'Khoảng cách phải lớn hơn 0 giây.' }
    for (let t = 0; t < duration; t += step) times.push(t)
  } else {
    const n = Math.round(Number(count))
    if (!Number.isFinite(n) || n < 1) return { times: [], error: 'Số khung phải từ 1 trở lên.' }
    times = Array.from({ length: n }, (_, i) => (n === 1 ? duration / 2 : (i * Math.max(0, duration - 0.05)) / (n - 1)))
  }
  times = times.filter(t => t >= 0 && t <= duration + 0.001).sort((a, b) => a - b)
  if (!times.length) return { times, error: `Không có mốc nào nằm trong thời lượng video (${formatTime(duration)}).` }
  if (times.length > MAX_FRAMES) return { times: [], error: `Tối đa ${MAX_FRAMES} khung mỗi lần (đang là ${times.length}).` }
  return { times }
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Không xuất được ảnh'))), type, quality))
}

export default function FrameExtract() {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('count')
  const [list, setList] = useState('')
  const [every, setEvery] = useState('5')
  const [count, setCount] = useState('6')
  const [format, setFormat] = useState<'png' | 'jpg'>('jpg')
  const [frames, setFrames] = useState<Frame[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const trackRef = useRef<{ dispose: () => void; track: InputVideoTrack } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const clearFrames = () => setFrames(list => { list.forEach(f => URL.revokeObjectURL(f.url)); return [] })

  useEffect(() => () => { trackRef.current?.dispose(); clearFrames() }, [])

  const pickFile = async (files: File[]) => {
    const f = files[0]
    trackRef.current?.dispose()
    trackRef.current = null
    clearFrames()
    setFile(f)
    setInfo(null)
    setLoadError(null)
    setRunError(null)
    try {
      const input = openInput(f)
      const track = await input.getPrimaryVideoTrack()
      if (!track) { input.dispose(); throw new Error('File không có track video.') }
      trackRef.current = { dispose: () => input.dispose(), track }
      const [duration, decodable] = await Promise.all([input.computeDuration(), track.canDecode()])
      setInfo({ duration, width: track.displayWidth, height: track.displayHeight, codec: track.codec, decodable })
    } catch (err) {
      setLoadError(`Không mở được video: ${describeError(err)}`)
    }
  }

  const plan = info ? computeTimes(mode, list, every, count, info.duration) : null

  const run = async () => {
    if (!trackRef.current || !plan || plan.error || !file) return
    cancelRef.current = false
    clearFrames()
    setRunError(null)
    setProgress(0)
    const type = format === 'png' ? 'image/png' : 'image/jpeg'
    try {
      const sink = new CanvasSink(trackRef.current.track, { poolSize: 2 }) // kích thước gốc, đã áp dụng xoay
      let i = 0
      for await (const wrapped of sink.canvasesAtTimestamps(plan.times)) {
        if (cancelRef.current) break
        const t = plan.times[i++]
        if (wrapped) {
          const blob = await canvasToBlob(wrapped.canvas, type, 0.92)
          const frame = { time: wrapped.timestamp, blob, url: URL.createObjectURL(blob), width: wrapped.canvas.width, height: wrapped.canvas.height }
          setFrames(prev => [...prev, frame])
        } else {
          console.warn('[frame-extract] không có khung tại', t)
        }
        setProgress(i / plan.times.length)
      }
    } catch (err) {
      setRunError(describeError(err))
    } finally {
      setProgress(null)
    }
  }

  const name = (f: Frame) => `${baseName(file?.name ?? 'video')}_${timeForFilename(f.time)}.${format}`

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <DropZone title={file ? 'Thả video khác để thay' : 'Thả 1 video vào đây hoặc bấm để chọn'} hint="Lấy khung hình ở độ phân giải gốc (PNG hoặc JPG)" accept="video/*,.mkv,.mov,.mxf" multiple={false} onFiles={pickFile} />
        {loadError && <p className="notice notice-fail" role="alert">{loadError}</p>}

        {file && info && (
          <section className="card stack">
            <div className="row-between">
              <h2 className="eyebrow">{file.name}</h2>
              <span className="muted small">{info.width}×{info.height} · {formatTime(info.duration)} · {info.codec ?? 'không rõ codec'}</span>
            </div>
            {!info.decodable && <p className="notice notice-fail">Trình duyệt này không giải mã được video {info.codec ?? ''}, nên không lấy được khung hình. Thử Safari hoặc Chrome trên máy có hỗ trợ phần cứng.</p>}
            <VideoPreview ref={videoRef} file={file} />
          </section>
        )}

        {frames.length > 0 && (
          <section className="card stack">
            <div className="row-between">
              <h2 className="eyebrow">Đã lấy {frames.length} khung</h2>
              <button type="button" className="btn btn-primary" onClick={() => saveZip(frames.map(f => ({ name: name(f), data: f.blob })), `${baseName(file?.name ?? 'video')}_frames.zip`)}>
                <Icon name="download" size={16} />Tải tất cả (ZIP)
              </button>
            </div>
            <div className="frame-grid">
              {frames.map(f => (
                <figure key={f.url} className="frame">
                  <img src={f.url} alt={`Khung tại ${formatTime(f.time)}`} loading="lazy" />
                  <figcaption>
                    <span>{formatTime(f.time)} · {f.width}×{f.height}</span>
                    <button type="button" className="icon-btn" aria-label={`Tải khung ${formatTime(f.time)}`} onClick={() => saveBlob(f.blob, name(f))}>
                      <Icon name="download" size={16} />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Lấy khung nào</h2>
          <div className="seg" role="radiogroup" aria-label="Cách chọn mốc">
            {([['count', 'Chia đều'], ['interval', 'Mỗi N giây'], ['list', 'Mốc cụ thể']] as const).map(([m, label]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="seg-btn" onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
          {mode === 'count' && (
            <label className="field">Số khung (tối đa {MAX_FRAMES})
              <input type="number" min={1} max={MAX_FRAMES} value={count} onChange={e => setCount(e.currentTarget.value)} />
            </label>
          )}
          {mode === 'interval' && (
            <label className="field">Cách nhau (giây hoặc mm:ss)
              <input value={every} onChange={e => setEvery(e.currentTarget.value)} inputMode="decimal" />
            </label>
          )}
          {mode === 'list' && (
            <>
              <label className="field">Mốc thời gian, mỗi dòng một mốc
                <textarea rows={5} value={list} onChange={e => setList(e.currentTarget.value)} placeholder={'0:05\n1:12,5\n125'} />
              </label>
              <button type="button" className="btn btn-ghost" disabled={!videoRef.current} onClick={() => {
                const t = videoRef.current?.currentTime ?? 0
                setList(prev => `${prev.trim() ? `${prev.trim()}\n` : ''}${formatTime(t, 2)}`)
              }}>
                <Icon name="plus" size={16} />Thêm vị trí đang xem
              </button>
            </>
          )}
          <fieldset className="field-row">
            <legend className="field-legend">Định dạng</legend>
            <label><input type="radio" name="fe-format" checked={format === 'jpg'} onChange={() => setFormat('jpg')} /> JPG (nhẹ)</label>
            <label><input type="radio" name="fe-format" checked={format === 'png'} onChange={() => setFormat('png')} /> PNG (không nén mất)</label>
          </fieldset>
          {plan?.error && <p className="notice notice-warn">{plan.error}</p>}
          {plan && !plan.error && <p className="muted small">Sẽ lấy {plan.times.length} khung.</p>}
          {progress === null ? (
            <button type="button" className="btn btn-primary" disabled={!info?.decodable || !plan || !!plan.error} onClick={run}>
              <Icon name="camera" size={16} />Lấy khung hình
            </button>
          ) : (
            <>
              <ProgressBar value={progress} label="Tiến độ lấy khung" />
              <button type="button" className="btn" onClick={() => { cancelRef.current = true }}><Icon name="x" size={16} />Dừng</button>
            </>
          )}
          {runError && <p className="notice notice-fail" role="alert">{runError}</p>}
        </section>
      </aside>
    </div>
  )
}
