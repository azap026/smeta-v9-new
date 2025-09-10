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
    res.status(500).json({ ok: false, error: e.message });
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

    const phaseMap = new Map(phases.map(p => [p.id, p]));
    const stageMap = new Map(stages.map(s => [s.id, s]));
    const subMap = new Map(substages.map(ss => [ss.id, ss]));

    const phaseKeys = new Set([
      ...works.map(w => w.phase_id).filter(Boolean),
      ...stages.map(s => s.phase_id).filter(Boolean),
      ...phases.map(p => p.id),
    ]);

    const byPhaseStages = stages.reduce((m, s) => { (m[s.phase_id] ||= []).push(s); return m; }, {});
    const byStageSubs = substages.reduce((m, ss) => { (m[ss.stage_id] ||= []).push(ss); return m; }, {});
    const byPhaseWorksOnly = works.reduce((m, w) => { if (w.phase_id && !w.stage_id && !w.substage_id) (m[w.phase_id] ||= []).push(w); return m; }, {});
    const byStageWorksOnly = works.reduce((m, w) => { if (w.stage_id && !w.substage_id) (m[w.stage_id] ||= []).push(w); return m; }, {});
    const bySubWorks = works.reduce((m, w) => { if (w.substage_id) (m[w.substage_id] ||= []).push(w); return m; }, {});

    const sortById = (a, b) => String(a.id || a).localeCompare(String(b.id || b), 'ru');
    const sortPhaseKeys = (a, b) => {
      const pa = phaseMap.get(a); const pb = phaseMap.get(b);
      const sa = pa?.sort_order; const sb = pb?.sort_order;
      if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb;
      if (typeof sa === 'number' && typeof sb !== 'number') return -1;
      if (typeof sa !== 'number' && typeof sb === 'number') return 1;
      return String(a).localeCompare(String(b), 'ru');
    };
    const out = [];
  const pids = Array.from(phaseKeys).sort(sortPhaseKeys);
    if (pids.length > 0) {
      for (const pid of pids) {
        const p = phaseMap.get(pid);
        out.push({ type: 'group', code: pid, title: p?.name || pid });
        for (const w of (byPhaseWorksOnly[pid] || [])) {
          out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
        }
        const phaseStages = (byPhaseStages[pid] || []).sort(sortById);
        for (const st of phaseStages) {
          out.push({ type: 'group', code: st.id, title: st.name || st.id });
          for (const w of (byStageWorksOnly[st.id] || [])) {
            out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
          }
          const stSubs = (byStageSubs[st.id] || []).sort(sortById);
          for (const ss of stSubs) {
            out.push({ type: 'group', code: ss.id, title: ss.name || ss.id });
            for (const w of (bySubWorks[ss.id] || [])) {
              out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
            }
          }
        }
      }
    } else {
      // Fallback: строим по стадиям/подстадиям, если нет фаз
      const stagesSorted = [...stages].sort(sortById);
      for (const st of stagesSorted) {
        out.push({ type: 'group', code: st.id, title: st.name || st.id });
        for (const w of (byStageWorksOnly[st.id] || [])) {
          out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
        }
        const stSubs = (byStageSubs[st.id] || []).sort(sortById);
        for (const ss of stSubs) {
          out.push({ type: 'group', code: ss.id, title: ss.name || ss.id });
          for (const w of (bySubWorks[ss.id] || [])) {
            out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
          }
        }
      }
      // Дополнительно: работы без stage/substage
      const orphan = works.filter(w => !w.stage_id && !w.substage_id);
      if (orphan.length) {
        out.push({ type: 'group', code: '_ungrouped', title: 'Прочее' });
        for (const w of orphan) {
          out.push({ type: 'item', code: w.id, name: w.name, unit: w.unit, price: w.unit_price });
        }
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
      const { imported } = await importFromCsv(tmpPath, client);
      console.log('Import: completed, rows=', imported);
      res.json({ ok: true, imported });
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
