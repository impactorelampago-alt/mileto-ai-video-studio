import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

const logoSource = 'public/logo.png';
const buildFolder = 'build';
const sizes = [256, 128, 64, 48, 32, 16];

async function generateMultiResIco() {
    console.log('=== Gerando ICO Multi-Resolução ===');

    const logo = await Jimp.read(logoSource);
    const pngPaths = [];

    for (const size of sizes) {
        const resized = logo.clone().contain(size, size);
        const outPath = path.join(buildFolder, `icon_${size}.png`);
        await resized.writeAsync(outPath);
        pngPaths.push(outPath);
        console.log(`  ✓ ${size}x${size} gerado`);
    }

    // Generate app icon with all resolutions
    console.log('\nCombinando em icon.ico (6 resoluções)...');
    const iconBuffer = await pngToIco(pngPaths);
    fs.writeFileSync(path.join(buildFolder, 'icon.ico'), iconBuffer);
    console.log(`  ✓ icon.ico => ${(fs.statSync(path.join(buildFolder, 'icon.ico')).size / 1024).toFixed(1)} KB`);

    // Generate installer icon (with arrow) with all resolutions
    console.log('\nGerando installer.ico com seta...');
    const installerPngs = [];
    for (const size of sizes) {
        const img = logo.clone().contain(size, size);

        // Draw arrow only on sizes >= 32
        if (size >= 32) {
            const blue = Jimp.rgbaToInt(0, 120, 255, 255);
            const scale = size / 256;
            const sx = Math.round(170 * scale);
            const sy = Math.round(170 * scale);

            // Stem
            const stemW = Math.max(2, Math.round(16 * scale));
            const stemH = Math.max(3, Math.round(40 * scale));
            for (let x = sx; x < sx + stemW; x++) {
                for (let y = sy; y < sy + stemH; y++) {
                    if (x >= 0 && x < size && y >= 0 && y < size) img.setPixelColor(blue, x, y);
                }
            }
            // Triangle
            const triH = Math.max(3, Math.round(30 * scale));
            for (let row = 0; row < triH; row++) {
                const w = Math.round(row * 1.2);
                const cx = sx + Math.round(stemW / 2);
                for (let dx = -w; dx <= w; dx++) {
                    const px = cx + dx;
                    const py = sy + stemH + row;
                    if (px >= 0 && px < size && py >= 0 && py < size) img.setPixelColor(blue, px, py);
                }
            }
        }

        const outPath = path.join(buildFolder, `installer_${size}.png`);
        await img.writeAsync(outPath);
        installerPngs.push(outPath);
    }

    const installerBuffer = await pngToIco(installerPngs);
    fs.writeFileSync(path.join(buildFolder, 'installer.ico'), installerBuffer);
    console.log(
        `  ✓ installer.ico => ${(fs.statSync(path.join(buildFolder, 'installer.ico')).size / 1024).toFixed(1)} KB`
    );

    // Cleanup temp PNGs
    for (const p of [...pngPaths, ...installerPngs]) {
        fs.unlinkSync(p);
    }

    console.log('\n=== CONCLUÍDO! Ícones prontos em build/ ===');
}

generateMultiResIco().catch(console.error);
