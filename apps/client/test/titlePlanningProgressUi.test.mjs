import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const progressSource = readFileSync(
    new URL('../src/components/chat/TitlePlanningProgress.tsx', import.meta.url),
    'utf8',
);

test('o carregamento distingue roteamento, geração e refinamento sem percentual inventado', () => {
    assert.match(progressSource, /'routing'\s*\|\s*'generating'\s*\|\s*'refining'/);
    assert.match(progressSource, /Identificando se o ajuste é nos títulos ou na narração/);
    assert.match(progressSource, /Analisando a narração e os gatilhos configurados/);
    assert.match(progressSource, /Aplicando suas orientações sem alterar a narração/);
    assert.doesNotMatch(progressSource, /aria-valuenow|aria-valuemin|aria-valuemax|percentual concluído/);
});

test('a barra indeterminada informa mudanças de fase a tecnologias assistivas', () => {
    assert.match(progressSource, /aria-live="polite"/);
    assert.match(progressSource, /aria-atomic="true"/);
    assert.match(progressSource, /role="progressbar"/);
    assert.match(progressSource, /aria-valuetext=/);
    assert.match(progressSource, /titlePlanningProgressSweep/);
    assert.match(progressSource, /motion-reduce:animate-none/);
});

test('o visual reutiliza tokens da marca sem gradiente ou glow chamativo', () => {
    assert.match(progressSource, /border-brand-accent\/20/);
    assert.match(progressSource, /bg-brand-card\/80/);
    assert.match(progressSource, /bg-brand-accent\/85/);
    assert.doesNotMatch(progressSource, /bg-gradient|linear-gradient|radial-gradient|drop-shadow|shadow-\[/);
});
