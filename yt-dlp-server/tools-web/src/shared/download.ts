// Tải kết quả về máy người dùng. Không có request nào ra server: blob được tạo ngay trong trình duyệt.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Safari cần URL còn sống thêm một chút sau click.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function saveText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  saveBlob(new Blob([text], { type }), filename)
}

export type ZipEntry = { name: string; data: Uint8Array | Blob }

// Nén nhiều kết quả thành một file ZIP. fflate chỉ được tải khi cần (chunk riêng).
export async function saveZip(entries: ZipEntry[], filename: string): Promise<void> {
  const { zip } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const entry of entries) {
    let name = entry.name.replace(/[\\/:*?"<>|]+/g, '_') || 'file'
    for (let i = 2; used.has(name); i++) name = name.replace(/(\.[^.]*)?$/, `-${i}$1`)
    used.add(name)
    files[name] = entry.data instanceof Blob ? new Uint8Array(await entry.data.arrayBuffer()) : entry.data
  }
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    // Ảnh/video đã nén sẵn: level 0 (chỉ đóng gói) nhanh hơn nhiều mà dung lượng gần như không đổi.
    zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)))
  })
  saveBlob(new Blob([data], { type: 'application/zip' }), filename)
}
