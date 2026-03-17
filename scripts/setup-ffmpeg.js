import fs from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '../apps/client/resources/bin');

console.log('--- Automating FFmpeg Binary Setup ---');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

const ext = process.platform === 'win32' ? '.exe' : '';
const ffmpegTarget = path.join(targetDir, `ffmpeg${ext}`);
const ffprobeTarget = path.join(targetDir, `ffprobe${ext}`);

try {
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        fs.copyFileSync(ffmpegStatic, ffmpegTarget);
        console.log(`[OK] FFmpeg binary copied to: ${ffmpegTarget}`);
    } else {
        console.error('[Error] FFmpeg binary not found in ffmpeg-static');
    }

    if (ffprobeStatic && ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) {
        fs.copyFileSync(ffprobeStatic.path, ffprobeTarget);
        console.log(`[OK] FFprobe binary copied to: ${ffprobeTarget}`);
    } else {
        console.error('[Error] FFprobe binary not found in ffprobe-static');
    }
} catch (error) {
    console.error('[Error] Failed to copy FFmpeg binaries:', error);
}

console.log('--- Setup Complete ---');
