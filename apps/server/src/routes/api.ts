import express from 'express';
import axios from 'axios';
import * as ttsController from '../controllers/ttsController';
import * as videoController from '../controllers/videoController';
import * as aiController from '../controllers/aiController';
import * as chatController from '../controllers/chatController';
import { upload } from '../middleware/upload';
import { isSafeRemoteUrl } from '../utils/safePath';

import * as uploadController from '../controllers/uploadController';
import * as musicController from '../controllers/musicController';
import * as projectController from '../controllers/projectController';
import * as transitionController from '../controllers/transitionController';
import * as downloadController from '../controllers/downloadController';
import * as fileExplorerController from '../controllers/fileExplorerController';
import * as sharedController from '../controllers/sharedController';
import * as opsController from '../controllers/opsController';
import * as aiGenerationController from '../controllers/aiGenerationController';

const router = express.Router();

// ─── Chat Mileto Routes ─────────────────────────────────────────────────────
router.get('/chat/folders', chatController.getFolders);
router.post('/chat/folders', chatController.createFolder);
router.patch('/chat/folders/:id', chatController.renameFolder);
router.delete('/chat/folders/:id', chatController.deleteFolder);

router.get('/chat/sessions', chatController.getSessions);
router.post('/chat/sessions', chatController.createSession);
router.patch('/chat/sessions/:id', chatController.renameSession);
router.patch('/chat/sessions/:id/model', chatController.updateSessionModel);
router.patch('/chat/sessions/:id/move', chatController.moveSession);
router.delete('/chat/sessions/:id', chatController.deleteSession);

router.get('/chat/sessions/:sessionId/messages', chatController.getMessages);
router.delete('/chat/sessions/:sessionId/messages/from/:messageId', chatController.truncateMessagesFrom);
router.post('/chat/message', chatController.sendMessage);

// Geração pelos agentes: execução continua no servidor local e termina na pasta local Geração por IA.
router.post('/ai/generations', aiGenerationController.start);
router.get('/ai/generations', aiGenerationController.list);
router.get('/ai/generations/:id', aiGenerationController.status);

// Project Persistence
router.get('/projects', projectController.listProjects);
router.get('/projects/:projectId', projectController.getProjectData);
router.post('/projects/:projectId', projectController.saveProjectData);
router.delete('/projects/:projectId', projectController.deleteProject);

// AI Generation Routes
router.post('/integrations/replicate/test', aiController.testReplicate);
router.post('/ai/replicate/image', aiController.generateReplicateImage);

// Runway
router.post('/runway/validate', aiController.validateRunway);
router.post('/ai/runway/video', aiController.generateRunwayVideo); // Text-to-Video
router.post('/ai/runway/image-to-video', aiController.generateRunwayImageToVideo); // Image-to-Video
router.get('/ai/job/:jobId', aiController.getRunwayJobStatus);

// Uploads
router.post('/uploads/image', upload.single('file'), uploadController.uploadImage);

// TTS Routes
router.post('/tts/preview-voice', ttsController.previewVoice);
router.post('/tts/generate-narration', ttsController.createNarration);
router.post('/tts/clone-voice', upload.single('audio'), ttsController.cloneVoice);
router.post('/tts/list-voices', ttsController.listProviderVoices);
// Gravação da própria voz do usuário (alternativa à narração por IA).
router.post('/tts/upload-recording', upload.single('audio'), ttsController.uploadNarrationRecording);

import * as sttController from '../controllers/sttController';
// STT Routes
router.post('/stt/generate-captions', sttController.generateCaptions);

// Video Routes
router.post('/video/upload', upload.single('video'), videoController.uploadVideo);
router.post('/video/generate-titles', aiController.generateTitles);
router.post('/video/mux', videoController.muxFinalExport);
router.post('/video/export-hybrid', videoController.exportHybrid);

// Music Library Routes
router.post('/music/upload', upload.single('file'), musicController.uploadMusic);
router.get('/music/list', musicController.listMusic);
router.patch('/music/:id', musicController.renameMusic);
router.delete('/music/:id', musicController.deleteMusic);

// Download Routes — analisa e baixa mídia de sites suportados pelo yt-dlp.
router.post('/download/inspect', downloadController.inspectDownload);
router.post('/download/start', downloadController.startDownload);
router.post('/download/ops', downloadController.startOpsDownload);
router.get('/download/jobs', downloadController.listDownloadJobs);
router.delete('/download/jobs/history', downloadController.clearDownloadHistory);
router.delete('/download/:jobId', downloadController.cancelDownload);
router.get('/download/status/:jobId', downloadController.getDownloadStatus);

