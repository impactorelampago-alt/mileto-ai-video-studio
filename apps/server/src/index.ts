import express from 'express';
import { config } from './config';
import loaders from './loaders';

async function startServer() {
    const app = express();

    // Prevent server crashes from unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (err) => {
        console.error('[Server] Uncaught Exception:', err.message);
    });

    // Initialize all components
    await loaders(app);

    app.listen(config.port, () => {
        console.log(`
        🚀 Server running on http://localhost:${config.port}
        🏥 Health check: http://localhost:${config.port}/health
        🛠️ Environment: ${config.env}
        📂 Storage: ${config.baseDataPath}
        `);
    });
}

// Start the engine
startServer().catch((err) => {
    console.error('[Server] Fatal error during startup:', err);
    process.exit(1);
});
