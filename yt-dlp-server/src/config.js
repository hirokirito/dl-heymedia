const path = require('path')
const { resolveCommand } = require('./utils/tools')

const rootDir = path.resolve(__dirname, '..')

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3001),
  publicDir: path.join(rootDir, 'public'),
  downloadDir: process.env.DOWNLOAD_DIR || '/tmp/yt-dlp-downloads',
  maxActiveJobs: Number(process.env.MAX_ACTIVE_JOBS || 3),
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 10 * 60 * 1000),
  jobTtlMs: Number(process.env.JOB_TTL_MS || 60 * 60 * 1000),
  ytdlpBin: process.env.YTDLP_BIN || resolveCommand(['/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp']),
  ffmpegBin: process.env.FFMPEG_BIN || resolveCommand(['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']),
  ytdlpJsRuntime: process.env.YTDLP_JS_RUNTIME || resolveCommand(['/usr/local/bin/deno', '/home/heymedia/.deno/bin/deno', 'deno']),
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE || '',
  ytdlpImpersonateClient: process.env.YTDLP_IMPERSONATE_CLIENT || '',
  douyinBrowserFallback: process.env.DOUYIN_BROWSER_FALLBACK === '1',
  youtubePlayerClient: process.env.YOUTUBE_PLAYER_CLIENT || '',
  youtubePoToken: process.env.YOUTUBE_PO_TOKEN || '',
  allowedOrigins: ['https://heymedia.online', 'https://dl.heymedia.online']
}

module.exports = config
