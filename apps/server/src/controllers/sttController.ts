import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { bearerFrom, gatewayStt, GatewayHttpError } from '../services/gatewayClient';
import { reconcileCaptionWords } from '../services/captionReconciliation';
import { segmentCaptionWords } from '../services/captionSegmentation';
import { safeResolve } from '../utils/safePath';

// Static-route prefix → diretório físico no USER_DATA_PATH (espelha index.ts).
// Fonte única da verdade para resolver URLs relativas servidas pelo Express.
const STATIC_ROUTE_MAP: Record<string, string> = {
    '/narrations/': 'narrations',
    '/uploads/': 'uploads',
    '/videos/': 'videos',
    '/mixes/': 'public/mixes',
    '/music/': 'music',
    '/transitions/': 'public/transitions',
    '/data/': 'data',
};

const resolveLocalAudioPath = (audioUrl: string): string | null => {
    const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');

    // SEM atalho de caminho absoluto: aceitar `/etc/passwd` ou `C:\...\id_rsa` aqui
    // permitiria transcrever (e exfiltrar via gateway) qualquer arquivo do disco.
    let pathname = String(audioUrl || '');
    try {
        if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
    } catch {
        return null;
    }

    if (!pathname.startsWith('/')) pathname = '/' + pathname;

    for (const [prefix, dir] of Object.entries(STATIC_ROUTE_MAP)) {
        if (pathname.startsWith(prefix)) {
            const rel = pathname.slice(prefix.length).replace(/^\/+/, '');
            try {
                // safeResolve garante que `/narrations/../../../...` não escape do dir de dados.
                return safeResolve(BASE_DATA_PATH, dir, rel);
            } catch {
                return null;
            }
        }
    }

    return null;
};

