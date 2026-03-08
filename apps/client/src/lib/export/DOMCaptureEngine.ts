export class DOMCaptureEngine {
    private videoPath: string | null = null;
    private audioPath: string | null = null;
    private frameCount = 0;

    // Fallback Properties for FFmpeg Image Sequence
    private usePngSequenceFallback = true;
    private fallbackCanvas: HTMLCanvasElement | null = null;
    private fallbackCtx: CanvasRenderingContext2D | null = null;

    abort() {
        // Cleanup temp files
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { ipcRenderer } = (window as any).require('electron');
            if (this.videoPath || this.audioPath) {
                ipcRenderer.invoke('export-cleanup', {
                    paths: [this.videoPath, this.audioPath].filter(Boolean),
                });
            }
        } catch {
            /* ignore */
        }
    }

    constructor(
        public width = 720,
        public height = 1280,
        public fps = 30,
        public isAlphaOverlay = false // NEW: Trigger WebM transparent encode
    ) {}

    async start() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');
        this.frameCount = 0;

        // Force native PNG extraction strategy
        this.usePngSequenceFallback = true;

        console.log('[DOMCapture] Iniciando Mestre de Sequência PNG Transparente (Bypass de GPU local)');

        // Initialize session on disk
        const session = await ipcRenderer.invoke('export-init', {
            useTxtList: this.usePngSequenceFallback,
        });

        this.videoPath = session.videoPath;
        this.audioPath = session.audioPath;
    }

    async captureFrame(canvas: HTMLCanvasElement) {
        if (!this.fallbackCanvas) {
            this.fallbackCanvas = document.createElement('canvas');
            this.fallbackCanvas.width = canvas.width;
            this.fallbackCanvas.height = canvas.height;
            this.fallbackCtx = this.fallbackCanvas.getContext('2d');
        }
        if (this.fallbackCtx) {
            // CRÍTICO: Limpar o canvas anterior caso as imagens sejam transparentes (Alpha),
            // senão a legenda será "carimbada" infinitamente por cima do texto velho (Ghosting/Echo).
            this.fallbackCtx.clearRect(0, 0, this.fallbackCanvas.width, this.fallbackCanvas.height);
            this.fallbackCtx.drawImage(canvas, 0, 0);

            // Extrai frame como PNG direto pra um array buffer nativo
            const blob = await new Promise<Blob | null>((resolve) => {
                this.fallbackCanvas!.toBlob(resolve, 'image/png');
            });

            if (blob) {
                const arrayBuffer = await blob.arrayBuffer();
                const uint8View = new Uint8Array(arrayBuffer);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { ipcRenderer } = (window as any).require('electron');

                await ipcRenderer.invoke('export-chunk-txt', {
                    filePath: this.videoPath,
                    buffer: uint8View,
                    frameIndex: this.frameCount,
                });
            }
        }

        // Libera o Event Loop para o React (sem travar o limite de FPS)
        await new Promise((r) => setTimeout(r, 0));
        this.frameCount++;
    }

    /**
     * Save audio file for muxing.
     * If masterAudioUrl is provided, downloads the real pre-mixed audio (narration + music).
     * Otherwise, generates a silent WAV as fallback for testing.
     */
    async saveAudio(masterAudioUrl?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');

        if (masterAudioUrl) {
            console.log('[DOMCapture] Baixando áudio master REAL:', masterAudioUrl);

            // Allow fetch to use raw URL if it's already a full localhost URL, else prefix with API_BASE
            let fetchUrl = masterAudioUrl;

            // If it's a relative path starting with /, prepend the correct backend API URL if not available
            if (masterAudioUrl.startsWith('/')) {
                const API_BASE = ((window as any).API_BASE_URL || 'http://localhost:3301') || 'http://localhost:3000';
                // Remove trailing slash from base if present
                const cleanBase = API_BASE.replace(/\/$/, '');
                fetchUrl = `${cleanBase}${masterAudioUrl}`;
            }

            let response;
            try {
                console.log(`[DOMCapture] Fetching audio from: ${fetchUrl}`);
                response = await fetch(fetchUrl);
            } catch (netErr) {
                console.error(`[DOMCapture] Erro de Rede ao baixar áudio: ${netErr}`);
                // eslint-disable-next-line
                throw new Error(`Falha de rede ao acessar áudio: ${fetchUrl} - ${netErr}`);
            }

            if (!response.ok)
                throw new Error(`Falha ao baixar áudio master HTTP ${response.status}: ${response.statusText}`);

            // Detect real format from Content-Type or URL
            const contentType = response.headers.get('content-type') || '';
            let ext = '.wav';
            if (contentType.includes('mpeg') || contentType.includes('mp3') || masterAudioUrl.endsWith('.mp3'))
                ext = '.mp3';
            else if (
                contentType.includes('aac') ||
                contentType.includes('mp4') ||
                masterAudioUrl.endsWith('.aac') ||
                masterAudioUrl.endsWith('.m4a')
            )
                ext = '.m4a';
            else if (contentType.includes('ogg') || masterAudioUrl.endsWith('.ogg')) ext = '.ogg';
            else if (contentType.includes('wav') || masterAudioUrl.endsWith('.wav')) ext = '.wav';

            // Fix audioPath extension to match real format
            if (this.audioPath && !this.audioPath.endsWith(ext)) {
                const oldPath = this.audioPath;
                this.audioPath = oldPath.replace(/\.[^.]+$/, ext);
                console.log(`[DOMCapture] Corrigindo extensão de áudio: ${oldPath} → ${this.audioPath}`);
            }

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8View = new Uint8Array(arrayBuffer);

            console.log(
                `[DOMCapture] Áudio baixado: ${(arrayBuffer.byteLength / 1024).toFixed(0)}KB, tipo: ${contentType}, ext: ${ext}`
            );

            await ipcRenderer.invoke('export-audio', {
                filePath: this.audioPath,
                buffer: uint8View,
            });
            console.log('[DOMCapture] Áudio master real salvo com sucesso em:', this.audioPath);
        } else {
            // Fallback: generate silent WAV
            const sampleRate = 48000;
            const duration = Math.max(1, this.frameCount / this.fps);
            const numChannels = 2;
            const numSamples = Math.floor(sampleRate * duration);

            const buffer = new ArrayBuffer(44 + numSamples * 2 * numChannels);
            const view = new DataView(buffer);

            const writeString = (offset: number, str: string) => {
                for (let i = 0; i < str.length; i++) {
                    view.setUint8(offset + i, str.charCodeAt(i));
                }
            };

            writeString(0, 'RIFF');
            view.setUint32(4, 36 + numSamples * 2 * numChannels, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true);
            view.setUint16(32, numChannels * 2, true);
            view.setUint16(34, 16, true);
            writeString(36, 'data');
            view.setUint32(40, numSamples * 2 * numChannels, true);

            const uint8View = new Uint8Array(buffer);

            await ipcRenderer.invoke('export-audio', {
                filePath: this.audioPath,
                buffer: uint8View,
            });
            console.log('[DOMCapture] Áudio silencioso de fallback gerado.');
        }
    }

    async finish(
        apiUrl: string,
        masterAudioUrl?: string,
        fileName?: string,
        outputPath?: string
    ): Promise<{ videoPath: string | null; audioPath: string | null } | string | null> {
        // Em fallback PNG Sequence, o vídeo gravado é só o arquivo TXT cheio de base64. O Mux vai descobrir.
        await new Promise((r) => setTimeout(r, 500));

        try {
            await this.saveAudio(masterAudioUrl);
        } catch (audioErr) {
            console.error('[DOMCapture] Erro ao salvar áudio:', audioErr);
            // Don't block export - fall back to silent
            alert(`[ERRO ÁUDIO] Falha ao baixar: ${audioErr}\nO vídeo será exportado sem áudio.`);
            await this.saveAudio(); // silent fallback
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');

        let destinationPath: string;

        if (outputPath !== undefined) {
            // Direct path provided or empty string mode — skip save dialog
            destinationPath = outputPath;
        } else {
            // Show save dialog as fallback
            const saveDialog = await ipcRenderer.invoke('export-save-dialog', {
                defaultName: `${fileName || 'MeuVideo_Mileto'}.mp4`,
            });
            if (saveDialog.canceled) {
                await ipcRenderer.invoke('export-cleanup', { paths: [this.videoPath, this.audioPath] });
                return null;
            }
            destinationPath = saveDialog.destinationPath;
        }

        // Se outputPath foi fornecido VAZIO no modo híbrido (string ''), é porque o caller
        // (ExportModal) queria que o finish apenas gerasse os aquivos temp sem abrir Dialog.
        // O Híbrido vai ignorar essa chamada API mux legacy e apenas retornar os caminhos.
        if (outputPath === '') {
            return { videoPath: this.videoPath, audioPath: this.audioPath };
        }

        try {
            const resp = await fetch(`${apiUrl}/video/mux`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoPath: this.videoPath,
                    audioPath: this.audioPath,
                    outputPath: destinationPath,
                }),
            });
            const data = await resp.json();

            await ipcRenderer.invoke('export-cleanup', { paths: [this.videoPath, this.audioPath] });

            if (data.ok) return data.finalPath;
            throw new Error(data.message);
        } catch (err) {
            await ipcRenderer.invoke('export-cleanup', { paths: [this.videoPath, this.audioPath] });
            throw err;
        }
    }
}
