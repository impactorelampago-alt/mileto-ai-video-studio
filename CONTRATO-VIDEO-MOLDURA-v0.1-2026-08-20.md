# Contrato — Vídeo Moldura (Filmmaker/Ops → executor Mileto AI Video) · v0.1 · 2026-08-20

## Objetivo
Permitir que o agente **Filmmaker** dispare um **Vídeo Moldura**: vídeo **1:1** com um **PNG de tela inteira** (a "moldura") sobreposto a **todos os takes**, **sem título e sem legenda**. É o mesmo modelo de 2 etapas (narração + takes) que já existe manual no app, agora disparável pela IA.

## O que o Ops precisa mandar no video-job
Além dos campos normais (`narration`, `takeAssetIds`, `companyId`, etc.), um job de moldura deve trazer:

| Campo | Valor | Observação |
|---|---|---|
| `settings.videoModel` | `"moldura"` | **O sinal do modelo.** É isso que liga o modo moldura no executor. Vai dentro de `settings` (que é aberto/passthrough — não precisa mudar schema). |
| `frameAssetId` | `id` do PNG da moldura | Pode vir no topo (`frameAssetId`) **ou** em `settings.frameOverlayAssetId`. **Obrigatório** no moldura. O asset precisa: existir na **mesma empresa** do job, `kind:"image"`, `mimeType:"image/png"`. |
| `format` | `"1:1"` | A moldura é sempre quadrada. (O executor **coage 1:1** de qualquer forma, mas mande 1:1.) |
| `captions` | `false` | Irrelevante — o executor **pula legenda de propósito** no moldura, ignore o valor. |
| `automaticTitles` | `false` | Irrelevante — o executor **pula título de propósito** no moldura, ignore o valor. |
| `settings.frameOverlayAnimation` | `"none"` \| `"vibrate"` \| `"bounce"` | **Opcional.** Animação sutil da moldura. Ausente/`none` = estática. |

## Regra de seleção da moldura (responsabilidade do Filmmaker)
- A moldura é escolhida da pasta **Moldura** da empresa (toda empresa já tem essa pasta no Ops).
- Cada moldura tem **título + descrição** (ex.: *"Multifocal R$199 + exame"*, *"Armação R$39,90 sem exame"*).
- O Filmmaker deve **casar a descrição da moldura com a promoção da narração**: se a narração fala de **R$199**, escolher a moldura de **R$199**. Preço/oferta divergentes = vídeo errado. **O app NÃO confere isso** (não recebe a descrição/preço) — a consistência é 100% responsabilidade do agente ao montar o job.
- **Configuração no Ops:** todo arquivo da pasta Moldura precisa ter **título e descrição** preenchidos, senão o agente não tem como casar com a promoção.

## Seleção de takes
Continua igual ao fluxo normal: o Filmmaker escolhe os takes (`takeAssetIds`); o executor distribui ao longo da narração. (Bônus: o executor aplica o **enquadramento 1:1** salvo em cada take e **descarta os marcados "ignorar 1:1"** — dados que o operador define na curadoria do app.)

## O que o executor (Mileto AI Video) faz ao receber um job moldura
1. Reconhece `settings.videoModel === "moldura"` → **modo forte**.
2. **Exige** `frameAssetId` válido (PNG/mesma empresa) e **≥1 take** — senão falha com erro claro.
3. **Coage `format` para 1:1** (targetDims 1080×1080).
4. Sintetiza a narração, distribui os takes, **aplica enquadramento 1:1 / pula os ignorados**.
5. **Sobrepõe a moldura** (objectFit `contain`) a todos os takes; anima se `frameOverlayAnimation` pedir.
6. **Pula legenda e título** independentemente das flags.
7. Exporta 1:1 e sobe pro Ops. Mostra o **nome da moldura** no progresso (pra conferência).

## Erros que o executor pode devolver (para o Ops exibir/tratar)
- `ops_frame_required` — job moldura sem `frameAssetId`.
- `ops_frame_missing` — a moldura pedida não está mais na empresa.
- `ops_frame_invalid` — o asset não é um PNG autorizado da empresa.
- `ops_take_required` — job moldura sem takes.

## Exemplo de payload (campos relevantes)
```json
{
  "companyId": "<empresa>",
  "projectTitle": "Promoção Multifocal 199",
  "narration": "…texto da promoção de R$199…",
  "takeAssetIds": ["<take1>", "<take2>", "..."],
  "frameAssetId": "<id-do-png-da-moldura-199>",
  "format": "1:1",
  "captions": false,
  "automaticTitles": false,
  "settings": {
    "videoModel": "moldura",
    "frameOverlayAnimation": "none"
  }
}
```

## Fronteira
- **Criar o job** (com esses campos) e **escolher a moldura por descrição** = **Ops/Filmmaker** (upstream; não há rota de criar job no app/gateway).
- **Hospedar o PNG da moldura** como asset do Ops = **Ops** (o app só faz upload de **MP4**, não sobe PNG).
- **Executar/renderizar** (tudo acima) = **Mileto AI Video** (já implementado neste release).
