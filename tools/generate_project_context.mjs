#!/usr/bin/env node
/**
 * generate_project_context.mjs
 * Scans the Mileto Video Generator project and outputs PROJECT_CONTEXT_MILETO.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const EXCLUDE = new Set([
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.cache',
    'coverage',
    '.vscode',
    '.git',
    '.gemini',
    'frames',
    'frame_cache',
]);

// ── helpers ──────────────────────────────────────────────────────────────
function readJson(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return null;
    }
}
function readText(p) {
    try {
        return fs.readFileSync(p, 'utf-8');
    } catch {
        return '';
    }
}
function walk(dir, exts, result = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, exts, result);
        else if (!exts || exts.some((x) => e.name.endsWith(x))) result.push(full);
    }
    return result;
}
function rel(p) {
    return path.relative(ROOT, p).replace(/\\/g, '/');
}
function countLines(p) {
    return readText(p).split('\n').length;
}

// ── 1. Package info ─────────────────────────────────────────────────────
const rootPkg = readJson(path.join(ROOT, 'package.json'));
const clientPkg = readJson(path.join(ROOT, 'apps/client/package.json'));
const serverPkg = readJson(path.join(ROOT, 'apps/server/package.json'));

function depsTable(pkg, label) {
    if (!pkg) return `*${label} package.json not found*\n`;
    const deps = { ...pkg.dependencies };
    const dev = { ...pkg.devDependencies };
    let t = `| Package | Version | Type |\n|---------|---------|------|\n`;
    for (const [k, v] of Object.entries(deps)) t += `| \`${k}\` | ${v} | dep |\n`;
    for (const [k, v] of Object.entries(dev)) t += `| \`${k}\` | ${v} | dev |\n`;
    return t;
}

// ── 2. Directory tree ────────────────────────────────────────────────────
function tree(dir, prefix = '', depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return '';
    let out = '';
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return '';
    }
    entries = entries.filter((e) => !EXCLUDE.has(e.name));
    entries.sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
    );
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const last = i === entries.length - 1;
        const connector = last ? '└── ' : '├── ';
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            out += `${prefix}${connector}${e.name}/\n`;
            out += tree(full, prefix + (last ? '    ' : '│   '), depth + 1, maxDepth);
        } else {
            const ext = path.extname(e.name);
            if (
                ['.ts', '.tsx', '.js', '.mjs', '.css', '.json'].includes(ext) ||
                e.name === '.env' ||
                e.name === '.env.example'
            ) {
                out += `${prefix}${connector}${e.name}\n`;
            }
        }
    }
    return out;
}

// ── 3. Wizard steps ──────────────────────────────────────────────────────
const STEPS = ['Step1.tsx', 'Step2.tsx', 'Step3.tsx', 'Step4.tsx'];
const stepsDir = path.join(ROOT, 'apps/client/src/pages');
function analyzeStep(filename) {
    const fp = path.join(stepsDir, filename);
    const src = readText(fp);
    if (!src) return null;
    const lines = src.split('\n').length;
    // extract top-level comments / JSDoc or first big comment block
    const imports = src.match(/import .+/g) || [];
    const stateVars = src.match(/const \[(\w+),\s*set\w+\]\s*=\s*useState/g) || [];
    const apiCalls = src.match(/fetch\(.+?\)|axios\.\w+\(.+?\)|\.post\(.+?\)|\.get\(.+?\)/g) || [];
    const wizardCalls = src.match(/update\w+|adData\.\w+|mediaTakes/g) || [];
    return {
        file: rel(fp),
        lines,
        imports: imports.length,
        stateVars,
        apiCalls,
        wizardCalls: [...new Set(wizardCalls)],
    };
}

// ── 4. Critical components ───────────────────────────────────────────────
const CRITICAL = [
    {
        name: 'ProjectPreviewPanel',
        glob: 'ProjectPreviewPanel.tsx',
        role: 'Preview em tempo real com RAF loop, transições visuais, sync de áudio e captions overlay',
    },
    {
        name: 'TimelineEditor',
        glob: 'TimelineEditor.tsx',
        role: 'Editor de audio timeline DAW-like com zoom, drag, split, delete, playback Web Audio API',
    },
    {
        name: 'TransitionModal',
        glob: 'TransitionModal.tsx',
        role: 'Modal de seleção de transição entre takes (tipo + duração)',
    },
    {
        name: 'CaptionOverlay',
        glob: 'CaptionOverlay.tsx',
        role: 'Renderiza legendas sincronizadas com karaokê word-level',
    },
    {
        name: 'useAudioEngine',
        glob: 'useAudioEngine.ts',
        role: 'Hook Web Audio API — decode, schedule, play, seek, fade',
    },
    { name: 'VideoUpload', glob: 'VideoUpload.tsx', role: 'Upload de mídia via react-dropzone → /api/video/upload' },
    {
        name: 'WizardContext',
        glob: 'WizardContext.tsx',
        role: 'State global (adData, mediaTakes, apiKeys, audioConfig, persistence)',
    },
];

function findFile(name) {
    const all = walk(path.join(ROOT, 'apps/client/src'), ['.ts', '.tsx']);
    return all.find((f) => path.basename(f) === name);
}

// ── 5. API routes ────────────────────────────────────────────────────────
function extractRoutes() {
    const apiFile = path.join(ROOT, 'apps/server/src/routes/api.ts');
    const src = readText(apiFile);
    if (!src) return [];
    const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
    const routes = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    return routes;
}

// ── 6. Render pipeline keywords ──────────────────────────────────────────
function scanKeywords(dir, keywords) {
    const files = walk(dir, ['.ts', '.tsx', '.js', '.mjs']);
    const hits = {};
    for (const f of files) {
        const src = readText(f);
        for (const kw of keywords) {
            if (src.toLowerCase().includes(kw.toLowerCase())) {
                if (!hits[kw]) hits[kw] = [];
                hits[kw].push(rel(f));
            }
        }
    }
    return hits;
}

// ── 7. Types summary ────────────────────────────────────────────────────
function extractInterfaces(filePath) {
    const src = readText(filePath);
    if (!src) return [];
    const re = /(?:export\s+)?(?:interface|type)\s+(\w+)/g;
    const names = [];
    let m;
    while ((m = re.exec(src)) !== null) names.push(m[1]);
    return names;
}

// ── 8. TODOs / FIXMEs ────────────────────────────────────────────────────
function collectTodos(dir) {
    const files = walk(dir, ['.ts', '.tsx', '.js', '.mjs']);
    const todos = [];
    const re = /\/\/\s*(TODO|FIXME|HACK|BUG|XXX|BROKEN)[:\s]*(.*)/gi;
    for (const f of files) {
        const lines = readText(f).split('\n');
        for (let i = 0; i < lines.length; i++) {
            let m;
            while ((m = re.exec(lines[i])) !== null) {
                todos.push({ file: rel(f), line: i + 1, tag: m[1].toUpperCase(), text: m[2].trim() });
            }
        }
    }
    return todos;
}

// ── 9. Caption presets ───────────────────────────────────────────────────
function extractPresets() {
    const fp = path.join(ROOT, 'apps/client/src/lib/captions/presets.ts');
    const src = readText(fp);
    if (!src) return [];
    const re = /id:\s*['"`]([^'"`]+)['"`].*?name:\s*['"`]([^'"`]+)['"`]/gs;
    const presets = [];
    let m;
    while ((m = re.exec(src)) !== null) presets.push({ id: m[1], name: m[2] });
    return presets;
}

// ── 10. Speed presets ────────────────────────────────────────────────────
function extractSpeedPresets() {
    const fp = path.join(ROOT, 'apps/client/src/lib/speedCurve.ts');
    const src = readText(fp);
    if (!src) return [];
    const re = /id:\s*['"`]([^'"`]+)['"`].*?label:\s*['"`]([^'"`]+)['"`]/gs;
    const p = [];
    let m;
    while ((m = re.exec(src)) !== null) p.push({ id: m[1], label: m[2] });
    return p;
}

// ── 11. Transition types ─────────────────────────────────────────────────
function extractTransitions() {
    const src = readText(path.join(ROOT, 'apps/server/src/services/ffmpeg.ts'));
    const re = /['"`](\w[\w-]*)['"`]\s*:\s*['"`](\w+)['"`]/g;
    const map = {};
    let m;
    // find XFADE_MAP block
    const block = src.match(/XFADE_MAP[^}]+\{([^}]+)\}/s);
    if (block) {
        while ((m = re.exec(block[1])) !== null) map[m[1]] = m[2];
    }
    return map;
}

// ── ASSEMBLE ─────────────────────────────────────────────────────────────
let md = '';
const h = (n, t) => '#'.repeat(n) + ' ' + t + '\n\n';
const ln = (t) => t + '\n';

md += h(1, 'PROJECT_CONTEXT_MILETO.md');
md += '> Documento de referência gerado automaticamente por `tools/generate_project_context.mjs`.\n';
md += '> **Nenhum código foi alterado** — arquivo puramente documental.\n\n---\n\n';

// ── Section 1: Visão Geral ────────────────────────────────────────────────
md += h(2, '1. Visão Geral');
md += 'O **Mileto Gerador de Vídeo** é uma aplicação full-stack para criação de vídeo-anúncios com IA.\n';
md += 'O usuário é guiado por um wizard de 4 etapas: narração → mídias → legendas → renderização.\n';
md += 'Output final: MP4 com vídeo editado, narração TTS, música de fundo e legendas automáticas.\n\n';
md += 'Recursos principais:\n';
md += '- Narração via TTS (Fish Audio / ElevenLabs)\n';
md += '- Upload e edição de mídia (trim, velocidade, transições)\n';
md += '- Geração de imagens/vídeos com IA (Replicate SDXL, Runway)\n';
md += '- Legendas automáticas com karaokê word-level\n';
md += '- Timeline de áudio DAW-like\n';
md += '- Renderização server-side via FFmpeg\n\n---\n\n';

// ── Section 2: Stack ──────────────────────────────────────────────────────
md += h(2, '2. Stack Tecnológica');
md += h(3, 'Monorepo Root');
md += `- **Nome**: ${rootPkg?.name || 'N/A'}\n`;
md += `- **Tipo**: ${rootPkg?.type || 'N/A'}\n`;
md += `- **Workspaces**: ${(rootPkg?.workspaces || []).join(', ')}\n`;
md += `- **Scripts**: ${Object.keys(rootPkg?.scripts || {}).join(', ')}\n\n`;

md += h(3, 'Client Dependencies');
md += depsTable(clientPkg, 'Client') + '\n';
md += h(3, 'Server Dependencies');
md += depsTable(serverPkg, 'Server') + '\n';
md += '---\n\n';

// ── Section 3: Estrutura ──────────────────────────────────────────────────
md += h(2, '3. Estrutura do Projeto');
md += '```\n';
md += tree(ROOT, '', 0, 4);
md += '```\n\n---\n\n';

// ── Section 4: Wizard Steps ───────────────────────────────────────────────
md += h(2, '4. Fluxo do Wizard (Steps 1–4)');
const stepDescriptions = {
    'Step1.tsx': {
        title: 'Informações do Anúncio / Narração',
        desc: 'Título, formato (aspect ratio), texto da narração, seleção de voz, geração TTS via Fish Audio. State: adData.title, format, narrationText, selectedVoiceId, narrationAudioUrl, narrationDuration.',
    },
    'Step2.tsx': {
        title: 'Takes & Cortes',
        desc: 'Upload de vídeo/imagem, reordenação DnD, trimming, speed curves, transições, geração de imagem/vídeo via IA. State: mediaTakes[] com trim, speedCurve, transition.',
    },
    'Step3.tsx': {
        title: 'Legendas Automáticas',
        desc: 'Geração de captions a partir do narrationText, seleção de preset visual (5 estilos), karaokê word-level. State: adData.captions (CaptionTrack com segments e words).',
    },
    'Step4.tsx': {
        title: 'Renderização',
        desc: 'Trigger POST /api/video/render, indicador de progresso, download do MP4 final. State: progress, status, videoUrl.',
    },
};
for (const s of STEPS) {
    const info = analyzeStep(s);
    const desc = stepDescriptions[s];
    md += h(3, `Step ${s.replace('Step', '').replace('.tsx', '')} — ${desc?.title || s}`);
    if (info) {
        md += `**Arquivo**: \`${info.file}\` (${info.lines} linhas)\n\n`;
    }
    md += `${desc?.desc || ''}\n\n`;
    if (info && info.stateVars.length) {
        md += `**useState detectados**: ${info.stateVars.length}\n\n`;
    }
}
md += '---\n\n';

// ── Section 5: Types ──────────────────────────────────────────────────────
md += h(2, '5. Principais Modelos / Types');
const typesFile = path.join(ROOT, 'apps/client/src/types/index.ts');
const typeNames = extractInterfaces(typesFile);
if (typeNames.length) {
    md += `**Arquivo**: \`${rel(typesFile)}\` (${countLines(typesFile)} linhas)\n\n`;
    md += `Interfaces/Types detectados: ${typeNames.map((t) => '`' + t + '`').join(', ')}\n\n`;
    md += 'Os principais modelos incluem:\n';
    md += '- **MediaTake**: Segmento de mídia (vídeo/imagem) com trim, speedCurve, transition\n';
    md += '- **AdData**: Dados globais do anúncio (título, formato, narração, captions, audioConfig)\n';
    md += '- **AudioTimeline / AudioTimelineTrack / AudioClip**: Timeline de áudio DAW-like\n';
    md += '- **CaptionTrack / CaptionSegment**: Legendas com timing e words (karaokê)\n';
    md += '- **SpeedKeyframe**: Keyframe de velocidade (position 0–1, speed multiplier)\n';
    md += '- **TransitionType**: Tipo de transição entre takes\n';
    md += '- **AudioConfig**: Configuração legacy de áudio (volume, offset, trim, fades)\n\n';
} else {
    md += '*Arquivo de types não encontrado.*\n\n';
}
md += '---\n\n';

// ── Section 6: Componentes Críticos ───────────────────────────────────────
md += h(2, '6. Componentes Críticos');
md += '| Componente | Arquivo | Linhas | Função |\n';
md += '|-----------|---------|--------|--------|\n';
for (const c of CRITICAL) {
    const fp = findFile(c.glob);
    const lines = fp ? countLines(fp) : '?';
    md += `| **${c.name}** | \`${fp ? rel(fp) : 'não encontrado'}\` | ${lines} | ${c.role} |\n`;
}
md += '\n---\n\n';

// ── Section 7: API Routes ─────────────────────────────────────────────────
md += h(2, '7. API REST (Server)');
const routes = extractRoutes();
if (routes.length) {
    md += `**Arquivo**: \`apps/server/src/routes/api.ts\`\n\n`;
    md += '| Método | Rota |\n';
    md += '|--------|------|\n';
    for (const r of routes) md += `| \`${r.method}\` | \`${r.path}\` |\n`;
    md += '\n';
    md += '**Static dirs servidos**: `/data/`, `/music/`, `/uploads/`, `/` (public).\n\n';
    md +=
        '**Upload middleware**: Multer disk storage, UUID filenames, types: video/mp4, quicktime, x-matroska, x-msvideo, image/jpeg, png, webp, audio/mpeg, wav, ogg.\n\n';
} else {
    md += '*Arquivo de rotas não encontrado.*\n\n';
}
md += '---\n\n';

// ── Section 8: Render Pipeline ────────────────────────────────────────────
md += h(2, '8. Pipeline de Renderização');
const renderKw = scanKeywords(path.join(ROOT, 'apps/server/src'), [
    'ffmpeg',
    'xfade',
    'renderVideo',
    'concat',
    'amix',
    'setpts',
    'audioMix',
]);
md += '**Arquivos envolvidos**:\n';
for (const [kw, files] of Object.entries(renderKw)) {
    md += `- Keyword \`${kw}\`: ${files.map((f) => '`' + f + '`').join(', ')}\n`;
}
md += '\n**Pipeline** (3 fases):\n';
md += '1. **Normalize**: Trim + Speed (setpts) + Resize 720×1280 para cada segment\n';
md += '2. **Concatenate**: concat simples (sem transição) ou xfade (com transição)\n';
md += '3. **Audio Mix**: narração + música via amix ou audioTimeline mix\n\n';

const transitions = extractTransitions();
if (Object.keys(transitions).length) {
    md += '**Transições → xfade FFmpeg**:\n\n';
    md += '| App | FFmpeg |\n|-----|--------|\n';
    for (const [k, v] of Object.entries(transitions)) md += `| \`${k}\` | \`${v}\` |\n`;
    md += '\n';
}
md += '---\n\n';

// ── Section 9: IA Integrations ────────────────────────────────────────────
md += h(2, '9. Integrações de IA');
const aiKw = scanKeywords(path.join(ROOT, 'apps/server/src'), [
    'replicate',
    'runway',
    'fish.audio',
    'elevenlabs',
    'veo3',
    'gen3a',
]);
for (const [kw, files] of Object.entries(aiKw)) {
    md += `- **${kw}**: ${files.map((f) => '`' + f + '`').join(', ')}\n`;
}
md += '\n';
md += '**Serviços detectados**:\n';
md += '- **Fish Audio** (`fishAudio.ts`): TTS via `POST https://api.fish.audio/v1/tts`, cache MD5\n';
md += '- **ElevenLabs** (`elevenlabs.ts`): TTS via ElevenLabs API, modelo `eleven_multilingual_v2` (legacy)\n';
md += '- **Replicate** (`aiController.ts`): Image gen via Stability AI SDXL\n';
md += '- **Runway** (`aiController.ts`): Text-to-Video (`veo3.1_fast`), Image-to-Video (`gen3a_turbo`)\n\n';
md += '---\n\n';

// ── Section 10: Captions ──────────────────────────────────────────────────
md += h(2, '10. Sistema de Legendas');
const presets = extractPresets();
if (presets.length) {
    md += '**Presets** (`lib/captions/presets.ts`):\n\n';
    md += '| ID | Nome |\n|----|------|\n';
    for (const p of presets) md += `| \`${p.id}\` | ${p.name} |\n`;
    md += '\n';
}
md +=
    '**Renderização** (`CaptionOverlay.tsx`): Bottom 12%, Montserrat 900 uppercase, WebkitTextStroke 1.5px black, `clamp(16px, 6cqw, 42px)`. Karaokê: palavra ativa `#FFD400`.\n\n';
md += '---\n\n';

// ── Section 11: Audio Timeline ────────────────────────────────────────────
md += h(2, '11. Timeline de Áudio');
md +=
    '**Arquitetura**: `TimelineEditor` (805 linhas) → `TrackLane` → `ClipItem`, com `TimeRuler` e `useAudioEngine` backend.\n\n';
md += '| Feature | Status |\n|---------|--------|\n';
md +=
    '| Drag/move clips | ✅ |\n| Trim start/end | ✅ |\n| Split no cursor | ✅ |\n| Delete | ✅ |\n| Volume por track | ✅ |\n';
md +=
    '| Mute/Solo | ✅ UI, lógica parcial |\n| Zoom 10%–500% | ✅ |\n| Auto-zoom fit | ✅ |\n| Playback preview | ✅ Web Audio API |\n| Autosave ↔ adData | ✅ |\n| Playhead drag | ✅ |\n\n';
md += '**Legacy compat**: `audioTimeline` coexiste com `audioConfig`, sincronizados bidirecionalmente.\n\n';
md += '---\n\n';

// ── Section 12: Persistência ──────────────────────────────────────────────
md += h(2, '12. Persistência / Storage');
md += '### Client\n| Mecanismo | Dados |\n|-----------|-------|\n';
md += '| `WizardContext` | adData, mediaTakes, apiKeys, customVoices |\n';
md += '| `localStorage` | API keys, custom voices, UI theme |\n\n';
md += '### Server\n| Local | Dados |\n|-------|-------|\n';
md += '| `data/projects/<id>/ad-data.json` | State do projeto |\n';
md += '| `data/music_library.json` | Biblioteca musical |\n';
md += '| `uploads/` | Mídia original + proxies |\n';
md += '| `music/` | Arquivos de música |\n';
md += '| `public/narrations/` | TTS cached |\n';
md += '| `public/videos/` | Vídeos renderizados |\n';
md += '| `temp/` | Temporários do render |\n\n';
md += '---\n\n';

// ── Section 13: TODOs ─────────────────────────────────────────────────────
md += h(2, '13. TODOs / Backlog');
const todos = [
    ...collectTodos(path.join(ROOT, 'apps/client/src')),
    ...collectTodos(path.join(ROOT, 'apps/server/src')),
];
if (todos.length) {
    md += `**${todos.length} itens encontrados no código**:\n\n`;
    md += '| Tag | Arquivo | Linha | Texto |\n|-----|---------|-------|-------|\n';
    for (const t of todos.slice(0, 40)) {
        md += `| ${t.tag} | \`${t.file}\` | ${t.line} | ${t.text.substring(0, 80)} |\n`;
    }
    if (todos.length > 40) md += `\n*... e mais ${todos.length - 40} itens.*\n`;
    md += '\n';
} else {
    md += '*Nenhum TODO/FIXME encontrado.*\n\n';
}
md += '---\n\n';

// ── Section 14: Bugs / Problemas ──────────────────────────────────────────
md += h(2, '14. Problemas / Bugs Conhecidos');
md += '### Alta Prioridade\n';
md += '1. **Transição preview ≠ render** — Client usa CSS opacity, server usa xfade FFmpeg\n';
md += '2. **Speed curve dessincroniza preview** — RAF loop vs setpts não são idênticos\n';
md += '3. **Console.log em production** — Debug logs espalhados no RAF loop e autosave\n\n';
md += '### Média Prioridade\n';
md += '4. **Proxy generation blocking** — Upload aguarda proxy MP4, pode timeout\n';
md += '5. **Temp files não limpos** — `fs.rmSync` comentado em ffmpeg.ts\n';
md += '6. **Music volume hardcoded** — Fixo 0.1 no mix simples\n';
md += '7. **Caption overlay duplicada** — Renderiza em stageContent E no container\n\n';
md += '### Baixa Prioridade\n';
md += '8. **Legacy presets** — clean-white e box-dark marcados legacy mas visíveis\n';
md += '9. **ElevenLabs não usado** — ttsController importa só fishAudio\n';
md += '10. **Test endpoints mock** — test-gemini e test-openai só validam comprimento\n\n';
md += '---\n\n';

// ── Footer ────────────────────────────────────────────────────────────────
md += `> Gerado automaticamente em ${new Date().toISOString()} por \`tools/generate_project_context.mjs\`.\n`;
md += `> Análise de ${walk(path.join(ROOT, 'apps'), ['.ts', '.tsx', '.js', '.mjs']).length} arquivos-fonte.\n`;

// ── WRITE ─────────────────────────────────────────────────────────────────
const outPath = path.join(ROOT, 'PROJECT_CONTEXT_MILETO.md');
fs.writeFileSync(outPath, md, 'utf-8');
const stats = fs.statSync(outPath);
const preview = md.split('\n').slice(0, 30).join('\n');

console.log('═'.repeat(60));
console.log('✅ Arquivo gerado com sucesso!');
console.log(`📄 Path: ${outPath}`);
console.log(`📏 Size: ${stats.size} bytes (${md.length} caracteres)`);
console.log(`📊 Lines: ${md.split('\n').length}`);
console.log(`✓  Length > 8000: ${md.length > 8000 ? 'SIM' : 'NÃO ⚠️'}`);
console.log('═'.repeat(60));
console.log('\n── Preview (30 primeiras linhas) ──\n');
console.log(preview);
console.log('\n── Fim do preview ──');
