import type { ComponentType } from 'react'
import type { IconName } from './components/Icon'

export type ToolGroup = 'video' | 'audio' | 'image' | 'document'

export type ToolDef = {
  // id cũng là đường dẫn: /tools/<id>. Chỉ chữ thường, số và gạch ngang (server kiểm tra cùng quy tắc).
  id: string
  name: string
  group: ToolGroup
  description: string
  icon: IconName
  // Mỗi tool là một chunk lazy riêng: tool đang tắt không bao giờ bị tải.
  load: () => Promise<{ default: ComponentType }>
}

export const GROUP_LABELS: Record<ToolGroup, string> = {
  video: 'Video',
  audio: 'Âm thanh',
  image: 'Ảnh',
  document: 'Tài liệu & văn bản'
}

export const GROUP_ORDER: ToolGroup[] = ['video', 'audio', 'image', 'document']

// Thêm tool mới: thêm một mục ở đây. Tool mới mặc định TẮT cho tới khi admin bật.
export const TOOLS: ToolDef[] = [
  {
    id: 'video-checker',
    name: 'Video Checker',
    group: 'video',
    description: 'Thông số, loudness, đối chiếu preset',
    icon: 'film',
    load: () => import('./tools/video-checker/VideoChecker')
  }
]

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find(tool => tool.id === id)
}
