import express from 'express';
import expressLoader from './express';
import directoriesLoader from './directories';

export default async (app: express.Application) => {
    console.log('[Loader] Starting all loaders...');
    
    // 1. Initialize directories (Critical for data persistence)
    await directoriesLoader();
    console.log('[Loader] Directories initialized.');

    // 2. Setup Express middleares and routes
    await expressLoader(app);
    console.log('[Loader] Express initialized.');

    console.log('[Loader] Application successfully loaded.');
};
