const { config, createApp, downloadManager, tools } = require('./app')

const app = createApp()

setInterval(downloadManager.cleanupStaleJobs, 10 * 60 * 1000).unref()

process.on('uncaughtException', err => {
  console.error('uncaughtException:', err)
})

process.on('unhandledRejection', err => {
  console.error('unhandledRejection:', err)
})

app.listen(config.port, config.host, () => {
  console.log(`yt-dlp server running on ${config.host}:${config.port}`)
  if (!tools.ytdlp) console.warn('Warning: yt-dlp not found. Downloads are disabled.')
  if (!tools.ffmpeg) console.warn('Warning: ffmpeg not found. Audio extraction and merged video formats are limited.')
})
