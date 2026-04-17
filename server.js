const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const KMZ_FILE = path.join(__dirname, 'rede_viaria.kmz');
const DATA_FILE = path.join(__dirname, 'roads_data.json');
const DATA_GZ   = path.join(__dirname, 'roads_data.json.gz');

const { execSync } = require('child_process');

function getAttr(body, attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = body.match(new RegExp(`<td>${escaped}</td>\\s*<td>([^<]+)</td>`));
  return m ? m[1].trim() : '';
}

function processKMZ(kmzPath) {
  const tmpDir = kmzPath + '_extracted';
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    execSync(`unzip -o "${kmzPath}" -d "${tmpDir}"`);
    const kmlFile = fs.readdirSync(tmpDir).find(f => f.endsWith('.kml'));
    if (!kmlFile) throw new Error('KML não encontrado');
    const content = fs.readFileSync(path.join(tmpDir, kmlFile), 'utf-8');
    const features = [];
    const re = /<Placemark id="(ID_\d+)">([\s\S]*?)<\/Placemark>/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const [, pid, body] = m;
      const nameM = body.match(/<name>([\s\S]*?)<\/name>/);
      const name = nameM ? nameM[1].replace(/[\r\n\s]+/g,'').trim() : pid;
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
      features.push({
        type: 'Feature',
        properties: {
          id: pid, name,
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
        geometry: { type: 'LineString', coordinates: coords }
      });
    }
    return { type: 'FeatureCollection', features };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
  }
}

// Comprime e cacheia o GeoJSON em memória na inicialização
let gzipCache = null;
let jsonCache  = null;

function loadData() {
  let geojson;
  if (fs.existsSync(DATA_FILE)) {
    console.log('Carregando roads_data.json...');
    geojson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } else if (fs.existsSync(KMZ_FILE)) {
    console.log('Processando KMZ...');
    geojson = processKMZ(KMZ_FILE);
    fs.writeFileSync(DATA_FILE, JSON.stringify(geojson));
  } else {
    geojson = { type: 'FeatureCollection', features: [] };
  }
  console.log(`${geojson.features.length} segmentos — comprimindo para cache...`);
  jsonCache = Buffer.from(JSON.stringify(geojson), 'utf-8');
  gzipCache = zlib.gzipSync(jsonCache);
  console.log(`Cache: ${(jsonCache.length/1024/1024).toFixed(1)} MB → gzip: ${(gzipCache.length/1024/1024).toFixed(1)} MB`);
}

loadData();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/data') {
    const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    if (acceptGzip) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(gzipCache);
    } else {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(jsonCache);
    }
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
