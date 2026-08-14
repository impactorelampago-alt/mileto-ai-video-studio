import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const controllerSource = readFileSync(
    path.resolve(__dirname, '../src/controllers/aiController.ts'),
    'utf8',
);
const routesSource = readFileSync(
    path.resolve(__dirname, '../src/routes/api.ts'),
    'utf8',
);

test('a rota de planejamento é POST dedicada e aponta para o controlador correto', () => {
    assert.match(
        routesSource,
        /router\.post\('\/video\/plan-titles',\s*aiController\.planTitles\);/,
    );
});

test('a resposta enumera todo gatilho ativo e marca ausência sem omiti-lo', () => {
    assert.match(
        controllerSource,
        /const enabledTriggers = titleSettings\.config\.triggers[\s\S]*\.filter\(\(trigger\) => trigger\.enabled && trigger\.titleTypes\.length\);/,
    );
    assert.match(controllerSource, /const triggers = enabledTriggers\.map\(\(trigger\) => \(\{/);
    assert.match(
        controllerSource,
        /status:\s*suggestions\.some\([\s\S]*\? 'found'[\s\S]*: 'not_found'/,
    );
    assert.match(
        controllerSource,
        /suggestionCount:\s*suggestions\.filter\(\(suggestion\) => suggestion\.triggerId === trigger\.id\)\.length/,
    );
    assert.match(controllerSource, /suggestions,\s*triggers,\s*summary,/);
});

test('nenhum gatilho aceita mais de três propostas', () => {
    assert.match(controllerSource, /Gere no máximo 3 alternativas por gatilho\./);
    assert.match(
        controllerSource,
        /if \(occurrence >= Math\.min\(3, trigger\.maxOccurrences\)\) return \[\];/,
    );
    assert.match(
        controllerSource,
        /maxOccurrences:\s*Math\.min\(3, trigger\.maxOccurrences\)/,
    );
});

test('sourceText só é aceito quando corresponde a trecho literal normalizado da narração', () => {
    assert.match(controllerSource, /const planningLiteralExists = \(script: string, candidate: unknown\) => \{/);
    assert.match(controllerSource, /const scriptKey = normalizePlanningText\(script\);/);
    assert.match(controllerSource, /const candidateKey = normalizePlanningText\(candidate\);/);
    assert.match(
        controllerSource,
        /candidateKey\.length > 1 && \(` \$\{scriptKey\} `\)\.includes\(` \$\{candidateKey\} `\)/,
    );
    assert.match(
        controllerSource,
        /const sourceText = safePlanningLine\(candidate\?\.sourceText \|\| candidate\?\.text, 240\);\s*if \(!planningLiteralExists\(script, sourceText\)\) return \[\];/,
    );
});

test('texto visual da IA não pode introduzir fatos ausentes da evidência literal', () => {
    assert.match(controllerSource, /const planningDisplaySupported = \(sourceText: string, displayText: string\) => \{/);
    assert.match(
        controllerSource,
        /displayWords\.length > 0 && displayWords\.every\(\(word\) => sourceWords\.has\(word\)\)/,
    );
    assert.match(
        controllerSource,
        /const text = planningDisplaySupported\(sourceText, requestedText\)[\s\S]*\? requestedText[\s\S]*: safePlanningLine\(safeCompact\)/,
    );
});

test('contexto anterior não contorna a validação literal nem vaza resposta bruta', () => {
    assert.match(controllerSource, /req\.body\?\.previousTitles[\s\S]*\.slice\(0, 40\)/);

    const successResponse = controllerSource.slice(
        controllerSource.indexOf('return res.json({', controllerSource.indexOf('export const planTitles')),
        controllerSource.indexOf('} catch (error: unknown)', controllerSource.indexOf('export const planTitles')),
    );
    assert.ok(successResponse.length > 0, 'resposta de sucesso do planejamento deve existir');
    assert.doesNotMatch(successResponse, /rawTitles|previousTitles|\btoken\b|\bsystem\b/);
});
