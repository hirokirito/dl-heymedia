const crypto = require('crypto')

// Xác thực JWT mà Cloudflare Access gắn vào request (header Cf-Access-Jwt-Assertion).
// Không dựa vào header email (Cf-Access-Authenticated-User-Email) vì header đó ai gọi thẳng vào
// server qua LAN cũng tự đặt được; chỉ chữ ký RS256 từ khoá công khai của team mới đáng tin.

const CLOCK_SKEW_SECONDS = 60
const CERTS_TTL_MS = 60 * 60 * 1000

function base64urlJson(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

function authError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

function createAccessVerifier({ teamDomain, audience, fetchImpl = fetch, now = () => Date.now() }) {
  const issuer = `https://${teamDomain}`
  const certsUrl = `${issuer}/cdn-cgi/access/certs`
  let cache = { keys: new Map(), fetchedAt: 0 }
  let inflight = null

  async function loadKeys(force = false) {
    if (!force && cache.keys.size && now() - cache.fetchedAt < CERTS_TTL_MS) return cache.keys
    if (!inflight) {
      inflight = (async () => {
        const res = await fetchImpl(certsUrl, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`Không tải được khoá Access (${res.status})`)
        const body = await res.json()
        const keys = new Map()
        for (const jwk of body.keys || []) {
          if (jwk.kid && jwk.kty === 'RSA') keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }))
        }
        cache = { keys, fetchedAt: now() }
        return keys
      })().finally(() => { inflight = null })
    }
    return inflight
  }

  async function verify(token) {
    if (typeof token !== 'string' || token.length > 8192) throw authError(401, 'Thiếu token Cloudflare Access')
    const parts = token.split('.')
    if (parts.length !== 3) throw authError(401, 'Token không đúng định dạng')

    let header, payload
    try {
      header = base64urlJson(parts[0])
      payload = base64urlJson(parts[1])
    } catch {
      throw authError(401, 'Token không đọc được')
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw authError(401, 'Thuật toán token không được chấp nhận')

    let keys = await loadKeys()
    let key = keys.get(header.kid)
    if (!key) {
      // Cloudflare xoay khoá định kỳ: thử tải lại một lần trước khi từ chối.
      keys = await loadKeys(true)
      key = keys.get(header.kid)
    }
    if (!key) throw authError(401, 'Token ký bằng khoá không xác định')

    const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
    const signature = Buffer.from(parts[2], 'base64url')
    if (!crypto.verify('RSA-SHA256', signed, key, signature)) throw authError(401, 'Chữ ký token không hợp lệ')

    const t = Math.floor(now() / 1000)
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!aud.includes(audience)) throw authError(401, 'Token không dành cho ứng dụng này')
    if (payload.iss !== issuer) throw authError(401, 'Token không do team Access này cấp')
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < t) throw authError(401, 'Phiên đăng nhập đã hết hạn, tải lại trang')
    if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > t) throw authError(401, 'Token chưa có hiệu lực')
    if (typeof payload.email !== 'string' || !payload.email) throw authError(401, 'Token không có email')

    return { email: payload.email.toLowerCase(), payload }
  }

  return { verify }
}

// Middleware cho /api/admin/*: thiếu cấu hình thì ĐÓNG (503), không bao giờ mở cửa mặc định.
function createRequireAdmin({ teamDomain, audience, adminEmails, verifier }) {
  const allowed = new Set(adminEmails.map(email => email.trim().toLowerCase()).filter(Boolean))
  const configured = Boolean(teamDomain && audience && allowed.size)
  const accessVerifier = configured ? verifier || createAccessVerifier({ teamDomain, audience }) : null

  return function requireAdmin(req, res, next) {
    if (!configured) {
      return res.status(503).json({ error: 'Quản trị chưa được cấu hình trên server (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_EMAILS).' })
    }
    const token = req.get('cf-access-jwt-assertion')
    if (!token) return res.status(401).json({ error: 'Cần đăng nhập Cloudflare Access (mở trang qua dl.heymedia.online)' })

    accessVerifier.verify(token)
      .then(({ email }) => {
        if (!allowed.has(email)) return res.status(403).json({ error: `${email} không có quyền quản trị` })
        req.adminEmail = email
        next()
      })
      .catch(err => {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
        console.error('[cf-access] lỗi khi xác thực:', err.message)
        res.status(503).json({ error: 'Không kiểm tra được đăng nhập lúc này, thử lại sau' })
      })
  }
}

module.exports = { createAccessVerifier, createRequireAdmin }