// File Explorer Routes — explorador de mídia (pastas/mover/copiar).
router.get('/files/tree', fileExplorerController.getTree);
router.get('/files/list', fileExplorerController.listItems);
router.post('/files/folder', fileExplorerController.createFolder);
router.post('/files/upload', upload.single('file'), fileExplorerController.uploadFile);
router.post('/files/import-paths', fileExplorerController.importLocalPaths);
router.post('/files/preview-source', fileExplorerController.preparePreviewSource);
router.patch('/files/rename', fileExplorerController.renameItem);
router.post('/files/move', fileExplorerController.moveItem);
router.post('/files/copy', fileExplorerController.copyItem);
router.delete('/files/item', fileExplorerController.deleteItem);

// Ambiente Compartilhado: o servidor local calcula o SHA-256 por streaming e
// encaminha as operaÃ§Ãµes autenticadas ao gateway/R2.
router.get('/shared/status', sharedController.status);
router.get('/shared/files/tree', sharedController.tree);
router.get('/shared/files/list', sharedController.list);
router.get('/shared/files/trash', sharedController.trash);
router.post('/shared/files/folder', sharedController.createFolder);
router.post('/shared/files/upload', upload.single('file'), sharedController.uploadFile);
router.post('/shared/files/import-local', sharedController.importLocalFile);
router.patch('/shared/files/rename', sharedController.renameItem);
router.post('/shared/files/move', sharedController.moveItem);
router.post('/shared/files/copy', sharedController.copyItem);
router.delete('/shared/files/item/:assetId', sharedController.trashItem);
router.post('/shared/files/item/:assetId/restore', sharedController.restoreItem);

// Mileto Ops: o renderer envia apenas uma referência opaca. O servidor local
// busca uma URL curta via gateway e materializa o arquivo no cache privado.
router.post('/ops/cache/materialize', opsController.materialize);
router.get('/ops/cache/status', opsController.cacheStatus);
router.get('/ops/cache/file/:cacheId/:filename', opsController.serveCacheFile);

// Transition Routes
router.post('/transitions/upload', upload.single('file'), transitionController.uploadTransition);
router.get('/transitions/list', transitionController.listTransitions);
router.delete('/transitions/:id', transitionController.deleteTransition);

import * as audioController from '../controllers/audioController';
// Audio Mix Routes
router.post('/audio/mix', audioController.mixAudio);

// Mock verification for now, real implementation would actually call the APIs
router.post('/test-gemini', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, message: 'API Key missing' });

    // TODO: integrated real test
    // For now, simple length check mock
    if (apiKey.length < 10) return res.status(401).json({ ok: false, message: 'Invalid Gemini Key format' });

    res.json({ ok: true, message: 'Gemini API Connected' });
});

import OpenAI from 'openai';

router.post('/test-openai', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || apiKey.length < 10) return res.status(401).json({ ok: false, message: 'Invalid OpenAI Key format' });

    try {
        const cleanKey = apiKey.trim();
        const openai = new OpenAI({ apiKey: cleanKey });
        // Simples chamada de listagem de modelos para validar a chave (gratuito)
        await openai.models.list();
        res.json({ ok: true, message: 'OpenAI API Connected' });
    } catch (e: any) {
        res.status(401).json({ ok: false, message: e.message || 'Incorrect API Key' });
    }
});

import { testApiKey, getApiCredit } from '../services/fishAudio';

router.post('/test-fishaudio', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, message: 'API Key missing' });

    try {
        const isValid = await testApiKey(apiKey);
        if (!isValid) {
            return res.status(401).json({ ok: false, message: 'Invalid Fish Audio Key or Connection Failed' });
        }

        // Autenticar não basta: a chave pode ser de outra conta, sem saldo.
        const wallet = await getApiCredit(apiKey);
        res.json({
            ok: true,
            message: 'Fish Audio API Connected',
            credit: wallet?.credit ?? null,
            accountId: wallet?.accountId ?? null,
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

import { testApiKey as testElevenLabsKey } from '../services/elevenlabs';

router.post('/test-elevenlabs', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, message: 'API Key missing' });

    try {
        const isValid = await testElevenLabsKey(apiKey);
        if (isValid) {
            res.json({ ok: true, message: 'ElevenLabs API Connected' });
        } else {
            res.status(401).json({ ok: false, message: 'Invalid ElevenLabs Key or Connection Failed' });
        }
    } catch (e: any) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// Proxy route to bypass CORS for external media (e.g. Canvas Tainted sources)
router.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send('URL is required');
    // Anti-SSRF: só http(s) para host PÚBLICO. Sem isso, `?url=http://169.254.169.254/...`
    // lê metadados da nuvem e varre a rede interna usando o app como proxy cego.
    if (!isSafeRemoteUrl(targetUrl)) return res.status(400).send('URL não permitida');
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            timeout: 10000,
            maxRedirects: 0, // um redirect para host interno burlaria a checagem acima
        });

        // Copy content type and content length so browser knows what it's dealing with
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

        // Pipe the stream directly back to the client
        response.data.pipe(res);
    } catch (error: any) {
        console.error('[Proxy Error] Failed to fetch:', targetUrl, error.message);
        res.status(500).send('Error proxying media');
    }
});

export default router;
