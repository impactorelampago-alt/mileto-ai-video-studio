import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { createModel, getAudioDuration } from '../services/fishAudio';
import { listVoices as listElevenLabsVoices } from '../services/elevenlabs';
import { getProviderLabel, isTtsProvider } from '../services/ttsProviders';
import { TtsProvider, VoiceSettings, isFishModel } from '../services/ttsTypes';
import { synthesizeViaGateway } from '../services/gatewayNarration';
import { bearerFrom, GatewayHttpError } from '../services/gatewayClient';

const NARRATION_DIR = path.join(process.env.USER_DATA_PATH || path.join(__dirname, '..', '..'), 'narrations');

/**
 * POST /api/tts/upload-recording — a pessoa gravou a própria voz (não quer IA).
 * Recebe o áudio gravado, converte para mp3 em narrations/ e devolve url+duração.
 * NÃO passa pelo gateway nem cobra crédito: é a voz do próprio usuário.
 */
export const uploadNarrationRecording = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, message: 'Nenhum áudio enviado.' });
        if (!fs.existsSync(NARRATION_DIR)) fs.mkdirSync(NARRATION_DIR, { recursive: true });

        const src = req.file.path; // uploads/<uuid>.webm (multer)
        const outName = `narration-rec-${randomUUID()}.mp3`;
        const outPath = path.join(NARRATION_DIR, outName);

        await new Promise<void>((resolve, reject) => {
            ffmpeg(src)
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .save(outPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        try {
            fs.unlinkSync(src);
        } catch {
            /* temp já removido */
        }

        const duration = await getAudioDuration(outPath);
        res.json({ ok: true, url: `/narrations/${outName}`, duration });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Erro ao salvar a gravação';
        console.error('[TTS] upload-recording:', msg);
        res.status(500).json({ ok: false, message: msg });
    }
};

/**
 * O provedor vem do cliente porque cada voz salva sabe a qual serviço pertence.
 * Sem `provider` no corpo, mantém o comportamento histórico (Fish Audio).
 */
const resolveProvider = (raw: unknown): TtsProvider => (isTtsProvider(raw) ? raw : 'fishAudio');

const parseSettings = (raw: unknown): VoiceSettings | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const { speed, volume, stability, similarityBoost, fishModel } = raw as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const settings: VoiceSettings = {
        speed: num(speed),
        volume: num(volume),
        stability: num(stability),
        similarityBoost: num(similarityBoost),
        fishModel: isFishModel(fishModel) ? fishModel : undefined,
    };
    return Object.values(settings).some((v) => v !== undefined) ? settings : undefined;
};

const handleSynthesis = async (req: Request, res: Response, label: string) => {
    const { voiceId, text, voiceSettings } = req.body;
    const provider = resolveProvider(req.body.provider);
    const token = bearerFrom(req);

    if (!voiceId || !text) {
        return res.status(400).json({ ok: false, message: 'Missing parameters (voiceId, text)' });
    }
    if (!token) {
        return res.status(401).json({ ok: false, message: 'Sessão expirada. Entre novamente para gerar narração.' });
    }

    console.log(`[TTS] ${label} requested — ${getProviderLabel(provider)} · voice ${voiceId}`);

    const result = await synthesizeViaGateway(token, provider, voiceId, text, parseSettings(voiceSettings));
    res.json({ ok: true, provider, url: result.url, path: result.path, duration: result.duration, demo: result.demo });
};

/** Traduz erros do gateway (401 sessão, 402 saldo) para o app. */
const sendTtsError = (res: Response, error: unknown, label: string) => {
    if (error instanceof GatewayHttpError) {
        console.error(`[TTS] ${label} gateway error ${error.status}:`, error.message);
        return res.status(error.status).json({ ok: false, message: error.message });
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[TTS] ${label} error:`, message);
    res.status(500).json({ ok: false, message });
};

export const previewVoice = async (req: Request, res: Response) => {
    try {
        await handleSynthesis(req, res, 'Preview');
    } catch (error: unknown) {
        sendTtsError(res, error, 'Preview');
    }
};

export const createNarration = async (req: Request, res: Response) => {
    try {
        await handleSynthesis(req, res, 'Narration');
    } catch (error: unknown) {
        sendTtsError(res, error, 'Narration');
    }
};

/**
 * Lista as vozes da conta do usuário no provedor escolhido.
 * Hoje só a ElevenLabs expõe esse catálogo — a Fish Audio não tem endpoint
 * equivalente de "minhas vozes", então lá continua sendo por ID ou clonagem.
 */
export const listProviderVoices = async (req: Request, res: Response) => {
    try {
        const { apiKey } = req.body;
        const provider = resolveProvider(req.body.provider);

        if (!apiKey) {
            return res.status(400).json({ ok: false, message: 'API Key is required' });
        }

        if (provider !== 'elevenLabs') {
            return res.status(400).json({
                ok: false,
                message: 'Listagem de vozes disponível apenas para ElevenLabs.',
            });
        }

        const voices = await listElevenLabsVoices(apiKey);
        console.log(`[TTS] Listed ${voices.length} ElevenLabs voices`);
        res.json({ ok: true, provider, voices });
    } catch (error: any) {
        console.error('[TTS] List voices error:', error.message);
        res.status(500).json({ ok: false, message: error.message });
    }
};

export const cloneVoice = async (req: Request, res: Response) => {
    try {
        const apiKey = req.body.apiKey;
        const voiceName = req.body.voiceName || 'Cloned Voice';

        if (!apiKey) {
            return res.status(400).json({ ok: false, message: 'Fish Audio API Key is required.' });
        }

        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'No audio file uploaded.' });
        }

        let fileBuffer: Buffer;
        if (req.file.buffer) {
            fileBuffer = req.file.buffer;
        } else if (req.file.path) {
            fileBuffer = fs.readFileSync(req.file.path);
        } else {
            return res.status(400).json({ ok: false, message: 'File payload is empty.' });
        }

        const fileName = req.file.originalname || 'audio.mp3';
        const mimeType = req.file.mimetype || 'audio/mpeg';

        console.log(`[TTS] Clone Voice requested: ${voiceName} (${fileName}, ${mimeType})`);

        const modelData = await createModel(voiceName, fileBuffer, fileName, mimeType, apiKey);

        if (req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('[TTS] Could not delete temp file:', err);
            });
        }

        res.json({
            ok: true,
            message: 'Voice cloned successfully',
            modelId: modelData._id,
            modelTitle: modelData.title,
            // Clonagem por gravação/upload só existe na Fish Audio hoje.
            provider: 'fishAudio' as TtsProvider,
        });
    } catch (error: any) {
        console.error('[TTS] Voice Clone error:', error);
        res.status(500).json({ ok: false, message: error.message || 'Error cloning voice' });
    }
};
