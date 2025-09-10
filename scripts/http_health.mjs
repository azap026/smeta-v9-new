const url = process.env.URL || 'http://127.0.0.1:4000/api/health';
try {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const t = await r.text();
  console.log('HTTP', r.status);
  console.log(t);
  if (!r.ok) process.exit(1);
} catch (e) {
  console.error('Health check failed:', e.message);
  process.exit(1);
}
