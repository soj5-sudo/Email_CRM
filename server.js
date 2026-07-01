// Local server for the Palak Diam campaign tool.
//  - serves the static app (index.html / style.css / app.js)
//  - proxies sends to Brevo (POST /api/send) so the API key + CORS stay local
// Usage: node server.js [port]   →   open http://localhost:8766
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 8766;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.csv': 'text/csv', '.json': 'application/json', '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  // ---- Brevo send proxy ----
  if (req.method === 'POST' && req.url === '/api/send') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 6e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch (e) { return sendJson(res, 400, { message: 'Bad request JSON' }); }
      const apiKey = (payload.apiKey || '').trim();
      if (!apiKey) return sendJson(res, 400, { message: 'Missing Brevo API key' });
      const data = JSON.stringify(payload.email || {});
      const preq = https.request({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          'accept': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      }, (pres) => {
        let out = '';
        pres.on('data', (c) => { out += c; });
        pres.on('end', () => {
          res.writeHead(pres.statusCode || 502, { 'content-type': 'application/json' });
          res.end(out || '{}');
        });
      });
      preq.on('error', (e) => sendJson(res, 502, { message: 'Proxy error: ' + e.message }));
      preq.write(data);
      preq.end();
    });
    return;
  }

  // ---- static files ----
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, d) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, () => console.log(`Campaign server on http://localhost:${PORT}`));
