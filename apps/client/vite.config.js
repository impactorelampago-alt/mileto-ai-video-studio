import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
// https://vite.dev/config/
export default defineConfig({
    base: './', // CRÍTICA: Necessário para o Electron carregar arquivos via file://
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
