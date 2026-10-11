'use strict';

const http = require('node:http');
const mysql = require('mysql2/promise');

const port = Number(process.env.PORT || 3000);
const dbConfig = {
  host: process.env.DB_HOST || 'banco',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 3000,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 10
};

if (!dbConfig.user || !dbConfig.password || !dbConfig.database) {
  console.error('Configuração obrigatória ausente: DB_USER, DB_PASSWORD e DB_NAME.');
  process.exit(1);
}

const pool = mysql.createPool(dbConfig);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.url === '/healthz' && req.method === 'GET') {
    try {
      await pool.query('SELECT 1');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
    } catch {
      res.writeHead(503);
      res.end(JSON.stringify({ status: 'unavailable' }));
    }
    return;
  }

  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ name: 'hardening-container', status: 'running' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Aplicação disponível na porta ${port}`);
});

function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
