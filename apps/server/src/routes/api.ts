import express from 'express';
import axios from 'axios';
import * as ttsController from '../controllers/ttsController';
import * as videoController from '../controllers/videoController';
import * as aiController from '../controllers/aiController';
import * as chatController from '../controllers/chatController';
import { upload } from '../middleware/upload';

import * as uploadController from '../controllers/uploadController';
import * as musicController from '../controllers/musicController';
import * as projectController from '../controllers/projectController';
import * as transitionController from '../controllers/transitionController';

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
router.post('/chat/message', chatController.sendMessage);

// Project Persistence
router.get('/projects/:projectId', projectController.getProjectData);
router.post('/projects/:projectId', projectController.saveProjectData);

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

import { testApiKey } from '../services/fishAudio';

router.post('/test-fishaudio', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, message: 'API Key missing' });

    try {
        const isValid = await testApiKey(apiKey);
        if (isValid) {
            res.json({ ok: true, message: 'Fish Audio API Connected' });
        } else {
            res.status(401).json({ ok: false, message: 'Invalid Fish Audio Key or Connection Failed' });
        }
    } catch (e: any) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// Proxy route to bypass CORS for external media (e.g. Canvas Tainted sources)
router.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send('URL is required');
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            timeout: 10000,
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
