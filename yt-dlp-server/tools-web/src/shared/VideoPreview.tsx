import { forwardRef, useEffect, useMemo, useState } from 'react'
import { formatTime } from '../lib/time'

// Xem trước video ngay trên máy (object URL, không tải lên đâu). Codec trình duyệt không phát được
// (vd. H.265 trên Chrome không có phần cứng, ProRes) thì báo, người dùng vẫn gõ mốc thời gian được.
type Props = { file: File; onTime?: (t: number) => void }

export const VideoPreview = forwardRef<HTMLVideoElement, Props>(function VideoPreview({ file, onTime }, ref) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const [error, setError] = useState(false)
  const [time, setTime] = useState(0)
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => setError(false), [url])

  return (
    <div className="preview">
      {error ? (
        <div className="preview-empty">Trình duyệt này không phát được video này để xem trước. Bạn vẫn gõ mốc thời gian được.</div>
      ) : (
        <video
          ref={ref}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setError(true)}
          onTimeUpdate={event => {
            const t = event.currentTarget.currentTime
            setTime(t)
            onTime?.(t)
          }}
        />
      )}
      {!error && <span className="muted small">Vị trí hiện tại: {formatTime(time)}</span>}
    </div>
  )
})
