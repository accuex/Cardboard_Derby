// Runs the game server (with reload on change) and the Vite client together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite', ...process.argv.slice(2)], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0); }));
