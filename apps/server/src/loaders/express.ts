import express from 'express';
import cors from 'cors';
import { config } from '../config';
import { requestInterceptor } from '../utils/logger';
import { errorHandler } from '../middleware/errorHandler';
import apiRoutes from '../routes/api';

export default async (app: express.Application) => {
    // Basic configurations
    app.use(requestInterceptor);
    app.use(express.json({ limit: '50mb' }));
    
    // CORS Configuration
    app.use(
        cors({
            origin: true,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Runway-Token', 'X-Replicate-Token'],
            credentials: true,
        })
    );

    // Static Routes
    app.use('/data', express.static(config.paths.data));
    app.use('/music', express.static(config.paths.music));
    app.use('/uploads', express.static(config.paths.uploads));
    app.use('/narrations', express.static(config.paths.narrations));
    app.use('/videos', express.static(config.paths.videos));
    app.use('/mixes', express.static(config.paths.mixes));
    app.use('/transitions', express.static(config.paths.transitions));
    app.use(express.static(config.paths.public));

    // Health Check & Debug
    app.get('/health', (_req, res) => {
        res.json({ ok: true, status: 'online', timestamp: new Date().toISOString() });
    });

    app.get('/debug', (_req, res) => {
        res.json({
            config,
            env: process.env.NODE_ENV,
        });
    });

    // API Routes
    app.use('/api', apiRoutes);

    // Global Error Handler
    app.use(errorHandler);
};
