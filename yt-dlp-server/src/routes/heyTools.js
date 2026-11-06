const express = require('express')
const fs = require('fs')
const path = require('path')
const { createToolsConfigStore } = require('../services/toolsConfig')
const { createRequireAdmin } = require('../middleware/cfAccess')

// Hey Tools: app tĩnh tại /tools + API bật/tắt tool. Mount TRƯỚC route "/" và fallback của downloader
// để /tools/* không bao giờ rơi vào index.html của downloader (và ngược lại).
function mountHeyTools(app, config, { verifier } = {}) {
  const store = createToolsConfigStore(config.toolsConfigFile)
  const distDir = config.toolsDistDir
  const indexFile = path.join(distDir, 'index.html')
  const requireAdmin = createRequireAdmin({
    teamDomain: config.cfAccessTeamDomain,
    audience: config.cfAccessAud,
    adminEmails: config.adminEmails,
    verifier
  })

  // Công khai: chỉ trả danh sách id đang bật, không lộ ai sửa lúc nào.
  app.get('/api/tools-config', (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ enabled: store.enabledIds() })
  })

  // Quản trị: nằm dưới /api/admin để Cloudflare Access chặn riêng theo đường dẫn.
  app.get('/api/admin/tools-config', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store')
    const data = store.read()
    res.json({ tools: data.tools, updatedAt: data.updatedAt, updatedBy: data.updatedBy, viewer: req.adminEmail })
  })

  app.put('/api/admin/tools-config', requireAdmin, (req, res) => {
    const tools = req.body && req.body.tools
    store.save(tools, req.adminEmail)
      .then(data => {
        console.log(`[tools-config] ${req.adminEmail} lưu: ${Object.keys(data.tools).filter(id => data.tools[id]).join(', ') || '(tắt hết)'}`)
        res.set('Cache-Control', 'no-store')
        res.json({ tools: data.tools, updatedAt: data.updatedAt, updatedBy: data.updatedBy, viewer: req.adminEmail })
      })
      .catch(err => {
        if (err.statusCode === 400) return res.status(400).json({ error: err.message })
        console.error('[tools-config] ghi file lỗi:', err.message)
        res.status(500).json({ error: 'Server không ghi được file cấu hình' })
      })
  })
  console.log('[routes] GET /api/tools-config, GET|PUT /api/admin/tools-config')

  // /tools → /tools/ để đường dẫn tương đối của Vite đúng.
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/tools' && !req.originalUrl.split('?')[0].endsWith('/')) {
      const query = req.originalUrl.slice(req.originalUrl.split('?')[0].length)
      return res.redirect(302, `/tools/${query}`)
    }
    next()
  })

  // Asset có hash trong tên → cache lâu; index.html luôn hỏi lại để nhận bản mới ngay sau deploy.
  app.use('/tools', express.static(distDir, {
    index: false,
    fallthrough: true,
    setHeaders(res, filePath) {
      if (filePath.startsWith(path.join(distDir, 'assets') + path.sep)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  }))

  // Fallback SPA, chỉ trong /tools. Asset thiếu thì 404 thật, không trả HTML thay.
  app.get(/^\/tools(\/.*)?$/, (req, res) => {
    if (req.path.startsWith('/tools/assets/')) return res.status(404).type('text').send('Not found')
    if (!fs.existsSync(indexFile)) return res.status(503).type('text').send('Hey Tools chưa được build (thiếu tools-web/dist).')
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexFile)
  })
  console.log(`[routes] Hey Tools tại /tools (dist: ${distDir}, ${fs.existsSync(indexFile) ? 'found' : 'missing'})`)

  return { store }
}

module.exports = { mountHeyTools }
