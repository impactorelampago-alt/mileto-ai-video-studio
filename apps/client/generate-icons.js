import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

const logoPath = 'public/logo.png';
const buildFolder = 'build';

async function generate() {
    if (!fs.existsSync(buildFolder)) {
        fs.mkdirSync(buildFolder);
    }

    console.log('Carregando logo...');
    const logo = await Jimp.read(logoPath);

    // 1. Gerar ícone padrão (256x256)
    console.log('Gerando ícone do aplicativo...');
    const appIcon = logo.clone().contain(256, 256);
    await appIcon.writeAsync(path.join(buildFolder, 'icon.png'));

    const iconBuffer = await pngToIco(path.join(buildFolder, 'icon.png'));
    fs.writeFileSync(path.join(buildFolder, 'icon.ico'), iconBuffer);

    // 2. Gerar ícone do instalador com seta
    console.log('Gerando ícone do instalador...');
    const installerIcon = logo.clone().contain(256, 256);

    // Desenhar seta para baixo (azul)
    // Coordenadas aproximadas para o canto inferior direito
    const arrowX = 180;
    const arrowY = 180;
    const arrowSize = 60;

    // Vamos desenhar uma seta simples usando retângulos/linhas se possível,
    // ou apenas um triângulo azul.
    // Como Jimp é limitado para desenho complexo, faremos um "V" grosso
    const blue = Jimp.rgbaToInt(0, 100, 255, 255);

    // Haste da seta
    for (let x = arrowX + 25; x < arrowX + 35; x++) {
        for (let y = arrowY; y < arrowY + 40; y++) {
            installerIcon.setPixelColor(blue, x, y);
        }
    }
    // Cabeça da seta
    for (let i = 0; i < 25; i++) {
        for (let j = 0; j < 10; j++) {
            installerIcon.setPixelColor(blue, arrowX + 5 + i + j, arrowY + 30 + i);
            installerIcon.setPixelColor(blue, arrowX + 55 - i - j, arrowY + 30 + i);
        }
    }

    await installerIcon.writeAsync(path.join(buildFolder, 'installer.png'));
    const installerBuffer = await pngToIco(path.join(buildFolder, 'installer.png'));
    fs.writeFileSync(path.join(buildFolder, 'installer.ico'), installerBuffer);

    console.log('Ícones gerados com sucesso na pasta build/');
}

generate().catch(console.error);