export const generateCaptions = async (req: Request, res: Response) => {
    try {
        const { audioUrl, narrationText } = req.body;
        const token = bearerFrom(req);

        if (!audioUrl) {
            return res.status(400).json({ ok: false, message: 'Falta audioUrl.' });
        }
        if (!token) {
            return res.status(401).json({ ok: false, message: 'Sessão expirada. Entre novamente para gerar legendas.' });
        }

        console.log('[STT] Iniciando transcrição via gateway para:', audioUrl);

        const filePath = resolveLocalAudioPath(audioUrl);

        if (!filePath || !fs.existsSync(filePath)) {
            console.error('[STT] Arquivo de áudio não encontrado localmente:', filePath, 'originalUrl:', audioUrl);
            return res.status(404).json({
                ok: false,
                message: `Áudio não encontrado no servidor: ${filePath || audioUrl}. Gere a narração novamente antes de criar legendas.`,
            });
        }

        // Bypass Whisper API explicitly for the default narration test track
        if (path.basename(filePath) === 'default-narration.mp3') {
            console.log('[STT] Default narration detected. Bypassing Whisper API to save credits.');
            const defaultSegments = [
                {
                    id: crypto.randomUUID(),
                    start: 0.1,
                    end: 1.5,
                    text: 'ATENÇÃO, ATENÇÃO!',
                    words: [
                        { text: 'ATENÇÃO,', start: 0.1, end: 0.8 },
                        { text: 'ATENÇÃO!', start: 0.8, end: 1.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 1.8,
                    end: 4.5,
                    text: 'NESTA SEMANA, A ÓTICA VIVAZ AVARÉ LIBEROU',
                    words: [
                        { text: 'NESTA', start: 1.8, end: 2.1 },
                        { text: 'SEMANA,', start: 2.1, end: 2.5 },
                        { text: 'A', start: 2.5, end: 2.6 },
                        { text: 'ÓTICA', start: 2.6, end: 3.0 },
                        { text: 'VIVAZ', start: 3.0, end: 3.5 },
                        { text: 'AVARÉ', start: 3.5, end: 4.0 },
                        { text: 'LIBEROU', start: 4.0, end: 4.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 4.6,
                    end: 6.8,
                    text: 'UMA CONDIÇÃO ESPECIAL PARA VOCÊ TROCAR',
                    words: [
                        { text: 'UMA', start: 4.6, end: 4.8 },
                        { text: 'CONDIÇÃO', start: 4.8, end: 5.5 },
                        { text: 'ESPECIAL', start: 5.5, end: 6.0 },
                        { text: 'PARA', start: 6.0, end: 6.2 },
                        { text: 'VOCÊ', start: 6.2, end: 6.4 },
                        { text: 'TROCAR', start: 6.4, end: 6.8 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 6.9,
                    end: 8.5,
                    text: 'SEUS ÓCULOS.',
                    words: [
                        { text: 'SEUS', start: 6.9, end: 7.3 },
                        { text: 'ÓCULOS.', start: 7.3, end: 8.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 8.8,
                    end: 11.0,
                    text: 'NA COMPRA DOS ÓCULOS COMPLETOS,',
                    words: [
                        { text: 'NA', start: 8.8, end: 9.0 },
                        { text: 'COMPRA', start: 9.0, end: 9.5 },
                        { text: 'DOS', start: 9.5, end: 9.8 },
                        { text: 'ÓCULOS', start: 9.8, end: 10.3 },
                        { text: 'COMPLETOS,', start: 10.3, end: 11.0 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 11.1,
                    end: 13.5,
                    text: 'VOCÊ LEVA A ARMAÇÃO POR APENAS',
                    words: [
                        { text: 'VOCÊ', start: 11.1, end: 11.4 },
                        { text: 'LEVA', start: 11.4, end: 11.8 },
                        { text: 'A', start: 11.8, end: 12.0 },
                        { text: 'ARMAÇÃO', start: 12.0, end: 12.8 },
                        { text: 'POR', start: 12.8, end: 13.1 },
                        { text: 'APENAS', start: 13.1, end: 13.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 13.6,
                    end: 15.0,
                    text: 'R$39,90.',
                    words: [{ text: 'R$39,90.', start: 13.6, end: 15.0 }],
                },
                {
                    id: crypto.randomUUID(),
                    start: 15.3,
                    end: 17.5,
                    text: 'E FAZENDO SEUS ÓCULOS COM A GENTE,',
                    words: [
                        { text: 'E', start: 15.3, end: 15.5 },
                        { text: 'FAZENDO', start: 15.5, end: 16.0 },
                        { text: 'SEUS', start: 16.0, end: 16.5 },
                        { text: 'ÓCULOS', start: 16.5, end: 17.0 },
                        { text: 'COM', start: 17.0, end: 17.2 },
                        { text: 'A', start: 17.2, end: 17.3 },
                        { text: 'GENTE,', start: 17.3, end: 17.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 17.6,
                    end: 19.5,
                    text: 'O EXAME SAI POR NOSSA CONTA.',
                    words: [
                        { text: 'O', start: 17.6, end: 17.8 },
                        { text: 'EXAME', start: 17.8, end: 18.2 },
                        { text: 'SAI', start: 18.2, end: 18.5 },
                        { text: 'POR', start: 18.5, end: 18.8 },
                        { text: 'NOSSA', start: 18.8, end: 19.2 },
                        { text: 'CONTA.', start: 19.2, end: 19.5 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 19.8,
                    end: 21.0,
                    text: 'MAS CORRE, PORQUE É',
                    words: [
                        { text: 'MAS', start: 19.8, end: 20.2 },
                        { text: 'CORRE,', start: 20.2, end: 20.6 },
                        { text: 'PORQUE', start: 20.6, end: 20.8 },
                        { text: 'É', start: 20.8, end: 21.0 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 21.1,
                    end: 23.0,
                    text: 'POR TEMPO LIMITADO.',
                    words: [
                        { text: 'POR', start: 21.1, end: 21.5 },
                        { text: 'TEMPO', start: 21.5, end: 22.0 },
                        { text: 'LIMITADO.', start: 22.0, end: 23.0 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 23.2,
                    end: 25.0,
                    text: 'CHAMA AGORA NO WHATSAPP',
                    words: [
                        { text: 'CHAMA', start: 23.2, end: 23.8 },
                        { text: 'AGORA', start: 23.8, end: 24.2 },
                        { text: 'NO', start: 24.2, end: 24.4 },
                        { text: 'WHATSAPP', start: 24.4, end: 25.0 },
                    ],
                },
                {
                    id: crypto.randomUUID(),
                    start: 25.2,
                    end: 27.5,
                    text: 'E GARANTA O SEU ANTES QUE ACABE.',
                    words: [
                        { text: 'E', start: 25.2, end: 25.4 },
                        { text: 'GARANTA', start: 25.4, end: 26.0 },
                        { text: 'O', start: 26.0, end: 26.2 },
                        { text: 'SEU', start: 26.2, end: 26.5 },
                        { text: 'ANTES', start: 26.5, end: 27.0 },
                        { text: 'QUE', start: 27.0, end: 27.2 },
                        { text: 'ACABE.', start: 27.2, end: 27.5 },
                    ],
                },
            ];

            return res.json({ ok: true, segments: defaultSegments });
        }

        // Transcrição via gateway (Whisper com a chave do servidor + medição por org).
        const audioBuffer = fs.readFileSync(filePath);
        let words: { word: string; start: number; end: number }[];
        try {
            const result = await gatewayStt(token, audioBuffer, path.basename(filePath), 'pt');
            words = result.words || [];
        } catch (err: unknown) {
            if (err instanceof GatewayHttpError) {
                const userMsg =
                    err.status === 402
                        ? 'Seus créditos Mileto acabaram. Recarregue para gerar legendas.'
                        : err.status === 401
                          ? 'Sessão expirada. Entre novamente para gerar legendas.'
                          : `Falha na transcrição: ${err.message}`;
                return res.status(err.status).json({ ok: false, message: userMsg });
            }
            const message = err instanceof Error ? err.message : 'Erro desconhecido';
            console.error('[STT] Erro ao transcrever via gateway:', message);
            return res.status(502).json({ ok: false, message: `Falha na transcrição: ${message}` });
        }

        if (!words || words.length === 0) {
            console.warn('[STT] Whisper retornou sem palavras — áudio silencioso ou muito curto?');
            return res.status(200).json({ ok: true, segments: [] });
        }

        // O STT determina os tempos. O roteiro aprovado corrige a grafia antes
        // de agrupar os blocos, evitando erros em cidades, marcas e valores.
        const reconciliation = reconcileCaptionWords(words, narrationText);
        const captionWords = reconciliation.words;

        const segments = segmentCaptionWords(captionWords).map((segment) => ({
            id: crypto.randomUUID(),
            ...segment,
        }));

        console.log(`[STT] Transcrição concluída: ${segments.length} blocos gerados.`);
        return res.json({ ok: true, segments, review: reconciliation.review });
    } catch (error: unknown) {
        const err = error as any;
        console.error('[STT] Erro durante a transcrição Whisper:', err.response?.data || err.message);
        res.status(500).json({ ok: false, message: err.message || 'Erro interno na transcrição' });
    }
};
