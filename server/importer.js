import fs from 'fs';
import { parse } from 'csv-parse/sync';

export async function importFromCsv(filePath, client) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }
  const csv = fs.readFileSync(filePath, 'utf8');
  const records = parse(csv, { columns: true, delimiter: ';', skip_empty_lines: true, trim: true });

  const phases = new Map();
  const stages = new Map();
  const substages = new Map();

  await client.query('begin');
  try {
    for (const row of records) {
      const phase_id = row.phase_id || null;
      const phase_name = row.phase_name || null;
      const phase_no_raw = row.phase_no || row.phase_num || row.phase_number || row.phase_sort || null;
      const phase_sort = phase_no_raw != null && phase_no_raw !== '' ? Number(String(phase_no_raw).replace(',', '.')) : null;

      const stage_id = row.stage_id || null;
      const stage_name = row.stage_name || null;
      const substage_id = row.substage_id || null;
      const substage_name = row.substage_name || null;
      const work_id = row.work_id;
      const work_name = row.work_name;
      const unit = row.unit || null;
      const unit_price = row.unit_price ? Number(String(row.unit_price).replace(',', '.')) : null;

      if (phase_id && !phases.has(phase_id)) {
        await client.query(
          'insert into phases(id, name, sort_order) values($1,$2,coalesce($3,0)) on conflict (id) do update set name=excluded.name, sort_order=coalesce(excluded.sort_order, phases.sort_order)',
          [phase_id, phase_name, phase_sort]
        );
        phases.set(phase_id, true);
      }
      if (stage_id && !stages.has(stage_id)) {
        await client.query('insert into stages(id, name, phase_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, phase_id=excluded.phase_id', [stage_id, stage_name, phase_id]);
        stages.set(stage_id, true);
      }
      if (substage_id && !substages.has(substage_id)) {
        await client.query('insert into substages(id, name, stage_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, stage_id=excluded.stage_id', [substage_id, substage_name, stage_id]);
        substages.set(substage_id, true);
      }

      await client.query(
        `insert into works_ref(id, name, unit, unit_price, phase_id, stage_id, substage_id)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set name=excluded.name, unit=excluded.unit, unit_price=excluded.unit_price, phase_id=excluded.phase_id, stage_id=excluded.stage_id, substage_id=excluded.substage_id`,
        [work_id, work_name, unit, unit_price, phase_id, stage_id, substage_id]
      );
    }
    await client.query('commit');
    return { imported: records.length };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
