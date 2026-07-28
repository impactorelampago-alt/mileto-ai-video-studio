# Proposta de contrato v0.2 — envio de imagens do Mileto AI Video ao Mileto Ops

Data: **2026-07-26**  
Estado: **aceita em princípio, com os ajustes desta revisão; não implementar nem ativar ainda**  
Dependência: validação ponta a ponta da integração somente leitura v0.1  
Escopo futuro: `assets.write`

## 1. Princípios

- O envio acontece somente após ação explícita **“Enviar ao Mileto Ops”**.
- O Mileto Ops é a fonte de verdade do arquivo compartilhado.
- O ator é obtido exclusivamente da delegação curta e do vínculo confirmado.
- O AI Video nunca informa livremente `opsProfileId`, conta ou ator.
- Empresa e pasta são revalidadas no backend do Ops contra a carteira do ator.
- Os bytes são enviados para uma capability temporária e opaca do próprio Ops; o consumidor não deduz nem acessa diretamente o provedor de Storage.
- O Ops valida e transmite os bytes para o R2 privado, inicialmente em quarentena.
- A deduplicação usa SHA-256 e ocorre somente dentro da mesma conta Ops.
- Um objeto físico pode ter várias referências lógicas, sem atravessar contas.
- Upload incompleto nunca aparece na biblioteca.

Prefixo proposto:

```text
/api/integrations/mileto-ai-video
```

## 2. Tipos aceitos inicialmente

MIME permitidos:

```text
image/jpeg
image/png
image/webp
image/gif
image/avif
```

SVG fica fora da primeira versão por permitir conteúdo ativo. O Ops calcula o SHA-256 durante o recebimento e detecta o MIME pela assinatura dos bytes. `Content-Type`, extensão e checksum declarado pelo AI Video não são prova suficiente.

O Ops poderá também limitar largura, altura, quantidade total de pixels, complexidade de GIF animado e rejeitar arquivos malformados.

Limite inicial proposto:

```text
25 MiB por imagem
```

O limite efetivo deve vir também na resposta da intenção para permitir alteração de configuração sem quebrar o cliente.

Checksum:

```text
algorithm: sha256
value: 64 caracteres hexadecimais minúsculos, calculados sobre os bytes exatos
```

## 3. Criar intenção

```http
POST /v1/companies/:companyId/assets/upload-intents
Authorization: Bearer <delegação curta>
Idempotency-Key: <UUID>
Content-Type: application/json
```

Corpo:

```json
{
  "folderId": "uuid-ou-null",
  "fileName": "campanha-verao.png",
  "mimeType": "image/png",
  "sizeBytes": 483920,
  "checksum": {
    "algorithm": "sha256",
    "value": "64-hex-minusculo"
  },
  "versionNote": "Opcional",
  "origin": "mileto_ai_video"
}
```

O Ops valida conexão, conta, delegação, `assets.write`, carteira, empresa, pasta, MIME, extensão, tamanho e checksum.

### 3.1. Objeto ainda não existe

Resposta `201 Created`:

