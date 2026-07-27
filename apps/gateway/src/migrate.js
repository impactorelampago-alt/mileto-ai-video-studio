import { pool, SCHEMA, RESET } from './db.js';

// `node src/migrate.js --reset` derruba e recria (dev). Sem flag, só cria o que falta.
const reset = process.argv.includes('--reset');

const run = async () => {
    if (reset) {
        console.log('[migrate] --reset: derrubando tabelas existentes...');
        await pool.query(RESET);
    }
    console.log('[migrate] aplicando esquema...');
    await pool.query(SCHEMA);
    console.log('[migrate] pronto.');
    await pool.end();
};

run().catch((e) => {
    console.error('[migrate] falhou:', e.message);
    process.exit(1);
});
