/**
 * Dependency-free GLB reader and validator (pure: bytes in, report out; no fs, no three.js).
 *
 *   parseGlb(bytes)          -> { json, bin }            glTF 2.0 binary container: header, JSON chunk, BIN chunk
 *   readAccessor(glb, index) -> { array, itemSize, count } typed copy of an accessor (honours byteStride)
 *   inspectGlb(bytes, opts)  -> report                    counts, bounding box, images, animations, and `errors`
 *
 * Used by tools/glb/validate-models.mjs (npm run validate:models) and by the tests.
 */

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function parseGlb(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength < 20) throw new Error('GLB: file shorter than a header and one chunk');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (magic !== MAGIC) throw new Error(`GLB: bad magic 0x${magic.toString(16)} (expected 'glTF')`);
  if (version !== 2) throw new Error(`GLB: container version ${version} (expected 2)`);
  if (length !== data.byteLength) throw new Error(`GLB: header length ${length} but file has ${data.byteLength} bytes`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) throw new Error(`GLB: chunk at ${offset} runs past the end of the file`);
    const chunk = data.subarray(start, start + chunkLength);
    if (offset === 12 && chunkType !== CHUNK_JSON) throw new Error('GLB: first chunk is not JSON');
    if (chunkType === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (chunkType === CHUNK_BIN && !bin) bin = chunk;
    offset = start + chunkLength;
  }
  if (!json) throw new Error('GLB: no JSON chunk');
  return { json, bin, length };
}

/** Typed copy of accessor `index` (non-sparse). */
export function readAccessor(glb, index) {
  const { json, bin } = glb;
  const accessor = json.accessors[index];
  const itemSize = COMPONENTS[accessor.type];
  const Typed = TYPED[accessor.componentType];
  const out = new Typed(accessor.count * itemSize);
  if (accessor.bufferView === undefined) return { array: out, itemSize, count: accessor.count };
  const bufferView = json.bufferViews[accessor.bufferView];
  const elementBytes = Typed.BYTES_PER_ELEMENT * itemSize;
  const stride = bufferView.byteStride || elementBytes;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const getter = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType];
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < itemSize; c += 1) {
      out[i * itemSize + c] = view[getter](base + i * stride + c * Typed.BYTES_PER_ELEMENT, true);
    }
  }
  return { array: out, itemSize, count: accessor.count };
}

/** Column-major 4x4 from a node's matrix or TRS. */
export function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx; const yy = qy * qy; const zz = qz * qz;
  const xy = qx * qy; const xz = qx * qz; const yz = qy * qz;
  const wx = qw * qx; const wy = qw * qy; const wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      for (let k = 0; k < 4; k += 1) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

export function transformPoint(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Every mesh node of the default scene with its world matrix: [{ node, mesh, matrix }]. */
export function meshNodes(json) {
  const out = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) out.push({ node: index, mesh: node.mesh, matrix, skinned: node.skin !== undefined });
    for (const child of node.children || []) visit(child, matrix);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of scene?.nodes || []) visit(root, identity);
  return out;
}

