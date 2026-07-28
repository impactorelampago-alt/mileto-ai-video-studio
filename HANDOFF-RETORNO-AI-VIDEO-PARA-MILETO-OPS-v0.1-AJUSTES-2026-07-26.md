# Retorno de compatibilidade — Mileto AI Video → Mileto Ops

Data: **2026-07-26**  
Contrato: **v0.1, somente leitura**  
Estado: **ajustes locais concluídos; aguardando configuração controlada e E2E**

## 1. Resultado

Os ajustes solicitados nos retornos do Mileto Ops foram tratados no lado do AI Video:

1. `workspace_id` derivado da organização autenticada foi incluído no OAuth.
2. A preparação assíncrona de mídia aceita `HTTP 202`/`ready: false`, respeita `retryAfterSeconds`, tem limite, timeout e cancelamento.
3. O MP4 entregue pelo Cloudflare não é comparado ao tamanho/checksum do arquivo original.
4. MIME e extensão seguem `download.delivery`.
5. O gateway foi consolidado de forma seletiva na pasta canônica do repositório.
6. A proposta v0.2 para envio explícito de imagens foi documentada, sem ativar `assets.write`.
7. URLs de mídia foram limitadas à origin configurada do Ops e ao caminho de entrega autorizado.

Nenhuma migration foi aplicada e nada foi publicado em produção.

## 2. Arquivos principais

Gateway canônico:

```text
apps/gateway/.env.example
apps/gateway/package.json
apps/gateway/package-lock.json
apps/gateway/src/config.js
apps/gateway/src/crypto.js
apps/gateway/src/db.js
apps/gateway/src/migrate.js
apps/gateway/src/opsClient.js
apps/gateway/src/opsIntegration.js
apps/gateway/src/server.js
```

Servidor local e renderer:

```text
apps/server/src/controllers/opsController.ts
apps/server/src/services/gatewayClient.ts
apps/client/src/components/OpsLibrary.tsx
apps/client/src/lib/gateway.ts
```

Contrato futuro:

```text
CONTRATO-PROPOSTO-MILETO-AI-VIDEO-OPS-v0.2-IMAGENS-2026-07-26.md
```

## 3. OAuth e segredos

O gateway agora inclui:

```js
authorize.searchParams.set('workspace_id', String(req.user.orgId));
```

O valor nasce exclusivamente da sessão autenticada. O navegador não escolhe o workspace.

Continuam restritos ao gateway:

- access token e refresh token do Ops;
- client secret;
- chave exclusiva de criptografia dos tokens;
- UID do Cloudflare;
- credenciais e caminhos internos do R2;
- URLs de entrega temporárias.

O renderer recebe somente DTOs autorizados, referências opacas e, quando necessário, uma URL temporária de visualização. Tokens Ops não são enviados ao renderer.

## 4. HTTP 202 e cancelamento

Os pedidos `stream-url` e `download-url` agora são `POST`, conforme o contrato.

Quando o Ops devolve `202` ou `data.ready === false`, o gateway:

- aguarda de 1 a 10 segundos conforme `retryAfterSeconds`;
- repete o mesmo `POST`;
- limita a 12 tentativas;
- encerra com `504 ops_media_not_ready` quando o limite termina;
- cancela a espera e a requisição ao Ops quando o cliente fecha/cancela;
- nunca trata `ready: false` como URL pronta.

O servidor local também tolera `202` na URL opaca de entrega, com o mesmo limite, e o botão **Cancelar** interrompe a materialização.

Timeouts do renderer e servidor local foram alinhados em 150 segundos para ficarem acima da janela máxima de preparação do gateway.

## 5. Entrega, MIME, extensão e integridade

### `delivery: "mp4"`

- arquivo final recebe `.mp4`;
- MIME efetivo precisa ser `video/mp4`;
- não é comparado com `asset.sizeBytes` nem com o checksum do MOV original;
- tamanho/checksum só são comparados quando pertencem ao descritor da entrega.

### `delivery: "signed-object"`

- MIME efetivo precisa ser compatível com o tipo do ativo;
- MIME/extensão originais válidos são preservados;
- respostas JSON, HTML e texto são rejeitadas como arquivo.

Mantidos:

- quota máxima local;
- SHA-256 local;
- limite de redirects;
- proteção anti-SSRF;
- arquivo `.part` com remoção após falha;
- renovação limitada de URL expirada;
- cache local temporário com URL-capability opaca;
- referência externa persistida sem signed URL, caminho local ou capability.

