const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KMZ_FILE = path.join(__dirname, 'rede_viaria.kmz');
const DATA_FILE = path.join(__dirname, 'roads_data.json');

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
    
    // Ler como buffer para preservar \r\n
    const buf = fs.readFileSync(path.join(tmpDir, kmlFile));
    const content = buf.toString('utf-8');

    const features = [];
    const re = /<Placemark id="(ID_\d+)">([\s\S]*?)<\/Placemark>/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const [, pid, body] = m;

      // Extrair <n> tag — pode ter \r\n dentro
      const nameM = body.match(/<n>([\s\S]*?)<\/n>/);
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
      const step = Math.max(1, Math.floor(coords.length / 30));
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

// Carregar dados: prioriza roads_data.json, só reprocessa KMZ se não existir
let geojsonData = null;

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    console.log('Carregando roads_data.json...');
    geojsonData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`${geojsonData.features.length} segmentos carregados.`);
  } else if (fs.existsSync(KMZ_FILE)) {
    console.log('Processando KMZ...');
    geojsonData = processKMZ(KMZ_FILE);
    fs.writeFileSync(DATA_FILE, JSON.stringify(geojsonData));
    console.log(`${geojsonData.features.length} segmentos processados e salvos.`);
  } else {
    console.warn('Nenhum dado encontrado!');
    geojsonData = { type: 'FeatureCollection', features: [] };
  }
}

loadData();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/data') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(geojsonData));
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('Erro'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
