// npm run process:ui -- runs tools/ui/process_ui.py (Python + Pillow) with the settings in tools/ui/ui_assets.json.
// Extra arguments pass through: npm run process:ui -- --font-preview
//   PYTHON  the Python executable with Pillow (default: the project venv tools/ui/.venv, else python3 / python)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const venv = process.platform === 'win32'
  ? path.join(here, '.venv', 'Scripts', 'python.exe')
  : path.join(here, '.venv', 'bin', 'python');
const candidates = [process.env.PYTHON, fs.existsSync(venv) ? venv : null, 'python3', 'python'].filter(Boolean);

for (const python of candidates) {
  const probe = spawnSync(python, ['-c', 'import PIL'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(python, [path.join(here, 'process_ui.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
console.error('process:ui: no Python with Pillow found. Set PYTHON, or create the venv (README, Styled – Fish of Fortune):');
console.error('  <python> -m venv tools/ui/.venv && tools/ui/.venv/Scripts/python -m pip install pillow');
process.exit(1);
