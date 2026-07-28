# Confirmação ao Mileto Ops — segurança v0.1 e revisão v0.2

Data: **2026-07-26**  
Estado v0.1: **compatível em código; aguardando configuração e E2E controlado**  
Estado v0.2: **contrato revisado; nenhuma escrita implementada ou ativada**

## 1. Upload opaco na v0.2

Aceito.

A primeira v0.2 tratará `upload.url` como capability temporária e opaca do próprio Ops. O consumidor não presumirá URL direta do R2, Supabase Storage ou outro provedor.

O desenho prevê:

- upload realizado pelo gateway seguro do AI Video;
- grant nunca entregue ao renderer;
- validade real de 15 minutos;
- uso único;
- limite de 25 MiB;
- checksum calculado pelo Ops durante o stream;
- MIME detectado pela assinatura dos bytes;
- quarentena até a conclusão;
- ausência de persistência ou log de `upload.url`.

Nenhum código de escrita foi implementado.

## 2. Allowlist exata da origin na v0.1

Implementada.

O gateway valida a URL retornada pelo Ops contra a origin exata de `OPS_BASE_URL`. O servidor local valida novamente antes do primeiro download e de cada redirect.

Regras:

- HTTPS obrigatório em produção;
- origin exatamente igual à configurada;
- caminho exclusivamente `/api/integrations/mileto-ai-video/delivery/:grant`;
- proibição de `username`, `password`, query string e fragmento;
- redirect não pode trocar origin nem caminho autorizado;
- máximo de três redirects;
- timeout, cancelamento e proteção anti-SSRF continuam ativos.

Validação integrada executada:

- redirect para outra origin: recusado com `502`;
- entrega válida no caminho autorizado: materializada com `201`;
- preparação assíncrona `202 → 200`: aprovada.

Arquivo principal:

```text
apps/gateway/src/opsIntegration.js
apps/server/src/controllers/opsController.ts
```

## 3. Idempotência separada por operação

Aceita para a v0.2.

Chave lógica:

```text
connection_id + actor_id + operation + Idempotency-Key
```

Operações como `create_intent` e `complete_intent` terão namespaces independentes e hash canônico do payload. Mesma chave/operação/payload devolve o mesmo resultado; payload divergente devolve `409 idempotency_conflict`.

## 4. Modelo genérico de armazenamento

Aceito para a v0.2.

O modelo será de infraestrutura geral do Mileto Ops, reutilizável pelo portal, equipe e integrações:

- objeto físico: conta, SHA-256, provedor, chave privada, MIME validado, tamanho, status e timestamps;
- referência lógica: empresa, pasta, nome, origem, autor, objeto físico, status e timestamps.

A futura migration será aditiva e compatível com `client_portal_files`, com vínculo opcional, backfill gradual, leitura de transição, rollback e nenhuma exclusão automática.

## 5. Deduplicação concorrente

Aceita para a v0.2.

Uma restrição única por:

```text
account_id + sha256
```

será combinada com transação ou upsert atômico. Finalizações simultâneas devem resultar em um objeto físico, referências lógicas independentes e limpeza segura do upload temporário perdedor. Nunca haverá deduplicação entre contas.

## 6. Escopos atuais

Confirmado:

```text
account.read
users.read
user_links.write
companies.read
assets.read
assets.stream
assets.download
```

`assets.write` não está na autorização v0.1 e não será incluído antes da aprovação do E2E e da autorização específica da v0.2.

## 7. Arquivos previstos futuramente para a v0.2

Lista de planejamento; os arquivos ainda não serão criados:

```text
apps/gateway/src/opsUploads.js
apps/gateway/src/opsIntegration.js
apps/gateway/src/server.js
apps/gateway/src/migrate.js
apps/server/src/controllers/opsUploadController.ts
apps/server/src/routes/api.ts
apps/client/src/components/SendToOpsDialog.tsx
apps/client/src/components/OpsLibrary.tsx
apps/client/src/lib/gateway.ts
apps/client/src/types/index.ts
```

Responsabilidades planejadas:

- servidor local: validar o arquivo local permitido e calcular SHA-256;
- gateway AI: manter delegação/grant, criar intenção, transmitir bytes ao Ops, finalizar, consultar e cancelar;
- renderer: coletar empresa, pasta, nome e observação, exibindo apenas estado/progresso;
- migration futura do gateway: jobs, idempotência e auditoria sem armazenar capability em texto permanente.

O contrato revisado está em:

```text
CONTRATO-PROPOSTO-MILETO-AI-VIDEO-OPS-v0.2-IMAGENS-2026-07-26.md
```

## 8. Condições preservadas

- nenhuma migration aplicada;
- nenhuma publicação em produção;
- nenhum client secret, token, signed URL, grant, caminho privado ou chave documentado;
- nenhuma alteração feita no repositório Mileto Ops;
- nenhum `assets.write` ativado.
