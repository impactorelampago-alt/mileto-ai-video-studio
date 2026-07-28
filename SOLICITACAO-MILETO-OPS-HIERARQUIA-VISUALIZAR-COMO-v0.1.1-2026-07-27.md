# Solicitação ao Mileto Ops — hierarquia e “visualizar como” para o Mileto AI Video

Data: 2026-07-27  
Integração base: v0.1, somente leitura  
Extensão proposta: v0.1.1 aditiva  

## Objetivo

Permitir que a biblioteca **Mileto Ops** dentro do Mileto AI Video respeite exatamente a hierarquia e as permissões já definidas no Mileto Ops.

O usuário precisa poder alternar entre os contextos que o Ops autorizar, por exemplo:

- **Minha conta**: somente o conteúdo e a carteira da própria pessoa;
- **Todos**: visão agregada da equipe que a pessoa pode supervisionar;
- **Pessoa específica**: conteúdo de um subordinado autorizado.

Exemplo esperado:

- o Dono pode visualizar a própria conta, Todos e cada pessoa permitida da empresa;
- uma Gerente pode visualizar a própria conta, Todos dentro do seu alcance hierárquico e cada subordinado permitido, mas não o Dono nem superiores;
- uma pessoa sem subordinados visualiza apenas a própria conta;
- as regras vêm do Mileto Ops e não são reproduzidas nem inferidas no Mileto AI Video.

## Lacuna do contrato v0.1 atual

O contrato atual permite criar uma delegação a partir de `aiVideoUserId`, mas o token delegado mantém a mesma pessoa como ator e sujeito. Ainda não existe uma forma segura de:

1. consultar os contextos que o ator pode visualizar;
2. selecionar `Todos` ou uma pessoa subordinada;
3. emitir uma delegação em que o ator real continue identificado, mas o contexto consultado seja outro;
4. aplicar essa escolha de forma uniforme a empresas, pastas, arquivos, thumbnails, reprodução, stream e download.

O Mileto AI Video **não deve enviar livremente um `ops_user_id` escolhido pelo renderer**. O Ops precisa fornecer opções autorizadas e revalidar a escolha no servidor.

## Contrato solicitado

### 1. Listar contextos autorizados

Adicionar um endpoint autenticado pelo token delegado atual:

`GET /api/integrations/mileto-ai-video/v1/me/view-contexts`

Escopo recomendado: aproveitar `companies.read`, sem criar novo consentimento OAuth para esta extensão somente leitura.

Resposta sugerida:

```json
{
  "data": {
    "defaultContextId": "opaque-context-id",
    "contexts": [
      {
        "contextId": "opaque-context-id",
        "mode": "self",
        "label": "Minha conta",
        "subtitle": "Dono",
        "isDefault": true
      },
      {
        "contextId": "opaque-context-id",
        "mode": "team",
        "label": "Todos",
        "subtitle": "Visão geral da equipe",
        "isDefault": false
      },
      {
        "contextId": "opaque-context-id",
        "mode": "profile",
        "label": "Otavio",
        "subtitle": "Vendedor",
        "relationship": "subordinate",
        "isDefault": false
      }
    ]
  }
}
```

Requisitos:

- `contextId` deve ser opaco, assinado ou resolvido exclusivamente pelo Ops;
- retornar somente pessoas e modos que o ator atual pode usar;
- não retornar e-mail ou dados sensíveis se não forem necessários ao seletor;
- a ordem e os rótulos podem ser entregues pelo Ops para manter coerência com sua interface;
- retornar capacidades explícitas, se útil, como `canViewTeam` e `canViewProfiles`; o AI Video não deve deduzi-las pelo nome do cargo.

### 2. Emitir delegação para o contexto escolhido

Estender o endpoint atual:

`POST /api/integrations/mileto-ai-video/v1/delegations`

Corpo sugerido:

```json
{
  "aiVideoUserId": "id-interno-do-ai-video",
  "viewContextId": "opaque-context-id"
}
```

Compatibilidade:

- `viewContextId` ausente mantém o comportamento v0.1 atual, equivalente a `self`;
- a autenticação continua sendo feita pelo token da conexão no gateway do AI Video;
- o Ops resolve o vínculo confirmado de `aiVideoUserId` para descobrir o ator real;
- o Ops valida que `viewContextId` pertence ao ator, à conta e à hierarquia atual;
- contexto inválido, expirado, de outra conta ou fora da hierarquia deve retornar `403` sem revelar nomes ou IDs não autorizados.

O token resultante precisa distinguir:

- **ator**: a pessoa realmente autenticada e vinculada no AI Video;
- **sujeito/contexto**: a própria pessoa, a equipe autorizada ou o subordinado selecionado;
- **modo**: `self`, `team` ou `profile`.

Não é necessário colocar toda a árvore hierárquica no token. O recomendado é manter token curto e revalidar no Ops a hierarquia e a carteira vigente ao atender cada recurso.

### 3. Aplicar o contexto a toda a biblioteca

O mesmo contexto autorizado deve reger:

