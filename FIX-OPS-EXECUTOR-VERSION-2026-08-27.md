# Correção do anúncio de versão do executor — 2026-08-27

## Diagnóstico

O executável instalado e o `package.json` estavam na versão `1.4.53`, mas o
heartbeat do consumidor de jobs do Mileto Ops anunciava `1.4.40` por meio de um
literal manual em `opsVideoWorkerState.ts`. Por isso, jobs que exigiam a versão
mínima `1.4.48` permaneciam corretamente protegidos na fila.

## Correção local

- A versão anunciada pelo heartbeat agora é injetada pelo Vite diretamente a
  partir de `apps/client/package.json`.
- A configuração valida o formato da versão durante o build.
- O teste de contrato impede a reintrodução de uma versão fixa no heartbeat.

## Validação

- Build do cliente concluído.
- Testes focados do contrato do executor: 41 aprovados.
- Executor local anunciou `1.4.53`, em modo `foreground`, com heartbeat ativo.
- Job `2f981e82-4b75-4a12-97d5-3a8523009e95` (`Vídeo Moldura — Ótica Luz`):
  claim confirmado, render validado, MP4 entregue, status `completed` em 100% e
  nenhum erro registrado.
- Validação cruzada no Mileto Ops também confirmou o Take manual e o lote
  textual `Vídeo 3 → Vídeo 2`, todos concluídos sem erro.

## Publicação

A correção foi preparada para a release desktop `v1.4.54`, autorizada depois da
validação cruzada do E2E. O gateway não recebeu alteração de runtime: sua
validação faz parte da checagem de saúde, enquanto a entrega necessária é o novo
instalador e o feed de atualização do Mileto AI Video.
