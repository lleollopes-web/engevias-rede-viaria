const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'roads_data.json');

// Carregar e comprimir dados na inicialização
console.log('Carregando dados...');
const jsonBuf = fs.readFileSync(DATA_FILE);
const gzipBuf = zlib.gzipSync(jsonBuf);
console.log('Pronto: ' + (jsonBuf.length/1024/1024).toFixed(1) + 'MB -> gzip: ' + (gzipBuf.length/1024/1024).toFixed(1) + 'MB');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/data') {
    const gz = (req.headers['accept-encoding'] || '').includes('gzip');
    res.writeHead(200, Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
      gz ? { 'Content-Encoding': 'gzip' } : {}
    ));
    res.end(gz ? gzipBuf : jsonBuf);
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('Servidor na porta ' + PORT));
