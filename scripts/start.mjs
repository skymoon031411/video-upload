import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn('python3', ['server/app.py'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, HOST: process.env.HOST || '0.0.0.0', PORT: process.env.PORT || '8000' },
  stdio: 'inherit',
});
child.on('error', error => { console.error(`啟動失敗：${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
