import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { inspectGlb, parseGlb } from '../../tools/glb/inspectGlb.mjs';

const folder = new URL('../../public/assets/models/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../../tools/blender/models.json', import.meta.url), 'utf8'));
const files = fs.readdirSync(folder).filter((f) => f.endsWith('.glb')).sort();
const report = (file) => inspectGlb(fs.readFileSync(new URL(file, folder)), { maxTextureSize: manifest.jobs.fish.textureSize });

describe('exported GLB models (tools/glb/inspectGlb.mjs)', () => {
  it('exports every model the manifest lists', () => {
    const { fish, track } = manifest.jobs;
    expect(files).toEqual([fish.output, ...Object.values(track.outputs)].sort());
  });

  for (const file of files) {
    it(`${file} is a valid glTF 2.0 binary`, () => {
      const r = report(file);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.extensionsUsed).not.toContain('KHR_draco_mesh_compression');
      expect(r.meshes).toBeGreaterThan(0);
    });
  }

  it('rejects broken files', () => {
    expect(inspectGlb(new Uint8Array(8)).ok).toBe(false);
    const bytes = new Uint8Array(fs.readFileSync(new URL('track_straight.glb', folder)));
    bytes[0] = 0; // magic
    expect(inspectGlb(bytes).errors[0]).toMatch(/magic/);
    expect(() => parseGlb(bytes)).toThrow(/magic/);
  });

  it('fish.glb: skinned, animated, textured at the export size, centred and facing along X', () => {
    const r = report('fish.glb');
    expect(r.skins).toEqual([{ name: 'Armature_Fish', joints: 10 }]);
    expect(r.animations.map((a) => a.name).sort()).toEqual(['Fish_Bubble_Spit', 'Fish_Idle', 'Fish_Swim']);
    expect(r.images.map((i) => [i.width, i.height])).toEqual([[512, 512], [512, 512]]);
    expect(r.bbox.size[0]).toBeGreaterThan(r.bbox.size[2]); // length on X
    for (let k = 0; k < 3; k += 1) expect(Math.abs(r.bbox.min[k] + r.bbox.max[k]) / 2).toBeLessThan(0.02); // centred
  });

  it('track pieces: flat colours, no animation, one cell long', () => {
    for (const file of ['track_straight.glb', 'track_corner.glb']) {
      const r = report(file);
      expect(r.materials).toEqual(['Mat_OuterRim', 'Mat_CanalBed', 'Mat_CanalWater']);
      expect(r.textures).toBe(0);
      expect(r.animations).toEqual([]);
    }
    expect(report('track_straight.glb').bbox.size[0]).toBeCloseTo(1, 4);
  });
});
