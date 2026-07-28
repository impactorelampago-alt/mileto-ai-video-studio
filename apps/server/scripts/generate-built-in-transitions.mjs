import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, '..');
const outputDir = join(serverDir, 'public', 'transitions', 'builtins');
const catalogPath = join(outputDir, 'catalog.json');
const ffmpeg = resolve(serverDir, '..', 'client', 'resources', 'bin', 'ffmpeg.exe');
const duration = 1.2;
const width = 540;
const height = 960;

mkdirSync(outputDir, { recursive: true });

const base = `color=c=black:s=${width}x${height}:r=30:d=${duration}`;
const fade = 'fade=t=in:st=0:d=0.10,fade=t=out:st=0.92:d=0.28';

const simple = (source, filters) => ({
    inputs: [source],
    filter: `[0:v]${filters},format=yuv420p[outv]`,
});

const rgba = (color, size, opacity = 0.9) =>
    `color=c=${color}@${opacity}:s=${size}:r=30:d=${duration},format=rgba`;

const composeMovingLayers = (layers, finish = fade) => {
    const inputs = [base, ...layers.map((layer) => rgba(layer.color, layer.size, layer.opacity))];
    const chain = [];
    let current = '[0:v]';

    layers.forEach((layer, index) => {
        const next = `[layer${index}]`;
        chain.push(
            `${current}[${index + 1}:v]overlay=x='${layer.x}':y='${layer.y}':eval=frame:format=auto:shortest=1${next}`,
        );
        current = next;
    });

    chain.push(`${current}${finish},format=yuv420p[outv]`);
    return { inputs, filter: chain.join(';') };
};

const sweepX = (colors, direction = 'lr', layerWidth = 130) => {
    const layers = colors.map((color, index) => {
        const w = Math.max(28, layerWidth - index * 28);
        const offset = index * 76;
        const x = direction === 'lr'
            ? `-${w + offset}+(main_w+overlay_w+${offset * 2})*t/${duration}`
            : `main_w+${offset}-(main_w+overlay_w+${offset * 2})*t/${duration}`;
        return { color, size: `${w}x${height}`, opacity: 0.86 - index * 0.12, x, y: '0' };
    });
    return composeMovingLayers(layers);
};

const sweepY = (colors, direction = 'td', layerHeight = 150) => {
    const layers = colors.map((color, index) => {
        const h = Math.max(35, layerHeight - index * 30);
        const offset = index * 92;
        const y = direction === 'td'
            ? `-${h + offset}+(main_h+overlay_h+${offset * 2})*t/${duration}`
            : `main_h+${offset}-(main_h+overlay_h+${offset * 2})*t/${duration}`;
        return { color, size: `${width}x${h}`, opacity: 0.86 - index * 0.12, x: '0', y };
    });
    return composeMovingLayers(layers);
};

const movingBars = (colors, vertical = false, gold = false) => {
    const layers = colors.map((color, index) => {
        if (vertical) {
            const w = 58;
            const h = 300;
            const x = 18 + index * 96;
            const y = index % 2 === 0
                ? `-${h}+(main_h+overlay_h)*t/${duration}`
                : `main_h-(main_h+overlay_h)*t/${duration}`;
            return { color, size: `${w}x${h}`, opacity: gold ? 0.9 : 0.78, x: String(x), y };
        }

        const w = 310;
        const h = 72;
        const y = 90 + index * 145;
        const x = index % 2 === 0
            ? `-${w}+(main_w+overlay_w)*t/${duration}`
            : `main_w-(main_w+overlay_w)*t/${duration}`;
        return { color, size: `${w}x${h}`, opacity: gold ? 0.9 : 0.78, x, y: String(y) };
    });
    return composeMovingLayers(layers);
};

const splitSweep = composeMovingLayers([
    {
        color: '#39ffb0', size: `120x${height}`, opacity: 0.88,
        x: `-120+(main_w/2+120)*t/${duration}`, y: '0',
    },
    {
        color: '#9a5cff', size: `120x${height}`, opacity: 0.88,
        x: `main_w-(main_w/2+120)*t/${duration}`, y: '0',
    },
    {
        color: '#ffffff', size: `28x${height}`, opacity: 0.82,
        x: `-28+(main_w/2+28)*t/${duration}`, y: '0',
    },
]);

const filmBurn = (baseColor, accentColor) => composeMovingLayers([
    {
        color: baseColor, size: `310x${height}`, opacity: 0.82,
        x: `-310+(main_w+overlay_w)*t/${duration}`, y: '0',
    },
    {
        color: accentColor, size: `92x${height}`, opacity: 0.92,
        x: `-190+(main_w+380)*t/${duration}`, y: '0',
    },
    {
        color: '#fff4c9', size: `24x${height}`, opacity: 0.9,
        x: `-70+(main_w+140)*t/${duration}`, y: '0',
    },
], `noise=alls=17:allf=t+u,${fade}`);

