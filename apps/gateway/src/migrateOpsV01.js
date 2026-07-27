import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '..', 'migrations', '20260726_ops_integration_v01.sql');

try {
    const sql = await fs.readFile(migrationPath, 'utf8');
    console.log('[migrate:ops-v01] aplicando migration aditiva...');
    await pool.query(sql);
    console.log('[migrate:ops-v01] concluída.');
} catch (error) {
    console.error('[migrate:ops-v01] falhou:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
