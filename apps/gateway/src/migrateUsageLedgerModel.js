import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '..', 'migrations', '20260813_usage_ledger_model.sql');

try {
    const sql = await fs.readFile(migrationPath, 'utf8');
    console.log(`[migrate:usage-ledger-model] aplicando ${path.basename(migrationPath)}...`);
    await pool.query(sql);
    console.log('[migrate:usage-ledger-model] concluida.');
} catch (error) {
    console.error('[migrate:usage-ledger-model] falhou:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
