import fs from 'fs';
import { parse } from 'csv-parse/sync';

export async function importFromCsv(filePath, client) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }
  const csv = fs.readFileSync(filePath, 'utf8');
  const records = parse(csv, { columns: true, delimiter: ';', skip_empty_lines: true, trim: true, bom: true });

  // Prefetch existing IDs for stats (cheap if tables small; optimize later if needed)
  const phasesExisting = new Set();
  const stagesExisting = new Set();
  const substagesExisting = new Set();
  const worksExisting = new Set();

  // Stats
  let insertedPhases = 0, updatedPhases = 0;
  let insertedStages = 0, updatedStages = 0;
  let insertedSubstages = 0, updatedSubstages = 0;
  let insertedWorks = 0, updatedWorks = 0;

  // For duplicate suppression of multiple rows referencing same new entity in current file
  const phasesSeenInFile = new Set();
  const stagesSeenInFile = new Set();
  const substagesSeenInFile = new Set();

  // Load existing sets
  // (no transaction needed yet)
  try {
    const [phR, stR, ssR, wR] = await Promise.all([
      client.query('select id from phases'),
      client.query('select id from stages'),
      client.query('select id from substages'),
      client.query('select id from works_ref'),
    ]);
    phR.rows.forEach(r=>phasesExisting.add(r.id));
    stR.rows.forEach(r=>stagesExisting.add(r.id));
    ssR.rows.forEach(r=>substagesExisting.add(r.id));
    wR.rows.forEach(r=>worksExisting.add(r.id));
  } catch {
    // Non-fatal; continue without stats if fails
  }

  await client.query('begin');
  try {
  let rowIndex = 0; // 0-based over data rows (excluding header)
  let skippedRows = 0;
  for (const row of records) {
      rowIndex++;
      // Базовая валидация обязательных полей
      if (!row.work_id || !row.work_name) {
        skippedRows++;
        continue; // пропускаем строку без ключевых полей
      }
      try {
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

      if (phase_id && !phasesSeenInFile.has(phase_id)) {
        const existed = phasesExisting.has(phase_id);
        await client.query(
          'insert into phases(id, name, sort_order) values($1,$2,coalesce($3,0)) on conflict (id) do update set name=excluded.name, sort_order=coalesce(excluded.sort_order, phases.sort_order)',
          [phase_id, phase_name, phase_sort]
        );
        phasesSeenInFile.add(phase_id);
        if (existed) updatedPhases++; else insertedPhases++;
      }
      if (stage_id && !stagesSeenInFile.has(stage_id)) {
        const existed = stagesExisting.has(stage_id);
        await client.query('insert into stages(id, name, phase_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, phase_id=excluded.phase_id', [stage_id, stage_name, phase_id]);
        stagesSeenInFile.add(stage_id);
        if (existed) updatedStages++; else insertedStages++;
      }
      if (substage_id && !substagesSeenInFile.has(substage_id)) {
        const existed = substagesExisting.has(substage_id);
        await client.query('insert into substages(id, name, stage_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, stage_id=excluded.stage_id', [substage_id, substage_name, stage_id]);
        substagesSeenInFile.add(substage_id);
        if (existed) updatedSubstages++; else insertedSubstages++;
      }

      const existedWork = worksExisting.has(work_id);
      await client.query(
        `insert into works_ref(id, name, unit, unit_price, phase_id, stage_id, substage_id)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set name=excluded.name, unit=excluded.unit, unit_price=excluded.unit_price, phase_id=excluded.phase_id, stage_id=excluded.stage_id, substage_id=excluded.substage_id`,
        [work_id, work_name, unit, unit_price, phase_id, stage_id, substage_id]
      );
      if (existedWork) updatedWorks++; else insertedWorks++;
      } catch (e) {
        // Добавляем контекст строки (номер + work_id) и пробрасываем
        const humanRow = rowIndex + 1; // + header line -> реальный номер в файле
        throw new Error(`Импорт: ошибка в строке ${humanRow} (work_id=${row.work_id || ''}): ${e.message}`);
      }
    }
    await client.query('commit');
    return { imported: records.length, skippedRows, insertedPhases, updatedPhases, insertedStages, updatedStages, insertedSubstages, updatedSubstages, insertedWorks, updatedWorks };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
