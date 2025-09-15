import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
if (!RAW_URL) {
  console.error('DATABASE_URL is not set in environment');
  process.exit(1);
}
// Удаляем из строки sslmode=require (pg к ней относится по-своему), но включаем SSL вручную
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false } });

const workId = process.argv[2] || 'w.1';

(async () => {
  const client = await pool.connect();
  try {
    const info = await client.query('select current_database() as db, current_user as usr, current_schema as schema');
    const searchPath = await client.query('show search_path');

    const countsRes = await client.query(`
      select
        (select count(*) from public.work_materials) as work_materials,
        (select count(*) from public.materials) as materials,
        (select count(*) from public.works_ref) as works_ref
    `);

    const rowsRes = await client.query(
      `select work_id, material_id, consumption_per_work_unit, waste_coeff, created_at, updated_at
       from public.work_materials
       where work_id = $1
       order by material_id`,
      [workId]
    );

    const out = {
      ok: true,
      connection: {
        urlSample: CONNECTION_URL.replace(/:[^:@/]+@/, '://****@'),
      },
      server: {
        current_database: info.rows[0]?.db,
        current_user: info.rows[0]?.usr,
        current_schema: info.rows[0]?.schema,
        search_path: searchPath.rows?.[0]?.search_path,
      },
      counts: countsRes.rows[0],
      rows: rowsRes.rows,
    };

    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
