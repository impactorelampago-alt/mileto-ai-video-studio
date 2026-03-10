import electron from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import os from 'os';
import updater from 'electron-updater';
const { autoUpdater } = updater;

let serverProcess = null;

function startServer() {
    const isDev = process.env.NODE_ENV === 'development';
    const appPath = app.getAppPath();
    const userDataPath = app.getPath('userData');
    const persistentPath = path.join(userDataPath, 'mileto-server-data');

    // Binaries development fallback vs Production resources
    let ffmpegPath = '';
    let ffprobePath = '';

    if (isDev) {
        // In dev, we might assume they are global or in a specific dev folder
        // but for safety, we'll try to find our bundled ones if they exist
        ffmpegPath = path.join(appPath, 'resources/bin/ffmpeg.exe');
        ffprobePath = path.join(appPath, 'resources/bin/ffprobe.exe');
    } else {
        // In production, Electron-Builder puts extraResources in the 'resources' folder next to the 'app.asar'
        // Which is usually at process.resourcesPath
        ffmpegPath = path.join(process.resourcesPath, 'bin/ffmpeg.exe');
        ffprobePath = path.join(process.resourcesPath, 'bin/ffprobe.exe');
    }

    console.log(`[Electron] Starting Backend Server...`);
    console.log(`[Electron] Persistent Data Path: ${persistentPath}`);

    // If not in dev, we run the compiled JS. In dev, we might run with ts-node or just assumed already running.
    // For the BUNDLE, we always want Electron to start its own backend.
    const serverEntry = isDev
        ? path.join(appPath, '../server/src/index.ts')
        : path.join(process.resourcesPath, 'server/bundle.js');

    const nodeExecutable = process.execPath; // Use Electron's internal Node!

    // In production, we'll use the packaged server folder
    const args = isDev ? ['--loader', 'ts-node/esm', serverEntry] : [serverEntry];

    serverProcess = spawn(nodeExecutable, args, {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PORT: '3301',
            USER_DATA_PATH: persistentPath,
            FFMPEG_PATH: ffmpegPath,
            FFPROBE_PATH: ffprobePath,
            NODE_ENV: process.env.NODE_ENV || 'production',
        },
        shell: false, // Changed from true to false for SECURITY and stability with execPath
    });

    serverProcess.stdout.on('data', (data) => {
        console.log(`[Server STDOUT]: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`[Server STDERR]: ${data}`);
    });

    serverProcess.on('close', (code) => {
        console.log(`[Server] Process exited with code ${code}`);
    });
}

const { app, BrowserWindow, ipcMain, dialog } = electron;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// Disable Chromium throttling when the app is in the background or hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function createWindow() {
    // Resolve icon path: in production it's next to the asar, in dev it's in the build folder
    const iconPath = isDev
        ? path.join(__dirname, '../build/icon.ico')
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico');

    // Fallback chain: try .ico first, then .png
    const finalIcon = fs.existsSync(iconPath) ? iconPath : path.join(__dirname, '../build/icon.ico');

    console.log('[Electron] Icon path:', finalIcon, 'exists:', fs.existsSync(finalIcon));

    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        autoHideMenuBar: true,
        icon: finalIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    // Setup IPC Handlers
    ipcMain.handle('export-init', (event, options = {}) => {
        const sessionId = Date.now().toString() + '-' + Math.floor(Math.random() * 10000);
        const tempDir = app.getPath('temp');

        // Se usar o fallback do Sequencer JPEG, a extensão será .txt para guardar o buffer numérico
        const ext = options.useTxtList ? 'txt' : 'mp4';
        const videoPath = path.join(tempDir, `mileto-export-vid-${sessionId}.${ext}`);
        const audioPath = path.join(tempDir, `mileto-export-aud-${sessionId}.wav`);

        // Limpa se já existirem (por precaução)
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

        return { sessionId, videoPath, audioPath };
    });

    ipcMain.handle('export-chunk', async (event, { filePath, buffer }) => {
        try {
            fs.appendFileSync(filePath, Buffer.from(buffer));
            return true;
        } catch (err) {
            console.error('Falha ao appending chunk:', err);
            throw err;
        }
    });

    ipcMain.handle('export-chunk-txt', async (event, { filePath, buffer, frameIndex }) => {
        try {
            // O frontend agora envia ArrayBuffer direto.
            // Crio uma subpasta _seq para armazenar os PNGs ordenados e ignoro o append de Base64
            const seqDir = filePath.replace(/\.txt$/, '_seq');

            // Limpeza radical: Purga a pasta se o export está no quadro 0 para evitar Frames Zumbis do passado
            if (frameIndex === 0 && fs.existsSync(seqDir)) {
                fs.rmSync(seqDir, { recursive: true, force: true });
            }

            if (!fs.existsSync(seqDir)) fs.mkdirSync(seqDir, { recursive: true });

            const framePath = path.join(seqDir, `${frameIndex}.png`);
            fs.writeFileSync(framePath, Buffer.from(buffer));

            // Faço um append vazio no TXT principal só pra criar o arquivo e o backend saber que existe
            if (frameIndex === 0) {
                fs.writeFileSync(filePath, 'SEQUENCIA_DE_IMAGENS_CRIADA_NO_DISCO', 'utf8');
            }
            return true;
        } catch (err) {
            console.error('Falha ao gravar Frame PNG Nativo no disco:', err);
            throw err;
        }
    });

    ipcMain.handle('export-audio', async (event, { filePath, buffer }) => {
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, Buffer.from(buffer), (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    });

    ipcMain.handle('select-folder', async () => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Selecionar pasta de destino',
            properties: ['openDirectory'],
        });
        if (canceled || filePaths.length === 0) return { canceled: true };
        return { canceled: false, folderPath: filePaths[0] };
    });

    ipcMain.handle('export-save-dialog', async (event, { defaultName }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Salvar Vídeo MP4',
            defaultPath: defaultName || 'MeuVideo_Mileto.mp4',
            filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
        });
        if (canceled || !filePath) return { canceled: true };
        return { canceled: false, destinationPath: filePath };
    });

    ipcMain.handle('export-cleanup', async (event, { paths }) => {
        paths.forEach((p) => {
            if (fs.existsSync(p)) {
                try {
                    fs.unlinkSync(p);
                } catch (e) {}
            }
        });
        return true;
    });

    // IPC: Install update (called from renderer when user clicks "Instalar Agora")    // ── Project Persistence ──────────────────────────────────────────────
    const getProjectsDir = () => {
        const dir = path.join(app.getPath('userData'), 'mileto-projects');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    };

    // List all projects, checking file existence for each take
    ipcMain.handle('projects-list', () => {
        const dir = getProjectsDir();
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        const projects = [];
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(dir, file), 'utf8');
                const proj = JSON.parse(raw);
                // Annotate each take with whether its file exists
                if (Array.isArray(proj.mediaTakes)) {
                    proj.mediaTakes = proj.mediaTakes.map((take) => ({
                        ...take,
                        fileMissing: take.backendPath ? !fs.existsSync(take.backendPath) : false,
                    }));
                }
                projects.push(proj);
            } catch (e) {
                console.error('[Projects] Failed to parse', file, e);
            }
        }
        // Sort by updatedAt descending
        return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });

    // Save (create or update) a project JSON
    ipcMain.handle('project-save', (_event, project) => {
        const dir = getProjectsDir();
        const filePath = path.join(dir, `${project.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
        return { ok: true };
    });

    // Delete a project JSON
    ipcMain.handle('project-delete', (_event, projectId) => {
        const dir = getProjectsDir();
        const filePath = path.join(dir, `${projectId}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { ok: true };
    });

    // Check file existence for a single project's takes (for real-time recheck)
    ipcMain.handle('project-check-files', (_event, takes) => {
        return takes.map((take) => ({
            id: take.id,
            fileMissing: take.backendPath ? !fs.existsSync(take.backendPath) : false,
        }));
    });

    // IPC: Install update (called from renderer when user clicks "Instalar Agora")
    ipcMain.handle('install-update', () => {
        autoUpdater.quitAndInstall();
    });

    createWindow();
    startServer();

    // Helper to send update status to all renderer windows
    const sendUpdateStatus = (data) => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('update-status', data);
        });
    };

    // Auto-update: emit events to renderer instead of showing system dialogs
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('error', (err) => {
        sendUpdateStatus({ type: 'error', message: err?.message || 'Erro desconhecido' });
    });

    autoUpdater.on('checking-for-update', () => {
        sendUpdateStatus({ type: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        sendUpdateStatus({ type: 'available', version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
        sendUpdateStatus({ type: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress) => {
        sendUpdateStatus({ type: 'progress', percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', () => {
        sendUpdateStatus({ type: 'downloaded' });
    });

    autoUpdater.checkForUpdates();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (serverProcess) serverProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
    if (serverProcess) serverProcess.kill();
});
