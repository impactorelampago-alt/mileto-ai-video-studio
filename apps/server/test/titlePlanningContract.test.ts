import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    planningDisplaySupported,
    planningLiteralExists,
} from '../src/services/titlePlanningSafety';

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
    assert.equal(planningLiteralExists(
        'Atenção, Piracicaba! Óculos a partir de R$ 199.',
        'piracicaba óculos a partir de r$ 199',
    ), true);
    assert.equal(planningLiteralExists(
        'Atenção, Piracicaba! Óculos a partir de R$ 199.',
        'Campinas',
    ), false);
    assert.match(
        controllerSource,
        /const sourceText = safePlanningLine\(candidate\?\.sourceText \|\| candidate\?\.text, 240\);\s*if \(!planningLiteralExists\(script, sourceText\)\) return \[\];/,
    );
});

test('texto visual da IA rejeita preço recombinado com outro produto ou benefício', () => {
    assert.equal(planningDisplaySupported(
        'Óculos por R$ 199. Exame premium por R$ 499.',
        'Exame R$ 199',
    ), false);
});

test('texto visual da IA rejeita nomes e localidades recombinados', () => {
    assert.equal(planningDisplaySupported(
        'Ótica Reis atende Piracicaba. Clínica Visão atende Campinas.',
        'Clínica Reis Campinas',
    ), false);
});

test('texto visual da IA rejeita duplicação de palavras ou valores', () => {
    assert.equal(planningDisplaySupported('Óculos por R$ 199.', 'R$ R$ 199'), false);
    assert.equal(planningDisplaySupported('Exame de vista grátis.', 'Exame exame grátis'), false);
});

test('texto visual da IA aceita recortes literais normalizados usados pelo produto', () => {
    const validCases = [
        ['A PARTIR DE R$ 39,90', 'R$ 39,90'],
        ['ATENÇÃO, PIRACICABA', 'PIRACICABA'],
        ['O EXAME DE VISTA', 'EXAME DE VISTA'],
        ['SUA ARMAÇÃO', 'ARMAÇÃO'],
        ['SOMENTE ATÉ SÁBADO', 'ATÉ SÁBADO'],
        ['CLIQUE NO BOTÃO', 'clique no botão'],
    ];

    validCases.forEach(([sourceText, displayText]) => {
        assert.equal(
            planningDisplaySupported(sourceText, displayText),
            true,
            `esperava aceitar "${displayText}" dentro de "${sourceText}"`,
        );
    });
});

test('texto visual rejeitado continua usando o compactador determinístico', () => {
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
