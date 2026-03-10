import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

const userIcoPath = path.resolve('../../icone/Logo-Mileto-AI-Video-.ico');
const buildFolder = 'build';
const sizes = [256, 128, 64, 48, 32, 16];

function extractLargestPngFromIco(icoPath) {
    const buf = fs.readFileSync(icoPath);
    // ICO header: 2 bytes reserved, 2 bytes type, 2 bytes count
    const count = buf.readUInt16LE(4);
    console.log(`ICO contém ${count} imagem(ns)`);

    let bestEntry = null;
    let bestSize = 0;

    for (let i = 0; i < count; i++) {
        const offset = 6 + i * 16;
        let width = buf.readUInt8(offset);
        let height = buf.readUInt8(offset + 1);
        // 0 means 256
        if (width === 0) width = 256;
        if (height === 0) height = 256;
        const dataSize = buf.readUInt32LE(offset + 8);
        const dataOffset = buf.readUInt32LE(offset + 12);

        console.log(`  Imagem ${i}: ${width}x${height}, ${dataSize} bytes`);

        if (width >= bestSize) {
            bestSize = width;
            bestEntry = { width, height, dataSize, dataOffset };
        }
    }

    // Extract the PNG data
    const imgData = buf.slice(bestEntry.dataOffset, bestEntry.dataOffset + bestEntry.dataSize);

    // Check if it's a PNG (starts with PNG magic bytes)
    const isPng = imgData[0] === 0x89 && imgData[1] === 0x50 && imgData[2] === 0x4e && imgData[3] === 0x47;
    console.log(`\nMaior: ${bestEntry.width}x${bestEntry.height}, PNG: ${isPng}`);

    return { data: imgData, isPng, width: bestEntry.width, height: bestEntry.height };
}

async function generateFromUserIco() {
    console.log('=== Extraindo imagem do ICO oficial do usuário ===\n');

    const extracted = extractLargestPngFromIco(userIcoPath);

    // Save extracted image
    const extractedPath = path.join(buildFolder, 'extracted_source.png');

    let source;
    if (extracted.isPng) {
        fs.writeFileSync(extractedPath, extracted.data);
        source = await Jimp.read(extractedPath);
    } else {
        // BMP format inside ICO - need to handle differently
        // Create a proper BMP file header and read
        console.log('Formato BMP dentro do ICO, tentando ler...');
        // For BMP in ICO, the height is doubled (includes mask)
        // We'll try writing as raw and reading
        fs.writeFileSync(extractedPath + '.bmp', extracted.data);
        // Fall back to using the logo.png but CROPPING it aggressively
        console.log('Fallback: Cortando logo.png de forma agressiva...');
        source = await Jimp.read('public/logo.png');
        source.autocrop({ tolerance: 0.01, cropOnlyFrames: false });
        // Make it square by cropping horizontally to match height
        const h = source.getHeight();
        const w = source.getWidth();
        if (w > h) {
            const excessW = w - h;
            source.crop(Math.floor(excessW / 2), 0, h, h);
        }
    }

    console.log(`\nFonte final: ${source.getWidth()}x${source.getHeight()}`);

    // Generate all sizes
    const pngPaths = [];
    for (const size of sizes) {
        const resized = source.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
        const outPath = path.join(buildFolder, `icon_${size}.png`);
        await resized.writeAsync(outPath);
        pngPaths.push(outPath);
        console.log(`  ✓ ${size}x${size}`);
    }

    // Combine into multi-resolution .ico
    console.log('\nGerando icon.ico...');
    const iconBuffer = await pngToIco(pngPaths);
    fs.writeFileSync(path.join(buildFolder, 'icon.ico'), iconBuffer);
    console.log(`  ✓ icon.ico => ${(fs.statSync(path.join(buildFolder, 'icon.ico')).size / 1024).toFixed(1)} KB`);

    // Installer version with arrow
    console.log('\nGerando installer.ico...');
    const installerPngs = [];
    for (const size of sizes) {
        const img = source.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
        if (size >= 32) {
            const blue = Jimp.rgbaToInt(0, 120, 255, 255);
            const scale = size / 256;
            const sx = Math.round(185 * scale);
            const sy = Math.round(185 * scale);
            const stemW = Math.max(2, Math.round(16 * scale));
            const stemH = Math.max(3, Math.round(35 * scale));
            for (let x = sx; x < sx + stemW; x++)
                for (let y = sy; y < sy + stemH; y++) if (x < size && y < size) img.setPixelColor(blue, x, y);
            const triH = Math.max(3, Math.round(22 * scale));
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

    // Cleanup
    for (const p of [...pngPaths, ...installerPngs]) fs.unlinkSync(p);
    if (fs.existsSync(extractedPath)) fs.unlinkSync(extractedPath);
    if (fs.existsSync(extractedPath + '.bmp')) fs.unlinkSync(extractedPath + '.bmp');

    console.log('\n=== PRONTO! Ícone QUADRADO e GRANDE ===');
}

generateFromUserIco().catch(console.error);
