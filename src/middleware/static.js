'use strict';
/**
 * src/middleware/static.js
 * Serves static files from /public with MIME type detection.
 */

const fs   = require('fs');
const path = require('path');
const config = require('../config');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

function serveStatic(req, res, pathname) {
  // Default route → login page; directory paths → their index.html
  if (pathname === '/') pathname = '/index.html';
  else if (pathname.endsWith('/')) pathname = pathname + 'index.html';

  const filePath = path.join(config.PUBLIC_DIR, pathname);

  // Security: prevent path traversal
  if (!filePath.startsWith(config.PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try with .html extension
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          return res.end('<h1>404 – Page Not Found</h1>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2);
      });
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

module.exports = { serveStatic };