### Allowlist final de mídia

O gateway valida a URL emitida pelo Ops contra a origin exata de `OPS_BASE_URL`. O servidor local repete a validação antes de cada requisição e redirect.

São aceitas somente URLs:

- sem `username` ou `password`;
- com a origin exata configurada;
- com HTTPS em produção;
- no caminho `/api/integrations/mileto-ai-video/delivery/:grant`;
- sem query string ou fragmento.

Redirect para outra origin ou caminho é rejeitado. Permanecem o limite de três redirects, anti-SSRF e timeout.

## 6. Consolidação do gateway

O conteúdo necessário do worktree foi copiado seletivamente para:

```text
apps/gateway
```

Não foram copiados:

- `.env`;
- `node_modules`;
- certificados e chaves locais;
- qualquer segredo.

O arquivo de prompt que já existia nas duas pastas tinha o mesmo SHA-256 e foi preservado.

## 7. Validações executadas

Resultados:

- build/typecheck do servidor: **aprovado**;
- build de produção do cliente: **aprovado**, 1.877 módulos;
- ESLint nos quatro arquivos alterados do servidor/cliente: **aprovado, zero erros**;
- `node --check` em todos os arquivos JavaScript do gateway canônico: **aprovado**;
- teste de cancelamento do cliente Ops: **aprovado**, retornando `499 ops_request_cancelled`;
- instalação reproduzível do gateway por `npm ci`: **aprovada, zero vulnerabilidades reportadas pelo npm**;
- testes unitários do contrato no repositório Ops: **5/5 aprovados**, executados de forma somente leitura;
- teste integrado local com gateway e entrega simulados:
  - primeira entrega `202`;
  - segunda entrega `200 image/png`;
  - materialização `201`;
  - extensão `.png`;
  - tamanho original propositalmente divergente não bloqueou;
  - arquivo final íntegro.
- teste da allowlist:
  - redirect para outra origin recusado com `502`;
  - URL válida na origin configurada e no caminho autorizado aceita;
  - polling `202 → 200` continuou funcional após a restrição.

Aviso não bloqueante: o `npm` sinaliza que `multer` 1.x está obsoleto e recomenda migração futura para 2.x. Isso não foi alterado neste ajuste para não ampliar o escopo.

## 8. Proposta v0.2

A proposta completa está em:

```text
CONTRATO-PROPOSTO-MILETO-AI-VIDEO-OPS-v0.2-IMAGENS-2026-07-26.md
```

Ela define intenção, upload direto temporário, finalização, consulta, cancelamento, SHA-256, limite de 25 MiB, MIME permitido, idempotência, deduplicação por conta, múltiplas referências, auditoria, expiração e limpeza.

É apenas uma proposta. `assets.write` não foi adicionado aos escopos da v0.1.

## 9. Pendências para o E2E controlado

No Mileto Ops:

1. revisar/aceitar o contrato v0.2 separadamente, sem implementá-lo na ativação v0.1;
2. aplicar a migration v0.1 no ambiente escolhido;
3. cadastrar o client OAuth com callback exato;
4. entregar `client_id` e `client_secret` por canal seguro;
5. confirmar CORS, base URL e rate limits do ambiente.

No gateway do AI Video:

1. configurar as variáveis Ops por gerenciador seguro de segredos;
2. executar a migration do gateway em ambiente controlado;
3. iniciar com uma organização e um Dono de teste;
4. observar logs por `requestId`, sem registrar tokens ou URLs assinadas.

Teste conjunto:

1. conectar e revogar;
2. refresh rotativo e detecção de reutilização;
3. sincronizar equipe e confirmar vínculos;
4. validar isolamento de carteira;
5. listar e usar imagem `signed-object`;
6. usar vídeo original MOV entregue como MP4;
7. forçar preparação `202`;
8. cancelar durante preparação;
9. reabrir projeto e rematerializar;
10. confirmar que não houve cópia automática para o R2 do AI Video.

## 10. Divergências restantes

- A migration do Ops e o cadastro OAuth ainda não existem no ambiente; portanto o E2E real continua bloqueado por configuração, não por código conhecido.
- O upgrade de `multer` deve ser tratado em manutenção separada e testado contra os fluxos existentes de upload.
