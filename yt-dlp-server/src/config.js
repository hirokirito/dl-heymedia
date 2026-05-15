const path = require('path')

const rootDir = path.resolve(__dirname, '..')

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3001),
  publicDir: path.join(rootDir, 'public'),
  downloadDir: process.env.DOWNLOAD_DIR || '/tmp/yt-dlp-downloads',
  maxActiveJobs: Number(process.env.MAX_ACTIVE_JOBS || 3),
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 10 * 60 * 1000),
  jobTtlMs: Number(process.env.JOB_TTL_MS || 60 * 60 * 1000),
  ytdlpBin: process.env.YTDLP_BIN || '/usr/bin/yt-dlp',
  ffmpegBin: process.env.FFMPEG_BIN || '/usr/bin/ffmpeg',
  youtubePlayerClient: process.env.YOUTUBE_PLAYER_CLIENT || '',
  youtubePoToken: process.env.YOUTUBE_PO_TOKEN || '',
  allowedOrigins: ['https://heymedia.online', 'https://dl.heymedia.online']
}

module.exports = config
