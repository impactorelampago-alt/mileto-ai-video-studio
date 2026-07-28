# Arquitetura dos agentes de IA

Data: 2026-07-27

## Objetivo

O Chat Mileto passa a ser a porta de entrada de uma equipe de quatro agentes. O aplicativo conhece apenas a identidade pública do agente que respondeu. Prompts, provedores, modelos, níveis de raciocínio e chaves permanecem no gateway.

## Agentes

1. **Mileto Diretor**: conversa com o usuário, preserva o contexto e coordena o trabalho.
2. **Estrategista de Prompt e Vendas**: transforma ideias em briefing, oferta, roteiro, CTA, gatilhos éticos e cenas.
3. **Diretor de Imagens**: transforma o briefing em um contrato JSON para o motor de imagens.
4. **Diretor de Vídeos**: transforma o briefing em storyboard, continuidade e contrato JSON para o motor de vídeo.

Os agentes de imagem e vídeo nascem desativados. Eles só devem ser ativados quando o motor e o modelo de produção estiverem configurados e validados.

## Controle no Super Admin

Em **IA > Agentes**, cada agente possui:

- ativação independente;
- três níveis independentes: **Mileto Lite**, **Mileto** e **Mileto Ultra**;
- provedor e modelo do cérebro definidos separadamente em cada nível;
- modo de raciocínio e limite máximo de saída definidos por nível;
- prompt de sistema;
- motor e modelo de produção por nível para imagem/vídeo;
- teste de rascunho sem publicação;
- publicação de nova versão;
- histórico de até 30 versões;
- rollback que cria uma nova versão auditável.

O painel antigo de Prompt é mantido como compatibilidade. Na primeira adoção, o Mileto Diretor aproveita esse prompt legado; depois disso, a Central de Agentes passa a ser a fonte de verdade.

## Fluxo seguro

```text
Renderer -> servidor local -> gateway autenticado -> agente versionado -> provedor
                                      |
                                      +-> reserva e conciliação de créditos
```

- O renderer nunca recebe prompt, chave, provedor ou ID do modelo real.
- O retorno seguro informa somente `id`, nome público e versão do agente.
- O nível público escolhido no chat acompanha toda a cadeia de agentes da conversa.
- Sessões antigas no formato Mileto Plus são tratadas como o nível intermediário **Mileto**.
- Agentes desativados falham fechados.
- Especialistas de Prompt/Vendas, Imagem e Vídeo usam saída JSON.
- O Mileto Diretor preserva o contrato de título e roteiro usado pelo editor.

## Experiência no aplicativo

- O Chat Mileto permite escolher **Diretor**, **Prompt e Vendas**, **Imagens** ou **Vídeos**.
- Cada conversa preserva o agente e o nível público que produziu a resposta.
- Prompt e Vendas entrega roteiro, oferta, CTA e gatilhos éticos em um cartão estruturado.
- Imagens e Vídeos entregam uma especificação de produção antes de qualquer cobrança.
- A geração só começa depois do clique explícito em **Aprovar e gerar**.
- O trabalho continua em segundo plano e seu andamento aparece no sino de notificações.
- O resultado é salvo exclusivamente na biblioteca local **Geração por IA**, agrupado pela conversa.
- A etapa 2 abre essa pasta diretamente para selecionar imagens e vídeos já gerados.
- Nenhuma criação de IA é enviada automaticamente ao R2 compartilhado ou ao Mileto Ops.

## Execução e cobrança

- Imagens são geradas pelo motor Gemini configurado no nível do Diretor de Imagens.
- Vídeos são enviados ao Seedance e acompanhados por um identificador opaco do gateway.
- URLs do provedor, chaves, prompts privados e IDs internos nunca chegam ao renderer.
- O vídeo final passa pelo gateway seguro antes de ser salvo no computador.
- Cada nível de imagem/vídeo exige um custo máximo em dólar configurado no Super Admin.
- Os créditos são reservados antes da geração e conciliados de forma transacional.
- Se o provedor não aceitar a geração, a reserva é devolvida; se aceitar, uma falha posterior de acompanhamento não gera reembolso indevido.
- Agente desativado, modelo vazio, chave ausente ou custo zerado bloqueiam a geração.

## Ativação de produção

Antes de publicar, é obrigatório:

1. aplicar a migration aditiva `npm run migrate:agents-v01` no gateway;
2. publicar a nova versão do gateway;
3. configurar a chave do Gemini e a chave do Seedance somente no gateway;
4. definir e validar o modelo de produção e o custo máximo para cada um dos três níveis;
5. testar uma geração controlada de imagem e uma de vídeo;
6. somente então ativar os agentes de Imagens e Vídeos.

## Estado desta entrega

- Central de Agentes e versionamento: implementados.
- Seleção dos quatro agentes no Chat Mileto: implementada.
- Contratos de Prompt/Vendas, Imagem e Vídeo: implementados.
- Aprovação, geração em segundo plano e progresso no sino: implementados.
- Salvamento local em `Geração por IA` e seleção na etapa 2: implementados.
- Execução real de imagem via Gemini e vídeo via Seedance: implementada no código e desligada por segurança até a configuração.
- Migração e publicação no gateway de produção: não realizadas nesta entrega.
