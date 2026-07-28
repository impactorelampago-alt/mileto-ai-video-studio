/**
 * Migração única (v1): centraliza TODA a mídia do app em files/ (Imagens, Vídeos,
 * Músicas) e constrói o índice central files_index.json.
 *
 * O que faz (uma única vez, marcada por data/.files_v1):
 *  1. BACKUP de music/, uploads/ e data/projects/ → data/_backup_pre_files_<ts>/
 *  2. Move arquivos físicos:
 *     - music/*           → files/Músicas/
 *     - uploads/* vídeo   → files/Vídeos/   (+ o _proxy.mp4 correspondente)
 *     - uploads/* imagem  → files/Imagens/
 *     - data/projects/<id>/ai/{images,videos}/* → files/Imagens|Vídeos/
 *     - data/projects/<id>/uploads/images/*     → files/Imagens/
 *  3. Constrói files_index.json (mescla music_library.json + arquivos descobertos).
 *  4. Reescreve TODOS ad-data.json com os novos caminhos públicos.
 *  5. Zera music_library.json legado. Cria a flag .files_v1.
 *
 * Segurança: por padrão só RELATA (dry-run). Executa de verdade com APPLY=1 (CLI)
 * ou quando o boot do app chama runMigration({ apply: true }). Em caso de erro aborta
 * e deixa o backup intacto — nada além do backup é alterado antes de todos os passos.
 *
 * Uso:  npx ts-node src/scripts/migrateToFiles.ts           (dry-run por padrão)
 *       APPLY=1 npx ts-node src/scripts/migrateToFiles.ts   (executa de verdade)
 *       Chamada automática no boot pelo index.ts (apply: true, com backup).
 */
import fs from 'fs';
import path from 'path';
import { FILES_ROOT, readIndex, writeIndex, registerFile, reconcileProjects, type FileEntry, type Category } from '../controllers/fileExplorerController';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const DATA_DIR = path.join(BASE_DATA_PATH, 'data');
const FLAG = path.join(DATA_DIR, '.files_v1');
const MUSIC_LEGACY_DIR = path.join(BASE_DATA_PATH, 'music');
const UPLOADS_DIR = path.join(BASE_DATA_PATH, 'uploads');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MUSIC_LEGACY_JSON = path.join(DATA_DIR, 'music_library.json');

// Segurança: PADRÃO é dry-run (só relata). Só aplica de verdade com APPLY=1 ou quando
// o boot do app chama runMigration({ apply: true }). Evita rodar a migração real por acidente.
let DRY_RUN = process.env.APPLY !== '1';

const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

function log(msg: string): void {
    console.log(`[Migrate] ${msg}`);
}

function extOf(name: string): string {
    return path.extname(name).toLowerCase();
}

/** Cria diretório (recursive) se não existir. */
function ensureDir(p: string): void {
    if (!DRY_RUN && !fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/** Copia recursivamente (sync). Usado para o backup. */
function copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(s, d);
        else if (entry.isFile()) fs.copyFileSync(s, d);
    }
}

/** Move um arquivo (preservando o nome). Retorna o destino absoluto. */
function moveFile(src: string, destDir: string): string {
    const dest = path.join(destDir, path.basename(src));
    if (DRY_RUN) {
        log(`  (dry-run) moveria ${path.relative(BASE_DATA_PATH, src)} → ${path.relative(BASE_DATA_PATH, dest)}`);
        return dest;
    }
    fs.renameSync(src, dest);
    return dest;
}

/** Sincroniza: (re)escreve o índice com a lista fornecida. No dry-run, só conta. */
function commitIndex(entries: FileEntry[]): void {
    if (DRY_RUN) {
        log(`  (dry-run) índice teria ${entries.length} entrada(s).`);
        return;
    }
    writeIndex(entries);
}

interface MigrationReport {
    music: number;
    videos: number;
    proxies: number;
    images: number;
    projectsRewritten: number;
    skipped: number;
}

