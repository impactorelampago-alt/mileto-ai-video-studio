# Handoff de implementação — Mileto AI Video → Mileto Ops

Data: **2026-07-26**  
Contrato: **v0.1**  
Classificação: **local/confidencial; não publicar com segredos**

## 1. Situação

O lado Mileto AI Video da integração v0.1 foi implementado após o aceite do contrato descrito em:

- `HANDOFF-RETORNO-MILETO-OPS-PARA-AI-VIDEO-2026-07-26.md`
- `ACK-CONTRATO-MILETO-AI-VIDEO-OPS-v0.1-2026-07-26.md`

O Mileto Ops ainda precisa implementar e implantar a API descrita abaixo. Nenhuma alteração foi feita no repositório do Ops por esta conversa.

## 2. Onde está a implementação do AI Video

### Aplicativo desktop e servidor local

Worktree principal:

```text
C:\Users\User\Desktop\Projetos de Programas\Mileto AI Video
```

Principais arquivos:

```text
apps/client/src/lib/gateway.ts
apps/client/src/pages/Account.tsx
apps/client/src/components/FileExplorer.tsx
apps/client/src/components/OpsLibrary.tsx
apps/client/src/context/WizardContext.tsx
apps/client/src/types/index.ts
apps/server/src/services/gatewayClient.ts
apps/server/src/controllers/opsController.ts
apps/server/src/routes/api.ts
apps/server/src/index.ts
```

### Gateway em nuvem

O gateway completo continua no worktree preservado:

```text
C:\Users\User\Desktop\Projetos de Programas\Mileto AI Video\.claude\worktrees\session-88436a\apps\gateway
```

Principais arquivos da integração:

```text
src/config.js
src/crypto.js
src/db.js
src/opsClient.js
src/opsIntegration.js
src/server.js
.env.example
```

Esse worktree precisa ser consolidado no fluxo Git/deploy correto antes da publicação. Não copiar cegamente por cima do worktree principal, que está modificado.

## 3. Fluxo já implementado no AI Video

1. O Dono abre `Minha Conta` e inicia a conexão.
2. O gateway gera `state`, `code_verifier` e `code_challenge` PKCE S256.
3. O navegador abre o consentimento do Ops.
4. O callback público do gateway consome o `state` uma única vez e troca o code.
5. Access/refresh tokens do Ops ficam cifrados no gateway com chave exclusiva.
6. O Dono executa full reconciliation da equipe.
7. E-mail normalizado/hash serve apenas para sugerir; somente o Dono confirma o vínculo por IDs.
8. Cada usuário vinculado recebe delegação curta; o renderer nunca recebe token Ops.
9. A biblioteca apresenta somente empresas e ativos autorizados pelo Ops.
10. “Usar no editor” cria referência opaca no gateway e materializa bytes em cache local temporário.
11. Rascunhos locais/compartilhados persistem a referência externa, nunca signed URL, capability local ou caminho do cache.
12. Ao reabrir um rascunho, o computador revalida o usuário/carteira e rematerializa o ativo.

Selecionar um ativo Ops **não copia o arquivo para o R2 do AI Video**. Uma futura ação explícita “Copiar para Compartilhado” permanece fora da v0.1.

## 4. Endpoints que o Ops precisa entregar

Prefixo obrigatório:

```text
/api/integrations/mileto-ai-video
```

### OAuth/PKCE

```text
GET  /authorize
POST /authorize
POST /oauth/token
POST /oauth/revoke
```

O gateway abre `GET /authorize` com:

```text
response_type=code
client_id=<OPS_CLIENT_ID>
redirect_uri=<OPS_REDIRECT_URI>
scope=account.read users.read user_links.write companies.read assets.read assets.stream assets.download
state=<aleatório>
code_challenge=<S256 base64url sem padding>
code_challenge_method=S256
```

`POST /oauth/token` usa `application/x-www-form-urlencoded`.

Troca de code:

```text
grant_type=authorization_code
code
redirect_uri
client_id
client_secret
code_verifier
```

Refresh:

```text
grant_type=refresh_token
refresh_token
client_id
client_secret
```

