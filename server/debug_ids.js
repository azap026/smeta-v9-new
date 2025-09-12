import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config();
const { Pool } = pkg;
const RAW_URL = process.env.DATABASE_URL || ''; const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl:{rejectUnauthorized:false}});

(async () => {
  const works = await pool.query('select id from works_ref order by id limit 20');
  const mats = await pool.query('select id from materials order by id limit 20');
  console.log('works_ref sample ids:', works.rows.map(r=>r.id));
  console.log('materials sample ids:', mats.rows.map(r=>r.id));
  await pool.end();
})();
