import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

import { config } from '../config';

const FRAMES_DIR = config.paths.frameCache;
const VIDEOS_DIR = config.paths.videos;
const TEMP_DIR = path.join(config.baseDataPath, 'temp');

// ─── FFmpeg Path Configuration ───
// Detect if we are running in an Electron bundle and use the included binaries
const ffPath = process.env.FFMPEG_PATH;
const probePath = process.env.FFPROBE_PATH;

if (ffPath && fs.existsSync(ffPath)) {
    console.log(`[FFmpeg] Using bundled FFmpeg: ${ffPath}`);
    ffmpeg.setFfmpegPath(ffPath);
}
if (probePath && fs.existsSync(probePath)) {
    console.log(`[FFmpeg] Using bundled FFprobe: ${probePath}`);
    ffmpeg.setFfprobePath(probePath);
}

[FRAMES_DIR, VIDEOS_DIR, TEMP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

export interface VideoMetadata {
    duration: number;
    width?: number;
    height?: number;
}

export const getVideoMetadata = (filePath: string): Promise<VideoMetadata> => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) return reject(err);
            const stream = data.streams.find((s) => s.codec_type === 'video');
            resolve({
                duration: data.format.duration || 0,
                width: stream?.width,
                height: stream?.height,
            });
        });
    });
};

export const extractFrames = (sourceId: string, filePath: string, count = 10): Promise<string[]> => {
    const outputDir = path.join(FRAMES_DIR, sourceId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    return new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .screenshots({
                count: count,
                folder: outputDir,
                filename: 'thumb-%i.jpg',
                size: '180x?', // Smaller thumbs for strip
            })
            .on('end', () => {
                const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.jpg'));
                // Create accessible URLs
                const frames = files.map((f) => `/frames/${sourceId}/${f}`);
                resolve(frames);
            })
            .on('error', (err) => {
                console.error('Frame extraction error:', err);
                reject(err);
            });
    });
};

export const muxVideoAudio = (videoPath: string, audioPath: string, outputPath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        console.log(`[FFmpeg Mux] Video Input: ${videoPath}`);
        console.log(`[FFmpeg Mux] Audio Input: ${audioPath}`);
        console.log(`[FFmpeg Mux] Output Target: ${outputPath}`);

        let actualVideoInput = videoPath;
        let isImageSequence = false;
        let tempFramesDir = '';

        // Check if the input is our custom Jpeg sequence fallback format (.txt line-by-line base64)
        if (videoPath.endsWith('.txt')) {
            isImageSequence = true;
            console.log('[FFmpeg Mux] Detectado fallback JPG Sequence em .txt. Descompactando na memória...');
            tempFramesDir = path.join(TEMP_DIR, `frames_fallback_${Date.now()}`);
            fs.mkdirSync(tempFramesDir, { recursive: true });

            try {
                const txtContent = fs.readFileSync(videoPath, 'utf-8');
                const lines = txtContent.split('\n').filter((l) => l.trim().length > 0);

                // Write each base64 line back as physical JPG frame
                for (let i = 0; i < lines.length; i++) {
                    fs.writeFileSync(path.join(tempFramesDir, `${i}.jpg`), Buffer.from(lines[i], 'base64'));
                }

                console.log(`[FFmpeg Mux] Sucesso: ${lines.length} frames reconstruídos no disco interno.`);
                actualVideoInput = path.join(tempFramesDir, '%d.jpg');
            } catch (err) {
                console.error('[FFmpeg Mux] Fallback extraction failed:', err);
                return reject(err);
            }
        }

        // Ensure the destination directory exists (FFmpeg fails if it doesn't)
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            console.log(`[FFmpeg] Creating missing output directory: ${outputDir}`);
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const cmd = ffmpeg();

        if (isImageSequence) {
            cmd.input(actualVideoInput).inputOptions(['-framerate 30', '-f image2']);
        } else {
            cmd.input(actualVideoInput);
        }

        cmd.input(audioPath)
            .outputOptions([
                // Default re-encode
                '-c:v',
                'libx264',
                '-preset',
                'fast',
                '-crf',
                '20',
                '-pix_fmt',
                'yuv420p',
                // Audio
                '-c:a',
                'aac',
                '-b:a',
                '192k',
                // Synchronize
                '-shortest',
                '-movflags',
                '+faststart',
            ])
            .save(outputPath)
            .on('start', (cmdStr) => {
                console.log('[FFmpeg Mux] Comando Executado:', cmdStr);
            })
            .on('stderr', (line) => {
                // To avoid spamming thousands of lines of log, only log if it's not a generic frame update
                if (!line.startsWith('frame=')) {
                    console.log('[FFmpeg Mux]', line);
                }
            })
            .on('end', () => {
                console.log('[FFmpeg Mux] ✅ Mux Finalizado com Sucesso (Qualidade Absoluta)!');

                // Cleanup Fallback Junk
                if (isImageSequence && fs.existsSync(tempFramesDir)) {
                    try {
                        fs.rmSync(tempFramesDir, { recursive: true, force: true });
                    } catch {
                        /* ignore */
                    }
                }
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('[FFmpeg Mux Error]', err);
                if (isImageSequence && fs.existsSync(tempFramesDir)) {
                    try {
                        fs.rmSync(tempFramesDir, { recursive: true, force: true });
                    } catch {
                        /* ignore */
                    }
                }
                reject(err);
            });
    });
};