Resposta aceita em camelCase ou snake_case, mas deve conter:

```json
{
  "accessToken": "opaco",
  "refreshToken": "opaco e rotativo",
  "expiresIn": 600,
  "scope": "account.read users.read ..."
}
```

Na troca inicial, `refreshToken` é obrigatório. O AI Video rejeita callback sem refresh token.

`POST /oauth/revoke` usa `application/x-www-form-urlencoded`:

```text
token
client_id
client_secret
```

O code deve ser uso único, armazenado como hash, ter TTL de 2–5 minutos, validar redirect exato e PKCE S256. Refresh token deve ser rotativo e armazenado somente como hash no Ops.

Callback exato a cadastrar em produção:

```text
https://api.miletoaivideo.com.br/v1/integrations/mileto-ops/callback
```

### Conta, equipe e delegação

```text
GET    /v1/account
GET    /v1/users?cursor=&limit=&updated_after=
PUT    /v1/user-links/:aiVideoUserId
DELETE /v1/user-links/:aiVideoUserId
POST   /v1/delegations
```

Expectativas específicas:

- `GET /v1/account`: `data.id`/`data.accountId` e `data.name`/`data.accountName`.
- `GET /v1/users`: `data` deve ser um array; paginação em `meta.nextCursor`.
- `PUT user-links`: JSON `{ "opsProfileId": "uuid" }`; repetição do mesmo vínculo é idempotente.
- `DELETE user-links`: desvincula, sem excluir pessoa.
- `POST /v1/delegations`: JSON `{ "aiVideoUserId": "123" }`.
- O Ops resolve internamente o `ops_profile_id`; nunca aceita ator Ops arbitrário do cliente.

Resposta mínima da delegação:

```json
{
  "data": {
    "accessToken": "delegação-curta",
    "expiresAt": "ISO-8601",
    "scopes": ["companies.read", "assets.read"]
  },
  "meta": { "requestId": "uuid" }
}
```

DTO de usuário:

```json
{
  "id": "ops-profile-uuid",
  "name": "Nome",
  "normalizedEmail": "owner/users.read apenas",
  "emailFingerprint": "sha256-do-email-normalizado",
  "primaryRole": "GESTOR_TRAFEGO",
  "memberships": ["GESTOR_TRAFEGO"],
  "status": "active",
  "updatedAt": "ISO-8601"
}
```

### Carteira e biblioteca somente leitura

```text
GET  /v1/me/companies?cursor=&limit=&q=
GET  /v1/companies/:companyId/folders
GET  /v1/companies/:companyId/assets?folderId=&cursor=&limit=&q=
GET  /v1/assets/:assetId
POST /v1/assets/:assetId/thumbnail-url
POST /v1/assets/:assetId/stream-url
POST /v1/assets/:assetId/download-url
```

Listas de empresas e ativos devem devolver um array em `data` e cursor em `meta.nextCursor`. O AI Video pagina automaticamente em páginas de até 100 itens.

DTO mínimo do ativo:

```json
{
  "id": "client_portal_files.id",
  "companyId": "clients.id",
  "folderId": null,
  "name": "arquivo.mov",
  "kind": "video",
  "mimeType": "video/quicktime",
  "sizeBytes": 123,
  "mid": null,
  "version": null,
  "checksum": null,
  "durationMs": null,
  "width": null,
  "height": null,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "capabilities": {
    "thumbnail": true,
    "stream": true,
    "download": true,
    "range": null
  }
}
```

Resposta dos endpoints `*-url`:

```json
{
  "data": {
    "url": "https://url-temporaria",
    "expiresAt": "ISO-8601 ou null",
    "delivery": "hls | mp4 | signed-object",
    "supportsRange": true,
    "requestId": "uuid"
  },
  "meta": { "requestId": "uuid" }
}
```

Cada endpoint precisa revalidar conexão, conta, ator delegado, carteira, empresa e ativo. Não devolver `storage_path`, `stream_uid`, credencial R2/Storage ou token Cloudflare em DTO de listagem.

## 5. Envelope e erros

Sucesso:

