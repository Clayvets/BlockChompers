// npm run export:models -- runs tools/blender/export_glb.py in Blender for every job in tools/blender/models.json,
// then validates the GLB output (tools/glb/validate-models.mjs).
//   BLENDER_PATH  the Blender executable (required; the models were exported with Blender 4.3)
//   ART_DIR       folder holding the source .blend files (default: ./art). The .blend files are only read.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'models.json'), 'utf8'));

const blender = process.env.BLENDER_PATH;
if (!blender || !fs.existsSync(blender)) {
  console.error('export:models: set BLENDER_PATH to the Blender executable, e.g. "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe"');
  process.exit(1);
}
const artDir = path.resolve(repo, process.env.ART_DIR || 'art');

for (const [job, spec] of Object.entries(manifest.jobs)) {
  const blend = path.join(artDir, spec.blend);
  if (!fs.existsSync(blend)) {
    console.error(`export:models: ${blend} not found; set ART_DIR to the folder with the .blend files`);
    process.exit(1);
  }
  console.log(`export:models: ${job} <- ${blend}`);
  const run = spawnSync(blender, [
    '--factory-startup', '-b', blend,
    '--python-exit-code', '1',
    '--python', path.join(here, 'export_glb.py'),
    '--', '--job', job, '--out', path.join(repo, manifest.outDir),
  ], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`export:models: Blender failed on ${job} (exit ${run.status})`);
    process.exit(run.status || 1);
  }
}

const check = spawnSync(process.execPath, [path.join(repo, 'tools', 'glb', 'validate-models.mjs')], { stdio: 'inherit' });
process.exit(check.status ?? 1);
