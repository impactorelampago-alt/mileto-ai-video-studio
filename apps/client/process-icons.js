import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

// This script will take the user's .ico, convert to PNG, add arrow, and save back to .ico
const sourceIco = 'build/icon.ico';
const tempPng = 'build/temp_icon.png';
const installerPng = 'build/installer_with_arrow.png';
const finalInstallerIco = 'build/installer.ico';

async function processIcons() {
    console.log('Iniciando processamento de ícones...');

    // We already have icon.ico (copied from user).
    // Let's use the logo.png we found earlier as the source for the arrow version
    const logoSource = 'public/logo.png';

    console.log('Lendo logo original...');
    const logo = await Jimp.read(logoSource);
    logo.contain(256, 256);

    // Create installer version with arrow
    console.log('Adicionando seta ao ícone do instalador...');
    const installer = logo.clone();

    // Draw a more professional arrow
    const arrowColor = Jimp.rgbaToInt(0, 150, 255, 255); // A nice blue
    const x = 160;
    const y = 160;

    // Simple blocky arrow for visibility
    // Stem
    for (let i = x + 20; i < x + 40; i++) {
        for (let j = y; j < y + 40; j++) {
            installer.setPixelColor(arrowColor, i, j);
        }
    }
    // Tip
    for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 30 - i; j++) {
            // Left side
            installer.setPixelColor(arrowColor, x + 30 - i, y + 40 + i);
            // Right side
            installer.setPixelColor(arrowColor, x + 30 + i, y + 40 + i);
            // Fill between
            for (let k = x + 30 - i; k < x + 30 + i; k++) {
                installer.setPixelColor(arrowColor, k, y + 40 + i);
            }
        }
    }

    await installer.writeAsync(installerPng);

    console.log('Convertendo para .ico...');
    const buf = await pngToIco(installerPng);
    fs.writeFileSync(finalInstallerIco, buf);

    console.log('Concluído! Ícones atualizados em build/');
}

processIcons().catch(console.error);