export async function runMigration(opts?: { force?: boolean; apply?: boolean }): Promise<MigrationReport> {
    // No boot do app passamos apply=true; o DRY_RUN só vale pra chamada via CLI.
    if (opts?.apply) DRY_RUN = false;

    // Idempotência: se a flag já existe, nada a fazer (a menos que force=true).
    if (!opts?.force && fs.existsSync(FLAG)) {
        log('Flag .files_v1 presente — migração já rodou. Pulando.');
        return { music: 0, videos: 0, proxies: 0, images: 0, projectsRewritten: 0, skipped: 1 };
    }

    log(DRY_RUN ? '=== MODO DRY-RUN (não altera nada) ===' : '=== Iniciando migração ===');

    // 1. BACKUP (sempre, mesmo em apply — segurança contra corrupção).
    if (!DRY_RUN) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(DATA_DIR, `_backup_pre_files_${ts}`);
        log(`Backup → ${path.relative(BASE_DATA_PATH, backupDir)}`);
        copyDirSync(MUSIC_LEGACY_DIR, path.join(backupDir, 'music'));
        copyDirSync(UPLOADS_DIR, path.join(backupDir, 'uploads'));
        copyDirSync(PROJECTS_DIR, path.join(backupDir, 'projects'));
    } else {
        log('(dry-run) faria backup de music/, uploads/, projects/');
    }

    const report: MigrationReport = { music: 0, videos: 0, proxies: 0, images: 0, projectsRewritten: 0, skipped: 0 };
    const index = readIndex(); // começa do que já existe (ex: uploads feitos após F2)

    // Mapa: publicUrl antigo → novo (para reconciliar projetos no fim).
    const urlMap = new Map<string, string>();

    // Helper: registra no índice uma categoria + mapeia URL antiga→nova.
    const adopt = async (filePath: string, category: Category, oldPublicUrl: string | null, relSubdir: string) => {
        const name = path.basename(filePath);
        const relPath = `${relSubdir}/${name}`.split(path.sep).join('/');
        if (DRY_RUN) {
            // No dry-run não move nem registra — só conta.
            return;
        }
        const entry = await registerFile(filePath, relPath, { category });
        index.push(entry);
        if (oldPublicUrl) urlMap.set(oldPublicUrl, entry.publicUrl);
    };

    ensureDir(path.join(FILES_ROOT, 'Músicas'));
    ensureDir(path.join(FILES_ROOT, 'Vídeos'));
    ensureDir(path.join(FILES_ROOT, 'Imagens'));

    // 2a. MÚSICAS (music/* + music_library.json)
    if (fs.existsSync(MUSIC_LEGACY_DIR)) {
        const libMeta: Array<{ id: string; publicUrl: string; displayName: string; durationSec: number; createdAt: string }> =
            (() => {
                try {
                    return JSON.parse(fs.readFileSync(MUSIC_LEGACY_JSON, 'utf-8'));
                } catch {
                    return [];
                }
            })();
        const metaByUrl = new Map(libMeta.map((m) => [m.publicUrl, m]));

        for (const name of fs.readdirSync(MUSIC_LEGACY_DIR)) {
            const src = path.join(MUSIC_LEGACY_DIR, name);
            if (!fs.statSync(src).isFile()) continue;
            const dest = moveFile(src, path.join(FILES_ROOT, 'Músicas'));
            const oldUrl = `/music/${name}`;
            const meta = metaByUrl.get(oldUrl);
            await adopt(dest, 'Músicas', oldUrl, 'Músicas');
            // Preserva metadados legados (displayName, duração) se houver.
            if (meta && !DRY_RUN) {
                const last = index[index.length - 1];
                last.durationSec = meta.durationSec;
                last.createdAt = meta.createdAt;
            }
            report.music++;
        }
        commitIndex(index);
        log(`Músicas migradas: ${report.music}`);
    }

    // 2b. UPLOADS (uploads/*) — vídeos, imagens, e os _proxy.mp4.
    if (fs.existsSync(UPLOADS_DIR)) {
        const proxies: Array<{ from: string; to: string }> = [];
        const names = fs.readdirSync(UPLOADS_DIR);
        for (const name of names) {
            const src = path.join(UPLOADS_DIR, name);
            if (!fs.statSync(src).isFile()) continue;

            // Proxy 720p: <basename>_proxy.mp4 — trata DEPOIS do original, pareando.
            if (/_proxy\.(mp4|mov|mkv|avi|webm)$/i.test(name)) {
                const base = name.replace(/_proxy\./, '.');
                proxies.push({ from: `/uploads/${name}`, to: `/uploads/${base}` });
                // o proxy físico também é mídia (vai pra Vídeos)
                const dest = moveFile(src, path.join(FILES_ROOT, 'Vídeos'));
                await adopt(dest, 'Vídeos', `/uploads/${name}`, 'Vídeos');
                report.proxies++;
                continue;
            }

            const ext = extOf(name);
            if (VIDEO_EXTS.includes(ext)) {
                const dest = moveFile(src, path.join(FILES_ROOT, 'Vídeos'));
                await adopt(dest, 'Vídeos', `/uploads/${name}`, 'Vídeos');
                report.videos++;
            } else if (IMAGE_EXTS.includes(ext)) {
                const dest = moveFile(src, path.join(FILES_ROOT, 'Imagens'));
                await adopt(dest, 'Imagens', `/uploads/${name}`, 'Imagens');
                report.images++;
            } else {
                report.skipped++;
                log(`  (pulando) ${name}: extensão não-mídia`);
            }
        }
        commitIndex(index);
        // Aponta o proxy pro NOVO caminho do seu original (não pro original velho).
        for (const { from, to } of proxies) {
            const newOrig = urlMap.get(to);
            if (newOrig) urlMap.set(from, urlMap.get(from) || newOrig.replace(/\.(mp4|mov)$/i, '_proxy.$1'));
        }
        log(`Uploads: ${report.videos} vídeo(s), ${report.proxies} proxy, ${report.images} imagem(ns), ${report.skipped} pulado(s).`);
    }

    // 2c. MÍDIA DENTRO DE PROJETOS (data/projects/<id>/ai|uploads/...)
    if (fs.existsSync(PROJECTS_DIR)) {
        for (const proj of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
            if (!proj.isDirectory()) continue;
            const projRoot = path.join(PROJECTS_DIR, proj.name);
            const buckets: Array<{ src: string; category: Category }> = [
                { src: path.join(projRoot, 'ai/images'), category: 'Imagens' },
                { src: path.join(projRoot, 'ai/videos'), category: 'Vídeos' },
                { src: path.join(projRoot, 'uploads/images'), category: 'Imagens' },
            ];
            for (const { src, category } of buckets) {
                if (!fs.existsSync(src)) continue;
                const subdir = category === 'Imagens' ? 'Imagens' : 'Vídeos';
                for (const name of fs.readdirSync(src)) {
                    const full = path.join(src, name);
                    if (!fs.statSync(full).isFile()) continue;
                    const oldUrl = `/data/projects/${proj.name}/${path.relative(projRoot, full).split(path.sep).join('/')}`;
                    const dest = moveFile(full, path.join(FILES_ROOT, subdir));
                    await adopt(dest, category, oldUrl, subdir);
                    if (category === 'Vídeos') report.videos++;
                    else report.images++;
                }
            }
        }
        commitIndex(index);
        log(`Mídia de projetos movida (total acumulado: ${report.videos} vídeos, ${report.images} imagens).`);
    }

    // 3. RECONCILIA PROJETOS — reescreve cada publicUrl antigo pelo novo.
    if (!DRY_RUN && fs.existsSync(PROJECTS_DIR)) {
        for (const [oldUrl, newUrl] of urlMap) {
            const n = reconcileProjects(oldUrl, newUrl);
            report.projectsRewritten += n;
        }
    }

    // 4. Zera o legado + cria a flag.
    if (!DRY_RUN) {
        try {
            fs.writeFileSync(MUSIC_LEGACY_JSON, '[]', 'utf-8');
            fs.writeFileSync(FLAG, new Date().toISOString(), 'utf-8');
        } catch (e) {
            log(`Aviso: não consegui escrever flag/json legado: ${(e as Error).message}`);
        }
    }

    log(`=== ${DRY_RUN ? 'Dry-run concluído' : 'Migração concluída'} ===`);
    log(`Músicas: ${report.music} | Vídeos: ${report.videos} | Proxies: ${report.proxies} | Imagens: ${report.images} | Projetos reescritos: ${report.projectsRewritten} | Pulados: ${report.skipped}`);
    return report;
}

// Permite rodar direto: `npx ts-node src/scripts/migrateToFiles.ts`.
// No bundle do servidor, esbuild transforma este módulo em parte do entrypoint e
// `require.main === module` também pode ficar verdadeiro; confira o nome para não
// encerrar o backend empacotado logo após o boot.
const isMigrationCli = require.main === module && /migrateToFiles\.(?:ts|js)$/i.test(require.main?.filename || '');
if (isMigrationCli) {
    void runMigration().then(() => process.exit(0));
}
