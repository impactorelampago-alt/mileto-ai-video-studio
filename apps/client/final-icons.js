import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

// This script ensures the high quality logo.png is used for the arrow version
const logoSource = 'public/logo.png';
const installerPng = 'build/installer_final.png';
const finalInstallerIco = 'build/installer.ico';

async function processInstallerIcon() {
    console.log('Gerando ícone de instalador com alta fidelidade...');

    const logo = await Jimp.read(logoSource);
    logo.contain(256, 256);

    // Draw arrow - simple but clean
    const blue = Jimp.rgbaToInt(0, 120, 255, 255);

    // Bottom right area
    const startX = 170;
    const startY = 170;

    // Stem
    for (let x = startX + 20; x < startX + 36; x++) {
        for (let y = startY; y < startY + 40; y++) {
            logo.setPixelColor(blue, x, y);
        }
    }

    // Triangle tip
    for (let yOffset = 0; yOffset < 30; yOffset++) {
        const width = yOffset * 1.2;
        for (let xOffset = -width; xOffset <= width; xOffset++) {
            logo.setPixelColor(blue, startX + 28 + Math.round(xOffset), startY + 40 + yOffset);
        }
    }

    await logo.writeAsync(installerPng);

    console.log('Convertendo para .ico...');
    const buf = await pngToIco(installerPng);
    fs.writeFileSync(finalInstallerIco, buf);

    console.log('Ícone do instalador pronto em build/installer.ico');
}

processInstallerIcon().catch(console.error);
