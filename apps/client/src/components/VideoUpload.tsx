import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { useWizard } from '../context/WizardContext';
import { MediaTake } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

export const VideoUpload = () => {
    const { addMediaTake } = useWizard();

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            acceptedFiles.forEach(async (file) => {
                // Generate a temporary ID for the toast to update it later
                const toastId = toast.loading(`Enviando ${file.name}...`);
                const objectUrl = URL.createObjectURL(file);

                const formData = new FormData();
                formData.append('video', file); // 'video' field expected by backend multer config

                try {
                    console.log(
                        '[VideoUpload] Sending request to:',
                        `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/video/upload`
                    );

                    const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/video/upload`, {
                        method: 'POST',
                        body: formData,
                        // No Content-Type header
                    });

                    if (!response.ok) {
                        let errorMsg = 'Erro desconhecido no upload';
                        try {
                            const errorData = await response.json();
                            errorMsg = errorData.message || errorData.error || errorMsg;
                        } catch {
                            errorMsg = await response.text();
                        }
                        throw new Error(`Erro ${response.status}: ${errorMsg}`);
                    }

                    const data = await response.json();

                    if (!data.ok) throw new Error(data.message);

                    const source = data.source;
                    const newTake: MediaTake = {
                        id: source.id,
                        file,
                        fileName: file.name,
                        originalDurationSeconds: source.duration,
                        url: source.url ? `${((window as any).API_BASE_URL || 'http://localhost:3301')}${source.url}` : objectUrl, // Prefer persistent URL
                        fileUrl: source.url ? `${((window as any).API_BASE_URL || 'http://localhost:3301')}${source.url}` : undefined,
                        backendPath: source.path,
                        proxyUrl: source.proxyUrl ? `${((window as any).API_BASE_URL || 'http://localhost:3301')}${source.proxyUrl}` : '',
                        type: source.type,
                        trim: {
                            start: 0,
                            end: source.duration,
                        },
                    };

                    addMediaTake(newTake);

                    toast.success(
                        `${source.type === 'image' ? 'Imagem adicionada' : 'Vídeo adicionado'}: ${file.name}`,
                        { id: toastId }
                    );
                } catch (error: unknown) {
                    console.error('[VideoUpload Error]', error);
                    const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
                    if (error instanceof TypeError && errMsg === 'Failed to fetch') {
                        toast.error('Offline: Verifique se o backend está rodando na porta 3301 e CORS está ativo.', {
                            id: toastId,
                        });
                    } else {
                        toast.error(`Erro ao enviar ${file.name}: ${errMsg}`, { id: toastId });
                    }
                }
            });
        },
        [addMediaTake]
    );

    const {
        getRootProps: getVideoRootProps,
        getInputProps: getVideoInputProps,
        isDragActive: isVideoDragActive,
    } = useDropzone({
        onDrop,
        accept: { 'video/*': ['.mp4', '.mov', '.avi', '.mkv'] },
    });

    const {
        getRootProps: getImageRootProps,
        getInputProps: getImageInputProps,
        isDragActive: isImageDragActive,
    } = useDropzone({
        onDrop,
        accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    });

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                {/* Video Upload Button */}
                <div
                    {...getVideoRootProps()}
                    className={cn(
                        'border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all',
                        isVideoDragActive
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-card hover:bg-muted/50 hover:border-primary/50'
                    )}
                >
                    <input {...getVideoInputProps()} />
                    <div className="flex flex-col items-center gap-2">
                        <div className="p-3 bg-muted rounded-full text-primary">
                            <VideoIcon className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-medium text-foreground text-center">Upload Vídeo</p>
                        <p className="text-xs text-muted-foreground text-center">MP4, MOV</p>
                    </div>
                </div>

                {/* Image Upload Button */}
                <div
                    {...getImageRootProps()}
                    className={cn(
                        'border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all',
                        isImageDragActive
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-card hover:bg-muted/50 hover:border-primary/50'
                    )}
                >
                    <input {...getImageInputProps()} />
                    <div className="flex flex-col items-center gap-2">
                        <div className="p-3 bg-muted rounded-full text-primary">
                            <ImageIcon className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-medium text-foreground text-center">Upload Imagem</p>
                        <p className="text-xs text-muted-foreground text-center">JPG, PNG</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
