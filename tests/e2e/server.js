// Tiny static file server for the end-to-end tests (no dependencies).
// The real src/config.js points at the live leaderboard; tests must never
// write to it, so this server always answers with an empty config.
// Tests that need a leaderboard mock it with page.route().
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/src/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end("window.CATNAP_CONFIG = { supabaseUrl: '', supabaseKey: '' };");
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`catnap test server on http://127.0.0.1:${PORT}`));
