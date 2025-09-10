import fs from 'fs';

const url = process.env.URL || 'http://127.0.0.1:4000/api/admin/import';
const filePath = process.env.FILE || process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/http_import.mjs <path-to-csv>');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

try {
  const fd = new FormData();
  const buff = await fs.promises.readFile(filePath);
  const blob = new Blob([buff], { type: 'text/csv' });
  fd.append('file', blob, filePath.split(/[/\\]/).pop());
  const r = await fetch(url, { method: 'POST', body: fd });
  const text = await r.text();
  console.log('HTTP', r.status);
  console.log(text);
  if (!r.ok) process.exit(1);
} catch (e) {
  console.error('Import failed:', e.message);
  process.exit(1);
}
