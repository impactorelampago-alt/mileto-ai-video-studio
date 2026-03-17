import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// CommonJS compatible __dirname (since tsconfig.json has module: commonjs)
// In CommonJS, __dirname is already available. If this file is compiled as CJS, it works.
// If we need to support both or if tsc is being picky:
const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.resolve();

// Base path for persistent data (critical for installed version)
const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(currentDir, '..', '..', '..');

export const config = {
    port: process.env.PORT || 3301,
    baseDataPath: BASE_DATA_PATH,
    env: process.env.NODE_ENV || 'development',
    paths: {
        narrations: path.join(BASE_DATA_PATH, 'narrations'),
        voiceSamples: path.join(BASE_DATA_PATH, 'voice_samples'),
        frameCache: path.join(BASE_DATA_PATH, 'frame_cache'),
        videos: path.join(BASE_DATA_PATH, 'videos'),
        uploads: path.join(BASE_DATA_PATH, 'uploads'),
        music: path.join(BASE_DATA_PATH, 'music'),
        data: path.join(BASE_DATA_PATH, 'data'),
        projects: path.join(BASE_DATA_PATH, 'data', 'projects'),
        mixes: path.join(BASE_DATA_PATH, 'public', 'mixes'),
        transitions: path.join(BASE_DATA_PATH, 'public', 'transitions'),
        public: path.join(currentDir, '..', '..', 'public'),
    },
    apiKeys: {
        replicate: process.env.REPLICATE_API_TOKEN,
        runway: process.env.RUNWAY_API_KEY,
        openai: process.env.OPENAI_API_KEY,
        gemini: process.env.GEMINI_API_KEY,
        fishAudio: process.env.FISH_AUDIO_API_KEY,
    }
};

console.log(`[Config] Loaded with Base Data Path: ${config.baseDataPath}`);
