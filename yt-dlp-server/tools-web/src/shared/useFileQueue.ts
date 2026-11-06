import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from './errors'

export type QueueStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type QueueItem<R> = {
  id: string
  file: File
  status: QueueStatus
  progress: number // 0..1, -1 = không xác định
  stage: string
  result?: R
  error?: string
}

export type ProcessContext = {
  signal: AbortSignal
  // Gọi để cập nhật tiến độ; giá trị ngoài 0..1 hiển thị dạng "đang chạy".
  onProgress: (progress: number, stage?: string) => void
}

export type Processor<R> = (file: File, ctx: ProcessContext) => Promise<R>

let nextId = 0

// Hàng đợi chạy LẦN LƯỢT từng file (tránh hai file 5 GB cùng chiếm RAM), có huỷ từng file.
export function useFileQueue<R>(process: Processor<R>, { maxFiles = 10 }: { maxFiles?: number } = {}) {
  const [items, setItems] = useState<QueueItem<R>[]>([])
  const [rejected, setRejected] = useState<string | null>(null)
  const controllers = useRef(new Map<string, AbortController>())
  const runningRef = useRef(false)
  const processRef = useRef(process)
  processRef.current = process

  const patch = useCallback((id: string, update: Partial<QueueItem<R>>) => {
    setItems(list => list.map(item => (item.id === id ? { ...item, ...update } : item)))
  }, [])

  const itemsRef = useRef(items)
  itemsRef.current = items

  const addFiles = useCallback((files: File[]) => {
    const room = Math.max(0, maxFiles - itemsRef.current.length)
    const accepted = files.slice(0, room).map(file => ({ id: `f${++nextId}`, file, status: 'queued' as const, progress: 0, stage: 'Đang chờ' }))
    setRejected(files.length > room ? `Chỉ nhận tối đa ${maxFiles} file mỗi lượt; ${files.length - room} file bị bỏ qua.` : null)
    if (accepted.length) setItems(list => [...list, ...accepted])
  }, [maxFiles])

  const cancel = useCallback((id: string) => {
    const controller = controllers.current.get(id)
    if (controller) controller.abort()
    setItems(list => list.map(item => (item.id === id && (item.status === 'queued' || item.status === 'running') ? { ...item, status: 'cancelled', stage: 'Đã huỷ' } : item)))
  }, [])

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    setItems(list => list.filter(item => item.id !== id))
  }, [])

  const clear = useCallback(() => {
    controllers.current.forEach(controller => controller.abort())
    setItems([])
    setRejected(null)
  }, [])

  // Mỗi lần danh sách đổi: nếu không có file nào đang chạy thì lấy file chờ đầu tiên.
  useEffect(() => {
    if (runningRef.current) return
    const next = items.find(item => item.status === 'queued')
    if (!next) return

    runningRef.current = true
    const controller = new AbortController()
    controllers.current.set(next.id, controller)
    patch(next.id, { status: 'running', stage: 'Đang xử lý', progress: -1 })

    let lastUpdate = 0
    const onProgress = (progress: number, stage?: string) => {
      const now = performance.now()
      if (now - lastUpdate < 100 && progress < 1) return // tránh render quá dày với file lớn
      lastUpdate = now
      patch(next.id, stage ? { progress, stage } : { progress })
    }

    processRef.current(next.file, { signal: controller.signal, onProgress })
      .then(result => {
        if (!controller.signal.aborted) patch(next.id, { status: 'done', progress: 1, stage: 'Xong', result })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        patch(next.id, { status: 'error', stage: 'Lỗi', error: describeError(err) })
      })
      .finally(() => {
        controllers.current.delete(next.id)
        runningRef.current = false
        // Kích hoạt effect chạy file kế tiếp.
        setItems(list => [...list])
      })
  }, [items, patch])

  useEffect(() => {
    const map = controllers.current
    return () => map.forEach(controller => controller.abort())
  }, [])

  return { items, rejected, addFiles, cancel, remove, clear }
}
