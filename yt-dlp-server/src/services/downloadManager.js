const { randomUUID } = require('crypto')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { isDouyinUrl, isYouTubeUrl } = require('../utils/platforms')

const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

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
    const fallbackArgs = isYouTubeUrl(url)
      ? buildYouTubeFallbackArgs({ url, format, quality, outputTemplate })
      : null

    jobs.set(jobId, {
      status: 'downloading',
      progress: 0,
      filepath: null,
      filename: null,
      fallbackArgs,
      douyinFallback: isDouyinUrl(url) && format !== 'audio'
        ? { url, outputPath: path.join(config.downloadDir, `${jobId}.mp4`) }
        : null,
      usedFallback: false,
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

    addJsRuntime(args)
    addCookiesFile(args)
    addPlatformHeaders(args, url)

    if (format === 'audio') {
      if (tools.ffmpeg) args.push('--ffmpeg-location', config.ffmpegBin)
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
    } else if (tools.ffmpeg) {
      args.push('--ffmpeg-location', config.ffmpegBin)
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

  function buildYouTubeFallbackArgs({ url, format, quality, outputTemplate }) {
    const args = buildYtDlpArgs({ url, format, quality, outputTemplate })
    const urlArg = args.pop()

    removeFormatArgs(args)
    removeYouTubeExtractorArgs(args)
    args.push(
      '--extractor-args', 'youtube:player_client=android',
      '-f', format === 'audio' ? 'ba/bestaudio/best' : 'best[ext=mp4]/18/best',
      urlArg
    )

    return args
  }

  function addJsRuntime(args) {
    if (tools.jsRuntime) args.push('--js-runtimes', config.ytdlpJsRuntime)
  }

  function addCookiesFile(args) {
    if (tools.cookiesFile) args.push('--cookies', config.ytdlpCookiesFile)
  }

  function addPlatformHeaders(args, url) {
    if (!isDouyinUrl(url)) return

    args.push(
      '--user-agent', DOUYIN_USER_AGENT,
      '--add-header', 'Referer:https://www.douyin.com/'
    )
  }

  function removeFormatArgs(args) {
    let index = args.indexOf('-f')
    while (index !== -1) {
      args.splice(index, 2)
      index = args.indexOf('-f')
    }
  }

  function removeYouTubeExtractorArgs(args) {
    for (let index = args.length - 2; index >= 0; index -= 1) {
      if (args[index] === '--extractor-args' && args[index + 1].startsWith('youtube:')) {
        args.splice(index, 2)
      }
    }
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

      if (!timedOut && currentJob.douyinFallback && !currentJob.usedFallback && shouldUseDouyinFallback(stderrBuf)) {
        currentJob.usedFallback = true
        currentJob.progress = 0
        cleanupJobFiles(jobId)
        console.warn('yt-dlp retrying with custom Douyin fallback:', stderrBuf.slice(-300))
        runDouyinFallbackJob(jobId, currentJob.douyinFallback)
        return
      }

      if (!timedOut && currentJob.fallbackArgs && !currentJob.usedFallback && shouldUseYouTubeFallback(stderrBuf)) {
        currentJob.usedFallback = true
        currentJob.progress = 0
        cleanupJobFiles(jobId)
        console.warn('yt-dlp retrying with YouTube Android fallback:', stderrBuf.slice(-300))
        runYtDlpJob(jobId, currentJob.fallbackArgs, attempt + 1)
        return
      }

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

  async function runDouyinFallbackJob(jobId, fallback) {
    const job = jobs.get(jobId)
    if (!job) return

    job.status = 'downloading'
    job.proc = null

    try {
      const mediaUrl = await resolveDouyinMediaUrl(fallback.url)
      await downloadDouyinMedia(jobId, mediaUrl, fallback.outputPath)
      completeJob(jobId)
    } catch (err) {
      const currentJob = jobs.get(jobId)
      if (!currentJob) return

      currentJob.status = 'error'
      currentJob.error = `Douyin fallback không tải được: ${err.message}`
      cleanupJobFiles(jobId)
      console.error('douyin fallback error:', err.message)
    }
  }

  async function resolveDouyinMediaUrl(url) {
    const cookie = readCookieHeader()
    const pageResponse = await fetch(url, {
      redirect: 'follow',
      headers: buildDouyinHeaders(cookie)
    })
    const html = await pageResponse.text()
    const finalUrl = pageResponse.url || url
    const videoId = extractDouyinVideoId(finalUrl, html)

    const candidates = [
      ...extractDouyinUrlsFromHtml(html),
      ...await fetchDouyinApiCandidates(videoId, cookie)
    ]

    const mediaUrl = candidates
      .map(normalizeDouyinMediaUrl)
      .find(Boolean)

    if (!mediaUrl) throw new Error('không tìm thấy video URL trong dữ liệu Douyin')
    return mediaUrl
  }

  async function fetchDouyinApiCandidates(videoId, cookie) {
    if (!videoId) return []

    const apiUrls = [
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=1128&device_platform=webapp`,
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoId}`
    ]
    const candidates = []

    for (const apiUrl of apiUrls) {
      try {
        const response = await fetch(apiUrl, {
          headers: buildDouyinHeaders(cookie, `https://www.douyin.com/video/${videoId}`)
        })
        const text = await response.text()
        if (!text.trim().startsWith('{')) continue
        candidates.push(...extractDouyinUrlsFromJson(JSON.parse(text)))
      } catch (err) {
        console.warn('douyin fallback API skipped:', err.message)
      }
    }

    return candidates
  }

  async function downloadDouyinMedia(jobId, mediaUrl, outputPath) {
    const response = await fetch(mediaUrl, {
      redirect: 'follow',
      headers: buildDouyinHeaders(readCookieHeader())
    })

    if (!response.ok || !response.body) {
      throw new Error(`CDN trả về HTTP ${response.status}`)
    }

    const total = Number(response.headers.get('content-length') || 0)
    let downloaded = 0
    const progress = new TransformStream({
      transform(chunk, controller) {
        downloaded += chunk.byteLength
        if (total > 0) {
          const job = jobs.get(jobId)
          if (job) job.progress = Math.min(99, (downloaded / total) * 100)
        }
        controller.enqueue(chunk)
      }
    })

    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(progress)),
      fs.createWriteStream(outputPath)
    )
  }

  function readCookieHeader() {
    if (!tools.cookiesFile) return ''

    return fs.readFileSync(config.ytdlpCookiesFile, 'utf8')
      .split(/\r?\n/)
      .map(line => line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line)
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.split('\t'))
      .filter(parts => parts.length >= 7)
      .map(parts => `${parts[5]}=${parts.slice(6).join('\t')}`)
      .join('; ')
  }

  function buildDouyinHeaders(cookie, referer = 'https://www.douyin.com/') {
    const headers = {
      'User-Agent': DOUYIN_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      Referer: referer
    }

    if (cookie) headers.Cookie = cookie
    return headers
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

function shouldUseYouTubeFallback(stderr) {
  const text = stderr.toLowerCase()

  return text.includes('[youtube]')
    && (
      text.includes('this video is not available')
      || text.includes('sabr')
      || text.includes('po token')
      || text.includes('missing a url')
      || text.includes('no supported javascript runtime')
      || text.includes('only images are available')
      || text.includes('403')
    )
}

function shouldUseDouyinFallback(stderr) {
  const text = stderr.toLowerCase()

  return text.includes('[douyin]')
    && (
      text.includes('fresh cookies')
      || text.includes('failed to parse json')
      || text.includes('no video formats')
      || text.includes('403')
      || text.includes('login')
    )
}

function extractDouyinVideoId(url, html) {
  const fromUrl = url.match(/\/video\/(\d+)/)
    || url.match(/[?&]modal_id=(\d+)/)
    || url.match(/[?&]aweme_id=(\d+)/)
  if (fromUrl) return fromUrl[1]

  const fromHtml = html.match(/"aweme_id"\s*:\s*"(\d+)"/)
    || html.match(/"awemeId"\s*:\s*"(\d+)"/)
    || html.match(/\/video\/(\d+)/)
  return fromHtml ? fromHtml[1] : ''
}

function extractDouyinUrlsFromHtml(html) {
  const candidates = []

  for (const data of extractJsonBlobs(html)) {
    candidates.push(...extractDouyinUrlsFromJson(data))
  }

  const escapedUrlPattern = /https?:\\?\/\\?\/[^"']+(?:play|playwm|douyin|byte)[^"']+/g
  for (const match of html.matchAll(escapedUrlPattern)) {
    candidates.push(unescapeJsonString(match[0]))
  }

  return candidates
}

function extractJsonBlobs(html) {
  const blobs = []
  const renderData = html.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([^<]+)<\/script>/)
  if (renderData) {
    try {
      blobs.push(JSON.parse(decodeURIComponent(renderData[1])))
    } catch (err) {
      console.warn('douyin fallback RENDER_DATA skipped:', err.message)
    }
  }

  const routerData = html.match(/window\._ROUTER_DATA\s*=\s*({.+?})\s*<\/script>/s)
  if (routerData) {
    try {
      blobs.push(JSON.parse(routerData[1]))
    } catch (err) {
      console.warn('douyin fallback ROUTER_DATA skipped:', err.message)
    }
  }

  const hydrationData = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([^<]+)<\/script>/)
  if (hydrationData) {
    try {
      blobs.push(JSON.parse(hydrationData[1]))
    } catch (err) {
      console.warn('douyin fallback SIGI_STATE skipped:', err.message)
    }
  }

  return blobs
}

function extractDouyinUrlsFromJson(data) {
  const urls = []
  const seen = new Set()

  function visit(value, key = '') {
    if (!value) return

    if (typeof value === 'string') {
      const normalized = unescapeJsonString(value)
      if (looksLikeDouyinMediaUrl(normalized) && !seen.has(normalized)) {
        seen.add(normalized)
        urls.push(normalized)
      }
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
      return
    }

    if (typeof value !== 'object') return

    if (isPlayAddressKey(key) && Array.isArray(value.url_list)) {
      for (const url of value.url_list) visit(url, key)
    }
    if (isPlayAddressKey(key) && Array.isArray(value.urlList)) {
      for (const url of value.urlList) visit(url, key)
    }
    if (isPlayAddressKey(key) && typeof value.src === 'string') {
      visit(value.src, key)
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey)
    }
  }

  visit(data)
  return urls
}

function isPlayAddressKey(key) {
  return /play[_-]?addr|playaddr|download|video/i.test(key)
}

function looksLikeDouyinMediaUrl(url) {
  return /^https?:\/\//.test(url)
    && /(aweme|douyin|byte|snssdk|ixigua|tos-cn)/i.test(url)
    && /(play|mime_type=video|video_id|\.mp4|tos-cn)/i.test(url)
}

function normalizeDouyinMediaUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) return ''

  try {
    const mediaUrl = new URL(url.replace(/\\u0026/g, '&'))
    mediaUrl.href = mediaUrl.href.replace('/playwm/', '/play/')
    return mediaUrl.href
  } catch {
    return ''
  }
}

function unescapeJsonString(value) {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
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
