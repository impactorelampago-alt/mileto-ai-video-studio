const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');

let serverProcess = null;
let mainWindowRef = null;
let autoUpdater = null;

function sendUpdateStatus(payload) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('update:status', payload);
    }
}

function initAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

    autoUpdater.on('checking-for-update', () => sendUpdateStatus({ type: 'checking' }));
    autoUpdater.on('update-available', (info) => sendUpdateStatus({ type: 'available', version: info.version }));
    autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ type: 'not-available', version: info.version }));
    autoUpdater.on('download-progress', (p) => sendUpdateStatus({ type: 'progress', percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
    autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ type: 'downloaded', version: info.version }));
    autoUpdater.on('error', (err) => sendUpdateStatus({ type: 'error', message: (err && err.message) || String(err) }));
    return autoUpdater;
}

function startServer() {
    const isDev = process.env.NODE_ENV === 'development';
    const appPath = app.getAppPath();
    const userDataPath = app.getPath('userData');
    const persistentPath = path.join(userDataPath, 'mileto-server-data');

    let ffmpegPath = '';
    let ffprobePath = '';

    if (isDev) {
        ffmpegPath = path.join(appPath, 'resources/bin/ffmpeg.exe');
        ffprobePath = path.join(appPath, 'resources/bin/ffprobe.exe');
    } else {
        ffmpegPath = path.join(process.resourcesPath, 'bin/ffmpeg.exe');
        ffprobePath = path.join(process.resourcesPath, 'bin/ffprobe.exe');
    }

    console.log(`[Electron] Starting Backend Server...`);
    console.log(`[Electron] Persistent Data Path: ${persistentPath}`);

    const serverEntry = isDev
        ? path.join(appPath, '../server/src/index.ts')
        : path.join(process.resourcesPath, 'server/bundle.js');

    const nodeExecutable = process.execPath;

    const args = isDev ? ['--require', 'ts-node/register', serverEntry] : [serverEntry];

    const serverCwd = isDev
        ? path.join(appPath, '../server')
        : path.join(process.resourcesPath, 'server');

    serverProcess = spawn(nodeExecutable, args, {
        cwd: serverCwd,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PORT: '3301',
            USER_DATA_PATH: persistentPath,
            FFMPEG_PATH: ffmpegPath,
            FFPROBE_PATH: ffprobePath,
            NODE_ENV: process.env.NODE_ENV || 'production',
        },
        shell: false,
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

const isDev = process.env.NODE_ENV === 'development';

// Disable Chromium throttling when the app is in the background or hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function createWindow() {
    const iconPath = isDev
        ? path.join(__dirname, '../build/icon.ico')
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico');

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
        },
    });

    mainWindowRef = mainWindow;

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    // ─── Auto-updater IPC ────────────────────────────────────────────────
    ipcMain.handle('update:check', async () => {
        try {
            const updater = initAutoUpdater();
            if (isDev) {
                const devCfg = path.join(__dirname, '..', 'dev-app-update.yml');
                if (fs.existsSync(devCfg)) {
                    updater.updateConfigPath = devCfg;
                    updater.forceDevUpdateConfig = true;
                }
            }
            const result = await updater.checkForUpdates();
            return {
                ok: true,
                currentVersion: app.getVersion(),
                updateInfo: result && result.updateInfo ? { version: result.updateInfo.version, releaseDate: result.updateInfo.releaseDate } : null,
            };
        } catch (err) {
            return { ok: false, message: err.message || String(err) };
        }
    });

    ipcMain.handle('update:download', async () => {
        try {
            await initAutoUpdater().downloadUpdate();
            return { ok: true };
        } catch (err) {
            return { ok: false, message: err.message || String(err) };
        }
    });

    ipcMain.handle('update:install', () => {
        setImmediate(() => initAutoUpdater().quitAndInstall(false, true));
        return { ok: true };
    });

    ipcMain.handle('update:get-current-version', () => app.getVersion());

    ipcMain.handle('export-init', (event, options = {}) => {
        const sessionId = Date.now().toString() + '-' + Math.floor(Math.random() * 10000);
        const tempDir = app.getPath('temp');

        const ext = options.useTxtList ? 'txt' : 'mp4';
        const videoPath = path.join(tempDir, `mileto-export-vid-${sessionId}.${ext}`);
        const audioPath = path.join(tempDir, `mileto-export-aud-${sessionId}.wav`);

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
            const seqDir = filePath.replace(/\.txt$/, '_seq');

            if (frameIndex === 0 && fs.existsSync(seqDir)) {
                fs.rmSync(seqDir, { recursive: true, force: true });
            }

            if (!fs.existsSync(seqDir)) fs.mkdirSync(seqDir, { recursive: true });

            const framePath = path.join(seqDir, `${frameIndex}.png`);
            fs.writeFileSync(framePath, Buffer.from(buffer));

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

    createWindow();
    startServer();

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