```json
{
  "data": {
    "uploadId": "uuid",
    "status": "awaiting_upload",
    "deduplicated": false,
    "upload": {
      "method": "PUT",
      "url": "temporária-e-opaca",
      "requiredHeaders": {
        "content-type": "image/png"
      },
      "expiresAt": "ISO-8601",
      "maxBytes": 26214400
    }
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

`upload.url` nunca deve ser persistida no projeto, banco local, log ou handoff.

Na primeira v0.2, essa URL aponta para uma rota temporária e opaca do próprio Ops, conceitualmente:

```text
PUT /api/integrations/mileto-ai-video/upload/:grant
```

O contrato não promete uma URL direta do R2 ou de qualquer provedor. O grant expira em 15 minutos, é de uso único e fica restrito à conexão, conta, ator, intenção, MIME e limite de 25 MiB. O upload ocorre no gateway seguro do AI Video; o renderer não recebe o grant.

Durante o stream, o Ops:

- limita o corpo;
- calcula SHA-256 sobre os bytes recebidos;
- detecta o tipo real;
- envia o objeto ao R2 privado em quarentena;
- mantém a referência invisível até `complete`.

### 3.2. Bytes já existem na mesma conta

O Ops cria uma nova referência lógica sem novo upload e responde `200 OK`:

```json
{
  "data": {
    "uploadId": "uuid",
    "status": "completed",
    "deduplicated": true,
    "asset": {
      "id": "asset-uuid",
      "companyId": "uuid",
      "folderId": "uuid-ou-null",
      "name": "campanha-verao.png",
      "kind": "image",
      "mimeType": "image/png",
      "sizeBytes": 483920,
      "checksum": "64-hex-minusculo",
      "version": 1,
      "updatedAt": "ISO-8601"
    }
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

## 4. Finalizar

```http
POST /v1/assets/upload-intents/:uploadId/complete
Authorization: Bearer <delegação curta>
Idempotency-Key: <o mesmo UUID da intenção>
Content-Type: application/json
```

Corpo:

```json
{
  "sizeBytes": 483920,
  "checksum": {
    "algorithm": "sha256",
    "value": "64-hex-minusculo"
  }
}
```

O Ops confirma a existência do objeto e exige coincidência entre:

- SHA-256 declarado na intenção;
- SHA-256 calculado pelo Ops;
- tamanho declarado;
- tamanho recebido;
- MIME declarado;
- MIME detectado pela assinatura dos bytes.

Depois registra o objeto físico e a referência lógica em uma transação e devolve `200 OK` com `status: "completed"` e o DTO final de `asset`.

A repetição de `complete` com o mesmo conteúdo retorna o mesmo resultado. Conteúdo divergente para a mesma chave retorna `409 idempotency_conflict`.

## 5. Consultar e cancelar

```http
GET    /v1/assets/upload-intents/:uploadId
DELETE /v1/assets/upload-intents/:uploadId
```

- `GET` devolve `awaiting_upload`, `uploading`, `processing`, `completed`, `cancelled`, `expired` ou `failed`.
- `DELETE` cancela apenas estados ainda não concluídos e é idempotente.
- Cancelar uma intenção concluída não exclui o ativo; responde `409 upload_already_completed`.
- A intenção pertence à conta, conexão e ator que a criou.

## 6. Idempotência e expiração

- `Idempotency-Key` obrigatório, no formato UUID.
- A chave é isolada por `connection_id + actor_id + operation + Idempotency-Key`.
- `create_intent` e `complete_intent` têm namespaces independentes; a mesma UUID pode ser usada nas duas operações.
- Cada registro guarda o hash canônico do payload.
- Mesma chave, operação e payload: mesmo resultado.
- Mesma chave e operação com payload diferente: `409 idempotency_conflict`.
- Retenção proposta da resposta idempotente: **24 horas**.
- URL de upload: **15 minutos**.
- Intenção sem finalização: expira após **24 horas**.
- Objetos temporários abandonados: limpeza assíncrona após a expiração.
- Falha na limpeza não publica o ativo e gera alerta/auditoria.

## 7. Deduplicação genérica, concorrência e exclusão

A infraestrutura de deduplicação pertence ao Mileto Ops como um todo, não exclusivamente à integração. Uploads originados no portal, equipe ou AI Video podem reutilizar o mesmo objeto físico dentro da mesma conta.

### Objeto físico

Representa os bytes:

- `account_id`;
- SHA-256;
- provedor;
- chave privada de Storage;
- MIME validado;
- tamanho;
- status;
- timestamps.

### Referência lógica

Representa onde o objeto aparece:

- empresa;
- pasta;
- nome;
- origem;
- autor;
- objeto físico;
- status;
- timestamps.

Chave física mínima:

```text
ops_account_id + sha256
```

O registro físico deve ter referências independentes por empresa/pasta. Excluir uma referência move-a para a lixeira ou a desativa; não remove os bytes enquanto houver outra referência ativa, uso por projeto ou período de retenção.

Não existe deduplicação entre contas.

Uma restrição única em `account_id + sha256`, combinada com transação ou upsert atômico, resolve finalizações concorrentes. Duas finalizações simultâneas dos mesmos bytes devem produzir um objeto físico, duas referências válidas quando os destinos diferirem e limpeza segura do upload temporário perdedor.

## 8. Compatibilidade com os arquivos atuais

A futura migration será aditiva e compatível com `client_portal_files`:

- vínculo opcional entre o arquivo atual e o novo objeto físico;
- backfill gradual e observável;
- leitura compatível durante a transição;
- nenhuma perda ou exclusão automática;
- rollback documentado;
- nenhuma quebra das rotas v0.1.

## 9. Responsabilidade futura do AI Video

Sem ativar a escrita agora, o desenho do AI Video deve prever:

- calcular SHA-256 antes da intenção;
- emitir `Idempotency-Key`;
- tratar `deduplicated: true` sem upload;
- enviar bytes somente para a URL opaca recebida;
- manter o grant exclusivamente no gateway;
- nunca persistir `upload.url`;
- cancelar quando solicitado;
- consultar status após falha de rede;
- repetir `complete` idempotentemente;
- persistir somente o `assetId` e a referência final.

## 10. Erros previstos

| HTTP | Código | Uso |
|---:|---|---|
| 400 | `invalid_upload_request` | Payload, extensão ou checksum inválido |
| 401 | `invalid_token` | Token ausente, expirado ou revogado |
| 403 | `insufficient_scope` | Falta `assets.write` |
| 403 | `company_access_denied` | Empresa fora da carteira |
| 404 | `folder_not_found` | Pasta ausente ou fora da empresa |
| 409 | `idempotency_conflict` | Mesma chave com conteúdo diferente |
| 409 | `upload_already_completed` | Tentativa incompatível após conclusão |
| 409 | `upload_grant_used` | Grant de uso único já consumido |
| 410 | `upload_intent_expired` | Intenção ou URL expirada |
| 413 | `asset_too_large` | Limite excedido |
| 415 | `unsupported_media_type` | MIME/extensão não permitidos |
| 422 | `checksum_mismatch` | Bytes, tamanho ou SHA-256 divergentes |
| 429 | `rate_limited` | Limite por ator/conta |
| 500/503 | `storage_unavailable` | R2 ou processamento indisponível |

Formato:

```json
{
  "error": {
    "code": "checksum_mismatch",
    "message": "O arquivo enviado não corresponde à intenção."
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

## 11. Auditoria obrigatória

Cada criação, deduplicação, upload, conclusão, cancelamento e falha registra:

- conta e conexão;
- ator delegado;
- empresa e pasta;
- `uploadId` e `assetId`, quando existir;
- tamanho, MIME e checksum;
- `origin: mileto_ai_video`;
- resultado e código de erro;
- `requestId`;
- data/hora.

Tokens, URL assinada, chave R2 e caminhos internos nunca entram na auditoria.

## 12. Critério de ativação

Esta proposta não autoriza mudanças no Ops nem a inclusão de `assets.write` no OAuth atual. A v0.2 só começa após:

1. migration e client OAuth v0.1 configurados em ambiente controlado;
2. E2E v0.1 aprovado;
3. revisão conjunta deste contrato;
4. testes de isolamento entre contas, carteira, deduplicação e upload abandonado;
5. plano de rollback e observabilidade aprovado.
