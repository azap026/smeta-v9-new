import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { importFromCsv } from './importer.js';
const { Pool } = pkg;

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
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
      phase_id ? 'select * from stages where phase_id=$1 order by id' : 'select * from stages order by id',
      phase_id ? [phase_id] : []
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/substages', async (req, res) => {
  try {
    const { stage_id } = req.query;
    const { rows } = await pool.query(
      stage_id ? 'select * from substages where stage_id=$1 order by id' : 'select * from substages order by id',
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
    const [phasesR, stagesR, substagesR, worksR] = await Promise.all([
      pool.query('select * from phases'),
      pool.query('select * from stages'),
      pool.query('select * from substages'),
      pool.query('select * from works_ref'),
    ]);
    const phases = phasesR.rows;
    const stages = stagesR.rows;
    const substages = substagesR.rows;
    const works = worksR.rows;

    // Натуральная сортировка идентификаторов (учитывает числа внутри строк)
    const naturalId = (a, b) => {
      const av = String(a.id || a);
      const bv = String(b.id || b);
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
    const stagesSorted = [...stages].sort(naturalId);
    for (const st of stagesSorted) {
      out.push({ type: 'group', level: 'stage', code: st.id, title: st.name || st.id, parents: [] });
      for (const w of (byStageWorksOnly[st.id] || []).sort(naturalId)) {
        out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: [st.id] });
      }
      const stSubs = (byStageSubs[st.id] || []).sort(naturalId);
      for (const ss of stSubs) {
        out.push({ type: 'group', level: 'substage', code: ss.id, title: ss.name || ss.id, parents: [st.id] });
        for (const w of (bySubWorks[ss.id] || []).sort(naturalId)) {
          out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: [st.id, ss.id] });
        }
      }
    }
    // Работы, у которых нет stage/substage (фазовые или полностью без привязки)
    const orphan = works.filter(w => !w.stage_id && !w.substage_id);
    if (orphan.length) {
      out.push({ type: 'group', level: 'orphan', code: '_ungrouped', title: 'Прочее', parents: [] });
      for (const w of orphan.sort(naturalId)) {
        out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price, parents: ['_ungrouped'] });
      }
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// quick debug endpoint
app.get('/api/debug-counts', async (req, res) => {
  try {
    const q = async (t) => (await pool.query(`select count(*)::int as c from ${t}`)).rows[0].c;
    const [ph, st, ss, wr] = await Promise.all(['phases','stages','substages','works_ref'].map(q));
    res.json({ phases: ph, stages: st, substages: ss, works_ref: wr });
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
