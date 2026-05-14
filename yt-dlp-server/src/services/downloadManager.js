const { randomUUID } = require('crypto')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { isYouTubeUrl } = require('../utils/platforms')

function createDownloadManager(config, tools) {
  fs.mkdirSync(config.downloadDir, { recursive: true })

  const jobs = new Map()

  function activeJobCount() {
    return [...jobs.values()].filter(job => job.status === 'downloading').length
  }

  function createJob({ url, format, quality }) {
    if (activeJobCount() >= config.maxActiveJobs) {
      const error = new Error('Server đang bận, thử lại sau')
      error.statusCode = 429
      throw error
    }

    const jobId = randomUUID()
    const outputTemplate = path.join(config.downloadDir, `${jobId}.%(ext)s`)
    const args = buildYtDlpArgs({ url, format, quality, outputTemplate })

    jobs.set(jobId, {
      status: 'downloading',
      progress: 0,
      filepath: null,
      filename: null,
      startTime: Date.now()
    })

    runYtDlpJob(jobId, args)
    return jobId
  }

  function getJob(jobId) {
    return jobs.get(jobId)
  }

  function removeJob(jobId) {
    jobs.delete(jobId)
  }

  function buildYtDlpArgs({ url, format, quality, outputTemplate }) {
    const args = [
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--retries', '3',
      '--fragment-retries', '5',
      '--extractor-retries', '3',
      '--retry-sleep', 'linear=1:5:2',
      '--socket-timeout', '30',
      '--force-overwrites',
      '-o', outputTemplate
    ]

    if (format === 'audio') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
    } else if (tools.ffmpeg) {
      args.push('--merge-output-format', 'mp4')
      addMergedVideoFormat(args, quality)
    } else {
      addSingleFileVideoFormat(args, quality)
    }

    for (const item of buildExtractorArgs(url)) {
      args.push('--extractor-args', item)
    }

    args.push(url)
    return args
  }

  function addMergedVideoFormat(args, quality) {
    if (quality === '1080p') {
      args.push('-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]/best')
    } else if (quality === '720p') {
      args.push('-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/best')
    } else {
      args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best')
    }
  }

  function addSingleFileVideoFormat(args, quality) {
    if (quality === '1080p') {
      args.push('-f', 'b[height<=1080][ext=mp4]/b[height<=1080]/best')
    } else if (quality === '720p') {
      args.push('-f', 'b[height<=720][ext=mp4]/b[height<=720]/best')
    } else {
      args.push('-f', 'b[ext=mp4]/best')
    }
  }

  function buildExtractorArgs(url) {
    const extractorArgs = ['tiktok:api_hostname=api22-normal-c-useast1a.tiktokv.com']

    // YouTube occasionally requires explicit client/PO token settings.
    // Keep this opt-in so normal downloads continue using yt-dlp defaults.
    if (isYouTubeUrl(url)) {
      const youtubeArgs = []
      if (config.youtubePlayerClient) youtubeArgs.push(`player_client=${config.youtubePlayerClient}`)
      if (config.youtubePoToken) youtubeArgs.push(`po_token=${config.youtubePoToken}`)
      if (youtubeArgs.length) extractorArgs.push(`youtube:${youtubeArgs.join(';')}`)
    }

    return extractorArgs
  }

  function runYtDlpJob(jobId, args, attempt = 1) {
    const job = jobs.get(jobId)
    if (!job) return

    job.status = 'downloading'
    job.attempt = attempt

    let stderrBuf = ''
    let timedOut = false
    let closed = false
    const proc = spawn(config.ytdlpBin, args, { windowsHide: true })
    job.proc = proc

    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!closed) proc.kill('SIGKILL')
      }, 5000).unref()
    }, config.jobTimeoutMs)
    timeout.unref()

    proc.stdout.on('data', data => updateProgress(jobId, data))
    proc.stderr.on('data', data => {
      updateProgress(jobId, data)
      stderrBuf = (stderrBuf + data.toString()).slice(-4000)
    })

    proc.on('error', err => {
      clearTimeout(timeout)
      const currentJob = jobs.get(jobId)
      if (!currentJob) return

      currentJob.status = 'error'
      currentJob.error = err.code === 'ENOENT'
        ? 'Server chưa cài yt-dlp hoặc YTDLP_BIN không đúng.'
        : 'Không khởi động được yt-dlp.'
      currentJob.proc = null
    })

    proc.on('close', code => {
      closed = true
      clearTimeout(timeout)

      const currentJob = jobs.get(jobId)
      if (!currentJob || currentJob.status === 'error') return
      currentJob.proc = null

      if (code === 0) return completeJob(jobId)

      if (!timedOut && attempt < 2) {
        cleanupJobFiles(jobId)
        runYtDlpJob(jobId, args, attempt + 1)
        return
      }

      currentJob.status = 'error'
      currentJob.error = classifyDownloadError(stderrBuf, timedOut)
      cleanupJobFiles(jobId)
      console.error('yt-dlp error:', stderrBuf.slice(-500))
    })
  }

  function updateProgress(jobId, chunk) {
    const match = chunk.toString().match(/\[download\]\s+([\d.]+)%/)
    if (!match) return

    const job = jobs.get(jobId)
    if (job) job.progress = parseFloat(match[1])
  }

  function completeJob(jobId) {
    const job = jobs.get(jobId)
    if (!job) return

    const filepath = findJobOutput(jobId)
    if (!filepath) {
      job.status = 'error'
      job.error = 'Không tìm thấy file sau khi tải.'
      return
    }

    job.status = 'done'
    job.progress = 100
    job.filepath = filepath
    job.filename = `heymedia-dl-${Date.now()}${path.extname(filepath)}`
  }

  function findJobOutput(jobId) {
    try {
      const files = fs.readdirSync(config.downloadDir)
        .filter(file => file.startsWith(jobId) && !file.endsWith('.part'))
        .map(file => ({
          name: file,
          time: fs.statSync(path.join(config.downloadDir, file)).mtimeMs
        }))
        .sort((a, b) => b.time - a.time)

      return files[0] ? path.join(config.downloadDir, files[0].name) : null
    } catch (err) {
      console.error('findJobOutput error:', err.message)
      return null
    }
  }

  function cleanupJobFiles(jobId) {
    try {
      for (const file of fs.readdirSync(config.downloadDir)) {
        if (file.startsWith(jobId)) fs.unlink(path.join(config.downloadDir, file), () => {})
      }
    } catch (err) {
      console.error('cleanupJobFiles error:', err.message)
    }
  }

  function cleanupStaleJobs() {
    const now = Date.now()

    for (const [jobId, job] of jobs.entries()) {
      if (now - job.startTime > config.jobTtlMs && job.status !== 'downloading') {
        if (job.filepath) fs.unlink(job.filepath, () => {})
        cleanupJobFiles(jobId)
        jobs.delete(jobId)
      }
    }

    try {
      for (const file of fs.readdirSync(config.downloadDir)) {
        const filePath = path.join(config.downloadDir, file)
        fs.stat(filePath, (err, stat) => {
          if (!err && now - stat.mtimeMs > config.jobTtlMs) fs.unlink(filePath, () => {})
        })
      }
    } catch (err) {
      console.error('cleanupStaleJobs error:', err.message)
    }
  }

  return {
    activeJobCount,
    cleanupStaleJobs,
    createJob,
    getJob,
    removeJob
  }
}

