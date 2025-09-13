const http = require('http');
const url = 'http://127.0.0.1:4000/api/estimates/by-code/current/full';
http.get(url, (res) => {
  let s='';
  res.on('data', d => s += d);
  res.on('end', () => {
    try {
      const j = JSON.parse(s);
      const items = (j.estimate && Array.isArray(j.estimate.items)) ? j.estimate.items : [];
      let total = 0, withImg = 0;
      for (const it of items) {
        for (const m of (it.materials||[])) {
          total++;
          if (m.image_url) withImg++;
        }
      }
      console.log(JSON.stringify({ total, withImg }, null, 2));
    } catch (e) {
      console.log('PARSE_ERR', e.message);
      console.log(s.slice(0, 500));
    }
  });
}).on('error', (e) => console.log('ERR', e.message));
