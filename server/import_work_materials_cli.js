import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pkg from 'pg';
import { parse } from 'csv-parse/sync';
const { Pool } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false }, max: 20 });

const args = process.argv.slice(2);
const fileArg = args.find(a => !a.startsWith('--'));
const truncate = args.includes('--truncate');
if (!fileArg) {
  console.error('Usage: node server/import_work_materials_cli.js <file.csv> [--truncate]');
  process.exit(1);
}
const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

(async () => {
  const client = await pool.connect();
  try {
    if (truncate) {
      await client.query('truncate table work_materials restart identity cascade');
      console.log('Table work_materials truncated');
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const records = parse(content, { delimiter: ';', columns: true, skip_empty_lines: true, trim: true });
    let inserted=0, updated=0, skipped=0, createdMaterials=0, remappedWorks=0;
    // Кэш существующих id для ускорения
    const workSet = new Set((await client.query('select id from works_ref')).rows.map(r=>r.id));
    const matSet = new Set((await client.query('select id from materials')).rows.map(r=>r.id));
    const normalizeKey = (k) => k.replace(/\uFEFF/g,'').toLowerCase().replace(/[^a-z0-9_]/g,'');
    for (const r of records) {
      // Поиск ключей с более гибкой нормализацией (убираем точки, пробелы и пр.)
      const wkKey = Object.keys(r).find(k => normalizeKey(k) === 'work_id');
      const mtKey = Object.keys(r).find(k => normalizeKey(k) === 'material_id');
      let work_id = wkKey ? String(r[wkKey]).trim() : '';
      let material_id = mtKey ? String(r[mtKey]).trim() : '';
      if (!work_id && !material_id) { skipped++; continue; }
      if (!material_id) { skipped++; continue; }
      if (!work_id) { skipped++; continue; }
      // Пробуем удалить префикс w. если такого work нет
      if (work_id && !workSet.has(work_id) && /^w\./i.test(work_id)) {
        const alt = work_id.replace(/^w\./i,'');
        if (workSet.has(alt)) { work_id = alt; remappedWorks++; }
      }
      if (!workSet.has(work_id)) { // нет такой работы вообще
        skipped++; continue; // не автосоздаём работы
      }
      if (!matSet.has(material_id)) {
        // создаём заглушку материала
        try {
          await client.query('insert into materials(id,name) values($1,$1) on conflict do nothing', [material_id]);
          matSet.add(material_id); createdMaterials++;
        } catch {}
      }
      const cpuRaw = r.consumption_per_work_unit || r.CONSUMPTION_PER_WORK_UNIT || r.cpu || '';
      const wcRaw = r.waste_coeff || r.WASTE_COEFF || r.wc || '';
      const cpu = cpuRaw===''? null : Number(String(cpuRaw).replace(/,/g,'.'));
      const wc = wcRaw===''? 1 : Number(String(wcRaw).replace(/,/g,'.'));
      try {
        const resUp = await client.query(`insert into work_materials(work_id, material_id, consumption_per_work_unit, waste_coeff)
          values($1,$2,$3,$4)
          on conflict (work_id, material_id) do update set consumption_per_work_unit=excluded.consumption_per_work_unit, waste_coeff=excluded.waste_coeff, updated_at=now() returning (xmax=0) as inserted`,
          [work_id, material_id, cpu, wc]);
        if (resUp.rows[0] && resUp.rows[0].inserted) inserted++; else updated++;
      } catch (e) {
        skipped++;
      }
    }
    console.log(JSON.stringify({ ok:true, file: path.basename(filePath), total: records.length, inserted, updated, skipped, createdMaterials, remappedWorks }, null, 2));
  } catch (e) {
    console.error('Import error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
