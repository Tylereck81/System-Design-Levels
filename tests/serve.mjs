// Static file server for the tests: node tests/serve.mjs <port>.
// It closes each file when the browser drops a request (a test navigates or ends mid-load), so a long run
// never runs out of open files, and a dropped request never stops the server.
import { createServer } from 'node:http';
import { createReadStream, stat } from 'node:fs';
import { pipeline } from 'node:stream';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve('.');
const port = Number(process.argv[2]) || 4199;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  stat(file, (err, st) => {
    if (res.destroyed) return; // the browser dropped the request while the file was looked up
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    try {
      pipeline(createReadStream(file), res, () => {}); // destroys the file stream if the response closes early
    } catch { res.destroy(); }
  });
}).listen(port);
