/**
 * Cardboard Derby game server.
 *   dev:  npm run dev      (this server on :3000 + Vite on :5173, Vite proxies /socket.io)
 *   prod: npm run build && npm start   (serves dist/ and the socket on :3000)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { NET, type ClientToServer, type ServerToClient } from '../src/net/protocol';
import { raceConfig } from '../src/config/race';
import { GameServer } from './GameServer';

const port = Number(process.env.GAME_PORT) || NET.port;
// SIM_SPEED speeds races up for automated tests
if (process.env.SIM_SPEED) raceConfig.simulation.timeScale = Math.max(1, Math.min(15, Number(process.env.SIM_SPEED) || 1));
const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const http = createServer((req, res) => {
  // Static files from the production build (dev uses Vite instead)
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/stats') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(game?.metrics() ?? {}));
    return;
  }
  if (url.pathname === '/api/info') {
    // LAN addresses so the big screen can show a QR code phones can reach
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n!.address);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lan, port }));
    return;
  }
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Cardboard Derby server is running. Open the Vite dev server (npm run dev) or build the client first.');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// perMessageDeflate: snapshots are repetitive JSON and compress well
let game: GameServer | null = null;
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true }, perMessageDeflate: { threshold: 512 } });
game = new GameServer(io);

http.listen(port, () => console.log(`[server] Cardboard Derby listening on http://localhost:${port}`));
