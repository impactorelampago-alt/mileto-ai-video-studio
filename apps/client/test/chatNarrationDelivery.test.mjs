import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    extractChatNarration,
    extractChatNarrationTitle,
    extractFishDirectionTags,
    hasChatNarrationDelivery,
    parseChatNarrationDelivery,
    uniqueFishDirectionTags,
} from '../src/lib/chatNarrationDelivery.ts';

test('reconhece a entrega final marcada e separa conversa, titulo, narracao e observacao', () => {
    const content = `Aqui está a versão final.

===TÍTULO===
Oferta de Inverno
===ROTEIRO===
[warm and reassuring] O inverno chegou com conforto.
[confident] Visite nossa loja hoje.
===FIM===

As direções serão usadas na locução.`;

    const delivery = parseChatNarrationDelivery(content);

    assert.deepEqual(delivery, {
        title: 'Oferta de Inverno',
        narration: '[warm and reassuring] O inverno chegou com conforto.\n[confident] Visite nossa loja hoje.',
        before: 'Aqui está a versão final.',
        after: 'As direções serão usadas na locução.',
        format: 'markers',
    });
    assert.equal(extractChatNarration(content), delivery.narration);
    assert.equal(extractChatNarrationTitle(content), delivery.title);
});

test('mantem compatibilidade com resposta antiga que nao tinha titulo', () => {
    const content = '===ROTEIRO===\n[confident] Uma oferta feita para você.\n===FIM===';
    const delivery = parseChatNarrationDelivery(content);

    assert.equal(delivery?.title, 'Uma oferta feita para você');
    assert.equal(delivery?.narration, '[confident] Uma oferta feita para você.');
    assert.equal(delivery?.format, 'markers');
});

test('mantem compatibilidade com o envelope JSON de narracao', () => {
    const content = '```json\n{"title":"Campanha da Loja","narration":"[curious] Já conhece nossa novidade?","directionMode":"manual"}\n```';
    const delivery = parseChatNarrationDelivery(content);

    assert.equal(delivery?.title, 'Campanha da Loja');
    assert.equal(delivery?.narration, '[curious] Já conhece nossa novidade?');
    assert.equal(delivery?.format, 'structured');
    assert.equal(hasChatNarrationDelivery(content), true);
});

test('conversa normal e JSON especializado sem narracao nao viram card final', () => {
    assert.equal(
        parseChatNarrationDelivery('Podemos usar um tom [confident]. Qual é a duração desejada?'),
        null,
    );
    assert.equal(
        parseChatNarrationDelivery('{"title":"Ideias","hook":"Uma abertura possível"}'),
        null,
    );
    assert.equal(hasChatNarrationDelivery('===ROTEIRO===\n\n===FIM==='), false);
});

test('extrai chips Fish sem confundir colchetes numericos e elimina repeticoes na legenda', () => {
    const narration = '[confident] Oferta [2026]. [confident] Só hoje. [warm and reassuring] Venha conhecer.';

    assert.deepEqual(extractFishDirectionTags(narration), [
        '[confident]',
        '[confident]',
        '[warm and reassuring]',
    ]);
    assert.deepEqual(uniqueFishDirectionTags(narration), [
        '[confident]',
        '[warm and reassuring]',
    ]);
});

const chatSource = readFileSync(
    new URL('../src/components/chat/ChatMileto.tsx', import.meta.url),
    'utf8',
);

test('o card final tem identidade e acoes proprias sem aceitar HTML do modelo', () => {
    assert.match(chatSource, /data-mileto-narration-card="final"/);
    assert.match(chatSource, /aria-label="Narração pronta"/);
    assert.match(chatSource, />\s*Narração pronta\s*</);
    assert.match(chatSource, /data-narration-action="copy"/);
    assert.match(chatSource, /data-narration-action="apply"/);
    assert.match(chatSource, /> Aplicar ao projeto\s*</);
    assert.match(chatSource, /Direções de voz/);
    assert.doesNotMatch(chatSource, /dangerouslySetInnerHTML/);
});

test('o renderer consulta o contrato final antes do card e preserva chat comum', () => {
    assert.match(chatSource, /const delivery = parseChatNarrationDelivery\(content\);/);
    assert.match(chatSource, /if \(delivery\) \{\s*return <NarrationCard/);
    assert.match(chatSource, /if \(!result\) return <RichChatText content=\{stripMarkers\(content\)\}/);
    assert.doesNotMatch(chatSource, />\s*Usar no projeto\s*</);
});
