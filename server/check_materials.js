import dotenv from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
if (!RAW_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const URL_CLEAN = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');

async function main() {
  const client = new Client({ connectionString: URL_CLEAN, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const exists = await client.query("select count(*)::int as c from information_schema.tables where table_schema='public' and table_name='materials'");
    console.log('materials table exists:', !!exists.rows[0].c);
    if (exists.rows[0].c) {
      const cols = await client.query("select column_name, data_type from information_schema.columns where table_name='materials' order by ordinal_position");
      console.table(cols.rows);
      const sample = await client.query('select * from materials order by id limit 3');
      console.log('first rows:', sample.rows);
    } else {
      console.log('You can create it manually with SQL:');
      console.log(`create table materials (\n  id text primary key,\n  name text not null,\n  image_url text,\n  item_url text,\n  unit text,\n  unit_price numeric(14,2),\n  expenditure numeric(14,6),\n  weight numeric(14,3),\n  created_at timestamptz default now(),\n  updated_at timestamptz default now()\n);`);
    }
  } catch (e) {
    console.error('check error:', e.message);
  } finally {
    await client.end();
  }
}

main();