- empresas permitidas;
- pastas;
- arquivos;
- thumbnails;
- reprodução;
- stream;
- download;
- criação de referência lógica no AI Video, sem copiar mídia.

Para `profile`, a carteira deve ser a carteira efetivamente visível para aquela pessoa conforme o Ops.

Para `team`, o resultado deve ser a união permitida para o ator e os subordinados dentro do alcance hierárquico do ator. A definição exata de alcance — direto ou recursivo — deve usar o mesmo serviço/regra já utilizado pelo seletor “visualizar como” do Ops.

Não tratar `team` como acesso irrestrito à conta, exceto quando o próprio Ops concluir que o ator possui esse acesso.

## Regras de segurança obrigatórias

- Mileto Ops continua sendo a fonte de verdade para conta, hierarquia, cargos, empresas e permissões.
- O AI Video não deve codificar regras como “Gerente sempre vê tudo”.
- O Dono, gerentes e demais cargos recebem exatamente os contextos calculados pelo Ops.
- Um gerente nunca pode visualizar o Dono, superiores, pares não autorizados ou pessoas de outra conta.
- O superadministrador da plataforma não deve ser misturado à equipe de uma empresa por causa de e-mail, cargo global ou privilégio operacional.
- `mileto.apps@gmail.com` e `impactorelampago@gmail.com` representam identidades e escopos diferentes; o vínculo e a conta atual precisam permanecer explícitos.
- O renderer envia ao gateway do AI Video somente o `contextId` opaco escolhido.
- O gateway deriva o `aiVideoUserId` da sessão autenticada; não aceita esse ID fornecido pelo renderer.
- O Ops valida novamente ator, vínculo, conta, contexto e hierarquia.
- Alteração de cargo, remoção da equipe ou mudança de hierarquia deve revogar o acesso efetivo imediatamente ou no máximo dentro do TTL curto do token, com revalidação de servidor.
- URLs assinadas, tokens, grants e caminhos privados continuam proibidos no renderer e nos logs.
- Continuar sem `assets.write`.
- Não enviar arquivos ao R2 nem ao Ops; a biblioteca permanece por referência e mídia segura via gateway.

## Auditoria solicitada

Para cada emissão de contexto e acesso material, registrar sem segredos:

- conta/empresa da conexão;
- ator real;
- modo selecionado;
- sujeito, quando houver;
- recurso acessado;
- decisão permitida ou negada;
- motivo técnico sanitizado para negações.

## Casos de aceite

1. **Dono — Minha conta**: vê somente sua carteira/conteúdo.
2. **Dono — Todos**: vê a visão agregada permitida de toda a equipe da empresa.
3. **Dono — Pessoa**: seleciona qualquer membro permitido e vê somente a carteira/conteúdo dessa pessoa.
4. **Gerente — Minha conta**: vê somente a própria carteira/conteúdo.
5. **Gerente — Todos**: vê somente sua equipe e subordinados dentro do alcance definido no Ops.
6. **Gerente — Pessoa**: seleciona subordinado permitido; Dono, superiores e pessoas fora de seu alcance não aparecem.
7. **Pessoa sem subordinados**: recebe somente `Minha conta`.
8. **Contexto forjado**: um `contextId` de outra pessoa, outra conta ou fora da hierarquia retorna `403`.
9. **Mudança de hierarquia**: um contexto anteriormente válido deixa de permitir acesso após a alteração no Ops.
10. **Isolamento empresarial**: nenhuma pessoa ou mídia de outra empresa aparece.
11. **Superadmin da plataforma**: não aparece como membro da empresa e não contamina a carteira da Impacto Relampago.
12. **Mídia**: thumbnails, reprodução, stream e download respeitam o mesmo contexto e passam pelo gateway seguro.
13. **Retrocompatibilidade**: clientes v0.1 que não enviam `viewContextId` continuam no contexto `self`.

## Entrega solicitada ao time do Mileto Ops

Devolver ao Mileto AI Video:

1. rotas e schemas finais;
2. exemplo sanitizado das respostas;
3. semântica oficial de `team` e alcance hierárquico;
4. TTL e regras de expiração do `contextId` e token delegado;
5. códigos de erro esperados;
6. confirmação de que todos os endpoints de mídia aplicam o contexto;
7. testes automatizados dos 13 casos de aceite;
8. commit e status de publicação em produção;
9. indicação de eventual migration aditiva;
10. handoff sem segredos.

## Observação sobre o estado atual exibido no AI Video

A mensagem **“Seu usuário precisa ser vinculado a um funcionário do Ops pelo dono da conta”** é anterior ao seletor hierárquico: ela indica que o usuário autenticado no Mileto AI Video ainda não possui um `user_link` confirmado com um perfil do Ops nessa conexão.

Antes de testar `Minha conta`, `Todos` ou subordinados, o Dono precisa sincronizar a equipe e confirmar o vínculo correto. O vínculo não deve ser criado apenas por semelhança de nome; comparação por e-mail normalizado pode sugerir a correspondência, mas casos ambíguos exigem confirmação e nunca devem duplicar ou excluir usuários automaticamente.

