const ALLOWED_HOSTS = [
  'tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com',
  'facebook.com', 'fb.watch', 'www.facebook.com',
  'douyin.com', 'www.douyin.com',
  'instagram.com', 'www.instagram.com'
]

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com']
const DOUYIN_HOSTS = ['douyin.com', 'www.douyin.com', 'v.douyin.com']

function matchesHost(hostname, allowedHost) {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
}

function isAllowedMediaUrl(url) {
  try {
    const { hostname } = new URL(url)
    return ALLOWED_HOSTS.some(host => matchesHost(hostname, host))
  } catch {
    return false
  }
}

function isYouTubeUrl(url) {
  try {
    const { hostname } = new URL(url)
    return YOUTUBE_HOSTS.some(host => matchesHost(hostname, host))
  } catch {
    return false
  }
}

function isDouyinUrl(url) {
  try {
    const { hostname } = new URL(url)
    return DOUYIN_HOSTS.some(host => matchesHost(hostname, host))
  } catch {
    return false
  }
}

module.exports = {
  isAllowedMediaUrl,
  isDouyinUrl,
  isYouTubeUrl
}
