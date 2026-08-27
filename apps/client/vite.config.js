import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';
const clientPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = String(clientPackage.version || '').trim();
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(appVersion)) {
    throw new Error('Versao invalida em apps/client/package.json.');
}
// https://vite.dev/config/
export default defineConfig({
    base: './', // CRÍTICA: Necessário para o Electron carregar arquivos via file://
    define: {
        __MILETO_APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), visualizer({ template: 'raw-data', filename: 'stats.json' })], // added visualizer plugin
    build: {
        target: 'esnext',
        minify: 'esbuild',
        sourcemap: false, // Absolutely essential for minimizing release footprint
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'react-router-dom'],
                    icons: ['lucide-react'],
                },
            },
        },
    },
});
