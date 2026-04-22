const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;

function loadGzip(file) {
  const buf = fs.readFileSync(file);
  const gz = zlib.gzipSync(buf);
  console.log(path.basename(file) + ': ' + (buf.length/1024/1024).toFixed(1) + 'MB -> ' + (gz.length/1024/1024).toFixed(1) + 'MB gzip');
  return { raw: buf, gz };
}

console.log('Carregando dados...');
const roads = loadGzip(path.join(__dirname, 'roads_data.json'));
const lvc   = loadGzip(path.join(__dirname, 'lvc_data.json'));
const iri   = loadGzip(path.join(__dirname, 'iri_data.json'));
console.log('Pronto.');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const gz = (req.headers['accept-encoding'] || '').includes('gzip');

  const routes = { '/data': roads, '/lvc': lvc, '/iri': iri };
  if (req.method === 'GET' && routes[url]) {
    const d = routes[url];
    res.writeHead(200, Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
      gz ? { 'Content-Encoding': 'gzip' } : {}
    ));
    res.end(gz ? d.gz : d.raw);
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('Servidor na porta ' + PORT));
