import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    // The game server (npm run server) owns the race; Vite only serves the client.
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true, xfwd: true },
      '/api': { target: 'http://localhost:3000', xfwd: true },
    },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