const scan = (primary, secondary) => composeMovingLayers([
    {
        color: primary, size: `${width}x34`, opacity: 0.92,
        x: '0', y: `-34+(main_h+overlay_h)*t/${duration}`,
    },
    {
        color: secondary, size: `${width}x12`, opacity: 0.74,
        x: '0', y: `-170+(main_h+340)*t/${duration}`,
    },
], fade);

const speedLines = composeMovingLayers([
    { color: '#ffffff', size: '280x12', opacity: 0.9, x: `-280+(main_w+560)*t/${duration}`, y: '150' },
    { color: '#3fffd0', size: '360x8', opacity: 0.84, x: `-520+(main_w+1040)*t/${duration}`, y: '330' },
    { color: '#58a6ff', size: '190x16', opacity: 0.82, x: `-190+(main_w+380)*t/${duration}`, y: '540' },
    { color: '#ffffff', size: '420x7', opacity: 0.74, x: `-720+(main_w+1440)*t/${duration}`, y: '760' },
]);

const filmScratches = composeMovingLayers([
    { color: '#ffffff', size: `4x${height}`, opacity: 0.68, x: `40+420*t/${duration}`, y: '0' },
    { color: '#ffd88a', size: `2x${height}`, opacity: 0.72, x: `380-300*t/${duration}`, y: '0' },
    { color: '#ff7548', size: `7x${height}`, opacity: 0.55, x: `210+90*t/${duration}`, y: '0' },
], `noise=alls=13:allf=t+u,${fade}`);

