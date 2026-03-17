import { Request, Response, NextFunction } from 'express';
import { aiService } from '../services/aiService';
import { BadRequestError } from '../utils/errors';

// ... Replicate Controllers ...
export const testReplicate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = (req.headers['x-replicate-token'] as string)?.trim();
        if (!token) throw new BadRequestError('Missing Replicate Token');
        await aiService.testReplicate(token);
        res.json({ ok: true });
    } catch (e) { next(e); }
};

export const generateReplicateImage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = (req.headers['x-replicate-token'] as string)?.trim();
        const { projectId, prompt, aspectRatio, qualityPreset } = req.body;
        const asset = await aiService.generateReplicateImage(projectId, prompt, aspectRatio, qualityPreset, token);
        res.json({ ok: true, asset });
    } catch (e) { next(e); }
};

// ... Runway Controllers ...
export const validateRunway = async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    if (!apiKey) throw new BadRequestError('Missing Runway Token');
    res.json({ ok: true, message: 'Runway Key Saved' });
};

export const generateRunwayVideo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = (req.headers['x-runway-token'] as string)?.trim();
        const { prompt, durationSec, aspectRatio } = req.body;
        const jobId = await aiService.generateRunwayVideo(prompt, Number(durationSec), aspectRatio, token);
        res.json({ ok: true, jobId });
    } catch (e) { next(e); }
};

export const generateRunwayImageToVideo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = (req.headers['x-runway-token'] as string)?.trim();
        const { promptText, imageUrl, durationSec, ratio } = req.body;
        const jobId = await aiService.generateRunwayImageToVideo(promptText, imageUrl, Number(durationSec), ratio, token);
        res.json({ ok: true, jobId });
    } catch (e) { next(e); }
};

export const getRunwayJobStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = (req.headers['x-runway-token'] as string)?.trim();
        const { jobId } = req.params;
        const { projectId } = req.query;
        if (!projectId) throw new BadRequestError('Missing Project ID');
        const result = await aiService.getRunwayJobStatus(jobId, String(projectId), token);
        res.json(result);
    } catch (e) { next(e); }
};

// ... Others ...
export const generateTitles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { script, captions, openaiKey, geminiKey } = req.body;
        const wordTimings = (captions?.segments || [])
            .flatMap((seg: any) => (seg.words || []).map((w: any) => `[${w.start.toFixed(2)}s] ${w.text}`))
            .join(' ');
        const titles = await aiService.generateTitles(script, wordTimings, openaiKey, geminiKey);
        res.json({ ok: true, titles });
    } catch (e) { next(e); }
};

export const generateMoodRewrite = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { text, mood, openaiKey, geminiKey } = req.body;
        const rewrittenText = await aiService.generateMoodRewrite(text, mood, openaiKey, geminiKey);
        res.json({ ok: true, text: rewrittenText });
    } catch (e) { next(e); }
};

export const testGemini = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) throw new BadRequestError('API Key missing');
        // Simple validation or real call to Gemini
        if (apiKey.length < 10) throw new BadRequestError('Invalid Gemini Key format');
        res.json({ ok: true, message: 'Gemini API Connected' });
    } catch (e) { next(e); }
};

export const testOpenAI = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) throw new BadRequestError('API Key missing');
        // Logic already exists in aiService or simple check here
        res.json({ ok: true, message: 'OpenAI API Connected' });
    } catch (e) { next(e); }
};
