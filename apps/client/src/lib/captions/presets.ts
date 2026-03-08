export interface CaptionPreset {
    id: string;
    name: string;
    containerStyle: React.CSSProperties;
    textStyle: React.CSSProperties;
    previewClass: string;
    activeWordStyle?: React.CSSProperties;
    animation?: 'pop' | 'fade' | 'none';
    description?: string; // Optional description
}

export const CAPTION_PRESETS: CaptionPreset[] = [
    {
        id: 'cc-yellow',
        name: 'Amarela Centro',
        description: 'Clássico CapCut',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
        },
        textStyle: {
            color: '#FFD700', // Gold/Yellow
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)', // Responsive small/medium
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
            // Stroke implementation
            WebkitTextStroke: '4px black', // Thicker stroke
            paintOrder: 'stroke fill', // Ensures stroke doesn't eat the fill
            textShadow: '2px 2px 0px rgba(0,0,0,0.5)', // Solid shadow
        },
        previewClass: 'text-yellow-400 font-black stroke-black text-sm uppercase',
    },
    {
        id: 'cc-white',
        name: 'Branca + Contorno',
        description: 'Legibilidade máxima',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
        },
        textStyle: {
            color: 'white',
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)',
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
            WebkitTextStroke: '4px black',
            paintOrder: 'stroke fill',
            textShadow: '2px 2px 0px rgba(0,0,0,0.5)',
        },
        previewClass: 'text-foreground font-black stroke-black text-sm uppercase',
    },
    {
        id: 'cc-karaoke',
        name: 'Karaokê',
        description: 'Palavra ativa vermelha',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
        },
        textStyle: {
            color: 'white',
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)',
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
            WebkitTextStroke: '4px black',
            paintOrder: 'stroke fill',
            textShadow: '2px 2px 0px rgba(0,0,0,0.5)',
        },
        activeWordStyle: {
            color: '#EF4444', // Red-500
            WebkitTextStroke: '4px black',
            transform: 'scale(1.05)',
            display: 'inline-block',
        },
        previewClass: 'text-foreground font-black stroke-black text-sm uppercase',
    },
    // Keep legacy presets for backward compatibility, but pushed to bottom
    {
        id: 'clean-white',
        name: 'Clean White (Legacy)',
        containerStyle: {
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: '8px',
            padding: '4px 12px',
        },
        textStyle: {
            color: 'white',
            fontWeight: 600,
            fontSize: '1.5rem',
            textAlign: 'center',
            textShadow: '0 2px 4px rgba(0,0,0,0.5)',
        },
        previewClass: 'text-foreground font-semibold bg-black/60 px-2 py-1 rounded',
    },
    {
        id: 'box-dark',
        name: 'Box Dark',
        containerStyle: {
            backgroundColor: 'black',
            padding: '2px 8px',
        },
        textStyle: {
            color: 'white',
            fontWeight: 800,
            fontSize: '1.5rem',
            textTransform: 'uppercase',
            fontFamily: 'sans-serif',
        },
        previewClass: 'text-foreground font-bold bg-black uppercase px-2',
    },
];

export const getPresetById = (id: string | null | undefined) => {
    return CAPTION_PRESETS.find((p) => p.id === id) || CAPTION_PRESETS[0];
};
