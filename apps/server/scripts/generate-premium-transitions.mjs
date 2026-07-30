import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(serverDir, 'public', 'transitions', 'builtins');
const ffmpeg = resolve(serverDir, '..', 'client', 'resources', 'bin', 'ffmpeg.exe');
const duration = 1.0;
const size = '540x960';

mkdirSync(outputDir, { recursive: true });

const effects = [
    ['whip-motion-blur', 'Whip Motion Blur', 'Movimento premium', 'Rastro branco veloz para cortes de câmera dinâmicos.', "drawbox=x=80:y=0:w=350:h=ih:color=white@0.82:t=fill,drawbox=x=160:y=0:w=68:h=ih:color=0x8feeff@0.72:t=fill,fade=t=in:st=0:d=0.08,fade=t=out:st=0.72:d=0.28"],
    ['foreground-wipe', 'Foreground Wipe', 'Movimento premium', 'Passagem de primeiro plano para mudanças naturais de cena.', "drawbox=x=40:y=0:w=390:h=ih:color=white@0.90:t=fill,drawbox=x=40:y=0:w=72:h=ih:color=0x00e676@0.76:t=fill,fade=t=in:st=0:d=0.08,fade=t=out:st=0.72:d=0.28"],
    ['prism-glass', 'Prism Glass', 'Acabamento premium', 'Refração de vidro discreta, pensada para óticas e beleza.', "drawbox=x=100:y=0:w=160:h=ih:color=0x6fe7ff@0.64:t=fill,drawbox=x=250:y=0:w=72:h=ih:color=0xffd36b@0.72:t=fill,drawbox=x=340:y=0:w=44:h=ih:color=0xff8ac7@0.66:t=fill,fade=t=in:st=0:d=0.10,fade=t=out:st=0.72:d=0.28"],
    ['soft-light-leak', 'Soft Light Leak', 'Acabamento premium', 'Luz âmbar macia, sem aparência de efeito exagerado.', "drawbox=x=70:y=0:w=280:h=ih:color=0xff8a3d@0.56:t=fill,drawbox=x=180:y=0:w=150:h=ih:color=0xffdc8a@0.64:t=fill,drawbox=x=285:y=0:w=44:h=ih:color=white@0.82:t=fill,fade=t=in:st=0:d=0.12,fade=t=out:st=0.68:d=0.32"],
    ['kinetic-slice', 'Kinetic Slice', 'Impacto editorial', 'Três lâminas precisas para CTA, preço e virada de oferta.', "drawbox=x=50:y=140:w=340:h=82:color=0x00e676@0.88:t=fill,drawbox=x=150:y=440:w=340:h=82:color=white@0.86:t=fill,drawbox=x=50:y=740:w=340:h=82:color=0xa855f7@0.84:t=fill,fade=t=in:st=0:d=0.08,fade=t=out:st=0.70:d=0.30"],
];

const catalog = effects.map(([id, originalName, category, description, filter]) => {
    const fileName = `${id}.mp4`;
    const output = join(outputDir, fileName);
    const result = spawnSync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${duration}`,
        '-vf', `${filter},format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', output,
    ], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Falha ao gerar ${id}: ${result.stderr}`);
    return { id: `builtin-${id}`, originalName, category, description, durationSec: duration, fileName, isBuiltIn: true };
});

writeFileSync(join(outputDir, 'catalog.json'), JSON.stringify(catalog, null, 2));
console.log(`Geradas ${catalog.length} transições premium.`);
