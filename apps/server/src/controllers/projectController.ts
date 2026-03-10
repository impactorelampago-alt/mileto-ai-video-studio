import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(BASE_DATA_PATH, 'data/projects');

export const getProjectData = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const pId = projectId || 'default';
        const projectPath = path.join(PROJECTS_DIR, pId);
        const dataPath = path.join(projectPath, 'ad-data.json');

        if (!fs.existsSync(dataPath)) {
            // Return null or default?
            // If not found, return 404 or empty object so frontend uses default
            return res.status(404).json({ ok: false, message: 'Project data not found' });
        }

        const raw = fs.readFileSync(dataPath, 'utf-8');
        const data = JSON.parse(raw);
        res.json({ ok: true, data });
    } catch (error: any) {
        console.error('Error getting project data:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};

export const saveProjectData = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const pId = projectId || 'default';
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ ok: false, message: 'No data provided' });
        }

        const projectPath = path.join(PROJECTS_DIR, pId);
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        const dataPath = path.join(projectPath, 'ad-data.json');

        // Merge with existing if needed? Or overwrite?
        // For simple persistence, overwrite is fine if we send full object.
        // But to be safe, maybe read existing and merge?
        // Let's overwrite for now as frontend should have full state.

        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');

        res.json({ ok: true, message: 'Project saved' });
    } catch (error: any) {
        console.error('Error saving project data:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};
