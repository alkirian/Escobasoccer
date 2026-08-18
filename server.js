// Servidor estático simple — Escoba Voladora
// Uso: node server.js  →  http://localhost:5680
const http = require('http');
const fs = require('fs');
const path = require('path');

// El puerto llega por entorno cuando lo lanza el harness; 5680 es el default
// para cuando se corre a mano con `node server.js`.
const PORT = Number(process.env.PORT) || 5680;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // Rutas sin extensión → su .html (ej: /test → /test.html)
  if (!path.extname(urlPath)) urlPath += '.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`🧹 Escoba Voladora → http://localhost:${PORT}`);
  console.log(`   /test   → escena de práctica (sin rivales ni arcos)`);
  console.log(`   ?debug  → overlay de físicas`);
  console.log(`   ?bots   → IA vs IA`);
  console.log(`   ?fast   → partido de 30s`);
});
