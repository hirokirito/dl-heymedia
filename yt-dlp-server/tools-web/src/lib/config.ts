import { useEffect, useState } from 'react'

export type ToolsConfigState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; enabled: Set<string> }

// Danh sách tool đang bật. Tool không có trong danh sách (kể cả tool mới chưa cấu hình) coi như tắt.
export function useEnabledTools(): ToolsConfigState {
  const [state, setState] = useState<ToolsConfigState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/tools-config', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async res => {
        if (!res.ok) throw new Error(`Server trả lỗi ${res.status}`)
        const data: unknown = await res.json()
        const enabled = (data as { enabled?: unknown }).enabled
        if (!Array.isArray(enabled)) throw new Error('Dữ liệu cấu hình không hợp lệ')
        setState({ status: 'ready', enabled: new Set(enabled.filter((x): x is string => typeof x === 'string')) })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Không tải được cấu hình' })
      })
    return () => controller.abort()
  }, [])

  return state
}

export type AdminConfig = {
  tools: Record<string, boolean>
  updatedAt: string | null
  updatedBy: string | null
  viewer: string
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function readJson(res: Response): Promise<unknown> {
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = (data as { error?: unknown }).error
    throw new HttpError(res.status, typeof message === 'string' ? message : `Server trả lỗi ${res.status}`)
  }
  return data
}

export async function fetchAdminConfig(signal?: AbortSignal): Promise<AdminConfig> {
  const res = await fetch('/api/admin/tools-config', { signal, headers: { Accept: 'application/json' } })
  return (await readJson(res)) as AdminConfig
}

export async function saveAdminConfig(tools: Record<string, boolean>): Promise<AdminConfig> {
  const res = await fetch('/api/admin/tools-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ tools })
  })
  return (await readJson(res)) as AdminConfig
}
