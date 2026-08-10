# Solicitação ao Mileto Ops — refresh rotativo idempotente v0.1.3

Data: 10/08/2026

Origem: Mileto AI Video

Destino: Mileto Ops

## Motivo

O refresh token do Ops é rotativo e de uso único. No código auditado do `mileto-ops2` (`c8f581d`), o token anterior é consumido antes de a resposta com o sucessor chegar ao gateway. Se a resposta se perder por timeout, repetir a mesma solicitação é interpretado como reutilização e revoga toda a família.

Até este contrato existir, o AI Video preserva o vínculo em falhas temporárias, mas não repete imediatamente o mesmo refresh token. Uma nova operação tenta renovar novamente. Isso evita provocar revogação por replay, mas não recupera o sucessor quando a primeira resposta foi perdida depois da rotação.

## Contrato necessário

1. `POST /oauth/token` deve aceitar `Idempotency-Key` estável por tentativa lógica de refresh.
2. Consumir o token pai, emitir access token, emitir refresh sucessor e registrar o replay deve ocorrer em uma única transação.
3. A mesma chave, cliente, token pai e corpo deve devolver exatamente a mesma resposta durante uma janela curta de replay, sugerida entre dois e cinco minutos.
4. A resposta precisa ficar recuperável de forma segura nessa janela, com tokens cifrados temporariamente ou derivados de forma determinística por chave exclusiva do servidor.
5. A mesma chave com corpo diferente deve falhar como conflito; outra chave reutilizando o mesmo token pode continuar acionando a proteção contra replay.
6. Uma disputa de CAS deve consultar o registro idempotente antes de revogar a família.
7. Erros do banco devem produzir `5xx` temporário. Somente evidência real de token ausente, expirado, revogado ou reutilizado deve produzir `invalid_grant`.
8. O Ops deve devolver o envelope OAuth padrão com `error`, `error_description` e, quando disponível, `requestId`.

## Ajuste correspondente no AI Video

Quando o contrato acima estiver publicado, o gateway passará a:

- gerar uma chave UUID antes da primeira tentativa;
- reutilizar a mesma chave em retries com backoff;
- respeitar `Retry-After` em `slow_down`/`429`;
- gerar outra chave somente depois de persistir e usar o refresh token sucessor.

## Critérios de aceite conjuntos

- timeout depois do commit no Ops e antes da resposta: retry devolve o mesmo access/refresh sem revogar a família;
- duas requisições concorrentes com a mesma chave convergem para a mesma resposta;
- falha entre consumo e emissão faz rollback e mantém o token pai utilizável;
- `429`, `500`, timeout e indisponibilidade do banco não desconectam a empresa;
- `invalid_grant` real exige nova autorização e não volta automaticamente para conectado;
- logs e respostas nunca expõem access token, refresh token, segredo do cliente ou conteúdo cifrado de replay.