const effects = [
    ['flash-white', 'Flash Clean', 'Luz & Cinema', 'Flash branco curto para esconder cortes secos.', simple(`color=c=white:s=${width}x${height}:r=30:d=${duration}`, 'fade=t=in:st=0:d=0.48,fade=t=out:st=0.48:d=0.62')],
    ['flash-warm', 'Flash Dourado', 'Luz & Cinema', 'Clarão quente para produto, beleza e lifestyle.', simple(`color=c=#ffd58a:s=${width}x${height}:r=30:d=${duration}`, 'fade=t=in:st=0:d=0.48,fade=t=out:st=0.48:d=0.62')],
    ['flash-red', 'Flash Rubi', 'Luz & Cinema', 'Impacto vermelho elegante para ofertas e chamadas.', simple(`color=c=#ff334f:s=${width}x${height}:r=30:d=${duration}`, 'fade=t=in:st=0:d=0.48,fade=t=out:st=0.48:d=0.62')],
    ['light-leak-left', 'Light Leak Âmbar', 'Luz & Cinema', 'Vazamento de luz quente da esquerda para a direita.', sweepX(['#ff7a18', '#ffc247', '#fff0b0'], 'lr', 190)],
    ['light-leak-right', 'Light Leak Rosé', 'Luz & Cinema', 'Vazamento rosa suave da direita para a esquerda.', sweepX(['#ff4f91', '#ff87ba', '#ffd4e8'], 'rl', 180)],
    ['light-leak-top', 'Light Leak Solar', 'Luz & Cinema', 'Luz solar descendo pelo quadro.', sweepY(['#ffc247', '#fff0a8', '#ffffff'], 'td', 190)],
    ['light-leak-bottom', 'Light Leak Sunset', 'Luz & Cinema', 'Luz alaranjada subindo pelo quadro.', sweepY(['#ff6a2a', '#ffb14e', '#fff0b0'], 'bu', 190)],
    ['film-burn-amber', 'Film Burn Âmbar', 'Luz & Cinema', 'Queima de filme quente com textura orgânica.', filmBurn('#ff5a12', '#ffe36e')],
    ['film-burn-red', 'Film Burn Carmim', 'Luz & Cinema', 'Queima cinematográfica vermelha e dourada.', filmBurn('#df1746', '#ffad32')],
    ['prism-rainbow', 'Prisma Rainbow', 'Luz & Cinema', 'Faixas prismáticas para moda e beleza.', movingBars(['#ff2a6d', '#ffb000', '#36f1cd', '#5b8cff', '#b34dff'], true)],
    ['flare-cyan', 'Flare Ciano', 'Luz & Cinema', 'Reflexo ciano limpo para tecnologia e produtos.', sweepX(['#42f5ff', '#d9ffff', '#168cff'], 'lr', 105)],
    ['flare-violet', 'Flare Violeta', 'Luz & Cinema', 'Reflexo violeta premium para cenas noturnas.', sweepX(['#9d5cff', '#ff72d0', '#e9d5ff'], 'rl', 105)],

    ['whip-left', 'Whip Branco →', 'Movimento & Energia', 'Rastro veloz horizontal para cortes dinâmicos.', sweepX(['#ffffff', '#c8efff'], 'lr', 92)],
    ['whip-right', 'Whip Branco ←', 'Movimento & Energia', 'Rastro veloz no sentido inverso.', sweepX(['#ffffff', '#c8efff'], 'rl', 92)],
    ['whip-down', 'Whip Vertical ↓', 'Movimento & Energia', 'Rastro vertical de cima para baixo.', sweepY(['#ffffff', '#c8efff'], 'td', 112)],
    ['whip-up', 'Whip Vertical ↑', 'Movimento & Energia', 'Rastro vertical de baixo para cima.', sweepY(['#ffffff', '#c8efff'], 'bu', 112)],
    ['energy-lime', 'Energia Lime', 'Movimento & Energia', 'Faixa verde elétrica alinhada à marca Mileto.', sweepX(['#00e676', '#b8ff3d', '#ffffff'], 'lr', 128)],
    ['energy-blue', 'Energia Azul', 'Movimento & Energia', 'Faixa azul vibrante para conteúdo corporativo.', sweepX(['#168cff', '#6fe7ff', '#ffffff'], 'rl', 128)],
    ['energy-orange', 'Energia Laranja', 'Movimento & Energia', 'Movimento quente para varejo e promoções.', sweepX(['#ff6a00', '#ffd166', '#ffffff'], 'lr', 128)],
    ['split-neon', 'Split Neon', 'Movimento & Energia', 'Duas faixas opostas convergem sobre o corte.', splitSweep],
    ['social-bars', 'Barras Social', 'Movimento & Energia', 'Barras curtas e rápidas para Reels e Shorts.', movingBars(['#00e676', '#42a5ff', '#ffca28', '#ff4f91', '#9d5cff', '#ffffff'])],
    ['speed-lines', 'Linhas de Velocidade', 'Movimento & Energia', 'Riscos luminosos que reforçam aceleração.', speedLines],

    ['neon-frame-lime', 'Moldura Neon Lime', 'Texturas & Acabamentos', 'Pulso de moldura verde para destacar a mudança.', simple(base, `drawbox=x=0:y=0:w=iw:h=ih:color=#00e676:t=24,fade=t=in:st=0:d=0.32,fade=t=out:st=0.58:d=0.48`)],
    ['neon-frame-violet', 'Moldura Neon Violeta', 'Texturas & Acabamentos', 'Moldura violeta sutil e contemporânea.', simple(base, `drawbox=x=0:y=0:w=iw:h=ih:color=#a855f7:t=24,fade=t=in:st=0:d=0.32,fade=t=out:st=0.58:d=0.48`)],
    ['scan-cyan', 'Scanner Ciano', 'Texturas & Acabamentos', 'Varredura tecnológica em duas camadas.', scan('#43f3ff', '#1c83ff')],
    ['scan-lime', 'Scanner Lime', 'Texturas & Acabamentos', 'Varredura verde para tecnologia e IA.', scan('#86ff8f', '#00e676')],
    ['rgb-slices', 'Fatias RGB', 'Texturas & Acabamentos', 'Fatias cromáticas com movimento alternado.', movingBars(['#ff295f', '#38e8ff', '#755cff', '#ff295f', '#38e8ff', '#755cff'])],
    ['gold-slices', 'Fatias Douradas', 'Texturas & Acabamentos', 'Lâminas douradas para produtos premium.', movingBars(['#ffb000', '#ffe08a', '#ff7a18', '#fff1bf', '#d98c00'], false, true)],
    ['film-scratches', 'Riscos de Filme', 'Texturas & Acabamentos', 'Riscos verticais discretos com sensação analógica.', filmScratches],
    ['soft-haze', 'Haze Rosé', 'Texturas & Acabamentos', 'Névoa rosé macia para beleza e moda.', sweepX(['#ff7eb6', '#ffc6dd', '#fff4f8'], 'lr', 260)],
];

const catalog = [];
for (const [id, originalName, category, description, effect] of effects) {
    const fileName = `${id}.mp4`;
    const target = join(outputDir, fileName);
    const args = ['-y'];
    effect.inputs.forEach((input) => args.push('-f', 'lavfi', '-i', input));
    args.push(
        '-filter_complex', effect.filter,
        '-map', '[outv]', '-t', String(duration), '-an', '-c:v', 'libx264',
        '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target,
    );

    const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) {
        throw new Error(`Falha ao gerar ${id}:\n${result.stderr}`);
    }
    catalog.push({
        id: `builtin-${id}`,
        originalName,
        category,
        description,
        durationSec: duration,
        fileName,
        isBuiltIn: true,
    });
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
console.log(`Geradas ${catalog.length} transições em ${outputDir}`);