function imageSize(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length > 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (mimeType === 'image/jpeg') {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const size = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      i += 2 + size;
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Parse and check a GLB. Errors (report.errors) make it invalid: bad container, glTF version, buffer views or
 * accessors out of range, missing POSITION bounds, Draco compression, broken texture/image references, images wider
 * than opts.maxTextureSize.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{ maxTextureSize?: number }} [opts]
 */
export function inspectGlb(bytes, opts = {}) {
  const errors = [];
  const size = bytes.byteLength;
  let glb;
  try {
    glb = parseGlb(bytes);
  } catch (error) {
    return { ok: false, errors: [error.message], fileSize: size };
  }
  const { json, bin } = glb;
  if (json.asset?.version !== '2.0') errors.push(`asset.version is ${json.asset?.version}, expected 2.0`);
  const used = [...(json.extensionsUsed || []), ...(json.extensionsRequired || [])];
  if (used.includes('KHR_draco_mesh_compression')) errors.push('uses Draco compression');
  const buffers = json.buffers || [];
  if (buffers[0] && (!bin || buffers[0].byteLength > bin.byteLength)) errors.push('buffer 0 is larger than the BIN chunk');
  (json.bufferViews || []).forEach((bv, i) => {
    const buffer = buffers[bv.buffer];
    if (!buffer || (bv.byteOffset || 0) + bv.byteLength > buffer.byteLength) errors.push(`bufferView ${i} runs past its buffer`);
  });
  (json.accessors || []).forEach((acc, i) => {
    if (acc.bufferView === undefined) return;
    const bv = json.bufferViews[acc.bufferView];
    const Typed = TYPED[acc.componentType];
    const itemBytes = Typed ? Typed.BYTES_PER_ELEMENT * COMPONENTS[acc.type] : 0;
    const need = (acc.byteOffset || 0) + (acc.count - 1) * (bv.byteStride || itemBytes) + itemBytes;
    if (!Typed || need > bv.byteLength) errors.push(`accessor ${i} runs past bufferView ${acc.bufferView}`);
  });

  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, matrix } of meshNodes(json)) {
    for (const prim of json.meshes[mesh].primitives) {
      primitives += 1;
      const pos = json.accessors[prim.attributes.POSITION];
      if (!pos?.min || !pos?.max) {
        errors.push(`mesh ${mesh} primitive without POSITION min/max`);
        continue;
      }
      vertices += pos.count;
      triangles += (prim.indices !== undefined ? json.accessors[prim.indices].count : pos.count) / 3;
      for (let c = 0; c < 8; c += 1) {
        const corner = [c & 1 ? pos.max[0] : pos.min[0], c & 2 ? pos.max[1] : pos.min[1], c & 4 ? pos.max[2] : pos.min[2]];
        const p = transformPoint(matrix, corner);
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
  }

  const images = (json.images || []).map((img, i) => {
    let bytesOf = null;
    if (img.bufferView !== undefined && bin) {
      const bv = json.bufferViews[img.bufferView];
      bytesOf = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    } else if (!img.uri) errors.push(`image ${i} has neither a bufferView nor a uri`);
    else errors.push(`image ${i} is external (${img.uri}); GLB images must be embedded`);
    const dims = bytesOf ? imageSize(bytesOf, img.mimeType) : { width: 0, height: 0 };
    if (opts.maxTextureSize && Math.max(dims.width, dims.height) > opts.maxTextureSize) {
      errors.push(`image ${img.name || i} is ${dims.width}x${dims.height}, over ${opts.maxTextureSize}`);
    }
    return { name: img.name, mimeType: img.mimeType, bytes: bytesOf ? bytesOf.byteLength : 0, ...dims };
  });
  (json.textures || []).forEach((t, i) => {
    if (t.source !== undefined && !json.images?.[t.source]) errors.push(`texture ${i} points at a missing image`);
  });
  const textureRefs = [];
  (json.materials || []).forEach((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    for (const ref of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.emissiveTexture, m.occlusionTexture]) {
      if (ref) textureRefs.push(ref.index);
    }
  });
  for (const index of textureRefs) if (!json.textures?.[index]) errors.push(`a material points at missing texture ${index}`);

  const animations = (json.animations || []).map((anim) => {
    let duration = 0;
    for (const sampler of anim.samplers) {
      const input = json.accessors[sampler.input];
      if (input?.max) duration = Math.max(duration, input.max[0]);
    }
    return { name: anim.name, channels: anim.channels.length, duration: Math.round(duration * 1000) / 1000 };
  });

  return {
    ok: errors.length === 0,
    errors,
    fileSize: size,
    generator: json.asset?.generator,
    meshes: (json.meshes || []).length,
    primitives,
    triangles,
    vertices,
    materials: (json.materials || []).map((m) => m.name),
    textures: (json.textures || []).length,
    images,
    animations,
    skins: (json.skins || []).map((s) => ({ name: s.name, joints: s.joints.length })),
    nodes: (json.nodes || []).length,
    extensionsUsed: json.extensionsUsed || [],
    bbox: primitives ? { min, max, size: max.map((v, k) => v - min[k]) } : null,
  };
}
