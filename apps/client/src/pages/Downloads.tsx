import { FileExplorer } from '../components/FileExplorer';

/**
 * Aba "Arquivos" da lateral.
 *
 * Explorador de mídia (pastas/mover/copiar/renomear). O nome do arquivo/export
 * ainda é "Downloads" por compatibilidade com o lazy import em App.tsx, mas a
 * rota é /files e a UI é o FileExplorer completo.
 */
export const Downloads = () => {
    return <FileExplorer />;
};

export default Downloads;
