import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();
const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized:false }, max:20 });

const file = process.argv[2];
if (!file) { console.error('Usage: node server/analyze_work_materials.js <csvFile>'); process.exit(1);} 
const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) { console.error('File not found', filePath); process.exit(1); }

(async () => {
  try {
    const csv = fs.readFileSync(filePath,'utf8');
    const records = parse(csv,{ delimiter:';', columns:true, skip_empty_lines:true, trim:true });
    const workIds = new Set(records.map(r => (r.work_id||'').trim()).filter(Boolean));
    const matIds = new Set(records.map(r => (r.material_id||'').trim()).filter(Boolean));
    const client = await pool.connect();
    try {
      const workRows = (await client.query('select id from works_ref')).rows.map(r=>r.id);
      const matRows = (await client.query('select id from materials')).rows.map(r=>r.id);
      const workSet = new Set(workRows);
      const matSet = new Set(matRows);
      const missingWorks = []; const missingMats = [];
      for (const w of workIds) if (!workSet.has(w)) missingWorks.push(w);
      for (const m of matIds) if (!matSet.has(m)) missingMats.push(m);
      const withPrefixCandidate = missingWorks.filter(w => /^w\./i.test(w));
      const strippedMissing = withPrefixCandidate.map(w => w.replace(/^w\./i,''));
      const strippedFound = strippedMissing.filter(id => workSet.has(id));
      const suggestion = strippedFound.length ? 'Detected that removing "w." prefix would match '+strippedFound.length+' work ids' : null;
      console.log(JSON.stringify({
        csvRecords: records.length,
        distinctWorks: workIds.size,
        distinctMaterials: matIds.size,
        existingWorks: workRows.length,
        existingMaterials: matRows.length,
        missingWorks: missingWorks.length,
        missingMaterials: missingMats.length,
        sampleMissingWorks: missingWorks.slice(0,10),
        sampleMissingMaterials: missingMats.slice(0,10),
        prefixSuggestion: suggestion
      }, null, 2));
    } finally { client.release(); }
  } catch (e) { console.error('Analyze error:', e.message); process.exitCode=1; }
  finally { await pool.end(); }
})();
