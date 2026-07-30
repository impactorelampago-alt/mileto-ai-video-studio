import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '../../');
const FRAMES_DIR = path.join(BASE_DATA_PATH, 'frame_cache'); // Reusing the naming convention from index.ts
const VIDEOS_DIR = path.join(BASE_DATA_PATH, 'videos');
const TEMP_DIR = path.join(BASE_DATA_PATH, 'temp');

// ─── FFmpeg Path Configuration ───
// Detect if we are running in an Electron bundle and use the included binaries
const ffPath = process.env.FFMPEG_PATH;
const probePath = process.env.FFPROBE_PATH;

if (ffPath && fs.existsSync(ffPath)) {
    console.log('[FFmpeg] Using bundled FFmpeg.');
    ffmpeg.setFfmpegPath(ffPath);
}
if (probePath && fs.existsSync(probePath)) {
    console.log('[FFmpeg] Using bundled FFprobe.');
    ffmpeg.setFfprobePath(probePath);
}

[FRAMES_DIR, VIDEOS_DIR, TEMP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Hardware-accelerated encoder detection ──────────────────────────────────
type HwEncoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';
let CACHED_ENCODER: HwEncoder | null = null;

const resolveFfmpegExe = (): string => (ffPath && fs.existsSync(ffPath) ? ffPath : 'ffmpeg');

const testEncoder = (enc: string): boolean => {
    try {
        execFileSync(
            resolveFfmpegExe(),
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'color=c=black:s=64x64:d=0.1',
                '-c:v',
                enc,
                '-f',
                'null',
                '-',
            ],
            { timeout: 10000, stdio: 'pipe' }
        );
        return true;
    } catch {
        return false;
    }
};

const detectBestEncoder = (): HwEncoder => {
    if (CACHED_ENCODER) return CACHED_ENCODER;
    if (process.env.DISABLE_GPU_ENCODE === '1') {
        console.log('[FFmpeg] GPU encode desabilitado via DISABLE_GPU_ENCODE=1 → libx264');
        CACHED_ENCODER = 'libx264';
        return CACHED_ENCODER;
    }
    let listed = '';
    try {
        listed = execFileSync(resolveFfmpegExe(), ['-hide_banner', '-encoders'], {
            encoding: 'utf8',
            timeout: 5000,
        });
    } catch (err) {
        console.warn('[FFmpeg] Falha ao listar encoders, usando libx264:', err);
        CACHED_ENCODER = 'libx264';
        return CACHED_ENCODER;
    }
    const candidates: HwEncoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf'];
    for (const enc of candidates) {
        if (listed.includes(enc) && testEncoder(enc)) {
            console.log(`[FFmpeg] ✅ Encoder de hardware ativo: ${enc}`);
            CACHED_ENCODER = enc;
            return enc;
        }
    }
    console.log('[FFmpeg] Nenhum encoder GPU disponível → libx264 (CPU)');
    CACHED_ENCODER = 'libx264';
    return 'libx264';
};

// Pre-detect once on module load so the first export call doesn't pay the cost
detectBestEncoder();

export interface EncoderArgsOpts {
    quality?: number;
    speed?: 'ultrafast' | 'veryfast' | 'fast';
}

