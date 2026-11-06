const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { config, createApp } = require('../src/app')
const { createAccessVerifier } = require('../src/middleware/cfAccess')
const { createToolsConfigStore, validateTools } = require('../src/services/toolsConfig')

const TEAM = 'heymedia.cloudflareaccess.com'
const AUD = 'test-aud-123'

// Cặp khoá RSA giả lập khoá của Cloudflare Access.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const fakeFetch = async url => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`)
  return { ok: true, json: async () => ({ keys: [jwk] }) }
}

function sign(claims, { kid = 'k1', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, iat: now, nbf: now, exp: now + 3600, email: 'sangphuoc.it@gmail.com', ...claims })).toString('base64url')
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')
  return `${header}.${payload}.${sig}`
}

function tmpDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heytools-'))
  fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>Hey Tools</title><script src="/tools/assets/app.js"></script>')
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)')
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'probe.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  return dir
}

async function startServer(overrides) {
  const dir = tmpDist()
  Object.assign(config, {
    toolsDistDir: path.join(dir, 'dist'),
    toolsConfigFile: path.join(dir, 'data', 'tools-config.json'),
    cfAccessTeamDomain: '',
    cfAccessAud: '',
    adminEmails: []
  }, overrides)
  const verifier = config.cfAccessTeamDomain ? createAccessVerifier({ teamDomain: TEAM, audience: AUD, fetchImpl: fakeFetch }) : undefined
  const app = createApp({ heyTools: { verifier } })
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const req = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init, headers: { Accept: 'text/html', ...(init.headers || {}) } })
  return { dir, server, req, close: () => new Promise(r => server.close(r)) }
}

const adminEnv = { cfAccessTeamDomain: TEAM, cfAccessAud: AUD, adminEmails: ['sangphuoc.it@gmail.com'] }

test('routing: /tools tách biệt với downloader', async t => {
  const s = await startServer()
  t.after(s.close)

  let res = await s.req('/tools')
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), '/tools/')

  res = await s.req('/tools?x=1')
  assert.equal(res.headers.get('location'), '/tools/?x=1')

  for (const p of ['/tools/', '/tools/video-checker', '/tools/admin']) {
    res = await s.req(p)
    assert.equal(res.status, 200, p)
    assert.match(await res.text(), /<title>Hey Tools<\/title>/, p)
    assert.equal(res.headers.get('cache-control'), 'no-cache', p)
  }

  res = await s.req('/tools/assets/app.js')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('cache-control'), /immutable/)

  res = await s.req('/tools/assets/khong-co.js')
  assert.equal(res.status, 404, 'asset thiếu phải 404, không trả HTML')

  res = await s.req('/tools/assets/probe.wasm')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/wasm')

  // Downloader giữ nguyên.
  for (const p of ['/', '/trang-bat-ky']) {
    res = await s.req(p)
    assert.equal(res.status, 200, p)
    assert.match(await res.text(), /Hey Media Downloader/, p)
  }
  res = await s.req('/health', { headers: { Accept: 'application/json' } })
  assert.equal((await res.json()).ok, true)
  res = await s.req('/api/download/khong-co/status', { headers: { Accept: 'application/json' } })
  assert.equal(res.status, 404)
})

test('quản trị đóng khi thiếu cấu hình', async t => {
  const s = await startServer()
  t.after(s.close)
  const res = await s.req('/api/admin/tools-config', { headers: { 'Cf-Access-Jwt-Assertion': sign({}) } })
  assert.equal(res.status, 503)
})

