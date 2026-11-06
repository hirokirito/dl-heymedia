import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import wasmAsset from 'mediainfo.js/MediaInfoModule.wasm?url'
import { Icon } from '../../components/Icon'
import { formatBytes, toCsv } from '../../lib/format'
import { saveText } from '../../shared/download'
import { DropZone } from '../../shared/DropZone'
import { QueueList, VerdictChip } from '../../shared/QueueList'
import { useFileQueue, type ProcessContext, type QueueItem } from '../../shared/useFileQueue'
import { evaluate, PRESETS, type Preset } from './presets'
import type { Analysis, WorkerMessage } from './types'
import { canUseFallback, measureWithWebAudio } from './webAudioFallback'

const NA = 'Không có dữ liệu'
const PRESET_KEY = 'heytools:video-checker:preset'

// Dấu trừ thật (−) thay cho gạch nối để số âm dễ đọc: −14,2 LUFS.
const n1 = (v: number | null, unit = '', digits = 1) =>
  v === null ? null : `${v.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/^-/, '−')}${unit}`
const bitrate = (bps: number | null) => (bps === null ? null : bps >= 1e6 ? `${n1(bps / 1e6, ' Mb/s')}` : `${n1(bps / 1e3, ' kb/s', 0)}`)
function duration(sec: number | null): string | null {
  if (sec === null) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const ss = s.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2, minimumIntegerDigits: 2 })
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${ss}`
}

// Phân tích trong worker; nếu WebCodecs từ chối giải mã âm thanh thì thử lại bằng Web Audio trên trang.
async function analyzeFile(file: File, ctx: ProcessContext): Promise<Analysis> {
  const result = await analyzeInWorker(file, ctx)
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
function analyzeInWorker(file: File, { signal, onProgress }: ProcessContext): Promise<Analysis> {
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
    worker.postMessage({ file, wasmUrl: new URL(wasmAsset, window.location.href).href, forceFallback })
  })
}

function readPreset(): string {
  try {
    const id = window.localStorage.getItem(PRESET_KEY)
    return PRESETS.some(p => p.id === id) ? (id as string) : PRESETS[0].id
  } catch {
    return PRESETS[0].id
  }
}

function loudnessText(a: Analysis): string {
  const l = a.loudness
  if (l.status === 'no-audio') return 'không có âm thanh'
  if (l.status !== 'ok') return 'chưa đo được LUFS'
  return l.integratedLufs === null ? 'im lặng' : `${n1(l.integratedLufs)} LUFS`
}

function summaryLine(a: Analysis): string {
  const v = a.video
  return [
    v?.codec ?? (a.audio ? 'chỉ âm thanh' : null),
    v?.displayWidth && v.displayHeight ? `${v.displayWidth}×${v.displayHeight}` : null,
    v?.fps ? `${n1(v.fps, ' fps', v.fps % 1 ? 2 : 0)}` : null,
    loudnessText(a)
  ].filter(Boolean).join(' · ')
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? 'is-na' : undefined}>{value ?? NA}</dd>
    </>
  )
}

function Detail({ item, preset, thumbUrls }: { item: QueueItem<Analysis>; preset: Preset; thumbUrls: (string | null)[] }) {
  const a = item.result!
  const { verdict, checks } = evaluate(a, preset)
  const v = a.video
  const au = a.audio
  const l = a.loudness
  return (
    <section className="card vc-detail" aria-label={`Kết quả ${item.file.name}`}>
      <div className="vc-detail-head">
        <div>
          <h2>{item.file.name}</h2>
          <p className="muted small">Preset: {preset.name} · phân tích xong sau {n1(a.elapsedMs / 1000, ' giây')}</p>
        </div>
        {verdict ? <VerdictChip verdict={verdict} /> : <span className="chip chip-unknown">Chỉ đo</span>}
      </div>

      {a.thumbs.length > 0 && (
        <div className="vc-thumbs">
          {a.thumbs.map((t, i) => (
            <figure key={t.label}>
              {thumbUrls[i] ? <img src={thumbUrls[i]!} alt={`Khung hình ${t.label.toLowerCase()} của ${item.file.name}`} /> : <div className="vc-thumb-empty">Không lấy được</div>}
              <figcaption>{t.label} · {duration(t.timeSec)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {a.thumbsNote && <p className="notice notice-warn"><Icon name="alert" size={18} />{a.thumbsNote}</p>}

      {checks.length > 0 && (
        <div className="vc-checks">
          <h3 className="eyebrow">Đối chiếu preset</h3>
          <ul>
            {checks.map(c => (
              <li key={c.text} className={`vc-check is-${c.verdict}`}>
                <Icon name={c.verdict === 'pass' ? 'check' : c.verdict === 'warn' ? 'alert' : c.verdict === 'fail' ? 'xCircle' : 'help'} size={16} strokeWidth={2.5} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.notes.length > 0 && (
        <ul className="vc-notes">
          {a.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}

      <div className="vc-specs">
        <dl>
          <dt className="eyebrow span">File</dt>
          <Row label="Container" value={a.file.container} />
          <Row label="Dung lượng" value={formatBytes(a.file.sizeBytes)} />
          <Row label="Thời lượng" value={duration(a.file.durationSec)} />
          <Row label="Bitrate tổng" value={bitrate(a.file.overallBitrate)} />
          <Row label="Số track" value={`${a.file.videoTracks} video · ${a.file.audioTracks} âm thanh`} />
          <Row label="Ngày quay" value={a.file.recordedDate} />
        </dl>
        <dl>
          <dt className="eyebrow span">Video</dt>
          {v ? (
            <>
              <Row label="Codec" value={[v.codec, v.profile].filter(Boolean).join(' ') || null} />
              <Row label="Hiển thị" value={v.displayWidth && v.displayHeight ? `${v.displayWidth}×${v.displayHeight}` : null} />
              <Row label="Xoay" value={v.rotation === null ? null : `${v.rotation}°`} />
              <Row label="Tốc độ" value={v.fps === null ? null : `${n1(v.fps, ' fps', 3)}${v.frameRateMode ? ` · ${v.frameRateMode}` : ''}`} />
              <Row label="Bit depth" value={v.bitDepth === null ? null : `${v.bitDepth}-bit`} />
              <Row label="Chroma" value={v.chroma} />
              <Row label="Không gian màu" value={[v.colorPrimaries, v.transfer, v.matrix].filter(Boolean).join(' / ') || null} />
              <Row label="HDR" value={v.hdr === 'SDR' ? 'Không (SDR)' : v.hdr} />
              <Row label="Bitrate" value={bitrate(v.bitrate)} />
            </>
          ) : <dd className="is-na span">Không có video</dd>}
        </dl>
        <dl>
          <dt className="eyebrow span">Âm thanh</dt>
          {au ? (
            <>
              <Row label="Codec" value={au.codec} />
              <Row label="Sample rate" value={au.sampleRate === null ? null : `${n1(au.sampleRate / 1000, ' kHz', au.sampleRate % 1000 ? 1 : 0)}`} />
              <Row label="Kênh" value={au.channels === null ? null : `${au.channels}${au.channelLayout ? ` (${au.channelLayout})` : ''}`} />
              <Row label="Bit depth" value={au.bitDepth === null ? null : `${au.bitDepth}-bit`} />
              <Row label="Integrated" value={l.status === 'ok' ? (l.integratedLufs === null ? 'Im lặng (dưới −70 LUFS)' : `${n1(l.integratedLufs)} LUFS`) : null} />
              <Row label="True peak" value={l.status === 'ok' ? n1(l.truePeakDbtp, ' dBTP') : null} />
              <Row label="Sample peak" value={l.status === 'ok' ? n1(l.samplePeakDbfs, ' dBFS') : null} />
              {l.status === 'ok' && <Row label="Đã đo" value={`${duration(l.measuredSeconds)} âm thanh`} />}
              {(l.status === 'unsupported' || l.status === 'error') && <dd className="is-na span">{l.reason}</dd>}
            </>
          ) : <dd className="is-na span">Không có âm thanh</dd>}
        </dl>
      </div>
      <p className="muted small">Loudness theo ITU-R BS.1770-4 (gate −70 LUFS và −10 LU). True peak nội suy 4× theo BS.1770-4 Annex 2; sample peak là mẫu gốc.</p>
    </section>
  )
}

function csvRows(items: QueueItem<Analysis>[], preset: Preset) {
  const header = ['file', 'ket_qua', 'ly_do', 'container', 'dung_luong_byte', 'thoi_luong_giay', 'video_codec', 'rong', 'cao', 'xoay', 'fps', 'che_do_fps', 'bit_depth', 'chroma', 'mau', 'hdr', 'audio_codec', 'sample_rate', 'so_kenh', 'lufs', 'true_peak_dbtp', 'sample_peak_dbfs', 'ghi_chu']
  const label = { pass: 'Đạt', warn: 'Cảnh báo', fail: 'Không đạt', unknown: 'Không xác định' } as const
  const rows: (string | number | null)[][] = [header]
  for (const item of items) {
    if (item.status === 'error') {
      rows.push([item.file.name, 'Không đạt', item.error ?? 'Lỗi', ...Array(header.length - 3).fill(null)])
      continue
    }
    const a = item.result
    if (!a) continue
    const { verdict, checks } = evaluate(a, preset)
    const v = a.video
    const l = a.loudness
    const ok = l.status === 'ok' ? l : null
    const r = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? null : Number(x.toFixed(d)))
    rows.push([
      item.file.name, verdict ? label[verdict] : 'Chỉ đo', checks.filter(c => c.verdict !== 'pass').map(c => c.text).join('; ') || null,
      a.file.container, a.file.sizeBytes, r(a.file.durationSec, 3),
      v?.codec ?? null, v?.displayWidth ?? null, v?.displayHeight ?? null, v?.rotation ?? null, r(v?.fps, 3), v?.frameRateMode ?? null,
      v?.bitDepth ?? null, v?.chroma ?? null, v ? [v.colorPrimaries, v.transfer, v.matrix].filter(Boolean).join('/') || null : null, v?.hdr ?? null,
      a.audio?.codec ?? null, a.audio?.sampleRate ?? null, a.audio?.channels ?? null,
      r(ok?.integratedLufs), r(ok?.truePeakDbtp), r(ok?.samplePeakDbfs),
      [...a.notes, a.thumbsNote, l.status === 'unsupported' || l.status === 'error' ? l.reason : null].filter(Boolean).join(' | ') || null
    ])
  }
  return rows
}

function textSummary(item: QueueItem<Analysis>, preset: Preset): string {
  if (!item.result) return `${item.file.name}: ${item.error ?? item.stage}`
  const { verdict, checks } = evaluate(item.result, preset)
  const label = verdict ? { pass: 'Đạt', warn: 'Cảnh báo', fail: 'Không đạt', unknown: 'Không xác định' }[verdict] : 'Chỉ đo'
  return [`${item.file.name} — ${label} (${preset.name})`, summaryLine(item.result), ...checks.map(c => `• ${c.text}`), ...item.result.notes.map(n => `• ${n}`)].join('\n')
}

export default function VideoChecker() {
  const process = useCallback(analyzeFile, [])
  const queue = useFileQueue(process, { maxFiles: 10 })
  const [presetId, setPresetId] = useState(readPreset)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0]

  // Ảnh thumbnail: tạo object URL một lần cho mỗi kết quả, thu hồi khi file bị bỏ khỏi hàng đợi.
  const urlCache = useRef(new Map<string, (string | null)[]>())
  const thumbUrls = useMemo(() => {
    const live = new Set<string>()
    for (const item of queue.items) {
      if (!item.result) continue
      live.add(item.id)
      if (!urlCache.current.has(item.id)) {
        urlCache.current.set(item.id, item.result.thumbs.map(t => (t.blob ? URL.createObjectURL(t.blob) : null)))
      }
    }
    for (const [id, urls] of urlCache.current) {
      if (!live.has(id)) {
        urls.forEach(u => u && URL.revokeObjectURL(u))
        urlCache.current.delete(id)
      }
    }
    return new Map(urlCache.current)
  }, [queue.items])
  useEffect(() => {
    const cache = urlCache.current
    return () => cache.forEach(urls => urls.forEach(u => u && URL.revokeObjectURL(u)))
  }, [])

  const done = queue.items.filter(item => item.status === 'done' || item.status === 'error')
  const selected = queue.items.find(item => item.id === selectedId && item.result) ?? queue.items.find(item => item.result)

  const choosePreset = (id: string) => {
    setPresetId(id)
    try { window.localStorage.setItem(PRESET_KEY, id) } catch { /* bỏ qua */ }
  }

  const copyAll = async () => {
    const text = done.map(item => textSummary(item, preset)).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      saveText(text, 'video-checker.txt')
    }
  }

  const counts = useMemo(() => {
    const c = { pass: 0, warn: 0, fail: 0, unknown: 0, running: 0 }
    for (const item of queue.items) {
      if (item.status === 'error') c.fail++
      else if (item.result) {
        const v = evaluate(item.result, preset).verdict
        if (v) c[v]++
      } else if (item.status === 'running' || item.status === 'queued') c.running++
    }
    return c
  }, [queue.items, preset])

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <DropZone
          title="Thả video vào đây hoặc bấm để chọn"
          hint="MP4, MOV, MKV, MXF… · tối đa 10 file · file 5–10 GB vẫn được"
          accept="video/*,audio/*,.mxf,.mkv,.mts,.m2ts"
          onFiles={queue.addFiles}
        />
        {queue.rejected && <p className="notice notice-warn" role="status">{queue.rejected}</p>}

        {queue.items.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2 className="eyebrow">Hàng đợi · {queue.items.length} file</h2>
              <span className="muted small" aria-live="polite">
                {[counts.pass && `${counts.pass} Đạt`, counts.warn && `${counts.warn} Cảnh báo`, counts.fail && `${counts.fail} Không đạt`, counts.unknown && `${counts.unknown} Không xác định`, counts.running && `${counts.running} đang chờ/đo`].filter(Boolean).join(' · ')}
              </span>
            </div>
            <QueueList
              items={queue.items}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onCancel={queue.cancel}
              onRemove={queue.remove}
              describe={item => ({ summary: summaryLine(item.result!), verdict: evaluate(item.result!, preset).verdict ?? undefined })}
            />
          </section>
        )}

        {selected?.result && <Detail item={selected} preset={preset} thumbUrls={thumbUrls.get(selected.id) ?? []} />}
      </div>

      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Preset đối chiếu</h2>
          <fieldset className="vc-presets">
            <legend className="visually-hidden">Chọn preset</legend>
            {PRESETS.map(p => (
              <label key={p.id} className={`vc-preset${p.id === preset.id ? ' is-on' : ''}`}>
                <input type="radio" name="vc-preset" checked={p.id === preset.id} onChange={() => choosePreset(p.id)} />
                <span>
                  <span className="vc-preset-name">{p.name}</span>
                  <span className="muted small">{p.summary}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="muted small">Đổi preset thì kết quả chấm lại ngay, không cần đo lại.</p>
        </section>

        <section className="card stack">
          <h2 className="eyebrow">Xuất kết quả</h2>
          <button type="button" className="btn btn-primary" disabled={done.length === 0} onClick={() => saveText(toCsv(csvRows(done, preset)), `video-checker-${preset.id}.csv`, 'text/csv;charset=utf-8')}>
            <Icon name="download" size={16} />Xuất CSV ({done.length} file xong)
          </button>
          <button type="button" className="btn" disabled={done.length === 0} onClick={copyAll}>
            <Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Đã sao chép' : 'Sao chép kết quả'}
          </button>
          {queue.items.length > 0 && <button type="button" className="btn btn-ghost" onClick={queue.clear}>Xoá hàng đợi</button>}
        </section>
      </aside>
    </div>
  )
}
