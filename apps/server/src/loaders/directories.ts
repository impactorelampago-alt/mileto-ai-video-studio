import fs from 'fs';
import { config } from '../config';

export default async () => {
    console.log('[Loader] Initializing directories...');
    
    const dirs = [
        config.paths.narrations,
        config.paths.voiceSamples,
        config.paths.frameCache,
        config.paths.videos,
        config.paths.uploads,
        config.paths.music,
        config.paths.data,
        config.paths.projects,
        config.paths.mixes,
        config.paths.transitions,
    ];

    dirs.forEach((dir) => {
        if (!fs.existsSync(dir)) {
            console.log(`[Loader] Creating directory: ${dir}`);
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    console.log('[Loader] Directories initialized.');
};
