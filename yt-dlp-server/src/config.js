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
  ytdlpBin: process.env.YTDLP_BIN || resolveCommand(['/opt/ytdlp/bin/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp']),
  ffmpegBin: process.env.FFMPEG_BIN || resolveCommand(['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']),
  ytdlpJsRuntime: process.env.YTDLP_JS_RUNTIME || resolveCommand(['/opt/ytdlp/bin/deno', '/usr/local/bin/deno', '/home/heymedia/.deno/bin/deno', 'deno']),
  // Tên runtime theo đúng cú pháp `--js-runtimes NAME[:PATH]` của yt-dlp.
  ytdlpJsRuntimeName: process.env.YTDLP_JS_RUNTIME_NAME || 'deno',
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE || '',
  ytdlpImpersonateClient: process.env.YTDLP_IMPERSONATE_CLIENT || '',
  douyinBrowserFallback: process.env.DOUYIN_BROWSER_FALLBACK === '1',
  // Mặc định của yt-dlp rơi vào android_vr, GVS URL của client này bị 403 giữa
  // chừng. web_embedded tải được cả video ngắn lẫn video dài 40+ phút, trong khi
  // mweb chỉ được video ngắn nên xếp sau.
  youtubePlayerClient: process.env.YOUTUBE_PLAYER_CLIENT || 'web_embedded,mweb',
  // Thử lần lượt từng client khi client trước bị 403 hoặc không có format nào.
  // Không client nào đúng mãi: YouTube siết từng client theo thời gian, và một
  // client tải được video này vẫn có thể chết với video khác.
  // Bỏ 'web' và 'tv': 'web' chỉ trả storyboard (SABR-only) với video dài,
  // 'tv' trả "The page needs to be reloaded".
  youtubeClientChain: process.env.YOUTUBE_CLIENT_CHAIN || 'web_embedded,mweb,web_safari,android',
  // Giữ để .env cũ không im lặng mất tác dụng; được nối vào cuối chuỗi trên.
  youtubeFallbackPlayerClient: process.env.YOUTUBE_FALLBACK_PLAYER_CLIENT || '',
  youtubePoToken: process.env.YOUTUBE_PO_TOKEN || '',
  youtubePotBaseUrl: process.env.YOUTUBE_POT_BASE_URL || '',
  allowedOrigins: ['https://heymedia.online', 'https://dl.heymedia.online']
}

module.exports = config