function classifyDownloadError(stderr, timedOut) {
  const text = stderr.toLowerCase()

  if (timedOut) return 'Tải xuống quá thời gian cho phép. Video có thể quá lớn hoặc nền tảng phản hồi quá chậm.'
  if (text.includes('ffmpeg') && text.includes('not found')) return 'Server thiếu ffmpeg. Không thể ghép video/audio hoặc xuất MP3.'
  if (text.includes('private') || text.includes('login') || text.includes('sign in')) return 'Video cần đăng nhập hoặc đang ở chế độ riêng tư.'
  if (text.includes('copyright') || text.includes('unavailable')) return 'Video không khả dụng hoặc bị giới hạn bởi nền tảng.'
  if (text.includes('403') || text.includes('po token') || text.includes('proof of origin')) {
    return 'YouTube từ chối tải video này. Hãy cập nhật yt-dlp hoặc cấu hình YOUTUBE_PLAYER_CLIENT/YOUTUBE_PO_TOKEN nếu cần.'
  }
  if (text.includes('timed out') || text.includes('connection') || text.includes('network')) return 'Lỗi mạng tạm thời khi tải video. Vui lòng thử lại.'

  return 'Không tải được. Video có thể bị private, giới hạn vùng, hoặc nền tảng vừa thay đổi.'
}

module.exports = { createDownloadManager }
