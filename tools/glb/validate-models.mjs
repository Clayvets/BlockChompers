// Validate every .glb in the model folder (npm run validate:models): container, JSON, references, texture sizes.
// Prints meshes, materials, textures, animations, bounding box and size per file; exits 1 if any file is invalid.
//   node tools/glb/validate-models.mjs [folder]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGlb } from './inspectGlb.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'tools', 'blender', 'models.json'), 'utf8'));
const folder = path.resolve(repo, process.argv[2] || manifest.outDir);
const maxTextureSize = manifest.jobs.fish.textureSize;
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.glb')).sort() : [];
if (!files.length) {
  console.error(`validate-models: no .glb files in ${folder}`);
  process.exit(1);
}
let failed = 0;
for (const file of files) {
  const report = inspectGlb(fs.readFileSync(path.join(folder, file)), { maxTextureSize });
  console.log(`${report.ok ? 'OK  ' : 'FAIL'} ${file}  ${(report.fileSize / 1024).toFixed(1)} KB`);
  if (!report.ok) {
    failed += 1;
    for (const error of report.errors) console.log(`       error: ${error}`);
    continue;
  }
  const { bbox } = report;
  console.log(`       meshes ${report.meshes} (${report.primitives} primitives, ${report.triangles} triangles, ${report.vertices} vertices), nodes ${report.nodes}`);
  console.log(`       materials ${JSON.stringify(report.materials)}, textures ${report.textures}`);
  for (const img of report.images) console.log(`       image ${img.name}: ${img.width}x${img.height} ${img.mimeType}, ${(img.bytes / 1024).toFixed(1)} KB`);
  for (const anim of report.animations) console.log(`       animation ${anim.name}: ${anim.channels} channels, ${anim.duration} s`);
  for (const skin of report.skins) console.log(`       skin ${skin.name}: ${skin.joints} joints`);
  if (bbox) console.log(`       bbox min [${bbox.min.map(fmt)}] max [${bbox.max.map(fmt)}] size [${bbox.size.map(fmt)}] (glTF, Y-up)`);
  if (report.extensionsUsed.length) console.log(`       extensions ${report.extensionsUsed.join(', ')}`);
}
console.log(failed ? `${failed} of ${files.length} GLB files invalid` : `all ${files.length} GLB files valid`);
process.exit(failed ? 1 : 0);
