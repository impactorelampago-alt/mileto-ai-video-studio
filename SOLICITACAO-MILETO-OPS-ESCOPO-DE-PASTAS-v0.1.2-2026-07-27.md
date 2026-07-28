# Solicitação Mileto AI Video → Mileto Ops — escopo exato de pastas v0.1.2

Data: 2026-07-27  
Integração atual: v0.1.1  
Natureza: ajuste aditivo e esclarecimento de contrato; não é a v0.2

## Contexto

Na biblioteca da empresa **Ótica Reis Raposo (Cintia)**, o Mileto Ops apresenta na raiz apenas as pastas **TAKES** e **Vídeos completos**. Os 27 arquivos estão dentro de **TAKES**.

Ao consultar a API de assets da empresa sem `folderId`, o Mileto AI Video recebe também os arquivos que pertencem a **TAKES**. Como a ausência de `folderId` estava sendo interpretada pelo cliente como “raiz”, os arquivos apareciam ao lado das pastas, achatando a árvore.

O Mileto AI Video já aplicou uma proteção local: na raiz exibe apenas pastas e só consulta assets depois que uma pasta é aberta.

## Confirmações solicitadas ao Mileto Ops

1. Documentar explicitamente a semântica de:
   - `GET /v1/companies/:companyId/assets` sem `folderId`;
   - `GET /v1/companies/:companyId/assets?folderId=<id>`.
2. Garantir que `folderId=<id>` retorne somente os arquivos diretamente pertencentes à pasta informada, sem arquivos de outras pastas.
3. Garantir que cada item retornado contenha `folderId` — `null` apenas quando o arquivo realmente estiver na raiz.
4. Manter `q` e a paginação restritos à pasta quando `folderId` for enviado.
5. Informar uma forma explícita, aditiva e estável de consultar somente os arquivos da raiz. Sugestões aceitáveis:
   - `scope=root`;
   - `folderId=root`;
   - outro parâmetro equivalente definido pelo Ops.
6. A consulta sem escopo pode continuar sendo uma busca global, desde que isso fique documentado e não seja confundido com a raiz.

## Cenário de aceite

Para uma empresa com esta estrutura:

```text
Raiz
├── TAKES (27 arquivos)
└── Vídeos completos (0 arquivos)
```

Os resultados esperados são:

- raiz: duas pastas e nenhum arquivo;
- `folderId` de TAKES: exatamente os 27 arquivos de TAKES;
- `folderId` de Vídeos completos: lista vazia;
- busca com `q` e `folderId`: resultados somente dentro da pasta selecionada;
- cada asset informa o `folderId` correto.

## Regras preservadas

- Não habilitar `assets.write`.
- Não enviar, mover, duplicar ou excluir arquivos.
- Não alterar as regras de hierarquia, empresas permitidas ou “visualizar como”.
- Stream, thumbnail e download continuam passando pelos fluxos seguros já contratados.
- Nenhum token, grant, signed URL ou caminho privado deve ser exposto.

## Retorno solicitado ao Ops

Responder com um handoff sem segredos contendo:

- semântica final dos parâmetros;
- exemplo de resposta com `folderId`;
- testes automatizados do cenário acima;
- commit publicado;
- estado do deploy em produção;
- eventual incompatibilidade que exija ajuste no Mileto AI Video.

