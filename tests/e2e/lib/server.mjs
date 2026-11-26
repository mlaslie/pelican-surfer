import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Starts an ephemeral static HTTP server bound to 127.0.0.1:0 serving rootDir.
 * Enforces strict path containment, ES module MIME types, and no-store caching.
 */
export async function startStaticServer(rootDir = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(rootDir);
  const sockets = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      const rawUrl = req.url || '/';
      let pathname;
      try {
        const parsed = new URL(rawUrl, 'http://127.0.0.1');
        pathname = decodeURIComponent(parsed.pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }

      if (pathname.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }

      if (pathname === '/') {
        pathname = '/index.html';
      }

      const relPath = pathname.replace(/^\/+/, '');
      const filePath = path.resolve(resolvedRoot, relPath);

      if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = await fs.readFile(filePath);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      });

      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(data);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Internal Server Error: ${err?.message || 'unknown'}`);
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral HTTP server port');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function close() {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore socket destroy error
      }
    }
    sockets.clear();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return {
    server,
    rootDir: resolvedRoot,
    port: addr.port,
    baseUrl,
    close,
  };
}
