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
    'music',
    'data',
    'public/mixes',
    'public/transitions',
];
persistentDirs.forEach((dir) => {
    const dirPath = path.join(BASE_DATA_PATH, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
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

// CORS Configuration — allow all origins (Electron uses file:// which can't be whitelisted)
app.use(
    cors({
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Runway-Token', 'X-Replicate-Token'],
        credentials: true,
    })
);

app.use(express.json({ limit: '50mb' }));

// Static Routes pointing to persistent data
app.use('/data', express.static(path.join(BASE_DATA_PATH, 'data')));
app.use('/music', express.static(path.join(BASE_DATA_PATH, 'music')));
app.use('/uploads', express.static(path.join(BASE_DATA_PATH, 'uploads')));
app.use('/narrations', express.static(path.join(BASE_DATA_PATH, 'narrations')));
app.use('/videos', express.static(path.join(BASE_DATA_PATH, 'videos')));
app.use('/mixes', express.static(path.join(BASE_DATA_PATH, 'public', 'mixes')));
app.use('/transitions', express.static(path.join(BASE_DATA_PATH, 'public', 'transitions')));
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
