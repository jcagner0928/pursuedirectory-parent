const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = path.resolve(__dirname);
const ROOT_DIR_WITH_SEP = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;
const SUPABASE_HOST = 'bvstmtteutzfwqdiovrm.supabase.co';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const [rawPath, rawQuery] = (req.url || '').split('?');

  // 1. Proxy Edge Function calls specifically to the directory endpoint
  if (rawPath === '/functions/v1/pursue-directory') {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Vary': 'Origin',
      });
      res.end('ok');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed.' }));
      return;
    }

    // Filter hop-by-hop headers
    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders['host'];
    delete forwardedHeaders['connection'];
    delete forwardedHeaders['keep-alive'];
    delete forwardedHeaders['transfer-encoding'];

    const proxyReq = https.request({
      hostname: SUPABASE_HOST,
      port: 443,
      path: '/functions/v1/pursue-directory' + (rawQuery ? `?${rawQuery}` : ''),
      method: 'POST',
      headers: {
        ...forwardedHeaders,
        host: SUPABASE_HOST,
      },
    }, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      headers['access-control-allow-origin'] = '*';
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode || 500, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. Serve static files with strict path normalization & directory traversal defense
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request: Invalid URL encoding');
    return;
  }

  // Reject null bytes and directory traversal probes
  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  let safeRelPath = path.normalize(decodedPath);
  if (safeRelPath === '/' || safeRelPath === '\\') safeRelPath = '/index.html';
  const filePath = path.resolve(ROOT_DIR, '.' + safeRelPath);

  // Strict boundary check against ROOT_DIR
  if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR_WITH_SEP)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pursue Youth Directory running at http://127.0.0.1:${PORT}/`);
  console.log(`Local development proxy enabled for Supabase Edge Functions.`);
});
