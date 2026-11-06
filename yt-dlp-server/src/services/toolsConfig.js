const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Cấu hình bật/tắt Hey Tools, lưu ở data/tools-config.json (volume Docker, không mất khi rebuild).
// Quy ước: tool không có trong file = TẮT. Vì vậy tool mới thêm vào code luôn tắt cho tới khi admin bật.

const TOOL_ID = /^[a-z0-9-]{1,40}$/
const MAX_TOOLS = 200

function emptyConfig() {
  return { version: 1, tools: {}, updatedAt: null, updatedBy: null }
}

// Trả về thông báo lỗi (string) nếu không hợp lệ, null nếu hợp lệ.
function validateTools(tools) {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return 'tools phải là object { "<id>": true|false }'
  const entries = Object.entries(tools)
  if (entries.length > MAX_TOOLS) return `Tối đa ${MAX_TOOLS} tool`
  for (const [id, value] of entries) {
    if (!TOOL_ID.test(id)) return `id tool không hợp lệ: ${JSON.stringify(id).slice(0, 60)}`
    if (typeof value !== 'boolean') return `Giá trị của "${id}" phải là true hoặc false`
  }
  return null
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return emptyConfig()
  const tools = validateTools(raw.tools) === null ? raw.tools : {}
  return {
    version: 1,
    tools,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null
  }
}

function createToolsConfigStore(filePath) {
  let writeChain = Promise.resolve()

  function read() {
    let text
    try {
      text = fs.readFileSync(filePath, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return emptyConfig()
      console.error('[tools-config] không đọc được file:', err.message)
      return emptyConfig()
    }
    try {
      return normalize(JSON.parse(text))
    } catch (err) {
      // File hỏng thì coi như tắt hết (an toàn hơn bật nhầm), và không ghi đè cho tới lần lưu kế tiếp.
      console.error('[tools-config] file hỏng, tạm coi như tắt hết:', err.message)
      return emptyConfig()
    }
  }

  function enabledIds() {
    const { tools } = read()
    return Object.keys(tools).filter(id => tools[id] === true).sort()
  }

  // Ghi atomic: ghi file tạm cùng thư mục, fsync, rồi rename đè lên file thật.
  function writeAtomic(data) {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`)
    const fd = fs.openSync(tmp, 'w', 0o644)
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    try {
      fs.renameSync(tmp, filePath)
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      throw err
    }
  }

  // Các lần lưu được xếp hàng để hai admin bấm cùng lúc không ghi chồng giữa chừng.
  function save(tools, updatedBy) {
    const error = validateTools(tools)
    if (error) return Promise.reject(Object.assign(new Error(error), { statusCode: 400 }))
    const next = writeChain.then(() => {
      const data = { version: 1, tools, updatedAt: new Date().toISOString(), updatedBy }
      writeAtomic(data)
      return data
    })
    writeChain = next.catch(() => {})
    return next
  }

  return { read, enabledIds, save, filePath }
}

module.exports = { createToolsConfigStore, validateTools, TOOL_ID }
