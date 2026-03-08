/**
 * TEST SCRIPT: Verifica se FFmpeg aplica setpts (speed) e overlay (transição) corretamente.
 * Roda: node test_ffmpeg.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Pegar 2 vídeos reais do disco
const videosDir = path.join(__dirname, 'public/videos');
const transitionsDir = path.join(__dirname, 'public/transitions');

const videos = fs
    .readdirSync(videosDir)
    .filter((f) => f.endsWith('.mp4'))
    .slice(0, 2);
const transitions = fs.readdirSync(transitionsDir).filter((f) => f.endsWith('.mp4'));

if (videos.length < 2) {
    console.error('ERRO: Precisa de pelo menos 2 vídeos em public/videos/');
    process.exit(1);
}

const vid1 = path.join(videosDir, videos[0]);
const vid2 = path.join(videosDir, videos[1]);
const trans = transitions.length > 0 ? path.join(transitionsDir, transitions[0]) : null;
const output = path.join(__dirname, 'temp', 'test_speed_transition.mp4');

// Criar pasta temp se não existir
if (!fs.existsSync(path.join(__dirname, 'temp'))) {
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
}

console.log('=== TESTE FFMPEG DIRETO ===');
console.log('Video 1:', vid1);
console.log('Video 2:', vid2);
console.log('Transição:', trans || 'NENHUMA');
console.log('Output:', output);
console.log('');

// ===== TESTE 1: Apenas setpts (speed 1.5x) =====
console.log('--- TESTE 1: setpts (velocidade 1.5x) ---');
const speedCmd = `ffmpeg -y -i "${vid1}" -filter_complex "[0:v]trim=start=0:duration=5,setpts=0.667*(PTS-STARTPTS),scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[out]" -map "[out]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -t 5 -an "${output.replace('.mp4', '_speed.mp4')}"`;

console.log('Comando:');
console.log(speedCmd);
console.log('');

try {
    const result = execSync(speedCmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
    console.log('✅ TESTE 1 SUCESSO! Vídeo criado:', output.replace('.mp4', '_speed.mp4'));

    // Verificar duração do output (deve ser ~3.3s com speed 1.5x de um clip de 5s)
    try {
        const probe = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${output.replace('.mp4', '_speed.mp4')}"`,
            { encoding: 'utf8' }
        );
        console.log('Duração do output:', probe.trim(), 's (esperado: ~3.3s se speed 1.5x funcionou)');
    } catch (e) {
        console.log('Não conseguiu verificar duração');
    }
} catch (err) {
    console.error('❌ TESTE 1 FALHOU!');
    console.error('stderr:', err.stderr);
}

console.log('');

// ===== TESTE 2: concat de 2 vídeos com setpts =====
console.log('--- TESTE 2: concat com setpts ---');
const concatCmd = `ffmpeg -y -i "${vid1}" -i "${vid2}" -filter_complex "[0:v]trim=start=0:duration=3,setpts=0.667*(PTS-STARTPTS),scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0];[1:v]trim=start=0:duration=3,setpts=0.667*(PTS-STARTPTS),scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[out]" -map "[out]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -t 5 -an "${output.replace('.mp4', '_concat.mp4')}"`;

console.log('Comando:');
console.log(concatCmd);
console.log('');

try {
    execSync(concatCmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
    console.log('✅ TESTE 2 SUCESSO! Vídeo criado:', output.replace('.mp4', '_concat.mp4'));
    try {
        const probe = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${output.replace('.mp4', '_concat.mp4')}"`,
            { encoding: 'utf8' }
        );
        console.log('Duração:', probe.trim(), 's (esperado: ~4s com 2 clips de 3s sped up 1.5x)');
    } catch (e) {}
} catch (err) {
    console.error('❌ TESTE 2 FALHOU!');
    console.error('stderr:', err.stderr);
}

console.log('');

// ===== TESTE 3: concat + transição overlay =====
if (trans) {
    console.log('--- TESTE 3: concat + transição com colorkey ---');
    const fullCmd = `ffmpeg -y -i "${vid1}" -i "${vid2}" -i "${trans}" -filter_complex "[0:v]trim=start=0:duration=3,setpts=0.667*(PTS-STARTPTS),scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0];[1:v]trim=start=0:duration=3,setpts=0.667*(PTS-STARTPTS),scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[basevideo];[2:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=rgba,colorkey=black:0.3:0.2[transKeyed];[basevideo][transKeyed]overlay=0:0:enable='gt(t,1.4)*lt(t,2.6)':eof_action=pass[out]" -map "[out]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -t 5 -an "${output}"`;

    console.log('Comando:');
    console.log(fullCmd);
    console.log('');

    try {
        execSync(fullCmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
        console.log('✅ TESTE 3 SUCESSO! Vídeo com speed + transição criado:', output);
    } catch (err) {
        console.error('❌ TESTE 3 FALHOU!');
        console.error('stderr:', err.stderr);
    }
} else {
    console.log('--- TESTE 3: PULADO (sem trânsição no disco) ---');
}

console.log('');
console.log('=== TESTES FINALIZADOS ===');
console.log('Verifique os vídeos na pasta temp/ para confirmar se os efeitos funcionam.');
