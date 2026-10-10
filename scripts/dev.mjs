import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 1500).unref();
  process.exitCode = code;
}
for (const [command, args, env] of [
  ['python3', ['server/app.py'], { ...process.env, HOST: '127.0.0.1', PORT: '3101',
    MUYING_ALLOWED_HOSTS: process.env.MUYING_ALLOWED_HOSTS || 'raw.githubusercontent.com,www.ck-download.com,ck-download.com,javboys.net,www.javboys.net,netfuck.net,www.netfuck.net' }],
  [process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], process.env],
]) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(`啟動失敗：${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