export const getVideoEncoderArgs = (opts: EncoderArgsOpts = {}): string[] => {
    const enc = detectBestEncoder();
    const q = opts.quality ?? 20;
    const speed = opts.speed ?? 'fast';
    if (enc === 'h264_nvenc') {
        const nvPreset = speed === 'ultrafast' ? 'p1' : speed === 'veryfast' ? 'p2' : 'p4';
        return [
            '-c:v',
            'h264_nvenc',
            '-preset',
            nvPreset,
            '-rc',
            'vbr',
            '-cq',
            String(q),
            '-b:v',
            '0',
            '-pix_fmt',
            'yuv420p',
        ];
    }
    if (enc === 'h264_qsv') {
        const qsvPreset = speed === 'ultrafast' ? 'veryfast' : speed;
        return [
            '-c:v',
            'h264_qsv',
            '-preset',
            qsvPreset,
            '-global_quality',
            String(q),
            '-look_ahead',
            '0',
            '-pix_fmt',
            'nv12',
        ];
    }
    if (enc === 'h264_amf') {
        const amfQuality = speed === 'fast' ? 'balanced' : 'speed';
        return [
            '-c:v',
            'h264_amf',
            '-quality',
            amfQuality,
            '-rc',
            'cqp',
            '-qp_i',
            String(q),
            '-qp_p',
            String(q),
            '-pix_fmt',
            'yuv420p',
        ];
    }
    return ['-c:v', 'libx264', '-preset', speed, '-crf', String(q), '-pix_fmt', 'yuv420p'];
};

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
        console.log('[FFmpeg Mux] Entradas e destino temporário validados.');

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
            console.log('[FFmpeg] Creating missing temporary output directory.');
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
                ...getVideoEncoderArgs({ quality: 20, speed: 'fast' }),
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
    motionEffect?: {
        type: 'zoom-in' | 'zoom-out' | 'zoom-in-out';
        intensity: number;
        focalX: number;
        focalY: number;
        easing: 'linear' | 'smooth';
    };
}

export interface HybridParams {
    takes: HybridTake[];
    transitionPath?: string; // Global overlay transition fallback
    audioPath: string; // The Master offline mix generated by Web Audio API
    overlayPath: string; // The UI Titles rendered via webm with Alpha Channel
    outputPath: string;
    duration?: number; // Optional flag to hard-truncate the rendered output (e.g. 5s tests)
    targetW?: number; // Resolução-alvo fornecida pelo cliente (mesma usada para capturar o overlay)
    targetH?: number;
    outputFps?: number;
}

