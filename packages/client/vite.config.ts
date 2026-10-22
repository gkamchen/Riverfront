import { defineConfig } from 'vite';

export default defineConfig({
  // Demo estática (npm run build:demo): sem servidor próprio, o painel online não tenta a mesma origem.
  define: { __RIVERFRONT_STATIC__: JSON.stringify(process.env.RIVERFRONT_STATIC === '1') },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // o three.js perde o comentário de licença ao ser minificado: vai de volta no topo do pedaço dele
        postBanner: (chunk) => (chunk.name === 'three' ? '/*! three.js | MIT License | Copyright © 2010-2026 three.js authors | avisos completos em THIRD_PARTY_NOTICES.txt */' : ''),
        // o three.js muda bem menos que o jogo: num pedaço separado, fica no cache entre versões
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
