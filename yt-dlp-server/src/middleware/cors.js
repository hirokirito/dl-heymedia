function createCorsMiddleware(allowedOrigins) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  }
}

module.exports = { createCorsMiddleware }