// ─── HYBRID PIPELINE - NATIVE C++ ENCODER ───────────────────────────────────┐

export interface HybridTake {
    id: string;
    type: 'video' | 'image';
    file_path: string;
    start: number;
    end: number;
    speed?: string | number;
    objectFit?: 'cover' | 'contain';
    muteOriginalAudio?: boolean;
}

export interface HybridParams {
    takes: HybridTake[];
    transitionPath?: string; 
    audioPath: string; 
    overlayPath: string; 
    outputPath: string;
    duration?: number; 
}

const probeHasAudio = (filePath: string): Promise<boolean> => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) return resolve(false);
            resolve(data.streams.some(s => s.codec_type === 'audio'));
        });
    });
};

export const buildHybridVideo = async (params: HybridParams): Promise<string> => {
    const { takes, transitionPath, audioPath, overlayPath, outputPath, duration } = params;
    const TARGET_W = 1080;
    const TARGET_H = 1920;

    const takeHasAudio = await Promise.all(takes.map(async (t) => {
        if (t.type !== 'video' || t.muteOriginalAudio) return false;
        return await probeHasAudio(t.file_path);
    }));

    return new Promise((resolve, reject) => {
        let actualOverlayInput = overlayPath;
        let tempOverlayDir = '';
        let isImageSequence = false;

        if (overlayPath.endsWith('.txt')) {
            isImageSequence = true;
            tempOverlayDir = overlayPath.replace(/\.txt$/, '_seq');

            if (!fs.existsSync(tempOverlayDir)) {
                console.error('[FFmpeg Hybrid] Pasta de sequencia Alpha Nativa nao encontrada:', tempOverlayDir);
                return reject(new Error('Falha catastrófica: Os frames nativos sumiram antes do Muxing.'));
            }

            const framesNoDisco = fs.readdirSync(tempOverlayDir).filter((f: string) => f.endsWith('.png')).length;
            console.log(`[FFmpeg Hybrid] Montando vídeo Híbrido com ${framesNoDisco} títulos Alpha em Disco.`);

            actualOverlayInput = path.join(tempOverlayDir, '%d.png');
        }

        // ─── BUILD FFMPEG ARGS DIRECTLY (bypass fluent-ffmpeg) ───
        const args: string[] = ['-y'];

        // Add silent audio generator to provide fallback audio for images/muted videos
        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
        const nullAudioIdx = 0; // The first input is now the silence generator!

        let currentInputIndex = 1;

        takes.forEach((t) => {
            args.push('-i', t.file_path);
            currentInputIndex++;
        });

        let transIdx = -1;
        if (transitionPath) {
            args.push('-i', transitionPath);
            transIdx = currentInputIndex;
            currentInputIndex++;
        }

        const audioIdx = currentInputIndex;
        args.push('-i', audioPath);
        currentInputIndex++;

        const overlayIdx = currentInputIndex;
        if (isImageSequence) {
            args.push('-framerate', '30', '-f', 'image2', '-i', actualOverlayInput);
        } else {
            args.push('-i', actualOverlayInput);
        }

        let filterGraph = '';
        const concatInputs: string[] = [];
        const originalTakeDurations: number[] = [];

        takes.forEach((take, index) => {
            const rawDuration = take.end - take.start;
            let setptsExpr = `PTS-STARTPTS`;
            let atempoExpr = `1.0`;
            let physicalDuration = rawDuration;

            if (typeof take.speed === 'string') {
                const D = rawDuration.toFixed(6);
                const X = `((PTS-STARTPTS)*TB)`; 

                if (take.speed === 'fast_in_slow_out') {
                    setptsExpr = `(${D}/1.5)*log(1.93/(1.93 - 1.5*${X}/${D}))/TB`;
                    atempoExpr = `1.5`; // Approximation for audio, dynamic audio speed is complex
                } else if (take.speed === 'slow_in_fast_out') {
                    setptsExpr = `(${D}/1.5)*log((0.43 + 1.5*${X}/${D})/0.43)/TB`;
                    atempoExpr = `0.75`;
                } else if (take.speed === 'swoosh') {
                    setptsExpr = `(${D}/2.104)*(atan(3.507*(${X}/${D} - 0.5)) + 1.052)/TB`;
                    atempoExpr = `1.0`; 
                }
            } else if (typeof take.speed === 'number' && take.speed !== 1) {
                setptsExpr = `${(1 / take.speed).toFixed(6)}*(PTS-STARTPTS)`;
                atempoExpr = `${take.speed}`;
                physicalDuration = rawDuration / take.speed;
            }

            originalTakeDurations.push(physicalDuration);

            // Video Filter
            const trimStr = take.type === 'video' ? `trim=start=${take.start}:duration=${rawDuration},setpts=${setptsExpr},` : '';
            const isContain = take.objectFit === 'contain';
            const scaleBase = `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=${isContain ? 'decrease' : 'increase'}`;
            const fitFilter = isContain ? `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black` : `crop=${TARGET_W}:${TARGET_H}`;
            const scaleStr = `${scaleBase},${fitFilter},setsar=1`;
            
            // Note: because input 0 is nullAudio, takes start at input 1
            const fileInputIdx = index + 1;
            filterGraph += `[${fileInputIdx}:v]${trimStr}${scaleStr}[v${index}];`;

            // Audio Filter
            if (takeHasAudio[index]) {
                const audioTrim = `atrim=start=${take.start}:duration=${rawDuration},asetpts=PTS-STARTPTS`;
                const audioSpeed = atempoExpr !== '1.0' ? `,atempo=${atempoExpr}` : '';
                filterGraph += `[${fileInputIdx}:a]${audioTrim}${audioSpeed},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${index}];`;
            } else {
                // Generate blank audio of exact physical duration using the null stream
                filterGraph += `[${nullAudioIdx}:a]atrim=duration=${physicalDuration},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${index}];`;
            }

            concatInputs.push(`[v${index}][a${index}]`);
        });

        // Concat both Video and Audio
        filterGraph += `${concatInputs.join('')}concat=n=${takes.length}:v=1:a=1[basevideo][takesaudio];`;
        let currentBase = '[basevideo]';

        // --- OVERLAY GLOBAL MATTE TRANSITION ---
        if (transitionPath && transIdx !== -1) {
            const numCuts = takes.length - 1;

            if (numCuts > 0) {
                filterGraph += `[${transIdx}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},setsar=1,format=rgba,colorkey=black:0.3:0.2`;
                if (numCuts > 1) {
                    filterGraph += `,split=${numCuts}`;
                    for (let s = 0; s < numCuts; s++) {
                        filterGraph += `[transSplit${s}]`;
                    }
                    filterGraph += ';';
                } else {
                    filterGraph += `[transSplit0];`;
                }

                let accTime = 0;
                let lastBase = currentBase;

                takes.forEach((_take, i) => {
                    const dur = originalTakeDurations[i];
                    accTime += dur;

                    if (i < takes.length - 1) {
                        const CUT_POINT = accTime;
                        const TRANS_HALF = 0.6; 
                        const overlayStart = Math.max(0, CUT_POINT - TRANS_HALF);
                        const outName = `[videoCut${i}]`;

                        filterGraph += `[transSplit${i}]setpts=PTS+${overlayStart.toFixed(3)}/TB[transDelayed${i}];`;
                        filterGraph += `${lastBase}[transDelayed${i}]overlay=0:0:enable='gte(t,${overlayStart.toFixed(3)})':eof_action=pass${outName};`;
                        lastBase = outName;
                    }
                });

                currentBase = lastBase;
            }
        }

        // Overlay do Título Transparente
        filterGraph += `[${overlayIdx}:v]colorchannelmixer=aa=1.0[alphaT];`;
        filterGraph += `${currentBase}[alphaT]overlay=eof_action=pass,fps=30[finalVideo];`;

        // Mix the takes concatenated audio with the master audio (background music/narration overlay)
        // Set master audio layout to match
        filterGraph += `[${audioIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[mastera];`;
        filterGraph += `[takesaudio][mastera]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[finalAudio]`;

        console.log('══════════════════════════════════════════════');
        console.log('[FFmpeg Hybrid Direct] FILTERGRAPH COMPLETO:');
        console.log(filterGraph);
        console.log('══════════════════════════════════════════════');

        // Build final command args
        args.push('-filter_complex', filterGraph);
        args.push('-map', '[finalVideo]');
        args.push('-map', '[finalAudio]');
        args.push('-c:v', 'libx264');
        args.push('-preset', 'fast');
        args.push('-crf', '18');
        args.push('-pix_fmt', 'yuv420p');
        args.push('-c:a', 'aac');
        args.push('-b:a', '192k');
        args.push('-shortest');

        if (duration) {
            args.push('-t', String(duration));
            console.log(`[FFmpeg Hybrid Direct] Duração travada em ${duration}s.`);
        }

        args.push(outputPath);

        // Ensure the destination directory exists (FFmpeg fails if it doesn't)
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            console.log(`[FFmpeg Hybrid Direct] Creating missing output directory: ${outputDir}`);
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log('[FFmpeg Hybrid Direct] Executando FFmpeg com', args.length, 'argumentos');

        const cleanup = () => {
            if (isImageSequence && tempOverlayDir && fs.existsSync(tempOverlayDir)) {
                try {
                    fs.rmSync(tempOverlayDir, { recursive: true, force: true });
                } catch {
                    /* ignore */
                }
            }
        };

        // Use the bundled FFmpeg path if available, fallback to global 'ffmpeg'
        const ffmpegExecutable = ffPath && fs.existsSync(ffPath) ? ffPath : 'ffmpeg';

        const proc = execFile(
            ffmpegExecutable,
            args,
            { maxBuffer: 50 * 1024 * 1024 },
            (error: Error | null, _stdout: string, stderr: string) => {
                if (error) {
                    console.error('[FFmpeg Hybrid Direct] ❌ FALHA:', error.message);
                    console.error('[FFmpeg Hybrid Direct] stderr:', stderr?.slice(-1000));
                    cleanup();
                    reject(error);
                } else {
                    console.log('[FFmpeg Hybrid Direct] ✅ Vídeo exportado com sucesso:', outputPath);
                    cleanup();
                    resolve(outputPath);
                }
            }
        );

        proc.on('error', (err: Error) => {
            console.error('[FFmpeg Hybrid Direct] Erro ao iniciar ffmpeg:', err);
            cleanup();
            reject(err);
        });
    });
};
