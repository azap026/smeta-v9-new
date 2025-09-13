const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s='';
      res.on('data', d => s += d);
      res.on('end', () => {
        try { resolve(JSON.parse(s)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let s='';
      res.on('data', d => s += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(s) }); } catch (e) { resolve({ status: res.statusCode, text: s }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const bundles = await getJson('http://127.0.0.1:4000/api/work-materials-bundles');
  const items = (bundles.items || []).slice(0, 5).map(b => ({
    work_code: b.work.id,
    work_name: b.work.name || b.work.id,
    unit: b.work.unit || null,
    quantity: '',
    unit_price: b.work.unit_price == null ? '' : String(b.work.unit_price),
    stage_id: b.work.stage_id || null,
    substage_id: b.work.substage_id || null,
    materials: (b.materials||[]).map(m => ({
      material_code: m.code,
      material_name: m.name || m.code,
      unit: m.unit || null,
      quantity: m.quantity || '',
      unit_price: m.unit_price || ''
    }))
  }));
  const payload = { code: 'current', title: 'Текущая смета', items };
  const r = await postJson('http://127.0.0.1:4000/api/estimates/by-code/current/full', payload);
  console.log('POST status', r.status, r.json || r.text);
})();
