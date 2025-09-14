import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { importFromCsv } from './importer.js';
import { importMaterialsCsv } from './import_materials.js';
import { parse } from 'csv-parse/sync';
const { Pool } = pkg;

dotenv.config();

const app = express();
app.use(cors());
// увеличим лимит тела JSON, т.к. снимок сметы может быть большим
app.use(express.json({ limit: '10mb' }));
// Simple root for connectivity check
app.get('/', (req, res) => res.type('text/plain').send('ok'));

// Disable etag/caching for dynamic API responses to avoid 304 with empty body caching
app.set('etag', false);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false }, max: 20 });
const upload = multer({ dest: path.join(os.tmpdir(), 'uploads') });

app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    // Более подробное логирование для диагностики подключения к БД
    console.error('[health] DB error:', e && e.message, e && e.code);
    res.status(500).json({ ok: false, error: e?.message || 'db error' });
  }
});

// BDWM reference endpoints
app.get('/api/phases', async (req, res) => {
  try {
  const { rows } = await pool.query('select * from phases order by sort_order, id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/stages', async (req, res) => {
  try {
    const { phase_id } = req.query;
    const { rows } = await pool.query(
      phase_id ? 'select * from stages where phase_id=$1 order by sort_order, id' : 'select * from stages order by sort_order, id',
      phase_id ? [phase_id] : []
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/substages', async (req, res) => {
  try {
    const { stage_id } = req.query;
    const { rows } = await pool.query(
      stage_id ? 'select * from substages where stage_id=$1 order by sort_order, id' : 'select * from substages order by sort_order, id',
      stage_id ? [stage_id] : []
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/works-ref', async (req, res) => {
  try {
    const { phase_id, stage_id, substage_id } = req.query;
    const cond = [];
    const args = [];
    if (phase_id) { args.push(phase_id); cond.push(`phase_id=$${args.length}`); }
    if (stage_id) { args.push(stage_id); cond.push(`stage_id=$${args.length}`); }
    if (substage_id) { args.push(substage_id); cond.push(`substage_id=$${args.length}`); }
    const where = cond.length ? `where ${cond.join(' and ')}` : '';
    const { rows } = await pool.query(`select * from works_ref ${where} order by id`, args);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Flat rows (groups + items) for UI rendering
app.get('/api/works-rows', async (req, res) => {
  try {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limitRaw = parseInt(req.query.limit) || 70;
  const limit = Math.min(70, Math.max(1, limitRaw));
  const qRaw = (req.query.q || '').toString().trim();
  const q = qRaw.toLowerCase();
    const [phasesR, stagesR, substagesR, worksR] = await Promise.all([
      pool.query('select * from phases order by sort_order, id'),
      pool.query('select * from stages order by sort_order, id'),
      pool.query('select * from substages order by sort_order, id'),
      pool.query('select * from works_ref order by sort_order, id'),
    ]);
    const phases = phasesR.rows;
    const stages = stagesR.rows;
    const substages = substagesR.rows;
    const works = worksR.rows;

    // Сортировка строго по натуральному id (numeric): stage id → substage id → work id
    const cmpById = (a, b) => {
      const av = String((a && a.id != null ? a.id : a) ?? '');
      const bv = String((b && b.id != null ? b.id : b) ?? '');
      return av.localeCompare(bv, 'ru', { numeric: true, sensitivity: 'base' });
    };

  const phaseMap = new Map(phases.map(p => [p.id, p])); // пока не используем, оставлено для будущего режима с фазами
  const stageMap = new Map(stages.map(s => [s.id, s])); // потенциально может пригодиться при расширении
  const subMap = new Map(substages.map(ss => [ss.id, ss]));

  // Группировки
  const byPhaseStages = stages.reduce((m, s) => { (m[s.phase_id] ||= []).push(s); return m; }, {}); // пока не используем в сортировке
    const byStageSubs = substages.reduce((m, ss) => { (m[ss.stage_id] ||= []).push(ss); return m; }, {});
    const byPhaseWorksOnly = works.reduce((m, w) => { if (w.phase_id && !w.stage_id && !w.substage_id) (m[w.phase_id] ||= []).push(w); return m; }, {});
    const byStageWorksOnly = works.reduce((m, w) => { if (w.stage_id && !w.substage_id) (m[w.stage_id] ||= []).push(w); return m; }, {});
    const bySubWorks = works.reduce((m, w) => { if (w.substage_id) (m[w.substage_id] ||= []).push(w); return m; }, {});

    // Плоский режим: полностью игнорируем фазы. Сортируем все стадии натурально.
    const out = [];
    const stagesSorted = [...stages].sort(cmpById);
    for (const st of stagesSorted) {
      out.push({ type: 'group', level: 'stage', code: st.id, title: st.name || st.id, parents: [] });
      for (const w of (byStageWorksOnly[st.id] || []).sort(cmpById)) {
        out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: [st.id] });
      }
      const stSubs = (byStageSubs[st.id] || []).sort(cmpById);
      for (const ss of stSubs) {
        out.push({ type: 'group', level: 'substage', code: ss.id, title: ss.name || ss.id, parents: [st.id] });
        for (const w of (bySubWorks[ss.id] || []).sort(cmpById)) {
          out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: [st.id, ss.id] });
        }
      }
    }
    // Работы, у которых нет stage/substage (фазовые или полностью без привязки)
    const orphan = works.filter(w => !w.stage_id && !w.substage_id);
    if (orphan.length) {
      out.push({ type: 'group', level: 'orphan', code: '_ungrouped', title: 'Прочее', parents: [] });
      for (const w of orphan.sort(cmpById)) {
        out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: ['_ungrouped'] });
      }
    }
    // Пагинация (простое нарезание по итоговому плоскому списку)
    let filtered = out;
    if (q) {
      // матч по item: code|name содержит q
      // матч по group: code|title содержит q
      const matchItem = (row) => {
        if (row.type !== 'item') return false;
        const codeL = (row.code || '').toString().toLowerCase();
        const nameL = (row.name || '').toString().toLowerCase();
        return codeL.includes(q) || nameL.includes(q);
      };
      const matchGroup = (row) => {
        if (row.type !== 'group') return false;
        const codeL = (row.code || '').toString().toLowerCase();
        const titleL = (row.title || '').toString().toLowerCase();
        return codeL.includes(q) || titleL.includes(q);
      };
      const keepGroups = new Set();
      const matchedItems = new Set();
      for (const row of out) {
        if (matchItem(row)) {
          matchedItems.add(row.code);
          (row.parents || []).forEach(p => keepGroups.add(p));
        } else if (matchGroup(row)) {
          keepGroups.add(row.code);
        }
      }
      filtered = out.filter(row => {
        if (row.type === 'group') return keepGroups.has(row.code);
        return matchItem(row);
      });
    }
    const total = filtered.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const items = filtered.slice(start, end);
    const hasMore = end < total;
    // Если клиент явно запросил пагинацию (page/limit) — возвращаем объект
    if (req.query.page || req.query.limit) {
      return res.json({ items, page, limit, total, hasMore, q: qRaw || undefined });
    }
    // Иначе прежнее поведение (весь список)
    res.json(q ? filtered : out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// quick debug endpoint
app.get('/api/debug-counts', async (req, res) => {
  try {
  const q = async (t) => (await pool.query(`select count(*)::int as c from ${t}`)).rows[0].c;
  const [ph, st, ss, wr, mt, wm] = await Promise.all(['phases','stages','substages','works_ref','materials','work_materials'].map(q));
  res.json({ phases: ph, stages: st, substages: ss, works_ref: wr, materials: mt, work_materials: wm });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: clear all data but keep schema
app.post('/api/admin/clear', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // Truncate all data tables, keep schema; restart sequences where applicable
    await client.query('truncate table works, works_groups, works_ref, substages, stages, phases restart identity cascade');
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ===== Materials API =====
// List materials with optional search & pagination
app.get('/api/materials', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limitRaw = parseInt(req.query.limit) || 70;
    const limit = Math.min(100, Math.max(1, limitRaw));
    const qRaw = (req.query.q || '').toString().trim();
    const args = [];
    let where = '';
    if (qRaw) {
      args.push('%' + qRaw.toLowerCase() + '%');
      where = 'where lower(id) like $1 or lower(name) like $1';
    }
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(`select * from materials ${where} order by id limit ${limit} offset ${offset}`, args);
    const total = (await pool.query(`select count(*)::int as c from materials ${where}`, args)).rows[0].c;
    res.json({ items: rows, page, limit, total, hasMore: offset + rows.length < total, q: qRaw || undefined });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Search materials by name or id (sku-like). Returns array of items.
app.get('/api/materials/search', async (req, res) => {
  try {
    const qRaw = ((req.query.q || '') + '').trim();
    const limitRaw = parseInt(req.query.limit) || 20;
    const limit = Math.min(50, Math.max(1, limitRaw));
    if (qRaw.length < 2) return res.json([]);
    const q = '%' + qRaw.toLowerCase() + '%';
    const { rows } = await pool.query(
      `select id, name, unit, unit_price, image_url as image
       from materials
       where lower(name) like $1 or lower(id) like $1
       order by id
       limit ${limit}`,
      [q]
    );
    // Add sku alias (fallback to id)
    const items = rows.map(r => ({ ...r, sku: r.id }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});
// Get single material
app.get('/api/materials/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from materials where id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
// Create/update (upsert) material
app.post('/api/materials', async (req, res) => {
  const { id, name, image_url, item_url, unit, unit_price, expenditure, weight } = req.body || {};
  if (!id || !name) return res.status(400).json({ ok:false, error:'id and name required' });
  try {
    const priceNum = unit_price===''||unit_price==null?null:Number(String(unit_price).replace(/\s+/g,'' ).replace(/,/g,'.'));
    const expNum = expenditure===''||expenditure==null?null:Number(String(expenditure).replace(/\s+/g,'' ).replace(/,/g,'.'));
    const weightNum = weight===''||weight==null?null:Number(String(weight).replace(/\s+/g,'' ).replace(/,/g,'.'));
    await pool.query(`insert into materials(id,name,image_url,item_url,unit,unit_price,expenditure,weight)
      values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (id) do update set name=excluded.name, image_url=excluded.image_url, item_url=excluded.item_url, unit=excluded.unit, unit_price=excluded.unit_price, expenditure=excluded.expenditure, weight=excluded.weight, updated_at=now()`,
      [id,name,image_url||null,item_url||null,unit||null,priceNum,expNum,weightNum]);
    const { rows } = await pool.query('select * from materials where id=$1', [id]);
    res.status(201).json({ ok:true, material: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});
// Patch material
app.patch('/api/materials/:id', async (req, res) => {
  const { id } = req.params;
  const { name, image_url, item_url, unit, unit_price, expenditure, weight, new_id } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    let currentId = id;
    if (new_id && new_id !== id) {
      const dup = await client.query('select 1 from materials where id=$1', [new_id]);
      if (dup.rows.length) { await client.query('rollback'); return res.status(409).json({ ok:false, error:'new_id exists' }); }
      await client.query('update materials set id=$1 where id=$2', [new_id, id]);
      currentId = new_id;
    }
    const sets = [];
    const args = [];
    if (name !== undefined) { args.push(name); sets.push(`name=$${args.length}`); }
    if (image_url !== undefined) { args.push(image_url||null); sets.push(`image_url=$${args.length}`); }
    if (item_url !== undefined) { args.push(item_url||null); sets.push(`item_url=$${args.length}`); }
    if (unit !== undefined) { args.push(unit||null); sets.push(`unit=$${args.length}`); }
    if (unit_price !== undefined) { const v=unit_price===''||unit_price==null?null:Number(String(unit_price).replace(/\s+/g,'' ).replace(/,/g,'.')); args.push(v); sets.push(`unit_price=$${args.length}`); }
    if (expenditure !== undefined) { const v=expenditure===''||expenditure==null?null:Number(String(expenditure).replace(/\s+/g,'' ).replace(/,/g,'.')); args.push(v); sets.push(`expenditure=$${args.length}`); }
    if (weight !== undefined) { const v=weight===''||weight==null?null:Number(String(weight).replace(/\s+/g,'' ).replace(/,/g,'.')); args.push(v); sets.push(`weight=$${args.length}`); }
    if (sets.length) {
      args.push(currentId);
      await client.query(`update materials set ${sets.join(', ')}, updated_at=now() where id=$${args.length}`, args);
    }
    const { rows } = await client.query('select * from materials where id=$1', [currentId]);
    await client.query('commit');
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, material: rows[0] });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok:false, error: e.message });
  } finally { client.release(); }
});
// Delete material
app.delete('/api/materials/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('delete from materials where id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, deleted:true, id: req.params.id });
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// ===================== WORK ↔ MATERIAL normative links =====================
// List materials for a work with normative consumption
app.get('/api/work-materials/:work_id', async (req,res) => {
  try {
    const { rows } = await pool.query(`select wm.work_id, wm.material_id,
      m.name as material_name, m.unit as material_unit, m.unit_price as material_unit_price, m.image_url as material_image_url,
      wm.consumption_per_work_unit, wm.waste_coeff,
      w.name as work_name, w.unit as work_unit, w.unit_price as work_unit_price,
      w.stage_id, w.substage_id, st.name as stage_name, ss.name as substage_name
      from work_materials wm
      left join works_ref w on w.id = wm.work_id
      left join stages st on st.id = w.stage_id
      left join substages ss on ss.id = w.substage_id
      left join materials m on m.id = wm.material_id
      where wm.work_id=$1
      order by wm.material_id`, [req.params.work_id]);
    // метаданные по работе берём из первой строки если есть
    let meta = null;
    if (rows.length) {
      const r0 = rows[0];
      meta = {
        work_id: r0.work_id,
        work_name: r0.work_name,
        work_unit: r0.work_unit,
        work_unit_price: r0.work_unit_price,
        stage_id: r0.stage_id,
        stage_name: r0.stage_name,
        substage_id: r0.substage_id,
        substage_name: r0.substage_name
      };
    } else {
      // fallback: всё равно попробуем вытащить саму работу без материалов
      const wq = await pool.query(`select w.id as work_id, w.name as work_name, w.unit as work_unit, w.unit_price as work_unit_price, w.stage_id, w.substage_id, st.name as stage_name, ss.name as substage_name
        from works_ref w
        left join stages st on st.id = w.stage_id
        left join substages ss on ss.id = w.substage_id
        where w.id=$1`, [req.params.work_id]);
      if (wq.rows.length) {
        const r0 = wq.rows[0];
        meta = { ...r0 };
      }
    }
  // Добавим image_url в каждом материале (material_image_url)
  const items = rows.map(r => ({ ...r }));
  res.json({ ok:true, items, meta });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Upsert link
app.post('/api/work-materials', async (req,res) => {
  const { work_id, material_id, consumption_per_work_unit, waste_coeff } = req.body || {};
  if (!work_id || !material_id) return res.status(400).json({ ok:false, error:'work_id and material_id required' });
  try {
    const cpu = consumption_per_work_unit===''||consumption_per_work_unit==null? null : Number(consumption_per_work_unit);
    const wc = waste_coeff===''||waste_coeff==null?1:Number(waste_coeff);
    await pool.query(`insert into work_materials(work_id, material_id, consumption_per_work_unit, waste_coeff)
      values($1,$2,$3,$4)
      on conflict (work_id, material_id) do update set consumption_per_work_unit=excluded.consumption_per_work_unit, waste_coeff=excluded.waste_coeff, updated_at=now()`,
      [work_id, material_id, cpu, wc]);
    res.status(201).json({ ok:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Delete link
app.delete('/api/work-materials/:work_id/:material_id', async (req,res) => {
  try {
    await pool.query('delete from work_materials where work_id=$1 and material_id=$2', [req.params.work_id, req.params.material_id]);
    res.json({ ok:true, deleted:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Bundles: все работы с их материалами (для массового создания блоков)
app.get('/api/work-materials-bundles', async (req,res) => {
  try {
  const { rows } = await pool.query(`select wm.work_id,
        w.name as work_name, w.unit as work_unit, w.unit_price as work_unit_price, w.sort_order as work_sort_order,
        w.stage_id, w.substage_id, st.name as stage_name, ss.name as substage_name,
    wm.material_id, m.name as material_name, m.unit as material_unit, m.unit_price as material_unit_price, m.image_url as material_image_url,
        wm.consumption_per_work_unit, wm.waste_coeff
      from work_materials wm
      left join works_ref w on w.id = wm.work_id
      left join stages st on st.id = w.stage_id
      left join substages ss on ss.id = w.substage_id
      left join materials m on m.id = wm.material_id
      order by wm.work_id, wm.material_id`);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.work_id)) {
        map.set(r.work_id, { work:{ id:r.work_id, name:r.work_name||r.work_id, unit:r.work_unit||'', unit_price:r.work_unit_price, sort_order: r.work_sort_order, stage_id:r.stage_id, stage_name:r.stage_name, substage_id:r.substage_id, substage_name:r.substage_name }, materials:[] });
      }
      map.get(r.work_id).materials.push({
        code: r.material_id,
        name: r.material_name || r.material_id,
        unit: r.material_unit || '',
        quantity: r.consumption_per_work_unit!=null ? String(r.consumption_per_work_unit) : '',
        unit_price: r.material_unit_price!=null ? String(r.material_unit_price) : '',
        image_url: r.material_image_url || '',
        total: ''
      });
    }
    res.json({ ok:true, items: Array.from(map.values()) });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Import CSV of links (semicolon separated). Headers: work_id;material_id;consumption_per_work_unit;waste_coeff
app.post('/api/admin/import-work-materials', upload.single('file'), async (req,res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:'file required' });
  const tmpPath = req.file.path;
  try {
    const content = fs.readFileSync(tmpPath, 'utf8');
    const records = parse(content, { delimiter: ';', columns: true, skip_empty_lines: true, trim: true, bom: true });
    let inserted=0, updated=0, skipped=0;
    for (const r of records) {
      const work_id = (r.work_id || r.WORK_ID || '').trim();
      // accept common header typo "m.aterial_id" as material_id
      const material_id = (r.material_id || r.MATERIAL_ID || r['m.aterial_id'] || r['M.ATERIAL_ID'] || '').trim();
      if (!work_id || !material_id) { skipped++; continue; }
      const cpuRaw = r.consumption_per_work_unit || r.CONSUMPTION_PER_WORK_UNIT || r.cpu || '';
      const wcRaw = r.waste_coeff || r.WASTE_COEFF || r.wc || '';
      const cpu = cpuRaw===''? null : Number(String(cpuRaw).replace(/,/g,'.'));
      const wc = wcRaw===''? 1 : Number(String(wcRaw).replace(/,/g,'.'));
      try {
        const resUp = await pool.query(`insert into work_materials(work_id, material_id, consumption_per_work_unit, waste_coeff)
          values($1,$2,$3,$4)
          on conflict (work_id, material_id) do update set consumption_per_work_unit=excluded.consumption_per_work_unit, waste_coeff=excluded.waste_coeff, updated_at=now() returning (xmax=0) as inserted`,
          [work_id, material_id, cpu, wc]);
        if (resUp.rows[0] && resUp.rows[0].inserted) inserted++; else updated++;
      } catch (e) { skipped++; }
    }
    res.json({ ok:true, inserted, updated, skipped, total: records.length });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    fs.unlink(tmpPath, ()=>{});
  }
});

// Export materials CSV
app.get('/api/admin/export-materials', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from materials order by id');
    const headers = ['material_id','material_name','image_url','item_url','unit','unit_price','expenditure','weight'];
    const esc = (v) => { if (v==null) return ''; const s=String(v); return /[";\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    let csv = headers.join(';')+'\n';
    for (const r of rows) {
      csv += [r.id,r.name,r.image_url,r.item_url,r.unit,r.unit_price,r.expenditure,r.weight].map(esc).join(';')+'\n';
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="materials_'+new Date().toISOString().slice(0,10)+'.csv"');
    res.send('\uFEFF'+csv);
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Export work-materials links CSV (normative links)
app.get('/api/admin/export-work-materials', async (req, res) => {
  try {
    const q = `
      select wm.work_id, w.name as work_name,
             wm.material_id, m.name as material_name,
             wm.consumption_per_work_unit, wm.waste_coeff
      from work_materials wm
      left join works_ref w on w.id = wm.work_id
      left join materials m on m.id = wm.material_id
      order by wm.work_id, wm.material_id`;
    const { rows } = await pool.query(q);
    const headers = ['work_id','work_name','material_id','material_name','consumption_per_work_unit','waste_coeff'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[";\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    };
    let csv = headers.join(';') + '\n';
    for (const r of rows) {
      csv += [
        r.work_id,
        r.work_name,
        r.material_id,
        r.material_name,
        r.consumption_per_work_unit,
        r.waste_coeff
      ].map(esc).join(';') + '\n';
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    const date = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Disposition', `attachment; filename="work_materials_${date}.csv"`);
    res.send('\uFEFF'+csv);
  } catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Clear only work-materials links (keep schema and other tables)
app.post('/api/admin/clear-work-materials', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = (await client.query('select count(*)::int as c from work_materials')).rows[0].c;
    await client.query('truncate table work_materials restart identity cascade');
    const after = (await client.query('select count(*)::int as c from work_materials')).rows[0].c;
    await client.query('commit');
    res.json({ ok:true, cleared:true, before, after });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});


// Admin: import CSV via multipart/form-data (field name: file)
app.post('/api/admin/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.warn('Import: no file in request');
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }
    const tmpPath = req.file.path;
    console.log('Import: received file at', tmpPath, 'size=', req.file.size);
    const client = await pool.connect();
    try {
  const stats = await importFromCsv(tmpPath, client);
  console.log('Import: completed, rows=', stats.imported);
  res.json({ ok: true, ...stats });
    } catch (e) {
      console.error('Import: failed', e.message);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      client.release();
      fs.unlink(tmpPath, () => {});
    }
  } catch (e) {
    console.error('Import endpoint error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Import materials CSV (multipart form-data: file)
app.post('/api/admin/import-materials', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'No file uploaded' });
    const tmpPath = req.file.path;
    const client = await pool.connect();
    try {
      const stats = await importMaterialsCsv(tmpPath, client);
      res.json({ ok:true, type:'materials', ...stats });
    } catch (e) {
      res.status(500).json({ ok:false, error:e.message });
    } finally {
      client.release();
      fs.unlink(tmpPath, ()=>{});
    }
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Admin: upsert a single work reference with optional phase/stage/substage
app.post('/api/admin/upsert-work-ref', async (req, res) => {
  const {
    phase_id, phase_name,
    stage_id, stage_name,
    substage_id, substage_name,
    work_id, work_name,
    unit, unit_price
  } = req.body || {};

  if (!work_id || !work_name) {
    return res.status(400).json({ ok: false, error: 'work_id and work_name are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (phase_id) {
      await client.query(
        'insert into phases(id, name, sort_order) values($1,$2, coalesce($3,0)) on conflict (id) do update set name=excluded.name',
        [phase_id, phase_name || phase_id, null]
      );
    }
    if (stage_id) {
      await client.query(
        'insert into stages(id, name, phase_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, phase_id=excluded.phase_id',
        [stage_id, stage_name || stage_id, phase_id || null]
      );
    }
    if (substage_id) {
      await client.query(
        'insert into substages(id, name, stage_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, stage_id=excluded.stage_id',
        [substage_id, substage_name || substage_id, stage_id || null]
      );
    }
    const priceNum = unit_price == null || unit_price === '' ? null : Number(unit_price);
    await client.query(
      `insert into works_ref(id, name, unit, unit_price, phase_id, stage_id, substage_id)
       values($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set name=excluded.name, unit=excluded.unit, unit_price=excluded.unit_price, phase_id=excluded.phase_id, stage_id=excluded.stage_id, substage_id=excluded.substage_id`,
      [work_id, work_name, unit || null, priceNum, phase_id || null, stage_id || null, substage_id || null]
    );
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Check if work_ref exists
app.get('/api/admin/work-ref/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rows } = await pool.query('select id, name, unit, unit_price from works_ref where id=$1', [id]);
    if (rows.length) return res.json({ ok: true, exists: true, work: rows[0] });
    res.json({ ok: true, exists: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Create new work_ref strictly (reject duplicate)
app.post('/api/admin/create-work-ref', async (req, res) => {
  const {
    phase_id, phase_name,
    stage_id, stage_name,
    substage_id, substage_name,
    work_id, work_name,
    unit, unit_price
  } = req.body || {};
  if (!work_id || !work_name) return res.status(400).json({ ok: false, error: 'work_id and work_name are required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    // Early duplicate check
    const dup = await client.query('select 1 from works_ref where id=$1', [work_id]);
    if (dup.rows.length) {
      await client.query('rollback');
      return res.status(409).json({ ok: false, duplicate: true, error: 'work_id already exists' });
    }
    if (phase_id) {
      await client.query(
        'insert into phases(id, name, sort_order) values($1,$2,coalesce($3,0)) on conflict (id) do update set name=excluded.name',
        [phase_id, phase_name || phase_id, null]
      );
    }
    if (stage_id) {
      await client.query(
        'insert into stages(id, name, phase_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, phase_id=excluded.phase_id',
        [stage_id, stage_name || stage_id, phase_id || null]
      );
    }
    if (substage_id) {
      await client.query(
        'insert into substages(id, name, stage_id) values($1,$2,$3) on conflict (id) do update set name=excluded.name, stage_id=excluded.stage_id',
        [substage_id, substage_name || substage_id, stage_id || null]
      );
    }
    const priceNum = unit_price == null || unit_price === '' ? null : Number(unit_price);
    await client.query(
      `insert into works_ref(id, name, unit, unit_price, phase_id, stage_id, substage_id)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [work_id, work_name, unit || null, priceNum, phase_id || null, stage_id || null, substage_id || null]
    );
    await client.query('commit');
    res.status(201).json({ ok: true, created: true });
  } catch (e) {
    await client.query('rollback');
    if (e && e.code === '23505') return res.status(409).json({ ok: false, duplicate: true, error: 'work_id already exists' });
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Delete a single work_ref by id
app.delete('/api/admin/work-ref/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  try {
    const { rowCount } = await pool.query('delete from works_ref where id=$1', [id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, deleted: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Patch (partial update / rename) work_ref
app.patch('/api/admin/work-ref/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok:false, error:'id required' });
  const { new_id, name, unit, unit_price } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    let currentId = id;
    if (new_id && new_id !== id) {
      const dup = await client.query('select 1 from works_ref where id=$1', [new_id]);
      if (dup.rows.length) { await client.query('rollback'); return res.status(409).json({ ok:false, duplicate:true, error:'new_id already exists' }); }
      const upd = await client.query('update works_ref set id=$1 where id=$2 returning *', [new_id, id]);
      if (!upd.rows.length) { await client.query('rollback'); return res.status(404).json({ ok:false, error:'not found' }); }
      currentId = new_id;
    }
    const fields = [];
    const args = [];
    if (name !== undefined) { args.push(name); fields.push(`name=$${args.length}`); }
    if (unit !== undefined) { args.push(unit || null); fields.push(`unit=$${args.length}`); }
    if (unit_price !== undefined) { const priceNum = unit_price === '' || unit_price == null ? null : Number(unit_price); args.push(priceNum); fields.push(`unit_price=$${args.length}`); }
    if (fields.length) {
      args.push(currentId);
      await client.query(`update works_ref set ${fields.join(', ')} where id=$${args.length}`, args);
    }
    const { rows } = await client.query('select id, name, unit, unit_price from works_ref where id=$1', [currentId]);
    await client.query('commit');
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found after update' });
    res.json({ ok:true, updated: rows[0] });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});

// Export works_ref with hierarchy names as CSV
app.get('/api/admin/export-works-ref', async (req, res) => {
  try {
    const q = `select w.id, w.name, w.unit, w.unit_price,
      w.phase_id, p.name as phase_name,
      w.stage_id, s.name as stage_name,
      w.substage_id, ss.name as substage_name
      from works_ref w
      left join phases p on p.id = w.phase_id
      left join stages s on s.id = w.stage_id
      left join substages ss on ss.id = w.substage_id
      order by w.id`;
    const { rows } = await pool.query(q);
    const headers = ['work_id','work_name','unit','unit_price','phase_id','phase_name','stage_id','stage_name','substage_id','substage_name'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[";,\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
      return s;
    };
    let csv = headers.join(';') + '\n';
    for (const r of rows) {
      csv += [r.id, r.name, r.unit, r.unit_price, r.phase_id, r.phase_name, r.stage_id, r.stage_name, r.substage_id, r.substage_name].map(esc).join(';') + '\n';
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    const date = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Disposition', `attachment; filename="works_ref_${date}.csv"`);
    res.send('\uFEFF'+csv); // BOM for Excel UTF-8
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get('/api/works', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from works order by sort_order, id');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/works', async (req, res) => {
  const { code, name, unit, price, group_code } = req.body;
  try {
    const { rows } = await pool.query(
      'insert into works(code, name, unit, price, group_code) values($1,$2,$3,$4,$5) returning *',
      [code, name, unit, price ?? null, group_code ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/works/:id', async (req, res) => {
  const { id } = req.params;
  const { code, name, unit, price, group_code } = req.body;
  try {
    const { rows } = await pool.query(
      'update works set code=$1, name=$2, unit=$3, price=$4, group_code=$5, updated_at=now() where id=$6 returning *',
      [code, name, unit, price ?? null, group_code ?? null, id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/works/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('delete from works where id=$1', [id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================= ESTIMATES (Расчет сметы) =========================
// List estimates
app.get('/api/estimates', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from estimates order by id desc');
    res.json({ ok:true, items: rows });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Create estimate
app.post('/api/estimates', async (req, res) => {
  const { code, title, client_name, status, currency } = req.body || {};
  if (!title) return res.status(400).json({ ok:false, error:'title required' });
  try {
    const { rows } = await pool.query(
      `insert into estimates(code,title,client_name,status,currency) values($1,$2,$3,coalesce($4,'draft'),coalesce($5,'RUB')) returning *`,
      [code||null,title,client_name||null,status||null,currency||null]
    );
    res.status(201).json({ ok:true, estimate: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Get single estimate (with optional aggregated totals later)
app.get('/api/estimates/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('select * from estimates where id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, estimate: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Patch estimate
app.patch('/api/estimates/:id', async (req, res) => {
  const { id } = req.params;
  const { code, title, client_name, status, currency } = req.body || {};
  const sets=[]; const args=[];
  if (code !== undefined) { args.push(code||null); sets.push(`code=$${args.length}`); }
  if (title !== undefined) { args.push(title); sets.push(`title=$${args.length}`); }
  if (client_name !== undefined) { args.push(client_name||null); sets.push(`client_name=$${args.length}`); }
  if (status !== undefined) { args.push(status||null); sets.push(`status=$${args.length}`); }
  if (currency !== undefined) { args.push(currency||null); sets.push(`currency=$${args.length}`); }
  if (!sets.length) return res.json({ ok:true, noop:true });
  try {
    args.push(id);
    const { rows } = await pool.query(`update estimates set ${sets.join(', ')}, updated_at=now() where id=$${args.length} returning *`, args);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, estimate: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
// Delete estimate (cascade)
app.delete('/api/estimates/:id', async (req,res) => {
  try {
    const r = await pool.query('delete from estimates where id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, deleted:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Estimate items (works inside estimate)
app.get('/api/estimates/:id/items', async (req,res) => {
  try {
    const { rows } = await pool.query('select * from estimate_items where estimate_id=$1 order by sort_order, id', [req.params.id]);
    res.json({ ok:true, items: rows });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/estimates/:id/items', async (req,res) => {
  const estimateId = req.params.id;
  const { work_id, quantity, unit_price } = req.body || {};
  if (!work_id) return res.status(400).json({ ok:false, error:'work_id required' });
  try {
    // Снимок
    const wr = await pool.query('select id,name,unit,unit_price,phase_id,stage_id,substage_id from works_ref where id=$1',[work_id]);
    let snap = { id: work_id, name: null, unit:null, unit_price:null, phase_id:null, stage_id:null, substage_id:null };
    if (wr.rows.length) snap = wr.rows[0];
    const qtyNum = quantity==null?0:Number(quantity);
    const up = unit_price==null? snap.unit_price : Number(unit_price);
    const { rows } = await pool.query(`insert into estimate_items(estimate_id, work_id, work_code, work_name, unit, quantity, unit_price, phase_id, stage_id, substage_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [estimateId, snap.id, snap.id, snap.name, snap.unit, qtyNum, up, snap.phase_id, snap.stage_id, snap.substage_id]);
    res.status(201).json({ ok:true, item: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.patch('/api/estimate-items/:itemId', async (req,res) => {
  const { itemId } = req.params;
  const { quantity, unit_price, sort_order, work_name } = req.body || {};
  const sets=[]; const args=[];
  if (quantity !== undefined) { args.push(Number(quantity)); sets.push(`quantity=$${args.length}`); }
  if (unit_price !== undefined) { const v = unit_price===''||unit_price==null?null:Number(unit_price); args.push(v); sets.push(`unit_price=$${args.length}`); }
  if (sort_order !== undefined) { args.push(Number(sort_order)); sets.push(`sort_order=$${args.length}`); }
  if (work_name !== undefined) { args.push(work_name); sets.push(`work_name=$${args.length}`); }
  if (!sets.length) return res.json({ ok:true, noop:true });
  try {
    args.push(itemId);
    const { rows } = await pool.query(`update estimate_items set ${sets.join(', ')}, updated_at=now() where id=$${args.length} returning *`, args);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, item: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.delete('/api/estimate-items/:itemId', async (req,res) => {
  try {
    const r = await pool.query('delete from estimate_items where id=$1', [req.params.itemId]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, deleted:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Materials inside estimate item
app.get('/api/estimate-items/:itemId/materials', async (req,res) => {
  try {
    const { rows } = await pool.query('select * from estimate_item_materials where estimate_item_id=$1 order by sort_order, id', [req.params.itemId]);
    res.json({ ok:true, items: rows });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/estimate-items/:itemId/materials', async (req,res) => {
  const { itemId } = req.params;
  const { material_id, consumption_per_work_unit, waste_coeff, quantity, unit_price } = req.body || {};
  if (!material_id) return res.status(400).json({ ok:false, error:'material_id required' });
  try {
    const m = await pool.query('select id,name,unit,unit_price from materials where id=$1', [material_id]);
    let snap = { id: material_id, name:null, unit:null, unit_price:null };
    if (m.rows.length) snap = m.rows[0];
    const cpu = consumption_per_work_unit==null? null : Number(consumption_per_work_unit);
    const wc = waste_coeff==null? 1 : Number(waste_coeff);
    const qty = quantity==null? null : Number(quantity);
    const up = unit_price==null? snap.unit_price : Number(unit_price);
    const { rows } = await pool.query(`insert into estimate_item_materials(estimate_item_id, material_id, material_code, material_name, unit, consumption_per_work_unit, waste_coeff, quantity, unit_price)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [itemId, snap.id, snap.id, snap.name, snap.unit, cpu, wc, qty, up]);
    res.status(201).json({ ok:true, material: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.patch('/api/estimate-item-materials/:id', async (req,res) => {
  const { id } = req.params;
  const { consumption_per_work_unit, waste_coeff, quantity, unit_price, material_name, sort_order, material_id } = req.body || {};
  const sets=[]; const args=[];
  // If material_id is provided, validate and snap unit/price from reference
  if (material_id !== undefined) {
    try {
      const m = await pool.query('select id,name,unit,unit_price,image_url from materials where id=$1', [material_id]);
      if (!m.rows.length) return res.status(400).json({ ok:false, error:'material_id not found' });
      const mm = m.rows[0];
      // apply snapshot fields
      args.push(mm.id); sets.push(`material_id=$${args.length}`);
      args.push(mm.id); sets.push(`material_code=$${args.length}`);
      args.push(mm.name); sets.push(`material_name=$${args.length}`);
      args.push(mm.unit || null); sets.push(`unit=$${args.length}`);
      args.push(mm.unit_price == null ? null : Number(mm.unit_price)); sets.push(`unit_price=$${args.length}`);
    } catch (e) {
      return res.status(500).json({ ok:false, error:e.message });
    }
  }
  if (consumption_per_work_unit !== undefined) { const v=consumption_per_work_unit===''||consumption_per_work_unit==null?null:Number(consumption_per_work_unit); args.push(v); sets.push(`consumption_per_work_unit=$${args.length}`); }
  if (waste_coeff !== undefined) { args.push(waste_coeff==null?1:Number(waste_coeff)); sets.push(`waste_coeff=$${args.length}`); }
  if (quantity !== undefined) { const v=quantity===''||quantity==null?null:Number(quantity); args.push(v); sets.push(`quantity=$${args.length}`); }
  if (unit_price !== undefined && material_id === undefined) { const v=unit_price===''||unit_price==null?null:Number(unit_price); args.push(v); sets.push(`unit_price=$${args.length}`); }
  if (material_name !== undefined) { args.push(material_name); sets.push(`material_name=$${args.length}`); }
  if (sort_order !== undefined) { args.push(Number(sort_order)); sets.push(`sort_order=$${args.length}`); }
  if (!sets.length) return res.json({ ok:true, noop:true });
  try {
    args.push(id);
    const { rows } = await pool.query(`update estimate_item_materials set ${sets.join(', ')}, updated_at=now() where id=$${args.length} returning *`, args);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, material: rows[0] });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.delete('/api/estimate-item-materials/:id', async (req,res) => {
  try {
    const r = await pool.query('delete from estimate_item_materials where id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, deleted:true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ========================= FULL ESTIMATE SNAPSHOT (load/save by code) =========================
// Shape expected on save: { code, title?, items:[ {work_code, work_name, unit, quantity, unit_price, stage_id, substage_id, materials:[{ material_code, material_name, unit, quantity, unit_price }]} ] }
// GET returns same structure (infers title from estimate row or code if absent)
app.get('/api/estimates/by-code/:code/full', async (req,res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ ok:false, error:'code required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const est = await client.query('select * from estimates where code=$1', [code]);
    if (!est.rows.length) { await client.query('rollback'); return res.json({ ok:true, exists:false, estimate:null }); }
    const estimate = est.rows[0];
    const itemsR = await client.query('select * from estimate_items where estimate_id=$1 order by id', [estimate.id]);
    const itemIds = itemsR.rows.map(r => r.id);
    let materialsMap = new Map();
    if (itemIds.length) {
      // Протягиваем image_url из справочника материалов по material_code
      const matsR = await client.query(
        `select eim.*, mt.image_url as material_image_url
         from estimate_item_materials eim
         left join materials mt on mt.id = eim.material_code
         where eim.estimate_item_id = any($1)
         order by eim.id`,
        [itemIds]
      );
      for (const m of matsR.rows) {
        if (!materialsMap.has(m.estimate_item_id)) materialsMap.set(m.estimate_item_id, []);
        materialsMap.get(m.estimate_item_id).push({
          material_code: m.material_code || m.material_id,
          material_name: m.material_name,
          unit: m.unit,
          quantity: m.quantity == null ? '' : String(m.quantity),
          unit_price: m.unit_price == null ? '' : String(m.unit_price),
          image_url: m.material_image_url || ''
        });
      }
    }
    const items = itemsR.rows.map(r => ({
      work_code: r.work_code || r.work_id,
      work_name: r.work_name,
      unit: r.unit,
      quantity: r.quantity==null? '': String(r.quantity),
      unit_price: r.unit_price==null? '': String(r.unit_price),
      stage_id: r.stage_id,
      substage_id: r.substage_id,
      materials: materialsMap.get(r.id) || []
    }));
    await client.query('commit');
    res.json({ ok:true, exists:true, estimate:{ code: estimate.code, title: estimate.title, items } });
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    res.status(500).json({ ok:false, error:e.message });
  } finally { client.release(); }
});

app.post('/api/estimates/by-code/:code/full', async (req,res) => {
  const { code } = req.params;
  const { title, items, clear } = req.body || {};
  if (!code) return res.status(400).json({ ok:false, error:'code required' });
  if (!Array.isArray(items)) return res.status(400).json({ ok:false, error:'items array required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    // Upsert estimate by code
    let est = await client.query('select * from estimates where code=$1', [code]);
    if (!est.rows.length) {
      const ins = await client.query('insert into estimates(code, title) values($1,$2) returning *', [code, title || code]);
      est = { rows: ins.rows };
    } else if (title && title !== est.rows[0].title) {
      await client.query('update estimates set title=$2, updated_at=now() where code=$1', [code, title]);
      est = await client.query('select * from estimates where code=$1', [code]);
    }
    const estimateId = est.rows[0].id;
    // Safeguard: ignore empty snapshot if estimate already exists and no explicit clear requested
    if (!clear && est.rows.length && items.length === 0) {
      await client.query('rollback');
      return res.json({ ok:true, ignored:true, reason:'empty items snapshot ignored' });
    }
    // Remove existing snapshot
    await client.query('delete from estimate_item_materials where estimate_item_id in (select id from estimate_items where estimate_id=$1)', [estimateId]);
    await client.query('delete from estimate_items where estimate_id=$1', [estimateId]);
    // Insert new items
    for (let idx=0; idx<items.length; idx++) {
      const it = items[idx];
      const qtyNum = it.quantity===''||it.quantity==null? 0 : Number(String(it.quantity).replace(/\s+/g,'').replace(/,/g,'.'));
      const upNum = it.unit_price===''||it.unit_price==null? null : Number(String(it.unit_price).replace(/\s+/g,'').replace(/,/g,'.'));
      const insItem = await client.query(`insert into estimate_items(estimate_id, work_id, work_code, work_name, unit, quantity, unit_price, stage_id, substage_id, sort_order)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [
        estimateId,
        null, // не удерживаем FK, храним только snapshot кода
        it.work_code || null,
        it.work_name || it.work_code || '',
        it.unit || null,
        qtyNum,
        upNum,
        it.stage_id || null,
        it.substage_id || null,
        idx
      ]);
      const itemId = insItem.rows[0].id;
    if (Array.isArray(it.materials)) {
        for (let mIdx=0; mIdx<it.materials.length; mIdx++) {
          const m = it.materials[mIdx];
      const mQty = m.quantity===''||m.quantity==null? null : Number(String(m.quantity).replace(/\s+/g,'').replace(/,/g,'.'));
      const mUp = m.unit_price===''||m.unit_price==null? null : Number(String(m.unit_price).replace(/\s+/g,'').replace(/,/g,'.'));
          await client.query(`insert into estimate_item_materials(estimate_item_id, material_id, material_code, material_name, unit, quantity, unit_price, sort_order)
            values($1,$2,$3,$4,$5,$6,$7,$8)`, [
            itemId,
            null, // не удерживаем FK, храним только snapshot кода
            m.material_code || null,
            m.material_name || m.material_code || '',
            m.unit || null,
            mQty,
            mUp,
            mIdx
          ]);
        }
      }
    }
    await client.query('commit');
    res.json({ ok:true, saved:true });
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    res.status(500).json({ ok:false, error:e.message }); }
  finally { client.release(); }
});

const port = process.env.PORT || 4000;
const host = process.env.HOST || '0.0.0.0';
const srv = app.listen(port, host, () => {
  const addr = srv.address();
  const shown = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : String(addr);
  console.log(`API listening on ${shown}`);
});
srv.on('error', (err) => {
  console.error('Server listen error:', err?.message || err);
});
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('SIGTERM', () => console.log('SIGTERM received'));
process.on('SIGINT', () => console.log('SIGINT received'));
