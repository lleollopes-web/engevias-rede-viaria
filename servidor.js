const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;

// Carregar arquivos sem comprimir — comprimir sob demanda e cachear
function loadFile(file) {
  const raw = fs.readFileSync(file);
  console.log(path.basename(file) + ': ' + (raw.length/1024/1024).toFixed(1) + 'MB carregado');
  return { raw, gz: null };
}

console.log('Carregando dados...');
const roads = loadFile(path.join(__dirname, 'roads_data.json'));
const lvc   = loadFile(path.join(__dirname, 'lvc_data.json'));
const iri   = loadFile(path.join(__dirname, 'iri_data.json'));
console.log('Pronto. Servidor iniciando...');

// Comprimir em background após subir
setTimeout(() => {
  console.log('Comprimindo dados em background...');
  roads.gz = zlib.gzipSync(roads.raw);
  lvc.gz   = zlib.gzipSync(lvc.raw);
  iri.gz   = zlib.gzipSync(iri.raw);
  console.log('Compressão concluída.');
}, 100);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const gz = (req.headers['accept-encoding'] || '').includes('gzip');

  const routes = { '/data': roads, '/lvc': lvc, '/iri': iri };
  if (req.method === 'GET' && routes[url]) {
    const d = routes[url];
    if (gz && d.gz) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' });
      res.end(d.gz);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(d.raw);
    }
    return;
  }

  // Servir arquivos estáticos da pasta /imagem
  if (url.startsWith('/imagem/')) {
    const ext = path.extname(url).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const mime = mimeTypes[ext] || 'application/octet-stream';
    const filePath = path.join(__dirname, url);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('Servidor na porta ' + PORT));
