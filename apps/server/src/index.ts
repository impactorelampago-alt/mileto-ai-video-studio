import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Base path for persistent data (critical for installed version)
const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
console.log(`[Server] Base Data Path: ${BASE_DATA_PATH}`);

// Ensure directories exist in the persistent path
const persistentDirs = [
    'narrations',
    'voice_samples',
    'frame_cache',
    'videos',
    'uploads',
    'ops-cache',
    'music',
    'data',
    'files/Imagens',
    'files/Vídeos',
    'files/Músicas',
    'public/mixes',
    'public/transitions',
];
persistentDirs.forEach((dir) => {
    const dirPath = path.join(BASE_DATA_PATH, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Migração v1: centraliza mídia em files/ (Imagens/Vídeos/Músicas) + índice.
// Idempotente (flag .files_v1); no boot sempre aplica com backup automático.
// Falhas aqui não podem derrubar o server — capturamos e só logamos.
import { runMigration } from './scripts/migrateToFiles';
void runMigration({ apply: true }).catch((e) => {
    console.error('[Migrate] Falha na migração (server continua normalmente):', e);
});

// Prevent server crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3301;

// CORS restrito. O app Electron carrega de file:// (sem Origin ou 'null') no build
// e de localhost:5173 em dev. Refletir QUALQUER origem (o padrão antigo) deixava
// qualquer site aberto no navegador ler as respostas do servidor local e — via
// preflight — disparar POSTs. Aqui só liberamos as origens do próprio app.
const isAllowedOrigin = (origin?: string): boolean => {
    if (!origin || origin === 'null') return true; // Electron file:// / same-origin
    try {
        const host = new URL(origin).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
        return false;
    }
};
app.use(
    cors({
        origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Runway-Token',
            'X-Replicate-Token',
            'X-Ops-View-Context',
        ],
        credentials: true,
    })
);

// Nunca deixe o navegador "adivinhar" o tipo de um arquivo servido (anti-XSS por sniffing).
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use(express.json({ limit: '50mb' }));

// Static Routes pointing to persistent data
app.use('/data', express.static(path.join(BASE_DATA_PATH, 'data')));
app.use('/music', express.static(path.join(BASE_DATA_PATH, 'music')));
app.use('/uploads', express.static(path.join(BASE_DATA_PATH, 'uploads')));
app.use('/narrations', express.static(path.join(BASE_DATA_PATH, 'narrations')));
app.use('/videos', express.static(path.join(BASE_DATA_PATH, 'videos')));
app.use('/mixes', express.static(path.join(BASE_DATA_PATH, 'public', 'mixes')));
app.use('/transitions', express.static(path.join(BASE_DATA_PATH, 'public', 'transitions')));
app.use('/files', express.static(path.join(BASE_DATA_PATH, 'files')));
app.use('/preview-cache', express.static(path.join(BASE_DATA_PATH, 'preview-cache')));
app.use(express.static(path.join(__dirname, '../public'))); // Correct for bundled dist/index.js

// Basic Routes
app.get('/', (_req, res) => {
    res.send('Mileto Video Generator API');
});

// Health Check
app.get('/health', (_req, res) => {
    res.json({ ok: true, status: 'online', timestamp: new Date().toISOString() });
});

// Debug endpoint - exposes runtime paths
app.get('/debug', (_req, res) => {
    res.json({
        BASE_DATA_PATH,
        __dirname,
        USER_DATA_PATH: process.env.USER_DATA_PATH,
        narrations: path.join(BASE_DATA_PATH, 'narrations'),
    });
});

import apiRoutes from './routes/api';

app.use('/api', apiRoutes);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});
