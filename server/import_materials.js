import fs from 'fs';
import { parse } from 'csv-parse/sync';

// Импорт CSV материалов
// Ожидаемые заголовки: material_id;material_name;image_url;item_url;unit;unit_price;expenditure;weight
// Допускает лишние/отсутствующие колонки (будут игнорированы). Разделитель ';', BOM поддерживается.
export async function importMaterialsCsv(filePath, client) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }
  const csv = fs.readFileSync(filePath, 'utf8');
  const records = parse(csv, { columns: true, delimiter: ';', skip_empty_lines: true, trim: true, bom: true });

  // Предзагрузка существующих id для статистики
  const existing = new Set();
  try {
    const r = await client.query('select id from materials');
    r.rows.forEach(row => existing.add(row.id));
  } catch {}

  let insertedMaterials = 0;
  let updatedMaterials = 0;
  let skippedRows = 0;
  let rowIndex = 0;

  await client.query('begin');
  try {
    for (const row of records) {
      rowIndex++;
      const id = (row.material_id || row.id || '').trim();
      const name = (row.material_name || row.name || '').trim();
      if (!id || !name) { skippedRows++; continue; }
      try {
        const image_url = (row.image_url || '').trim() || null;
        const item_url = (row.item_url || '').trim() || null;
        const unit = (row.unit || '').trim() || null;
        const normalizeNum = (v) => {
          if (v == null || v === '') return null;
            const s = String(v).replace(/\s+/g,'').replace(/,/g,'.');
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        };
        const unit_price = normalizeNum(row.unit_price);
        const expenditure = normalizeNum(row.expenditure || row.consumption);
        const weight = normalizeNum(row.weight);
        const existed = existing.has(id);
        await client.query(
          `insert into materials(id,name,image_url,item_url,unit,unit_price,expenditure,weight)
           values($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do update set name=excluded.name, image_url=excluded.image_url, item_url=excluded.item_url, unit=excluded.unit, unit_price=excluded.unit_price, expenditure=excluded.expenditure, weight=excluded.weight, updated_at=now()`,
          [id,name,image_url,item_url,unit,unit_price,expenditure,weight]
        );
        if (existed) updatedMaterials++; else insertedMaterials++;
      } catch (e) {
        const humanRow = rowIndex + 1; // header offset
        throw new Error(`Материалы: ошибка в строке ${humanRow} (id=${row.material_id || row.id || ''}): ${e.message}`);
      }
    }
    await client.query('commit');
    return { imported: records.length, skippedRows, insertedMaterials, updatedMaterials };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
