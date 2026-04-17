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
    {
        id: 'cc-neon-glow',
        name: 'Neon Glow',
        description: 'Efeito neon futurista',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
        },
        textStyle: {
            color: '#00FFFF', // Cyan
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)',
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
            textShadow: '0 0 10px #00FFFF, 0 0 20px #00FFFF, 0 0 30px #00FFFF, 0 0 40px #00FFFF',
            filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
        },
        activeWordStyle: {
            color: '#FF00FF', // Magenta
            textShadow: '0 0 15px #FF00FF, 0 0 30px #FF00FF',
            transform: 'scale(1.1)',
            display: 'inline-block',
        },
        previewClass: 'text-cyan-400 font-black text-sm uppercase drop-shadow-lg',
    },
    {
        id: 'cc-gradient-rainbow',
        name: 'Arco-Íris',
        description: 'Gradiente colorido',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
        },
        textStyle: {
            background: 'linear-gradient(45deg, #FF0000, #FF7F00, #FFFF00, #00FF00, #0000FF, #4B0082, #9400D3)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)',
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
            textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
        },
        activeWordStyle: {
            background: 'linear-gradient(45deg, #FFFF00, #FF00FF, #00FFFF)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            transform: 'scale(1.05)',
            display: 'inline-block',
            filter: 'drop-shadow(0 0 8px rgba(255, 255, 0, 0.8))',
        },
        previewClass: 'bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 via-purple-500 bg-clip-text text-transparent font-black text-sm uppercase',
    },
    {
        id: 'cc-vintage-retro',
        name: 'Vintage Retrô',
        description: 'Estilo anos 80',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
            backgroundColor: 'rgba(255, 20, 147, 0.1)',
            borderRadius: '12px',
            padding: '8px 16px',
            border: '2px solid #FF1493',
        },
        textStyle: {
            color: '#FF1493', // Deep Pink
            fontWeight: 900,
            fontSize: 'clamp(18px, 3.2vw, 34px)',
            lineHeight: '1.2',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Courier New, monospace',
            textShadow: '2px 2px 0px #000000, 4px 4px 0px rgba(255, 20, 147, 0.5)',
        },
        activeWordStyle: {
            color: '#00FFFF', // Cyan
            textShadow: '2px 2px 0px #000000, 4px 4px 0px rgba(0, 255, 255, 0.5)',
            transform: 'scale(1.02)',
            display: 'inline-block',
        },
        previewClass: 'text-pink-500 font-black text-sm uppercase bg-pink-500/10 border border-pink-500/30 px-2 py-1 rounded',
    },
    {
        id: 'cc-minimal-clean',
        name: 'Minimal Clean',
        description: 'Simples e elegante',
        containerStyle: {
            width: '90%',
            margin: '0 auto',
        },
        textStyle: {
            color: '#FFFFFF',
            fontWeight: 400,
            fontSize: 'clamp(20px, 3.5vw, 36px)',
            lineHeight: '1.3',
            textAlign: 'center',
            fontFamily: 'Inter, sans-serif',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        },
        activeWordStyle: {
            color: '#3B82F6', // Blue-500
            fontWeight: 600,
            display: 'inline-block',
        },
        previewClass: 'text-foreground font-normal text-sm',
    },
    {
        id: 'cc-bold-impact',
        name: 'Bold Impact',
        description: 'Impacto máximo',
        containerStyle: {
            width: '80%',
            margin: '0 auto',
            backgroundColor: 'rgba(0,0,0,0.8)',
            borderRadius: '8px',
            padding: '12px 20px',
        },
        textStyle: {
            color: '#FFFFFF',
            fontWeight: 900,
            fontSize: 'clamp(22px, 4vw, 40px)',
            lineHeight: '1.1',
            textTransform: 'uppercase',
            textAlign: 'center',
            fontFamily: 'Impact, sans-serif',
            textShadow: '3px 3px 0px #000000, 6px 6px 0px rgba(0,0,0,0.3)',
            letterSpacing: '2px',
        },
        activeWordStyle: {
            color: '#FFD700', // Gold
            textShadow: '3px 3px 0px #000000, 6px 6px 0px rgba(255, 215, 0, 0.5)',
            transform: 'scale(1.1)',
            display: 'inline-block',
        },
        previewClass: 'text-foreground font-black text-sm uppercase bg-black/60 px-3 py-2 rounded',
    },
    {
        id: 'cc-glass-morphism',
        name: 'Glass Morphism',
        description: 'Efeito vidro moderno',
        containerStyle: {
            width: '85%',
            margin: '0 auto',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            borderRadius: '16px',
            padding: '12px 20px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
        },
        textStyle: {
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 'clamp(18px, 3vw, 32px)',
            lineHeight: '1.2',
            textAlign: 'center',
            fontFamily: 'Inter, sans-serif',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        },
        activeWordStyle: {
            color: '#60A5FA', // Blue-400
            fontWeight: 700,
            display: 'inline-block',
            textShadow: '0 0 8px rgba(96, 165, 250, 0.8)',
        },
        previewClass: 'text-foreground font-semibold text-sm bg-white/10 backdrop-blur px-3 py-2 rounded-lg border border-white/20',
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