```json
{
  "data": {},
  "meta": { "requestId": "uuid", "nextCursor": null }
}
```

Erro:

```json
{
  "error": {
    "code": "asset_forbidden",
    "message": "Sem acesso a este arquivo.",
    "requestId": "uuid"
  }
}
```

O gateway preserva status, `code` e `requestId`. Não registrar tokens, codes OAuth nem URLs assinadas completas.

## 6. Comportamento de mídia no AI Video

- Cache: `<USER_DATA_PATH>/ops-cache`.
- Quota padrão: 20 GB; configurável por `OPS_CACHE_MAX_BYTES`.
- TTL padrão: 7 dias; configurável por `OPS_CACHE_TTL_DAYS`.
- Limpeza: LRU quando passa de 90%, reduzindo até 75%.
- Download: `.part`, rename atômico, tamanho/checksum quando disponíveis e SHA-256 local.
- Renovação: até duas renovações depois de 401/403/410 ou falha no stream.
- URLs remotas e redirecionamentos passam por validação anti-SSRF.
- Arquivos físicos recebem nomes opacos derivados da chave do cache.
- O diretório não é servido estaticamente; preview usa URL-capability local para o arquivo exato.
- URL-capability e caminhos locais são retirados de todo rascunho persistido.
- Cada reabertura revalida a referência e a carteira no Ops.

## 7. Variáveis necessárias no gateway AI

```dotenv
OPS_BASE_URL=https://<dominio-do-ops>
OPS_CLIENT_ID=<cliente-first-party>
OPS_CLIENT_SECRET=<segredo-forte>
OPS_REDIRECT_URI=https://api.miletoaivideo.com.br/v1/integrations/mileto-ops/callback
OPS_TOKEN_ENCRYPTION_KEY=<chave-aleatoria-exclusiva>
OPS_SCOPES=account.read users.read user_links.write companies.read assets.read assets.stream assets.download
```

Sem todos os campos obrigatórios, a integração fica desabilitada e o restante do AI Video continua funcionando.

## 8. Pendências para ativação conjunta

1. Implementar migrations, OAuth, vínculo, delegação, auditoria e endpoints no Ops.
2. Cadastrar o client first-party e o redirect URI exato.
3. Entregar `OPS_BASE_URL`, client ID e secret por canal seguro; não colocar segredos neste MD.
4. Consolidar e implantar o worktree do gateway AI correto.
5. Aplicar o schema novo do gateway AI em ambiente controlado.
6. Configurar `OPS_TOKEN_ENCRYPTION_KEY` exclusiva.
7. Repetir a reconciliação quando o PostgreSQL do gateway AI estiver acessível; nenhum vínculo foi gravado até agora.
8. Executar teste integrado com um Dono, um membro vinculado, um membro sem acesso, uma empresa permitida e um ativo negado.

## 9. Validações já executadas no AI Video

- TypeScript do servidor local: passou.
- Build TypeScript/Vite do cliente: passou.
- ESLint focado nos arquivos novos: sem erros.
- `git diff --check`: passou.
- Sintaxe dos módulos novos do gateway: passou.
- AES-256-GCM Ops: roundtrip e rejeição de adulteração passaram.
- Cliente Ops com mock HTTP: troca de token enviou `code_verifier`; Bearer foi aplicado.
- Rota local do cache: capability correta aceita; token errado retorna 403; arquivo diferente retorna 404.

Não foi possível executar E2E real porque a API do Ops ainda não existe e o PostgreSQL do gateway AI estava indisponível (`ECONNREFUSED`). Nenhuma migration ou escrita de produção foi realizada.

## 10. Critério de conclusão do agente Ops

O agente Ops deve devolver um novo handoff contendo:

- arquivos/migrations implementados;
- client ID criado, sem expor secret;
- URL base e redirect cadastrados;
- testes de PKCE, rotação/reuso de refresh, revogação e cross-tenant;
- testes da carteira para Dono e funcionário;
- fixtures/resultados de paginação das 55 empresas da Impacto;
- teste de URL expirada durante download;
- riscos ou divergências contratuais restantes.

