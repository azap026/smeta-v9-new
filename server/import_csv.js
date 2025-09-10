import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false }, max: 20 });

const filePath = path.resolve(process.cwd(), 'BDWM.csv');

(async () => {
  const client = await pool.connect();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const records = parse(raw, { columns: true, delimiter: ';', skip_empty_lines: true, trim: true });
    await client.query('begin');
    // Upsert helpers
    const upsertPhase = async (code, name) => {
      await client.query(
        `insert into work_phases(code, name) values($1,$2)
         on conflict (code) do update set name=excluded.name, updated_at=now()`,
        [code, name]
      );
    };
    const upsertStage = async (code, name, phase_code) => {
      await client.query(
        `insert into work_stages(code, name, phase_code) values($1,$2,$3)
         on conflict (code) do update set name=excluded.name, phase_code=excluded.phase_code, updated_at=now()`,
        [code, name, phase_code]
      );
    };
    const upsertSubstage = async (code, name, stage_code) => {
      if (!code) return; // some rows have empty substage
      await client.query(
        `insert into work_substages(code, name, stage_code) values($1,$2,$3)
         on conflict (code) do update set name=excluded.name, stage_code=excluded.stage_code, updated_at=now()`,
        [code, name, stage_code]
      );
    };
    const upsertItem = async (rec) => {
      const { phase_id, phase_name, stage_id, stage_name, substage_id, substage_name, work_id, work_name, unit, unit_price } = rec;
      await upsertPhase(phase_id, phase_name);
      await upsertStage(stage_id, stage_name, phase_id);
      if (substage_id) await upsertSubstage(substage_id, substage_name, stage_id);
      await client.query(
        `insert into work_items(code, name, unit, unit_price, phase_code, stage_code, substage_code)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict (code) do update set
           name=excluded.name,
           unit=excluded.unit,
           unit_price=excluded.unit_price,
           phase_code=excluded.phase_code,
           stage_code=excluded.stage_code,
           substage_code=excluded.substage_code,
           updated_at=now()`,
        [work_id, work_name, unit, unit_price || null, phase_id, stage_id, substage_id || null]
      );
    };

    for (const rec of records) {
      await upsertItem(rec);
    }

    await client.query('commit');
    console.log(`Imported ${records.length} rows`);
  } catch (e) {
    await client.query('rollback');
    console.error('Import failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
