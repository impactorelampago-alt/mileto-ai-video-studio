import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step1 = read('../../client/src/pages/Step1.tsx');
const wizard = read('../../client/src/context/WizardContext.tsx');
const timelineEditor = read('../../client/src/components/timeline/TimelineEditor.tsx');
const musicLibrary = read('../../client/src/components/MusicLibrary.tsx');

const section = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `início da seção ausente: ${start}`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `fim da seção ausente: ${end}`);
    return source.slice(from, to);
};

test('geração da narração calcula o corte da música com a regra temporal compartilhada', () => {
    const generate = section(step1, 'const handleGenerateNarration', '// ─── Gravar a própria voz');
    const nextAudioConfig = section(generate, 'const nextAudioConfig', 'updateAdData({');

    assert.match(nextAudioConfig, /narration:\s*\{[\s\S]*?trimEnd:\s*narrationDuration\s*>\s*0\s*\?\s*narrationDuration\s*:\s*undefined/);
    assert.match(step1, /import\s*\{\s*backgroundTrimEndForNarration\s*\}\s*from\s*['"]\.\.\/lib\/audioAutoFit['"]/);
    assert.match(generate, /backgroundTrimEndForNarration\s*\(\s*\{/);
    assert.match(generate, /backgroundTrimStart:\s*[^,\n]+/);
    assert.match(generate, /backgroundOffsetSec:\s*[^,\n]+/);
    assert.match(generate, /narrationDurationSec:\s*narrationDuration/);
    assert.match(generate, /narrationOffsetSec:\s*[^,\n]+/);
    assert.match(generate, /backgroundSourceDurationSec:\s*[^,\n]+/);
    assert.match(nextAudioConfig, /background:\s*\{[\s\S]*?trimEnd:\s*[^,\n]+/);
    assert.doesNotMatch(nextAudioConfig, /background:\s*\{[\s\S]*?trimEnd:\s*narrationDuration\s*>/);
});

test('troca de faixa descarta cortes antigos e reaplica o corte automático da narração', () => {
    const selectMusic = section(wizard, 'const setSelectedMusicId', 'const contextValue');

    assert.match(selectMusic, /masterAudioUrl:\s*undefined/);
    assert.match(selectMusic, /sharedMasterAssetId:\s*undefined/);
    assert.match(selectMusic, /background:\s*\{[\s\S]*?offsetSec:\s*0[\s\S]*?trimStart:\s*0/);
    assert.match(selectMusic, /const narrationDuration\s*=\s*Number\(ad\.narrationDuration/);
    assert.match(selectMusic, /const automaticTrimEnd\s*=\s*narrationTimelineEnd\s*>\s*0/);
    assert.match(selectMusic, /trimEnd:\s*automaticTrimEnd/);
    assert.match(selectMusic, /timelineTrack\.id\s*===\s*'bgm'[\s\S]*?clips:\s*\[\]/);
});

test('trocar a música com narração pronta remixa e ignora resposta obsoleta', () => {
    const effects = [...step1.matchAll(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[([^\]]*)\]\);/g)]
        .map((match) => ({ body: match[1], dependencies: match[2] }));
    const remixEffect = effects.find(({ body, dependencies }) =>
        body.includes('/api/audio/mix') &&
        dependencies.includes('adData.musicAudioUrl') &&
        dependencies.includes('adData.narrationAudioUrl')
    );

    assert.ok(remixEffect, 'faltou um efeito de remix ligado às URLs atuais de narração e música');
    assert.match(remixEffect.body, /if\s*\([\s\S]*?isAudioEditorOpen/);
    assert.ok(
        remixEffect.dependencies.includes('isAudioEditorOpen'),
        'abrir ou fechar o editor precisa pausar/retomar a remistura automática',
    );
    assert.ok(
        remixEffect.dependencies.includes('adData.sharedNarrationAssetId') &&
        remixEffect.dependencies.includes('adData.sharedMusicAssetId'),
        'a troca da identidade compartilhada também precisa disparar a remistura',
    );
    assert.match(
        remixEffect.body,
        /refreshSharedAudioSourceUrl\(\s*adData\.sharedNarrationAssetId,\s*adData\.narrationAudioUrl,\s*'shared_narration_source_unavailable'/,
        'a narração compartilhada deve ser renovada no momento do uso',
    );
    assert.match(
        remixEffect.body,
        /refreshSharedAudioSourceUrl\(\s*adData\.sharedMusicAssetId,\s*adData\.musicAudioUrl,\s*'shared_music_source_unavailable'/,
        'a música compartilhada deve ser renovada no momento do uso',
    );
    const refreshAt = remixEffect.body.indexOf('const [narrationUrl, musicUrl] = await Promise.all([');
    const mixAt = remixEffect.body.indexOf('/api/audio/mix');
    assert.ok(refreshAt >= 0 && mixAt > refreshAt, 'as capabilities precisam ser renovadas antes do mix');
    assert.match(remixEffect.body, /body:\s*JSON\.stringify\(\{\s*narrationUrl,\s*musicUrl,/);
    assert.match(remixEffect.body, /audioConfig:\s*(?:adData\.audioConfig|currentAudioConfigRef\.current)/);
    assert.match(
        remixEffect.body,
        /updateAdData\(\{\s*masterAudioUrl,\s*sharedMasterAssetId:\s*undefined,/,
        'um master local novo não pode conservar a identidade do master compartilhado antigo',
    );
    assert.match(remixEffect.body, /sharedNarrationAssetId\s*\?\s*\{\s*narrationAudioUrl:\s*narrationUrl\s*\}/);
    assert.match(remixEffect.body, /sharedMusicAssetId\s*\?\s*\{\s*musicAudioUrl:\s*musicUrl\s*\}/);
    assert.match(
        remixEffect.body,
        /AbortController|signal\.aborted|\b\w*(?:request|mix|revision|generation|sequence)\w*Ref\.current/i,
        'o remix precisa abortar ou rejeitar uma resposta pertencente à faixa anterior',
    );
    assert.match(
        remixEffect.body,
        /return\s*\(\)\s*=>\s*\{[\s\S]*?controller\.abort\(\);[\s\S]*?setIsMixing\(false\);[\s\S]*?\};/,
        'o cleanup deve abortar a requisição e liberar o botão de avançar ao abrir o editor',
    );
});

test('avançar renova áudios compartilhados e nunca reutiliza o master anterior', () => {
    const handleNext = section(step1, 'const handleNext', 'const handleGenerateNarration');

    assert.match(handleNext, /if\s*\(isGenerating\s*\|\|\s*isRecording\s*\|\|\s*isUploadingRec\)/);
    assert.match(handleNext, /const requestId\s*=\s*\+\+nextMixRequestRef\.current/);
    assert.match(handleNext, /const requestIdentity\s*=\s*audioMixRequestIdentity\(adData,\s*selectedMusicId\)/);
    assert.match(
        handleNext,
        /requestIdentity\s*===\s*audioMixRequestIdentity\(\s*latestAdDataRef\.current,\s*latestSelectedMusicIdRef\.current/,
        'uma resposta antiga não pode aplicar master nem avançar depois da troca de fonte',
    );
    assert.match(
        handleNext,
        /refreshSharedAudioSourceUrl\(\s*adData\.sharedNarrationAssetId,\s*adData\.narrationAudioUrl,\s*'shared_narration_source_unavailable'/,
    );
    assert.match(
        handleNext,
        /refreshSharedAudioSourceUrl\(\s*adData\.sharedMusicAssetId,\s*adData\.musicAudioUrl,\s*'shared_music_source_unavailable'/,
    );
    const refreshAt = handleNext.indexOf('const [narrationUrl, musicUrl] = await Promise.all([');
    const mixAt = handleNext.indexOf('/api/audio/mix');
    assert.ok(refreshAt >= 0 && mixAt > refreshAt, 'o avanço deve renovar as URLs antes de solicitar o mix');
    assert.match(handleNext, /body:\s*JSON\.stringify\(\{\s*narrationUrl,\s*musicUrl,/);
    assert.match(handleNext, /updateAdData\(\{\s*masterAudioUrl,\s*sharedMasterAssetId:\s*undefined,/);
    const responseAt = handleNext.indexOf('await res.json()');
    const staleGuardAt = handleNext.indexOf('if (!requestIsCurrent())', responseAt);
    const masterUpdateAt = handleNext.indexOf('updateAdData({', responseAt);
    assert.ok(
        responseAt >= 0 && staleGuardAt > responseAt && masterUpdateAt > staleGuardAt,
        'a identidade atual precisa ser validada antes de gravar o master',
    );
    assert.match(handleNext, /updateAdData\(\{\s*masterAudioUrl:\s*undefined,\s*sharedMasterAssetId:\s*undefined\s*\}\)/);
    assert.match(
        handleNext,
        /catch\s*\([^)]*\)\s*\{[\s\S]*?toast\.error\([\s\S]*?return;[\s\S]*?\}\s*finally\s*\{[\s\S]*?setIsMixing\(false\)/,
        'uma falha de mix deve manter o usuário na etapa atual',
    );
});

test('trocar ou carregar projeto invalida renovação pendente da música anterior', () => {
    assert.match(wizard, /const invalidatePendingMusicSelection\s*=\s*React\.useCallback/);
    for (const [start, end] of [
        ['const applyLoadedDraft', 'const loadProject'],
        ['const loadProject', 'const loadDraft'],
        ['const loadDraft', 'const applyProjectSnapshot'],
        ['const applyProjectSnapshot', 'const startNewDraft'],
        ['const startNewDraft', '// Tenta recuperar o rascunho ativo'],
    ]) {
        assert.match(
            section(wizard, start, end),
            /invalidatePendingMusicSelection\(\)/,
            `${start} deve invalidar a capability pendente do projeto anterior`,
        );
    }
});

test('próximo passo e TTS ficam bloqueados durante geração, gravação ou upload', () => {
    const generate = section(step1, 'const handleGenerateNarration', '// ─── Gravar a própria voz');
    const ttsButton = section(step1, 'onClick={() => handleGenerateNarration()}', 'className="flex w-full');
    const nextButton = section(step1, 'onClick={handleNext}', '<TimelineEditor');

    assert.match(step1, /const isAudioOperationBusy\s*=\s*isMixing\s*\|\|\s*isGenerating\s*\|\|\s*isRecording\s*\|\|\s*isUploadingRec/);
    assert.match(nextButton, /disabled=\{isAudioOperationBusy\}/);
    assert.match(ttsButton, /disabled=\{[\s\S]*?isGenerating\s*\|\|[\s\S]*?isRecording\s*\|\|[\s\S]*?isUploadingRec[\s\S]*?\}/);
    assert.match(
        generate,
        /if\s*\(isRecording\s*\|\|\s*isUploadingRec\)\s*\{[\s\S]*?return;/,
        'a proteção da TTS deve existir também no handler, não apenas no botão',
    );
});

test('geração aplica o resultado sobre o estado e a seleção mais recentes', () => {
    const generate = section(step1, 'const handleGenerateNarration', '// ─── Gravar a própria voz');
    const responseAt = generate.indexOf('await response.json()');
    assert.notEqual(responseAt, -1);

    for (const reference of [
        'latestAdDataRef.current',
        'latestSelectedMusicIdRef.current',
        'latestMusicLibraryRef.current',
    ]) {
        const referenceAt = generate.indexOf(reference, responseAt);
        assert.ok(referenceAt > responseAt, `${reference} deve ser consultada depois da resposta da TTS`);
    }
    assert.doesNotMatch(generate, /musicUrl:\s*adData\.musicAudioUrl/);
});

test('geração descarta resposta se texto ou configuração da voz ficar obsoleta', () => {
    const generate = section(step1, 'const handleGenerateNarration', '// ─── Gravar a própria voz');
    const staleCheckAt = generate.indexOf('if (requestIsObsolete())');
    const updateAt = generate.indexOf('updateAdData({');

    assert.match(generate, /const requestId\s*=\s*\+\+narrationGenerationRequestRef\.current/);
    assert.match(generate, /const requestFingerprint\s*=\s*narrationGenerationInputFingerprint\(adData\)/);
    assert.match(
        generate,
        /narrationGenerationInputFingerprint\(latestAdDataRef\.current\)\s*!==\s*requestFingerprint/,
    );
    assert.ok(staleCheckAt >= 0 && staleCheckAt < updateAt, 'a obsolescência precisa ser validada antes de aplicar o áudio');
    assert.match(generate, /finally\s*\{[\s\S]*?requestId\s*===\s*narrationGenerationRequestRef\.current[\s\S]*?setIsGenerating\(false\)/);
});

test('gravação nova normaliza cortes e invalida timeline e master anteriores', () => {
    const upload = section(step1, 'const uploadRecording', 'const startRecTimer');

    assert.match(upload, /const narrationDuration\s*=\s*Number\(data\.duration\s*\|\|\s*0\)/);
    assert.match(upload, /backgroundTrimEndForNarration\s*\(\s*\{/);
    assert.match(upload, /narration:\s*\{[\s\S]*?trimStart:\s*0,[\s\S]*?trimEnd:\s*narrationDuration/);
    assert.match(upload, /background:\s*\{[\s\S]*?trimEnd:\s*backgroundTrimEnd/);
    assert.match(upload, /audioTimeline:\s*undefined/);
    assert.match(upload, /masterAudioUrl:\s*undefined/);
    assert.match(upload, /sharedMasterAssetId:\s*undefined/);
});

test('Ajuste Automático alinha a música à narração em vez de alterar apenas o zoom', () => {
    const adjustment = section(timelineEditor, 'const handleAutomaticAdjustment', 'if (!isOpen || !timeline)');

    assert.match(adjustment, /const narrationEnd\s*=/);
    assert.match(adjustment, /const requestedOut\s*=\s*backgroundClip\.inSec\s*\+\s*availableMusicTime/);
    assert.match(adjustment, /clip\.id\s*===\s*backgroundClip\.id\s*\?\s*\{\s*\.\.\.clip,\s*outSec:\s*nextOut/);
    assert.match(timelineEditor, /onClick=\{handleAutomaticAdjustment\}/);
});

test('música compartilhada preserva identidade, descarta URL antiga e rejeita renovação obsoleta', () => {
    const selectMusic = section(wizard, 'const setSelectedMusicId', 'const contextValue');

    assert.match(musicLibrary, /scope:\s*'shared'/);
    assert.match(musicLibrary, /sharedAssetId:\s*file\.id/);
    assert.match(wizard, /import\s*\{\s*refreshSharedAudioSourceUrl\s*\}\s*from\s*['"]\.\.\/lib\/sharedMediaRecovery['"]/);
    assert.match(selectMusic, /const requestId\s*=\s*\+\+musicSelectionRequestRef\.current/);
    assert.match(
        selectMusic,
        /sharedMusicAssetId:\s*resolvedTrack\?\.scope\s*===\s*'shared'[\s\S]*?resolvedTrack\.sharedAssetId\s*\|\|\s*resolvedTrack\.id/,
        'a seleção precisa manter o ID estável mesmo sem uma URL utilizável',
    );
    assert.match(
        selectMusic,
        /applySelection\(\s*\{\s*\.\.\.track,\s*sharedAssetId,\s*scope:\s*'shared'\s*\},\s*null,?\s*\);\s*void refreshSharedAudioSourceUrl/,
        'a URL assinada anterior deve sair do estado antes de iniciar a renovação',
    );
    assert.match(
        selectMusic,
        /refreshSharedAudioSourceUrl\(\s*sharedAssetId,\s*track\.publicUrl,\s*'shared_music_source_unavailable'/,
    );
    assert.match(
        selectMusic,
        /\.then\(\(freshUrl\)\s*=>\s*\{\s*if\s*\(requestId\s*!==\s*musicSelectionRequestRef\.current\s*\|\|\s*!freshUrl\)\s*return;/,
        'uma resposta atrasada não pode substituir a faixa escolhida depois',
    );
    assert.match(
        selectMusic,
        /applySelection\(\s*\{\s*\.\.\.track,\s*publicUrl:\s*freshUrl,\s*sharedAssetId,\s*scope:\s*'shared'\s*\},\s*freshUrl,?\s*\);/,
        'somente a capability recém-renovada pode voltar ao estado',
    );
    assert.match(
        selectMusic,
        /\.catch\(\(error\)\s*=>\s*\{\s*if\s*\(requestId\s*!==\s*musicSelectionRequestRef\.current\)\s*return;/,
        'até uma falha antiga precisa ser ignorada depois de outra seleção',
    );
});

test('falha ao retomar preview de música antiga não altera a faixa atual', () => {
    const togglePlay = section(musicLibrary, 'const togglePlay', '// Seek handler');
    const resumeCurrent = section(togglePlay, 'if (playingId === track.id)', '// Different track');
    const resumeCatch = section(resumeCurrent, '.catch((error) => {', '});');

    const obsoleteGuardAt = resumeCatch.indexOf('if (audioRef.current !== audio) return;');
    const resetPlayingAt = resumeCatch.indexOf('setPlayingId(null)');
    assert.ok(obsoleteGuardAt >= 0, 'o catch da retomada deve reconhecer que o Audio mudou');
    assert.ok(resetPlayingAt > obsoleteGuardAt, 'o guard precisa executar antes de limpar o preview atual');
});

test('rascunho compartilhado legado renova a música pelo selectedMusicId sem inventar um asset', () => {
    const hydrate = section(wizard, 'const hydrateSharedPayload', 'const saveProject');

    assert.match(
        hydrate,
        /const legacySharedMusicId\s*=\s*nextAd[\s\S]*?&&\s*!nextAd\.sharedMusicAssetId[\s\S]*?&&\s*data\.selectedMusicId[\s\S]*?&&\s*!isSystemMusicId\(data\.selectedMusicId\)[\s\S]*?&&\s*nextAd\.musicAudioUrl[\s\S]*?&&\s*!isLocalMedia\(nextAd\.musicAudioUrl,\s*null\)[\s\S]*?\?\s*data\.selectedMusicId\s*:\s*undefined/,
        'somente uma faixa remota não-sistema sem sharedMusicAssetId deve entrar na migração',
    );
    assert.match(hydrate, /if\s*\(legacySharedMusicId\)\s*ids\.add\(legacySharedMusicId\)/);
    assert.match(hydrate, /assets\.set\(id,\s*await gatewayApi\.sharedAsset\(id\)\)/);
    assert.match(hydrate, /const resolvedMusicAssetId\s*=\s*nextAd\.sharedMusicAssetId\s*\|\|\s*legacySharedMusicId/);
    assert.match(hydrate, /const music\s*=\s*resolvedMusicAssetId\s*\?\s*assets\.get\(resolvedMusicAssetId\)\s*:\s*null/);
    assert.match(
        hydrate,
        /if\s*\(music\)\s*\{\s*nextAd\.sharedMusicAssetId\s*=\s*music\.id;\s*nextAd\.musicAudioUrl\s*=\s*music\.publicUrl;\s*\}/,
        'ID e URL renovada só podem ser persistidos depois que o asset for resolvido',
    );
    assert.doesNotMatch(hydrate, /nextAd\.sharedMusicAssetId\s*=\s*legacySharedMusicId/);
});
