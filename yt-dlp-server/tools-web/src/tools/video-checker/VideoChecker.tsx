import { useCallback } from 'react'
import { Icon } from '../../components/Icon'
import { formatBytes, toCsv } from '../../lib/format'
import { saveText } from '../../shared/download'
import { DropZone } from '../../shared/DropZone'
import { throwIfAborted } from '../../shared/errors'
import { QueueList } from '../../shared/QueueList'
import { useFileQueue, type ProcessContext } from '../../shared/useFileQueue'

// BƯỚC 1: khung thử cho hàng đợi dùng chung. Chỉ đọc thông tin File và băm thử phần đầu file
// theo từng khúc để kiểm tra tiến độ + huỷ. Đọc thông số thật (mediainfo.js) và LUFS là việc của Bước 2.
type BasicInfo = { name: string; size: number; type: string; lastModified: number; sampledBytes: number }

const CHUNK = 8 * 1024 * 1024

async function inspect(file: File, { signal, onProgress }: ProcessContext): Promise<BasicInfo> {
  const limit = Math.min(file.size, 64 * 1024 * 1024) // đọc thử tối đa 64 MB đầu file
  let read = 0
  while (read < limit) {
    throwIfAborted(signal)
    const end = Math.min(read + CHUNK, limit)
    await file.slice(read, end).arrayBuffer()
    read = end
    onProgress(limit ? read / limit : 1, 'Đang đọc thử file')
  }
  return { name: file.name, size: file.size, type: file.type || 'không rõ', lastModified: file.lastModified, sampledBytes: read }
}

export default function VideoChecker() {
  const process = useCallback(inspect, [])
  const queue = useFileQueue(process, { maxFiles: 10 })
  const done = queue.items.filter(item => item.status === 'done' && item.result)

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['file', 'dung_luong_byte', 'mime', 'sua_lan_cuoi']]
    for (const item of done) {
      const r = item.result!
      rows.push([r.name, r.size, r.type, new Date(r.lastModified).toISOString()])
    }
    saveText(toCsv(rows), 'video-checker.csv', 'text/csv;charset=utf-8')
  }

  return (
    <div className="tool-layout">
      <div className="tool-col">
        <p className="notice notice-warn" role="status">
          <Icon name="alert" size={18} />
          Bản khung: hiện chỉ đọc tên, dung lượng, định dạng. Đo thông số và LUFS sẽ có ở Bước 2.
        </p>
        <DropZone
          title="Thả video vào đây hoặc bấm để chọn"
          hint="MP4, MOV, MKV, MXF… · tối đa 10 file"
          accept="video/*,.mxf,.mkv"
          onFiles={queue.addFiles}
        />
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
              describe={item => ({ summary: `${item.result?.type} · ${formatBytes(item.result?.sampledBytes ?? 0)} đã đọc thử` })}
            />
          </section>
        )}
      </div>
      <aside className="tool-aside">
        <section className="card stack">
          <h2 className="eyebrow">Xuất kết quả</h2>
          <button type="button" className="btn btn-primary" disabled={done.length === 0} onClick={exportCsv}>
            <Icon name="download" size={16} />Xuất CSV ({done.length} file xong)
          </button>
        </section>
      </aside>
    </div>
  )
}
