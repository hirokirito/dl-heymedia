const express = require('express')
const fs = require('fs')
const path = require('path')
const config = require('./config')
const { createCorsMiddleware } = require('./middleware/cors')
const { createDownloadManager } = require('./services/downloadManager')
const { isAllowedMediaUrl } = require('./utils/platforms')
const { commandExists } = require('./utils/tools')

const tools = {
  ytdlp: commandExists(config.ytdlpBin),
  ffmpeg: commandExists(config.ffmpegBin),
  jsRuntime: commandExists(config.ytdlpJsRuntime),
  cookiesFile: Boolean(config.ytdlpCookiesFile && fs.existsSync(config.ytdlpCookiesFile))
}
console.log('[tools]', tools)
if (config.ytdlpCookiesFile && !tools.cookiesFile) {
  console.warn(`[tools] YTDLP_COOKIES_FILE not found: ${config.ytdlpCookiesFile}`)
}

const downloadManager = createDownloadManager(config, tools)

function createApp() {
  const app = express()
  const indexFile = path.join(config.publicDir, 'index.html')

  app.use(express.json({ limit: '32kb' }))
  app.use(createCorsMiddleware(config.allowedOrigins))

  console.log(`[routes] static directory: ${config.publicDir}`)
  console.log(`[routes] index file: ${indexFile} (${fs.existsSync(indexFile) ? 'found' : 'missing'})`)

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      tools
    })
  })
  console.log('[routes] GET /health')

  app.post('/api/download', (req, res) => {
    const { url, format = 'video', quality = 'best' } = req.body

    const validationError = validateDownloadRequest({ url, format, quality })
    if (validationError) return res.status(validationError.statusCode).json({ error: validationError.message })

    try {
      const jobId = downloadManager.createJob({ url, format, quality })
      res.json({ jobId })
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Không tạo được job tải xuống.' })
    }
  })
  console.log('[routes] POST /api/download')

  app.get('/api/download/:jobId/status', (req, res) => {
    const job = downloadManager.getJob(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    res.json({
      status: job.status,
      progress: job.progress,
      filename: job.filename,
      error: job.error
    })
  })
  console.log('[routes] GET /api/download/:jobId/status')

  app.get('/api/download/:jobId/file', (req, res) => {
    const job = downloadManager.getJob(req.params.jobId)
    if (!job || job.status !== 'done' || !job.filepath) {
      return res.status(404).json({ error: 'File not ready' })
    }

    const filename = encodeURIComponent(job.filename)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.setHeader('Content-Type', 'application/octet-stream')

    const stream = fs.createReadStream(job.filepath)
    stream.pipe(res)
    stream.on('end', () => {
      fs.unlink(job.filepath, () => {})
      downloadManager.removeJob(req.params.jobId)
    })
    stream.on('error', () => res.status(500).end())
  })
  console.log('[routes] GET /api/download/:jobId/file')

  app.get('/', (req, res) => {
    res.sendFile(indexFile)
  })
  console.log('[routes] GET /')

  app.use(express.static(config.publicDir, { index: false }))
  console.log('[routes] static assets mounted at /')

  // Keep future frontend-only pages working without intercepting API routes.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts('html')) {
      return res.sendFile(indexFile)
    }
    next()
  })

  return app
}

function validateDownloadRequest({ url, format, quality }) {
  if (!url) return httpError(400, 'URL required')
  if (!isAllowedMediaUrl(url)) return httpError(400, 'URL không được hỗ trợ')
  if (!['video', 'audio'].includes(format)) return httpError(400, 'Định dạng không hợp lệ')
  if (!['best', '1080p', '720p'].includes(quality)) return httpError(400, 'Chất lượng không hợp lệ')
  if (!tools.ytdlp) return httpError(503, 'Server chưa cài yt-dlp hoặc YTDLP_BIN không đúng.')
  if (format === 'audio' && !tools.ffmpeg) return httpError(503, 'Server thiếu ffmpeg nên chưa thể xuất MP3.')

  return null
}

function httpError(statusCode, message) {
  return { statusCode, message }
}

module.exports = {
  config,
  createApp,
  downloadManager,
  tools
}
