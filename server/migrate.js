import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false } });

const sql = `
create table if not exists works_groups (
  id serial primary key,
  code text unique not null,
  title text not null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists works (
  id serial primary key,
  code text unique,
  name text not null,
  unit text,
  price numeric(12,2),
  group_code text references works_groups(code) on delete set null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_works_group on works(group_code);

-- BDWM hierarchical reference from CSV
create table if not exists phases (
  id text primary key,
  name text not null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists stages (
  id text primary key,
  name text not null,
  phase_id text references phases(id) on delete set null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists substages (
  id text primary key,
  name text not null,
  stage_id text references stages(id) on delete set null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists works_ref (
  id text primary key,
  name text not null,
  unit text,
  unit_price numeric(14,2),
  phase_id text references phases(id) on delete set null,
  stage_id text references stages(id) on delete set null,
  substage_id text references substages(id) on delete set null,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_stages_phase on stages(phase_id);
create index if not exists idx_substages_stage on substages(stage_id);
create index if not exists idx_worksref_stage on works_ref(stage_id);
create index if not exists idx_worksref_substage on works_ref(substage_id);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('Migrations applied');
  } catch (e) {
    await client.query('rollback');
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
