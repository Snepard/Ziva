import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePythonBin() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;

  const candidates = [
    // Windows venv at repo root
    path.resolve(__dirname, '../.venv/Scripts/python.exe'),
    // macOS/Linux venv at repo root
    path.resolve(__dirname, '../.venv/bin/python'),
    // Fallbacks
    'python',
    'python3',
  ];

  for (const candidate of candidates) {
    try {
      if (candidate === 'python' || candidate === 'python3') return candidate;
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  return 'python';
}

const pythonBin = resolvePythonBin();
process.env.PYTHON_BIN = pythonBin;

const nodeArgs = [];
if (process.env.NODE_ENV !== 'production') {
  nodeArgs.push('--trace-warnings');
}
nodeArgs.push(path.resolve(__dirname, 'server.js'));

console.log(`[dev] Using PYTHON_BIN=${pythonBin}`);

const child = spawn(process.execPath, nodeArgs, {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[dev] Failed to start server:', err);
  process.exit(1);
});
