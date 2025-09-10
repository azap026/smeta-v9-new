import path from 'path';
import dotenv from 'dotenv';
import pkg from 'pg';
import { importFromCsv } from './importer.js';
const { Pool } = pkg;

dotenv.config();

const RAW_URL = process.env.DATABASE_URL || '';
const CONNECTION_URL = RAW_URL.replace(/([?&])sslmode=require&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({ connectionString: CONNECTION_URL, ssl: { rejectUnauthorized: false }, max: 20 });

const argPath = process.argv[2];
const envPath = process.env.BDWM_CSV_PATH;
const filePath = argPath ? path.resolve(argPath) : envPath ? path.resolve(envPath) : path.resolve(process.cwd(), 'BDWM.csv');

(async () => {
  const client = await pool.connect();
  try {
    const { imported } = await importFromCsv(filePath, client);
    console.log(`Imported ${imported} rows`);
  } catch (e) {
    console.error('Import failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
