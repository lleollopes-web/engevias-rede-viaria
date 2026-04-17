const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const KMZ_FILE = path.join(__dirname, 'rede_viaria.kmz');

function getAttr(body, attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = body.match(new RegExp('<td>' + escaped + '<\\/td>\\s*<td>([^<]+)<\\/td>'));
  return m ? m[1].trim() : '';
}

function processKMZ(kmzPath) {
  const tmpDir = kmzPath + '_ext';
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    execSync('unzip -o "' + kmzPath + '" -d "' + tmpDir + '"');
    const kmlFile = fs.readdirSync(tmpDir).find(f => f.endsWith('.kml'));
    if (!kmlFile) throw new Error('KML não encontrado');
    const content = fs.readFileSync(path.join(tmpDir, kmlFile), 'utf-8');
    const features = [];
    const re = /<Placemark id="(ID_\d+)">([\s\S]*?)<\/Placemark>/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const pid = m[1];
      const body = m[2];

      // Usar campo Name da tabela HTML — fonte definitivamente correta
      const name = getAttr(body, 'Name') || pid;

      const coordM = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
      if (!coordM) continue;
      const coords = [];
      coordM[1].trim().split(/\s+/).forEach(pt => {
        const p = pt.split(',');
        if (p.length >= 2) {
          const lon = parseFloat(p[0]), lat = parseFloat(p[1]);
          if (!isNaN(lon) && !isNaN(lat)) coords.push([lon, lat]);
        }
      });
      if (coords.length < 2) continue;
      const step = Math.max(1, Math.floor(coords.length / 450));
      const simplified = coords.filter((_, i) => i % step === 0);
      if (simplified[simplified.length - 1] !== coords[coords.length - 1])
        simplified.push(coords[coords.length - 1]);

      features.push({
        type: 'Feature',
        properties: {
          id: pid,
          name: name,
          rodovia:    getAttr(body, 'RODOVIA'),
          extensao:   getAttr(body, 'EXTENSÃO'),
          desc_ini:   getAttr(body, 'DESC_INICI'),
          desc_fim:   getAttr(body, 'DESC_FIM'),
          km_ini:     getAttr(body, 'KM_INI'),
          km_fim:     getAttr(body, 'KM_FINAL'),
          situacao:   getAttr(body, 'SITUAÇÃO'),
          tipo_pav:   getAttr(body, 'TIPO_PAV'),
          jurisdicao: getAttr(body, 'JURISDIÇ'),
        },
        geometry: { type: 'LineString', coordinates: simplified }
      });
    }
    return { type: 'FeatureCollection', features };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) {}
  }
}

console.log('Processando KMZ...');
const geojson = processKMZ(KMZ_FILE);
console.log(geojson.features.length + ' segmentos | ex: ' + geojson.features[0].properties.name);

const jsonBuf = Buffer.from(JSON.stringify(geojson), 'utf-8');
const gzipBuf = zlib.gzipSync(jsonBuf);
console.log('Cache: ' + (jsonBuf.length/1024/1024).toFixed(1) + 'MB -> gzip: ' + (gzipBuf.length/1024/1024).toFixed(1) + 'MB');

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
