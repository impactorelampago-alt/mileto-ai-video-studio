import { getKey } from './settings.js';
import { priceOf, release, reserve, settle } from './meter.js';

export const AUDIO_ISOLATION_KIND = 'audio_isolation';
export const AUDIO_ISOLATION_MODEL = 'elevenlabs-audio-isolation';
export const AUDIO_ISOLATION_FILE_FORMAT = 'pcm_s16le_16';
export const PCM_SAMPLE_RATE = 16_000;
export const PCM_BYTES_PER_FRAME = 2; // s16le mono: uma amostra de 16 bits por frame
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_BYTES_PER_FRAME;
export const AUDIO_ISOLATION_MAX_SECONDS = 10 * 60;
export const AUDIO_ISOLATION_MAX_BYTES = 20 * 1024 * 1024;
export const ELEVENLABS_AUDIO_ISOLATION_URL = 'https://api.elevenlabs.io/v1/audio-isolation';

class AudioIsolationInputError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'AudioIsolationInputError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Valida o contrato bruto na fronteira autenticada. A duração é sempre derivada
 * dos bytes PCM; nenhum metadado de duração enviado pelo cliente participa da
 * cobrança ou dos limites de produto.
 */
export const inspectAudioIsolationInput = ({ audio, fileFormat }) => {
    if (String(fileFormat || '').trim() !== AUDIO_ISOLATION_FILE_FORMAT) {
        throw new AudioIsolationInputError(
            400,
            'audio_isolation_invalid_format',
            `file_format deve ser ${AUDIO_ISOLATION_FILE_FORMAT}.`
        );
    }
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
        throw new AudioIsolationInputError(
            400,
            'audio_isolation_audio_required',
            'Envie o PCM bruto no campo multipart "audio".'
        );
    }
    if (audio.length > AUDIO_ISOLATION_MAX_BYTES) {
        throw new AudioIsolationInputError(
            413,
            'audio_isolation_too_large',
            'O áudio excede o limite de 20 MB.'
        );
    }
    if (audio.length % PCM_BYTES_PER_FRAME !== 0) {
        throw new AudioIsolationInputError(
            400,
            'audio_isolation_unaligned_pcm',
            'O PCM s16le mono precisa estar alinhado em frames de 2 bytes.'
        );
    }
    const durationSeconds = audio.length / PCM_BYTES_PER_SECOND;
    if (durationSeconds > AUDIO_ISOLATION_MAX_SECONDS) {
        throw new AudioIsolationInputError(
            413,
            'audio_isolation_too_long',
            'O áudio excede o limite de 10 minutos.'
        );
    }
    return { audio, durationSeconds, frameCount: audio.length / PCM_BYTES_PER_FRAME };
};

const safeProviderContentType = (value) => {
    const contentType = String(value || '').trim();
    if (!contentType || /[\r\n]/.test(contentType)) return 'application/octet-stream';
    return contentType.slice(0, 200);
};

/** Faz apenas a chamada externa; reserva e conciliação permanecem no handler. */
export const isolateWithElevenLabs = async ({ key, audio, fetchImpl = fetch }) => {
    const form = new FormData();
    form.append('audio', new Blob([audio], { type: 'audio/pcm' }), 'mileto-input.pcm');
    form.append('file_format', AUDIO_ISOLATION_FILE_FORMAT);

    const response = await fetchImpl(ELEVENLABS_AUDIO_ISOLATION_URL, {
        method: 'POST',
        headers: {
            'xi-api-key': key,
            Accept: 'audio/*, application/octet-stream',
        },
        body: form,
        signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
            `ElevenLabs Audio Isolation ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`
        );
    }
    const isolated = Buffer.from(await response.arrayBuffer());
    if (!isolated.length) throw new Error('A ElevenLabs devolveu um áudio vazio.');
    return {
        audio: isolated,
        contentType: safeProviderContentType(response.headers?.get?.('content-type')),
        demo: false,
    };
};

const billingError = (res, error) => {
    if (error?.code === 'INSUFFICIENT_CREDIT') {
        res.status(402).json({ ok: false, message: error.message });
        return true;
    }
    if (error?.code === 'ORG_SUSPENDED') {
        res.status(403).json({ ok: false, message: error.message });
        return true;
    }
    if (error?.code === 'ORG_NOT_FOUND') {
        res.status(404).json({ ok: false, message: error.message });
        return true;
    }
    return false;
};

export const createAudioIsolationHandler = (overrides = {}) => {
    const dependencies = {
        getKey,
        priceOf,
        reserve,
        release,
        settle,
        isolate: isolateWithElevenLabs,
        ...overrides,
    };

    return async (req, res) => {
        if (!req.user?.orgId) {
            return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        }

        let input;
        try {
            input = inspectAudioIsolationInput({
                audio: req.file?.buffer,
                fileFormat: req.body?.file_format,
            });
        } catch (error) {
            if (error instanceof AudioIsolationInputError) {
                return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
            }
            throw error;
        }

        const key = await dependencies.getKey('elevenLabs');
        const demo = !key;
        const quote = await dependencies.priceOf(
            'elevenLabs',
            AUDIO_ISOLATION_MODEL,
            input.durationSeconds,
            AUDIO_ISOLATION_KIND
        );

        let reserved;
        try {
            reserved = await dependencies.reserve({
                orgId: req.user.orgId,
                estCharge: quote.charged,
                demo,
            });
        } catch (error) {
            if (billingError(res, error)) return;
            throw error;
        }

        let result;
        try {
            result = demo
                ? {
                    audio: input.audio,
                    contentType: 'audio/pcm; rate=16000; channels=1',
                    demo: true,
                }
                : await dependencies.isolate({ key, audio: input.audio });
        } catch (error) {
            await dependencies.release({ orgId: req.user.orgId, reserved, demo }).catch(() => {});
            console.error('[gateway] /v1/audio-isolation provedor', error.message);
            return res.status(502).json({
                ok: false,
                code: 'AUDIO_ISOLATION_PROVIDER_ERROR',
                message: `Falha no isolamento de voz: ${error.message}`,
            });
        }

        const meta = await dependencies.settle({
            orgId: req.user.orgId,
            userId: req.user.id,
            provider: 'elevenLabs',
            model: AUDIO_ISOLATION_MODEL,
            kind: AUDIO_ISOLATION_KIND,
            units: input.durationSeconds,
            demo: result.demo,
            reserved,
        });

        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Mileto-Demo', String(result.demo));
        res.setHeader('X-Mileto-Charged', String(meta.charged));
        res.setHeader('X-Mileto-Balance', String(meta.balanceAfter));
        res.setHeader(
            'Access-Control-Expose-Headers',
            'X-Mileto-Demo, X-Mileto-Charged, X-Mileto-Balance'
        );
        return res.send(result.audio);
    };
};

export const audioIsolationHandler = createAudioIsolationHandler();
