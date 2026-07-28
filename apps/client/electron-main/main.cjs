const { app, BrowserWindow, ipcMain, dialog, safeStorage, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { randomBytes } = require('crypto');
const { spawn } = require('child_process');
const os = require('os');

let serverProcess = null;
let mainWindowRef = null;
let autoUpdater = null;
const localFileImportToken = randomBytes(32).toString('hex');
const authorizedExportDirs = new Set();

function isPathInside(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function uniqueExportDestination(requestedPath) {
    if (!fs.existsSync(requestedPath)) return requestedPath;
    const parsed = path.parse(requestedPath);
    for (let index = 2; index < 10000; index += 1) {
        const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Não foi possível reservar um nome para o arquivo exportado.');
}

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
    let ytdlpPath = '';

    if (isDev) {
        ffmpegPath = path.join(appPath, 'resources/bin/ffmpeg.exe');
        ffprobePath = path.join(appPath, 'resources/bin/ffprobe.exe');
        ytdlpPath = path.join(appPath, 'resources/bin/yt-dlp.exe');
    } else {
        ffmpegPath = path.join(process.resourcesPath, 'bin/ffmpeg.exe');
        ffprobePath = path.join(process.resourcesPath, 'bin/ffprobe.exe');
        ytdlpPath = path.join(process.resourcesPath, 'bin/yt-dlp.exe');
    }

    console.log(`[Electron] Starting Backend Server...`);
    console.log('[Electron] Persistent data directory ready.');

    const serverEntry = isDev
        ? path.join(appPath, '../server/src/index.ts')
        : path.join(process.resourcesPath, 'server/bundle.js');

    const nodeExecutable = process.execPath;

    const args = isDev ? ['--require', 'ts-node/register', serverEntry] : [serverEntry];

    const serverCwd = isDev
        ? path.join(appPath, '../server')
        : path.join(process.resourcesPath, 'server');
    const builtInTransitionsPath = isDev
        ? path.join(appPath, '../server/public/transitions/builtins')
        : path.join(process.resourcesPath, 'server/public/transitions/builtins');

    serverProcess = spawn(nodeExecutable, args, {
        cwd: serverCwd,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PORT: '3301',
            USER_DATA_PATH: persistentPath,
            FFMPEG_PATH: ffmpegPath,
            FFPROBE_PATH: ffprobePath,
            YTDLP_PATH: ytdlpPath,
            BUILTIN_TRANSITIONS_PATH: builtInTransitionsPath,
            LOCAL_FILE_IMPORT_TOKEN: localFileImportToken,
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

    // Sem este handler, uma falha ao spawnar (bundle ausente, execPath ruim, EACCES)
    // emite 'error' → vira uncaughtException → o app trava no boot sem explicação.
    serverProcess.on('error', (err) => {
        console.error('[Server] Falha ao iniciar o processo do servidor:', err.message);
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            dialog.showErrorBox(
                'Erro ao iniciar o Mileto',
                'Não foi possível iniciar o servidor interno. Reinstale o aplicativo ou reinicie o computador.\n\n' +
                    err.message
            );
        }
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

    console.log('[Electron] App icon available:', fs.existsSync(finalIcon));

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

// ─── Sessão do usuário (token) — guardado cifrado com safeStorage (DPAPI no
// Windows). Nunca vai para localStorage do renderer, que é legível em texto. ──
const authFilePath = () => path.join(app.getPath('userData'), 'mileto-auth.bin');

function readAuthToken() {
    try {
        const f = authFilePath();
        if (!fs.existsSync(f)) return null;
        const buf = fs.readFileSync(f);
        if (buf.length === 0) return null;
        // O arquivo é SEMPRE cifrado (nunca gravamos texto puro). Se a decifragem
        // falhar (chave mudou, arquivo de outra máquina), devolve null → re-login.
        return safeStorage.decryptString(buf);
    } catch (err) {
        console.error('[auth] Falha ao ler token:', err.message);
        return null;
    }
}

function writeAuthToken(token) {
    const f = authFilePath();
    if (!token) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
        return true;
    }
    // NUNCA grava o token em texto puro. Sem cifragem disponível (raro; safeStorage
    // usa DPAPI no Windows), não persiste — o renderer cai para sessionStorage, que
    // some ao fechar. Um bearer de 30 dias em claro no disco seria pior.
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Criptografia (safeStorage) indisponível; sessão não será salva em texto puro.');
    }
    fs.writeFileSync(f, safeStorage.encryptString(String(token)));
    return true;
}

function readClipboardFilePaths() {
    const candidates = [];
    const addValues = (value) => {
        for (const part of String(value || '').split(/\0|\r?\n/)) {
            const cleaned = part.trim().replace(/^['"]|['"]$/g, '');
            if (cleaned) candidates.push(cleaned);
        }
    };

    try {
        const formats = clipboard.availableFormats('clipboard');
        if (formats.includes('FileNameW')) {
            addValues(clipboard.readBuffer('FileNameW', 'clipboard').toString('utf16le'));
        }
        if (formats.includes('FileName')) {
            addValues(clipboard.readBuffer('FileName', 'clipboard').toString('latin1'));
        }
    } catch (err) {
        console.warn('[clipboard] Falha ao ler formatos de arquivo:', err.message);
    }

    // Alguns aplicativos colocam também o caminho absoluto como texto.
    try {
        addValues(clipboard.readText('clipboard'));
    } catch {
        // Sem representação textual; os formatos de arquivo acima continuam válidos.
    }

    return [...new Set(candidates)]
        .filter((candidate) => {
            try {
                return path.isAbsolute(candidate) && fs.statSync(candidate).isFile();
            } catch {
                return false;
            }
        })
        .slice(0, 50);
}

app.whenReady().then(() => {
    authorizedExportDirs.add(path.resolve(app.getPath('desktop')));
    // ─── Sessão do usuário ───────────────────────────────────────────────
    ipcMain.handle('auth:get', () => readAuthToken());
    ipcMain.handle('auth:set', (_event, token) => {
        try {
            return writeAuthToken(token);
        } catch (err) {
            console.error('[auth] Falha ao gravar token:', err.message);
            return false;
        }
    });
    ipcMain.handle('auth:clear', () => {
        try {
            return writeAuthToken(null);
        } catch {
            return false;
        }
    });

    // Cola arquivos copiados no Windows Explorer. A cópia física é feita pelo
    // servidor local para não carregar vídeos grandes inteiros na memória da UI.
    ipcMain.handle('files:paste-from-clipboard', async (_event, parent = '') => {
        const paths = readClipboardFilePaths();
        if (paths.length === 0) return { ok: false, noFiles: true };

        try {
            const response = await fetch('http://127.0.0.1:3301/api/files/import-paths', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Local-File-Import': localFileImportToken,
                },
                body: JSON.stringify({ paths, parent: typeof parent === 'string' ? parent : '' }),
            });
            const responseText = await response.text();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch {
                return {
                    ok: false,
                    message: 'O servidor interno ainda está desatualizado. Feche completamente o Mileto e abra novamente.',
                };
            }
            return result;
        } catch (err) {
            return {
                ok: false,
                message: err.message || 'O servidor local não respondeu. Reinicie o Mileto e tente novamente.',
            };
        }
    });

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
        authorizedExportDirs.add(path.resolve(filePaths[0]));
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
        authorizedExportDirs.add(path.resolve(path.dirname(filePath)));
        return { canceled: false, destinationPath: filePath };
    });

    ipcMain.handle('export-commit', async (_event, { sourcePath, destinationPath } = {}) => {
        try {
            if (!sourcePath || !destinationPath) throw new Error('Caminhos da exportação ausentes.');
            const resolvedSource = path.resolve(sourcePath);
            const resolvedDestination = path.resolve(destinationPath);
            const tempRoot = path.resolve(app.getPath('temp'));
            if (!isPathInside(tempRoot, resolvedSource)) {
                throw new Error('Origem temporária da exportação inválida.');
            }
            if (path.extname(resolvedDestination).toLowerCase() !== '.mp4') {
                throw new Error('O destino final precisa ser um arquivo MP4.');
            }
            const destinationDirectory = path.dirname(resolvedDestination);
            const authorized = [...authorizedExportDirs].some((root) => isPathInside(root, destinationDirectory));
            if (!authorized) throw new Error('Selecione novamente a pasta de destino para autorizar a gravação.');
            const sourceStats = fs.statSync(resolvedSource);
            if (!sourceStats.isFile() || sourceStats.size < 1024) {
                throw new Error('O render temporário está vazio ou inválido.');
            }
            fs.mkdirSync(destinationDirectory, { recursive: true });
            const committedPath = uniqueExportDestination(resolvedDestination);
            fs.copyFileSync(resolvedSource, committedPath);
            const committedStats = fs.statSync(committedPath);
            if (committedStats.size !== sourceStats.size) {
                throw new Error('A cópia final do vídeo ficou incompleta.');
            }
            return { ok: true, destinationPath: committedPath, sizeBytes: committedStats.size };
        } catch (err) {
            return { ok: false, message: err.message || 'Falha ao salvar o vídeo exportado.' };
        }
    });

    ipcMain.handle('export-show-in-folder', async (_event, filePath) => {
        if (!filePath || !fs.existsSync(filePath)) return false;
        shell.showItemInFolder(filePath);
        return true;
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