export const buildHybridVideo = async (params: HybridParams): Promise<string> => {
    // ─── Resolução-alvo: usar a que o cliente já usou para capturar o overlay,
    // senão cair para detecção via ffprobe. Divergência entre client/server causa
    // distorção ("esticamento") das legendas porque o overlay era re-escalado
    // com aspect ratio diferente.
    let TARGET_W = 1080;
    let TARGET_H = 1920;

    if (params.targetW && params.targetH && params.targetW > 0 && params.targetH > 0) {
        TARGET_W = Math.max(2, Math.floor(params.targetW / 2) * 2);
        TARGET_H = Math.max(2, Math.floor(params.targetH / 2) * 2);
        console.log(`[FFmpeg Hybrid] Resolução alinhada ao cliente: ${TARGET_W}×${TARGET_H}`);
    } else {
        const videoTakes = params.takes.filter((t) => t.type === 'video');
        if (videoTakes.length > 0) {
            let minW = Infinity;
            let minH = Infinity;
            for (const t of videoTakes) {
                try {
                    const meta = await getVideoMetadata(t.file_path);
                    if (meta.width && meta.height) {
                        if (meta.width < minW) minW = meta.width;
                        if (meta.height < minH) minH = meta.height;
                    }
                } catch (err) {
                    console.warn(
                        '[FFmpeg Hybrid] ffprobe falhou em um take:',
                        err instanceof Error ? err.message : String(err)
                    );
                }
            }
            if (Number.isFinite(minW) && Number.isFinite(minH)) {
                // Round to even (h264/yuv420p requirement)
                TARGET_W = Math.max(2, Math.floor(minW / 2) * 2);
                TARGET_H = Math.max(2, Math.floor(minH / 2) * 2);
                console.log(`[FFmpeg Hybrid] Resolução automática: ${TARGET_W}×${TARGET_H} (menor source)`);
            }
        }
    }

    return new Promise((resolve, reject) => {
        const { takes, transitionPath, audioPath, overlayPath, outputPath, duration } = params;
        const outputFps = [24, 30, 60].includes(Number(params.outputFps)) ? Number(params.outputFps) : 30;

        let actualOverlayInput = overlayPath;
        let tempOverlayDir = '';
        let isImageSequence = false;
        let isSparseSequence = false;

        if (overlayPath.endsWith('.txt')) {
            isImageSequence = true;
            tempOverlayDir = overlayPath.replace(/\.txt$/, '_seq');

            if (!fs.existsSync(tempOverlayDir)) {
                console.error('[FFmpeg Hybrid] Pasta da sequência alpha não encontrada.');
                return reject(new Error('Falha catastrófica: Os frames nativos sumiram antes do Muxing.'));
            }

            const sequenceFiles = fs
                .readdirSync(tempOverlayDir)
                .filter((f: string) => f.endsWith('.webp') || f.endsWith('.png'));
            console.log(`[FFmpeg Hybrid] Montando vídeo Híbrido com ${sequenceFiles.length} quadros alpha únicos.`);

            try {
                const metadata = JSON.parse(fs.readFileSync(overlayPath, 'utf8')) as {
                    version?: number;
                    sparse?: boolean;
                    frameCount?: number;
                    fps?: number;
                    extension?: string;
                };
                if (metadata.version === 2 && metadata.sparse && Number(metadata.frameCount) > 0) {
                    const sparseFps = Number(metadata.fps) > 0 ? Number(metadata.fps) : outputFps;
                    const extension = metadata.extension === 'webp' ? 'webp' : 'png';
                    const sparseFrames = sequenceFiles
                        .filter((fileName) => fileName.endsWith(`.${extension}`) && /^\d+\./.test(fileName))
                        .map((fileName) => ({
                            fileName,
                            frameIndex: Number(fileName.slice(0, fileName.indexOf('.'))),
                        }))
                        .filter((frame) => Number.isFinite(frame.frameIndex))
                        .sort((a, b) => a.frameIndex - b.frameIndex);

                    if (!sparseFrames.length) throw new Error('A sequência alpha não contém quadros válidos.');

                    const totalFrames = Math.max(Number(metadata.frameCount), sparseFrames.at(-1)!.frameIndex + 1);
                    const concatLines = ['ffconcat version 1.0'];
                    sparseFrames.forEach((frame, index) => {
                        const nextFrameIndex = sparseFrames[index + 1]?.frameIndex ?? totalFrames;
                        const durationSeconds = Math.max(1, nextFrameIndex - frame.frameIndex) / sparseFps;
                        concatLines.push(`file '${frame.fileName}'`);
                        concatLines.push(`duration ${durationSeconds.toFixed(9)}`);
                    });
                    concatLines.push(`file '${sparseFrames.at(-1)!.fileName}'`);

                    actualOverlayInput = path.join(tempOverlayDir, 'frames.ffconcat');
                    fs.writeFileSync(actualOverlayInput, `${concatLines.join('\n')}\n`, 'utf8');
                    isSparseSequence = true;
                    console.log(
                        `[FFmpeg Hybrid] Sequência esparsa: ${sparseFrames.length} imagens para ${totalFrames} quadros finais.`
                    );
                }
            } catch (error) {
                const marker = fs.readFileSync(overlayPath, 'utf8').trim();
                if (marker.startsWith('{')) {
                    return reject(error instanceof Error ? error : new Error('Índice esparso da exportação inválido.'));
                }
                console.warn('[FFmpeg Hybrid] Índice esparso indisponível; usando sequência legada.', error);
            }

            if (!isSparseSequence) {
                // Detect frame extension (webp preferred, png fallback for legacy sessions)
                const hasWebp = sequenceFiles.some((f: string) => f.endsWith('.webp'));
                actualOverlayInput = path.join(tempOverlayDir, hasWebp ? '%d.webp' : '%d.png');
            }
        }

        // ─── BUILD FFMPEG ARGS DIRECTLY (bypass fluent-ffmpeg) ───
        const args: string[] = ['-y'];

        // Input files
        let currentInputIndex = 0;

        interface TakeData {
            file_path: string;
            type: string;
            start: number;
            end: number;
            speed?: string | number;
            objectFit?: 'cover' | 'contain';
            motionEffect?: HybridTake['motionEffect'];
        }

        (takes as TakeData[]).forEach((t) => {
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
        if (isSparseSequence) {
            args.push('-f', 'concat', '-safe', '0', '-i', actualOverlayInput);
        } else if (isImageSequence) {
            args.push('-framerate', String(outputFps), '-f', 'image2', '-i', actualOverlayInput);
        } else {
            args.push('-i', actualOverlayInput);
        }

        // ─── BUILD COMPLEX FILTERGRAPH ───
        console.log(
            '[FFmpeg Hybrid Direct] Transição:',
            transitionPath ? 'configurada' : 'ausente',
            '| transIdx:',
            transIdx
        );
        takes.forEach((t, i) =>
            console.log(`  Take[${i}]: speed=${t.speed}, start=${t.start}, end=${t.end}, type=${t.type}`)
        );

        let filterGraph = '';
        const concatInputs: string[] = [];
        const originalTakeDurations: number[] = []; // Store true physical durations for cut calculations

        takes.forEach((take, index) => {
            const rawDuration = take.end - take.start;
            let setptsExpr = `PTS-STARTPTS`;
            let physicalDuration = rawDuration;

            // Advanced non-linear time remapping (Calculus integrals converted to FFmpeg Expr)
            if (typeof take.speed === 'string') {
                const D = rawDuration.toFixed(6);
                const X = `((PTS-STARTPTS)*TB)`; // Elapsed input time in seconds

                if (take.speed === 'fast_in_slow_out') {
                    // t_out(x) = (D/1.5) * ln(1.93 / (1.93 - 1.5*(X/D)))
                    setptsExpr = `(${D}/1.5)*log(1.93/(1.93 - 1.5*${X}/${D}))/TB`;
                } else if (take.speed === 'slow_in_fast_out') {
                    // t_out(x) = (D/1.5) * ln((0.43 + 1.5*(X/D)) / 0.43)
                    setptsExpr = `(${D}/1.5)*log((0.43 + 1.5*${X}/${D})/0.43)/TB`;
                } else if (take.speed === 'swoosh') {
                    // t_out(x) = (D/2.104) * (atan(3.507*(x/D - 0.5)) + 1.052)
                    setptsExpr = `(${D}/2.104)*(atan(3.507*(${X}/${D} - 0.5)) + 1.052)/TB`;
                }
            } else if (typeof take.speed === 'number' && take.speed !== 1) {
                // Flat uniform speed modifier
                setptsExpr = `${(1 / take.speed).toFixed(6)}*(PTS-STARTPTS)`;
                physicalDuration = rawDuration / take.speed;
            }

            originalTakeDurations.push(physicalDuration);

            const trimStr =
                take.type === 'video' ? `trim=start=${take.start}:duration=${rawDuration},setpts=${setptsExpr},` : '';
            const isContain = take.objectFit === 'contain';
            // O movimento usa uma tela intermediária em 2x. O zoompan mantém a saída
            // com dimensões fixas em todos os quadros; isso evita o arredondamento
            // alternado de scale + crop que fazia a imagem vibrar na exportação.
            const motionFactor = take.motionEffect ? 2 : 1;
            const workingW = Math.max(2, Math.round((TARGET_W * motionFactor) / 2) * 2);
            const workingH = Math.max(2, Math.round((TARGET_H * motionFactor) / 2) * 2);
            const scaleBase = `scale=${workingW}:${workingH}:force_original_aspect_ratio=${isContain ? 'decrease' : 'increase'}`;
            const fitFilter = isContain
                ? `pad=${workingW}:${workingH}:(ow-iw)/2:(oh-ih)/2:color=black`
                : `crop=${workingW}:${workingH}`;
            const scaleStr = `${scaleBase},${fitFilter},setsar=1`;
            let motionStr = '';
            if (take.motionEffect) {
                const effect = take.motionEffect;
                const amount = Math.min(0.35, Math.max(0.02, Number(effect.intensity) || 0.12));
                const motionDuration = Math.max(0.001, physicalDuration);
                const motionFrameDenominator = Math.max(1, Math.round(motionDuration * outputFps) - 1);
                const p = `min(max(on/${motionFrameDenominator},0),1)`;
                const motionProgress =
                    effect.type === 'zoom-in-out' ? `(if(lt(${p},0.5),2*(${p}),2*(1-(${p}))))` : `(${p})`;
                const eased =
                    effect.easing === 'smooth'
                        ? `((${motionProgress})*(${motionProgress})*(3-2*(${motionProgress})))`
                        : motionProgress;
                const zoom =
                    effect.type === 'zoom-out'
                        ? `(1+${amount.toFixed(6)}*(1-${eased}))`
                        : `(1+${amount.toFixed(6)}*${eased})`;
                const focalX = Math.min(1, Math.max(0, (Number(effect.focalX) || 50) / 100));
                const focalY = Math.min(1, Math.max(0, (Number(effect.focalY) || 50) / 100));
                const zoomPanX = `(iw-iw/zoom)*${focalX.toFixed(4)}`;
                const zoomPanY = `(ih-ih/zoom)*${focalY.toFixed(4)}`;
                motionStr = `,format=yuv444p,zoompan=z='${zoom}':x='${zoomPanX}':y='${zoomPanY}':d=1:s=${workingW}x${workingH}:fps=${outputFps},scale=${TARGET_W}:${TARGET_H}:flags=lanczos,format=yuv420p`;
            }

            filterGraph += `[${index}:v]${trimStr}${scaleStr}${motionStr}[v${index}];`;
            concatInputs.push(`[v${index}]`);
        });

        filterGraph += `${concatInputs.join('')}concat=n=${takes.length}:v=1:a=0[basevideo];`;
        let currentBase = '[basevideo]';

        // --- OVERLAY GLOBAL MATTE TRANSITION ---
        if (transitionPath && transIdx !== -1) {
            const numCuts = takes.length - 1;

            if (numCuts > 0) {
                // Apply cover logic exactly like the video takes to prevent distorted/zoomed transitions
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
                        const TRANS_HALF = 0.6; // Duração hardcoded default do alpha trans fallback antigo
                        const overlayStart = Math.max(0, CUT_POINT - TRANS_HALF);
                        const outName = `[videoCut${i}]`;

                        // Atrasa o início físico da stream da transição para coincidir com o tempo do corte
                        filterGraph += `[transSplit${i}]setpts=PTS+${overlayStart.toFixed(3)}/TB[transDelayed${i}];`;
                        filterGraph += `${lastBase}[transDelayed${i}]overlay=0:0:enable='gte(t,${overlayStart.toFixed(3)})':eof_action=pass${outName};`;
                        lastBase = outName;
                    }
                });

                currentBase = lastBase;
            }
        }

        // Overlay do Título Transparente — preserva o aspect ratio do PNG capturado.
        // Se o overlay foi gravado no mesmo TARGET, o scale é no-op. Caso contrário,
        // encaixa (decrease) e preenche com transparente, evitando deformação das legendas.
        filterGraph += `[${overlayIdx}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,colorchannelmixer=aa=1.0[alphaT];`;
        filterGraph += `${currentBase}[alphaT]overlay=eof_action=pass,fps=${outputFps}[finalVideo]`;

        console.log('══════════════════════════════════════════════');
        console.log('[FFmpeg Hybrid Direct] FILTERGRAPH COMPLETO:');
        console.log(filterGraph);
        console.log('══════════════════════════════════════════════');

        // Build final command args
        args.push('-filter_complex', filterGraph);
        args.push('-map', '[finalVideo]');
        args.push('-map', `${audioIdx}:a`);
        args.push(...getVideoEncoderArgs({ quality: 18, speed: 'fast' }));
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
            console.log('[FFmpeg Hybrid Direct] Criando diretório temporário de saída.');
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
                    console.log('[FFmpeg Hybrid Direct] ✅ Vídeo exportado com sucesso.');
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
