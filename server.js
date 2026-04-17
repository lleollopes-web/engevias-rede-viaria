const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const KMZ_FILE  = path.join(__dirname, 'rede_viaria.kmz');
const DATA_FILE = path.join(__dirname, 'roads_data.json');

function getAttr(body, attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = body.match(new RegExp(`<td>${escaped}</td>\\s*<td>([^<]+)</td>`));
  return m ? m[1].trim() : '';
}

function processKMZ(kmzPath) {
  const tmpDir = kmzPath + '_ext';
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
      // Tag é <name> — confirmado byte a byte: 0x6e 0x61 0x6d 0x65
      const nameM = body.match(/<name>([\s\S]*?)<\/name>/);
      const name = nameM ? nameM[1].replace(/[\r\n\s]+/g, '').trim() : pid;
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
      if (simplified[simplified.length-1] !== coords[coords.length-1])
        simplified.push(coords[coords.length-1]);
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
        geometry: { type: 'LineString', coordinates: simplified }
      });
    }
    return { type: 'FeatureCollection', features };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
  }
}

// Inicialização: usa roads_data.json se existir, senão processa KMZ
let gzipCache = null;
let jsonCache  = null;

function loadData() {
  let geojson;
  if (fs.existsSync(DATA_FILE)) {
    console.log('Carregando roads_data.json...');
    geojson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    // Verificar se o name está correto (não começa com "ID_")
    const sample = geojson.features[0];
    if (sample && sample.properties.name === sample.properties.id) {
      console.log('roads_data.json com names incorretos — reprocessando KMZ...');
      geojson = processKMZ(KMZ_FILE);
      fs.writeFileSync(DATA_FILE, JSON.stringify(geojson));
    }
  } else if (fs.existsSync(KMZ_FILE)) {
    console.log('Processando KMZ...');
    geojson = processKMZ(KMZ_FILE);
    fs.writeFileSync(DATA_FILE, JSON.stringify(geojson));
  } else {
    geojson = { type: 'FeatureCollection', features: [] };
  }
  console.log(`${geojson.features.length} segmentos | name[0]: ${geojson.features[0]?.properties?.name}`);
  jsonCache = Buffer.from(JSON.stringify(geojson), 'utf-8');
  gzipCache = zlib.gzipSync(jsonCache);
  console.log(`Cache: ${(jsonCache.length/1024/1024).toFixed(1)}MB → gzip: ${(gzipCache.length/1024/1024).toFixed(1)}MB`);
}

loadData();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/data') {
    const gz = (req.headers['accept-encoding'] || '').includes('gzip');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
      'Cache-Control': 'no-cache'
    });
    res.end(gz ? gzipCache : jsonCache);
    return;
  }
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
