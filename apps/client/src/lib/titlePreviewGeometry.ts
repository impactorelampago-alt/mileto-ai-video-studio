// O cadastro dos modelos e a Etapa 4 precisam usar o mesmo palco em pixels.
// Vários modelos possuem tipografia em px; se o palco muda de largura, o mesmo
// layout salvo aparenta ter outro tamanho e outra posição relativa.
export const TITLE_EDITOR_PORTRAIT_PREVIEW_WIDTH =
    'min(100%, clamp(180px, calc(56.25dvh - 174.375px), 312px))';
