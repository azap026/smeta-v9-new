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

-- Materials reference (from BDM CSV)
create table if not exists materials (
  id text primary key,
  name text not null,
  image_url text,
  item_url text,
  unit text,
  unit_price numeric(14,2),
  expenditure numeric(14,6), -- нормативный расход (если применимо)
  weight numeric(14,3),       -- масса одного юнита
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_materials_name on materials using gin (to_tsvector('simple', name));

-- Нормативная связка работы и материалов (многие-ко-многим)
create table if not exists work_materials (
  work_id text not null references works_ref(id) on delete cascade,
  material_id text not null references materials(id) on delete cascade,
  consumption_per_work_unit numeric(18,6), -- сколько материала на 1 ед. работы
  waste_coeff numeric(8,4) default 1.0,    -- коэффициент запаса/потерь
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (work_id, material_id)
);
create index if not exists idx_work_materials_material on work_materials(material_id);

-- =============================
-- СМЕТА (структура вкладки "Расчет сметы")
-- =============================
-- Документ сметы (шапка). Храним код/название/клиента и статусы.
create table if not exists estimates (
  id serial primary key,
  code text unique,
  title text not null,
  client_name text,
  status text default 'draft', -- draft | approved | archived
  currency text default 'RUB',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Позиции сметы (работы). Снимок на момент добавления: имя, ед., базовая цена.
-- Храним ссылки на иерархию для группировки без доп. join-ов.
create table if not exists estimate_items (
  id serial primary key,
  estimate_id int not null references estimates(id) on delete cascade,
  work_id text references works_ref(id) on delete set null,
  work_code text,            -- дублируем id работы для быстрого доступа/истории
  work_name text,            -- снимок названия
  unit text,                 -- снимок единицы
  quantity numeric(18,4) not null default 0,
  unit_price numeric(14,2),  -- снимок цены работы (может обновляться вручную независимо от works_ref)
  phase_id text,             -- для будущей группировки, nullable
  stage_id text,
  substage_id text,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_estimate_items_estimate on estimate_items(estimate_id);
create index if not exists idx_estimate_items_stage on estimate_items(stage_id);
create index if not exists idx_estimate_items_substage on estimate_items(substage_id);

-- Материалы, связанные с конкретной позицией сметы.
-- quantity = рассчитанное или вручную заданное итоговое кол-во для данной позиции.
create table if not exists estimate_item_materials (
  id serial primary key,
  estimate_item_id int not null references estimate_items(id) on delete cascade,
  material_id text references materials(id) on delete set null,
  material_code text,         -- снимок id материала
  material_name text,         -- снимок названия
  unit text,                  -- ед. измерения материала (снимок)
  consumption_per_work_unit numeric(18,6), -- норматив расхода на 1 ед. работы (копия из связи или ручной ввод)
  waste_coeff numeric(8,4) default 1.0,
  quantity numeric(18,6),     -- итоговое количество материала (quantity_work * consumption * waste) – можно пересчитывать
  unit_price numeric(14,2),   -- снимок цены материала
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_eim_item on estimate_item_materials(estimate_item_id);
create index if not exists idx_eim_material on estimate_item_materials(material_id);

-- =============================
-- PROJECTS (вкладка "Создать проект")
-- =============================
create table if not exists projects (
  id serial primary key,
  code text unique,
  name text not null,
  customer text,
  address text,
  currency text default 'RUB',
  vat numeric(6,3) default 0,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_projects_name on projects using gin (to_tsvector('simple', name));

-- Представление для быстрого агрегирования (сумма по работам) - опционально (создаем по необходимости)
-- create or replace view v_estimate_items_totals as
--   select ei.id as estimate_item_id,
--          coalesce(sum(eim.quantity * coalesce(eim.unit_price,0)),0) as materials_total,
--          (ei.quantity * coalesce(ei.unit_price,0)) as work_total,
--          (ei.quantity * coalesce(ei.unit_price,0)) + coalesce(sum(eim.quantity * coalesce(eim.unit_price,0)),0) as item_grand_total
--   from estimate_items ei
--   left join estimate_item_materials eim on eim.estimate_item_id = ei.id
--   group by ei.id;
`;

(async () => {
  if (!RAW_URL) {
    console.error('❌ DATABASE_URL не задан. Создайте .env с реальной строкой подключения. Пример:');
    console.error('DATABASE_URL=postgres://USER:PASSWORD@host:5432/dbname');
    process.exitCode = 1;
    return;
  }
  if (/user:pass@localhost/.test(RAW_URL)) {
    console.error('❌ DATABASE_URL все ещё содержит placeholder user:pass. Миграция не запущена, чтобы не писать в тестовую БД.');
    process.exitCode = 1;
    return;
  }
  try {
    const u = new URL(CONNECTION_URL);
    console.log('→ Применяю миграции к БД:', `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//,'')}`);
  } catch {}
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
