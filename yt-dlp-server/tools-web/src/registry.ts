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
  },
  {
    id: 'frame-extract',
    name: 'Trích frame',
    group: 'video',
    description: 'Xuất khung hình PNG/JPG theo mốc thời gian',
    icon: 'camera',
    load: () => import('./tools/frame-extract/FrameExtract')
  },
  {
    id: 'video-trim',
    name: 'Cắt video nhanh',
    group: 'video',
    description: 'Cắt đoạn, không mã hoá lại',
    icon: 'scissors',
    load: () => import('./tools/video-trim/VideoTrim')
  },
  {
    id: 'audio-extract',
    name: 'Tách âm thanh',
    group: 'video',
    description: 'Lấy track âm thanh ra file riêng',
    icon: 'music',
    load: () => import('./tools/audio-extract/AudioExtract')
  },
  {
    id: 'audio-check',
    name: 'Kiểm tra audio',
    group: 'audio',
    description: 'Sample rate, số kênh, loudness, peak',
    icon: 'wave',
    load: () => import('./tools/audio-check/AudioCheck')
  }
]

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find(tool => tool.id === id)
}