test('phân quyền và lưu cấu hình', async t => {
  const s = await startServer(adminEnv)
  t.after(s.close)
  const json = { Accept: 'application/json', 'Content-Type': 'application/json' }
  const put = (body, token) => s.req('/api/admin/tools-config', { method: 'PUT', headers: { ...json, ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}) }, body: JSON.stringify(body) })

  let res = await s.req('/api/tools-config', { headers: json })
  assert.deepEqual(await res.json(), { enabled: [] }, 'chưa có file = tắt hết')

  assert.equal((await put({ tools: { 'video-checker': true } })).status, 401, 'không token')
  // Header email tự đặt (giả mạo khi gọi thẳng qua LAN) không có tác dụng.
  res = await s.req('/api/admin/tools-config', { method: 'PUT', headers: { ...json, 'Cf-Access-Authenticated-User-Email': 'sangphuoc.it@gmail.com' }, body: '{"tools":{}}' })
  assert.equal(res.status, 401)

  assert.equal((await put({ tools: {} }, sign({ email: 'nguoi-khac@gmail.com' }))).status, 403, 'không phải admin')
  assert.equal((await put({ tools: {} }, sign({ aud: ['aud-khac'] }))).status, 401, 'sai aud')
  assert.equal((await put({ tools: {} }, sign({ iss: 'https://khac.cloudflareaccess.com' }))).status, 401, 'sai iss')
  assert.equal((await put({ tools: {} }, sign({ exp: Math.floor(Date.now() / 1000) - 3600 }))).status, 401, 'hết hạn')
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  assert.equal((await put({ tools: {} }, sign({}, { key: other }))).status, 401, 'ký bằng khoá lạ')
  assert.equal((await put({ tools: {} }, sign({}, { kid: 'k-la' }))).status, 401, 'kid lạ')
  const good = sign({ email: 'SangPhuoc.IT@gmail.com' })
  const tampered = good.split('.'); tampered[1] = Buffer.from(JSON.stringify({ email: 'sangphuoc.it@gmail.com', aud: [AUD], iss: `https://${TEAM}`, exp: 9999999999 })).toString('base64url')
  assert.equal((await put({ tools: {} }, tampered.join('.'))).status, 401, 'sửa payload')

  assert.equal((await put({ tools: { 'Video Checker': true } }, good)).status, 400, 'id sai quy tắc')
  assert.equal((await put({ tools: { 'video-checker': 'yes' } }, good)).status, 400, 'giá trị không phải boolean')
  assert.equal((await put({ tools: [] }, good)).status, 400, 'tools là mảng')

  res = await put({ tools: { 'video-checker': true, 'nen-anh': false } }, good)
  assert.equal(res.status, 200)
  const saved = await res.json()
  assert.equal(saved.viewer, 'sangphuoc.it@gmail.com', 'email so khớp không phân biệt hoa thường')
  assert.equal(saved.updatedBy, 'sangphuoc.it@gmail.com')

  res = await s.req('/api/tools-config', { headers: json })
  assert.deepEqual(await res.json(), { enabled: ['video-checker'] })

  res = await s.req('/api/admin/tools-config', { headers: { ...json, 'Cf-Access-Jwt-Assertion': good } })
  assert.deepEqual((await res.json()).tools, { 'video-checker': true, 'nen-anh': false })

  const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'tools-config.json'), 'utf8'))
  assert.equal(onDisk.tools['video-checker'], true)
  assert.deepEqual(fs.readdirSync(path.join(s.dir, 'data')), ['tools-config.json'], 'không sót file tạm')
})

test('file cấu hình hỏng thì coi như tắt hết', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heytools-cfg-'))
  const file = path.join(dir, 'tools-config.json')
  fs.writeFileSync(file, '{ hỏng')
  const store = createToolsConfigStore(file)
  assert.deepEqual(store.enabledIds(), [])
  fs.writeFileSync(file, JSON.stringify({ tools: { 'video-checker': 'true' } }))
  assert.deepEqual(store.enabledIds(), [], 'giá trị sai kiểu bị bỏ qua')
})

test('ghi đồng thời không làm hỏng file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heytools-cfg-'))
  const store = createToolsConfigStore(path.join(dir, 'tools-config.json'))
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.save({ [`tool-${i}`]: true }, 'a@b.c')))
  const data = store.read()
  assert.equal(Object.keys(data.tools).length, 1)
  assert.equal(validateTools(data.tools), null)
})

test('tải khoá: thử lại khi lỗi và dùng khoá cũ khi làm mới thất bại', async () => {
  let calls = 0
  let mode = 'fail-once'
  let clock = Date.now()
  const flaky = async () => {
    calls++
    if (mode === 'fail-once' && calls === 1) throw new Error('timeout')
    if (mode === 'down') throw new Error('timeout')
    return { ok: true, json: async () => ({ keys: [jwk] }) }
  }
  const v = createAccessVerifier({ teamDomain: TEAM, audience: AUD, fetchImpl: flaky, now: () => clock })
  const token = sign({})
  assert.equal((await v.verify(token)).email, 'sangphuoc.it@gmail.com')
  assert.equal(calls, 2, 'lần đầu lỗi, lần hai thành công')

  mode = 'down'
  clock += 2 * 60 * 60 * 1000 // quá TTL, buộc làm mới
  const later = sign({ iat: Math.floor(clock / 1000), nbf: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600 })
  assert.equal((await v.verify(later)).email, 'sangphuoc.it@gmail.com', 'mạng lỗi nhưng còn khoá cũ')
  assert.ok(calls >= 4, 'đã thử làm mới (2 lần) trước khi dùng khoá cũ')
})
