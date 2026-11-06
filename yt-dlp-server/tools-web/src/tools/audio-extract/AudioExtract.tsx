import { useCallback, useState } from 'react'
import { Icon } from '../../components/Icon'
import { formatBytes } from '../../lib/format'
import { baseName } from '../../lib/time'
import { saveBlob, saveZip } from '../../shared/download'
import { DropZone } from '../../shared/DropZone'
import { audioContainerFor, openInput, runCopy } from '../../shared/mediaCopy'
import { QueueList } from '../../shared/QueueList'
import { useFileQueue, type ProcessContext } from '../../shared/useFileQueue'

type Mode = 'copy' | 'wav'
type Extracted = { blob: Blob; filename: string; label: string; codec: string | null; note: string | null }

const LABEL: Record<Mode, string> = { copy: 'Giữ nguyên (không mã hoá lại)', wav: 'WAV PCM 16-bit' }

async function extract(file: File, ctx: ProcessContext, mode: Mode): Promise<Extracted> {
  ctx.onProgress(-1, 'Đang đọc track âm thanh')
  const input = openInput(file)
  let codec: string | null = null
  let estimated = 0
  try {
    const audio = await input.getPrimaryAudioTrack()
    if (!audio) throw new Error('File không có âm thanh.')
    codec = audio.codec
    const duration = await input.computeDuration()
    if (mode === 'wav') {
      estimated = Math.ceil(duration * audio.sampleRate * audio.numberOfChannels * 2)
    } else {
      const stats = await audio.computePacketStats(200)
      estimated = Math.ceil((stats.averageBitrate * duration) / 8 * 1.05)
    }
  } finally {
    input.dispose()
  }
  const result = await runCopy({
    file,
    outputName: `${baseName(file.name)}_audio`,
    container: streaming => audioContainerFor(mode === 'wav' ? 'pcm-s16' : codec, streaming),
    discardVideo: true,
    toWav: mode === 'wav',
    deliver: 'blob',
    estimatedBytes: estimated,
    signal: ctx.signal,
    onProgress: p => ctx.onProgress(p, `Đang ${mode === 'wav' ? 'chuyển sang WAV' : 'chép âm thanh'} ${Math.round(p * 100)}%`)
  })
  if (!result.blob) throw new Error('Không tạo được file âm thanh.')
  return { blob: result.blob, filename: result.filename, label: result.label, codec, note: result.discarded.length ? result.discarded.join('; ') : null }
}

export default function AudioExtract() {
  const [mode, setMode] = useState<Mode>('copy')
  const process = useCallback((file: File, ctx: ProcessContext) => extract(file, ctx, mode), [mode])
  const queue = useFileQueue(process, { maxFiles: 10 })
  const done = queue.items.filter(i => i.status === 'done' && i.result)

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <DropZone title="Thả video vào đây hoặc bấm để chọn" hint="Lấy riêng track âm thanh · tối đa 10 file" accept="video/*,audio/*,.mkv,.mov,.mxf" onFiles={queue.addFiles} />
        {queue.rejected && <p className="notice notice-warn" role="status">{queue.rejected}</p>}
        {queue.items.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2 className="eyebrow">Hàng đợi · {queue.items.length} file</h2>
              <button type="button" className="btn btn-ghost" onClick={queue.clear}>Xoá hàng đợi</button>
            </div>
            <QueueList
              items={queue.items}
              onCancel={queue.cancel}
              onRemove={queue.remove}
              describe={item => ({
                summary: (
                  <>
                    {item.result!.label} · {formatBytes(item.result!.blob.size)}
                    {item.result!.note ? ` · ${item.result!.note}` : ''}
                    {' · '}
                    <button type="button" className="link-btn" onClick={() => saveBlob(item.result!.blob, item.result!.filename)}>Tải {item.result!.filename}</button>
                  </>
                )
              })}
            />
          </section>
        )}
      </div>
      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Định dạng đầu ra</h2>
          <fieldset className="vc-presets">
            <legend className="visually-hidden">Định dạng đầu ra</legend>
            {(['copy', 'wav'] as const).map(m => (
              <label key={m} className={`vc-preset${mode === m ? ' is-on' : ''}`}>
                <input type="radio" name="ae-mode" checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  <span className="vc-preset-name">{LABEL[m]}</span>
                  <span className="muted small">{m === 'copy' ? 'Nhanh, đúng chất lượng gốc: AAC → .m4a, MP3 → .mp3, PCM → .wav, Opus → .ogg' : 'Giải mã ra PCM để đưa vào phần mềm chỉ nhận WAV (file lớn hơn nhiều)'}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="muted small">Áp dụng cho file thả vào sau khi chọn.</p>
        </section>
        <section className="card stack">
          <h2 className="eyebrow">Tải kết quả</h2>
          <button type="button" className="btn btn-primary" disabled={done.length === 0}
            onClick={() => saveZip(done.map(i => ({ name: i.result!.filename, data: i.result!.blob })), 'am-thanh.zip')}>
            <Icon name="download" size={16} />Tải tất cả (ZIP, {done.length} file)
          </button>
        </section>
      </aside>
    </div>
  )
}
