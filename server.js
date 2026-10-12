'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const ai = require('./api/ai');

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/ai') return ai(req, res);
  // Only publish the app, never server source or environment files.
  if ((pathname === '/' || pathname === '/index.html') && ['GET', 'HEAD'].includes(req.method)) {
    try {
      const html = await readFile(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      res.writeHead(500);
      return res.end('Could not load Lexora.');
    }
  }
  res.writeHead(404);
  res.end('Not found');
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Lexora listening on port ${port}`));
}

module.exports = server;
