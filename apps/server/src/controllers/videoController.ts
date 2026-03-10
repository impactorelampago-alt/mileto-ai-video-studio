import { Request, Response } from 'express';
import { getVideoMetadata, extractFrames, muxVideoAudio } from '../services/ffmpeg';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';

export const uploadVideo = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });

        const mimeType = req.file.mimetype;
        const isVideo = mimeType.startsWith('video/');
        const isImage = mimeType.startsWith('image/');

        let duration = 0;
        let frames: string[] = [];
        const sourceId = path.parse(req.file.filename).name;

        if (isVideo) {
            const metadata = await getVideoMetadata(req.file.path);
            duration = metadata.duration;
            // Frames for video
            frames = await extractFrames(sourceId, req.file.path);
        } else if (isImage) {
            duration = 3.5;
        }

        // PROXY GENERATION (Auto-convert to safe MP4)
        let proxyUrl = '';
        if (isVideo) {
            const originalPath = req.file.path;
            const dir = path.dirname(originalPath);
            const ext = path.extname(originalPath);
            const basename = path.basename(originalPath, ext);

            const proxyFilename = `${basename}_proxy.mp4`;
            const proxyPath = path.join(dir, proxyFilename);

            // Generate URL immediately (assuming successful generation or async)
            // But we will await it to ensure it exists for immediate preview
            try {
                console.log('[Proxy] Generating proxy for:', originalPath);

                await new Promise<void>((resolve, _reject) => {
                    const ffmpeg = spawn('ffmpeg', [
                        '-y',
                        '-i',
                        originalPath,
                        '-vf',
                        'scale=720:-2', // 720p width, maintain aspect ratio
                        '-c:v',
                        'libx264',
                        '-preset',
                        'veryfast',
                        '-crf',
                        '26', // Lower quality for preview is fine
                        '-pix_fmt',
                        'yuv420p',
                        '-movflags',
                        '+faststart',
                        '-c:a',
                        'aac',
                        '-b:a',
                        '128k',
                        proxyPath,
                    ]);

                    ffmpeg.stderr.on('data', (data: Buffer) => {
                        console.log('[Proxy ffmpeg]', data.toString().trim());
                    });

                    ffmpeg.on('close', (code) => {
                        if (code === 0) {
                            console.log('[Proxy] Success:', proxyPath);
                            resolve();
                        } else {
                            console.error('[Proxy] FFmpeg failed with code', code);
                            resolve(); // Resolve to allow upload to complete even if proxy fails
                        }
                    });

                    ffmpeg.on('error', (err) => {
                        console.error('[Proxy] Spawn error:', err);
                        resolve();
                    });
                });

                if (fs.existsSync(proxyPath)) {
                    const stats = fs.statSync(proxyPath);
                    if (stats.size > 1000) {
                        // arbitrary small size to ensure it's not empty header
                        proxyUrl = `/uploads/${proxyFilename}`;
                        console.log('[Proxy] Assigned URL:', proxyUrl);
                    } else {
                        console.warn('[Proxy] Generated file is too small, ignoring:', stats.size);
                    }
                } else {
                    console.warn('[Proxy] File not found after generation attempt:', proxyPath);
                }
            } catch (e) {
                console.error('[Proxy] Exception:', e);
            }
        }

        res.json({
            ok: true,
            source: {
                id: sourceId,
                path: req.file.path,
                fileName: req.file.originalname,
                duration: duration,
                frames,
                type: isVideo ? 'video' : 'image',
                url: `/uploads/${path.basename(req.file.filename)}`, // Web-accessible URL
                proxyUrl: proxyUrl, // Return the safe proxy URL
            },
        });
    } catch (error: any) {
        console.error('Upload Error:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};

export const muxFinalExport = async (req: Request, res: Response) => {
    try {
        let { videoPath } = req.body;
        const { audioPath, outputPath } = req.body;
        if (!videoPath || !audioPath || !outputPath) {
            return res.status(400).json({ ok: false, message: 'Missing paths for muxing' });
        }

        // Verify files exist before muxing
        const fsCheck = await import('fs');
        let videoExists = fsCheck.existsSync(videoPath);

        // Auto-detect fallback TXT sequence if MP4 doesn't exist
        if (!videoExists && videoPath.match(/\.(mp4|webm)$/)) {
            const txtFallbackPath = videoPath.replace(/\.(mp4|webm)$/, '.txt');
            if (fsCheck.existsSync(txtFallbackPath)) {
                videoPath = txtFallbackPath;
                videoExists = true;
                console.log(`[Mux] Auto-detectado fallback arquivo TXT para Video Input.`);
            }
        }

        const audioExists = fsCheck.existsSync(audioPath);
        const videoSize = videoExists ? fsCheck.statSync(videoPath).size : 0;
        const audioSize = audioExists ? fsCheck.statSync(audioPath).size : 0;

        console.log(`[Mux] Video: ${videoPath} (existe=${videoExists}, ${(videoSize / 1024).toFixed(0)}KB)`);
        console.log(`[Mux] Audio: ${audioPath} (existe=${audioExists}, ${(audioSize / 1024).toFixed(0)}KB)`);
        console.log(`[Mux] Output: ${outputPath}`);

        if (!videoExists) {
            return res.status(400).json({ ok: false, message: `Arquivo de vídeo não encontrado: ${videoPath}` });
        }
        if (!audioExists) {
            return res.status(400).json({ ok: false, message: `Arquivo de áudio não encontrado: ${audioPath}` });
        }

        const finalPath = await muxVideoAudio(videoPath, audioPath, outputPath);
        res.json({ ok: true, finalPath });
    } catch (error: any) {
        console.error('Mux Error:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};

// ─── HYBRID PIPELINE ────────────────────────────────────────────────────────┐
import { buildHybridVideo } from '../services/ffmpeg';

export const exportHybrid = async (req: Request, res: Response) => {
    try {
        const { takes, transitionPath, audioPath, finalPath, duration } = req.body;
        let { overlayPath } = req.body;

        console.log('--- [HYBRID EXPORT INITIATED] ---');
        console.log(`Takes Count: ${takes?.length}`);
        console.log(`Transition: ${transitionPath}`);
        console.log(`Audio File: ${audioPath}`);
        console.log(`Overlay File: ${overlayPath}`);
        console.log(`Output: ${finalPath}`);

        // Detailed take-level diagnostics
        const fsEarly = await import('fs');
        takes?.forEach((t: any, i: number) => {
            const exists = t.file_path ? fsEarly.existsSync(t.file_path) : false;
            console.log(
                `  Take[${i}]: file_path=${t.file_path} (exists=${exists}), speed=${t.speed}, start=${t.start}, end=${t.end}`
            );
        });
        if (transitionPath) {
            console.log(`  TransitionPath exists on disk: ${fsEarly.existsSync(transitionPath)}`);
        } else {
            console.log(`  WARNING: TransitionPath is undefined/null/empty!`);
        }

        if (!takes || takes.length === 0 || !finalPath) {
            return res.status(400).json({ ok: false, message: 'Parametros Insuficientes (takes, finalPath)' });
        }

        const fsCheck = await import('fs');
        const audioExists = fsCheck.existsSync(audioPath);
        let overlayExists = fsCheck.existsSync(overlayPath);

        // Auto-detect fallback TXT sequence if MP4/WebM doesn't exist
        if (!overlayExists && overlayPath.match(/\.(mp4|webm)$/)) {
            const txtFallbackPath = overlayPath.replace(/\.(mp4|webm)$/, '.txt');
            if (fsCheck.existsSync(txtFallbackPath) || fsCheck.existsSync(txtFallbackPath.replace(/\.txt$/, '_seq'))) {
                overlayPath = txtFallbackPath;
                overlayExists = true;
                console.log(`[HYBRID] Auto-detectado fallback arquivo TXT para Overlay Input.`);
            }
        } else if (!overlayExists && overlayPath.endsWith('.txt')) {
            // Garante que se o Node.js Backend já gravou a pasta pura mas pulou o txt temporário, passa na verificação
            if (fsCheck.existsSync(overlayPath.replace(/\.txt$/, '_seq'))) {
                overlayExists = true;
                console.log(`[HYBRID] A pasta _seq existe fisicamente, bypass no flag de OverlayExists!`);
            }
        }

        console.log(`[HYBRID] Check Audio File: ${audioPath} - EXISTS: ${audioExists}`);
        console.log(`[HYBRID] Check Overlay File: ${overlayPath} - EXISTS: ${overlayExists}`);

        if (!audioExists) {
            return res
                .status(400)
                .json({ ok: false, message: `Áudio Mestre não encontrado no HD (Falha interna IPC): ${audioPath}` });
        }
        if (!overlayExists) {
            return res
                .status(400)
                .json({ ok: false, message: `Vídeo Base Alpha/Tela Verde não encontrado: ${overlayPath}` });
        }

        // Call our shiny new C++ bridge implementation
        await buildHybridVideo({
            takes,
            transitionPath,
            audioPath,
            overlayPath,
            outputPath: finalPath,
            duration,
        });

        res.json({ ok: true, message: 'Exportação Híbrida concluída puramente por Hardware.' });
    } catch (e: any) {
        console.error('[HYBRID EXPORT ERR]:', e);
        res.status(500).json({ ok: false, message: e.message || 'Erro fatídico ao construir video hibrido' });
    }
};
