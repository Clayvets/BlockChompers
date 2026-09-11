"""
Export the Fish of Fortune art to GLB for BlockChompers.

Non-destructive and reproducible: Blender opens the .blend in memory and this script never saves it. Everything it
changes (downscaled textures, flattened water colour, cut track pieces) exists only in this Blender session, so the
same .blend always gives the same GLBs. Settings are in tools/blender/models.json.

One job per .blend (`npm run export:models` runs both, then validates the output):
  blender --factory-startup -b $ART_DIR/Art.blend --python-exit-code 1 --python tools/blender/export_glb.py -- --job fish
  blender --factory-startup -b $ART_DIR/Fish_Rail.blend --python-exit-code 1 --python tools/blender/export_glb.py -- --job track
Options after `--`: --job fish|track, --manifest <models.json> (default: next to this script), --out <dir>.

fish   fish.glb: the skinned fish (Armature_Fish + Mesh_0) with every action as its own glTF animation. Its textures are
       downscaled to textureSize; the originals stay in the .blend.
track  Fish_Rail.blend holds the loop as one fused mesh, so the pieces are cut out of it with bisect planes:
         track_straight.glb  one canal cell of the south side: x in [-w/2, w/2], from the outer edge in to the canal's
                             inner edge (the inner rim and the pool are left out)
         track_corner.glb    the south-east corner: x in [inner, edge], y in [-edge, -inner]
         track_chevron.glb   one flow chevron from the canal centre, turned to point +X
       Each piece is moved so the canal centre of its cell is the origin, then scaled by 1 / canal width w, so one
       game cell is 1 unit and the canal spans [-0.5, 0.5] across it. Heights scale the same way. The water's
       procedural base colour is baked in Cycles and averaged into a flat colour (glTF cannot carry shader nodes).
Axes: glTF is Y-up (Blender +Z -> glTF +Y, Blender -Y -> glTF +Z). A straight piece's outer rim therefore ends up on
+Z (outward on the south side of the game board) and the corner's rims on +X and +Z (the south-east corner).
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
EPS = 1e-5

# Shared glTF export settings (Blender 4.3 exporter). Keys the running exporter does not know are skipped and logged.
BASE_EXPORT = dict(
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_vertex_color="NONE",
    export_attributes=False,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_unused_images=False,
    export_unused_textures=False,
    export_draco_mesh_compression_enable=False,
    check_existing=False,
)


def log(*args):
    print("EXPORT|", *args, flush=True)


def fail(message):
    raise SystemExit(f"export_glb: {message}")


def cli():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    manifest_path = opt("--manifest", os.path.join(HERE, "models.json"))
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    job = opt("--job")
    if job not in manifest["jobs"]:
        fail(f"--job must be one of {sorted(manifest['jobs'])}")
    out_dir = opt("--out", os.path.join(REPO, manifest["outDir"]))
    os.makedirs(out_dir, exist_ok=True)
    return job, manifest["jobs"][job], out_dir


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export(filepath, objects, **extra):
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    wanted = {**BASE_EXPORT, **extra}
    kwargs = {k: v for k, v in wanted.items() if k in known}
    skipped = sorted(set(wanted) - set(kwargs))
    if skipped:
        log(f"exporter does not know {skipped}; skipped")
    if bpy.ops.export_scene.gltf(filepath=filepath, **kwargs) != {"FINISHED"}:
        fail(f"glTF export failed for {filepath}")
    log(f"wrote {os.path.relpath(filepath, REPO)}: {os.path.getsize(filepath)} bytes")


def fresh_mesh(name, bm, materials):
    """A new mesh object from `bm` holding only the materials its faces use (indices remapped in the bmesh first:
    removing slots from a Blender mesh afterwards would reset its faces' material indices)."""
    used = sorted({f.material_index for f in bm.faces})
    remap = {old: new for new, old in enumerate(used)}
    for face in bm.faces:
        face.material_index = remap[face.material_index]
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    for old in used:
        mesh.materials.append(materials[old])
    return link(bpy.data.objects.new(name, mesh))


def triangles(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


# ---------------------------------------------------------------------------------------------------- fish

def job_fish(spec, out_dir):
    objects = [bpy.data.objects.get(name) for name in spec["objects"]]
    missing = [n for n, o in zip(spec["objects"], objects) if o is None]
    if missing:
        fail(f"objects not found in the .blend: {missing}")
    size = spec["textureSize"]
    images = {}
    for obj in objects:
        for slot in getattr(obj, "material_slots", []):
            if slot.material and slot.material.use_nodes:
                for node in slot.material.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image:
                        images[node.image.name] = node.image
    for name in sorted(images):
        image = images[name]
        before = tuple(image.size)
        if max(image.size) > size:
            image.scale(size, size)
            image.pack()  # re-encode the scaled pixels, in memory only, so the exporter embeds them
        log(f"texture {name}: {before[0]}x{before[1]} -> {image.size[0]}x{image.size[1]} ({image.colorspace_settings.name})")
    mesh_objects = [o for o in objects if o.type == "MESH"]
    log(f"fish: {sum(triangles(o.data) for o in mesh_objects)} triangles, actions {sorted(a.name for a in bpy.data.actions)}")
    export(
        os.path.join(out_dir, spec["output"]), objects,
        export_skins=True,
        export_all_influences=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_range=False,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
    )


# ---------------------------------------------------------------------------------------------------- track

def check_art(spec, inner, outer, center):
    """Fail loudly if the rail no longer matches the canal numbers in models.json."""
    path = bpy.data.objects[spec["pathObject"]]
    south = [p.co for s in path.data.splines for p in s.points if p.co.y < 0 and abs(p.co.x) < 1.5]
    if not south or any(abs(p.y + center) > 1e-3 for p in south):
        fail(f"{spec['pathObject']} does not run along y = -{center} on the south side")
    water = bpy.data.objects[spec["waterObject"]].data
    canal = [i for i, m in enumerate(water.materials) if m and m.name in spec["flattenMaterials"]]
    ys = [water.vertices[v].co.y for p in water.polygons if p.material_index in canal for v in p.vertices
          if abs(water.vertices[v].co.x) < 1.0 and water.vertices[v].co.y < 0]
    if abs(max(ys) + inner) > 1e-3 or abs(min(ys) + outer) > 1e-3:
        fail(f"canal water spans y [{min(ys):.3f}, {max(ys):.3f}] on the south side, expected [-{outer}, -{inner}]")
    log(f"art check: path on the canal centre -{center}, water from -{outer} to -{inner}")


def bake_base_color(obj, material, bake):
    """
    Average base colour (linear) of `material` on `obj`, sampled over several frames of its animation. Whatever
    feeds the Principled BSDF's Base Color is routed through an Emission shader for the bake (EMIT), so the samples
    are exactly the node tree's colour output, not a lit or energy-weighted diffuse value.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = bake["samples"]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    keep = {i for i, m in enumerate(obj.data.materials) if m == material}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keep], context="FACES")
    tmp = fresh_mesh(f"bake_{material.name}", bm, obj.data.materials)
    bm.free()
    tmp.matrix_world = obj.matrix_world
    tree = material.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    base = bsdf.inputs["Base Color"]
    if not base.is_linked:
        return list(base.default_value[:3])
    color_source = base.links[0].from_socket
    surface_source = output.inputs["Surface"].links[0].from_socket
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(color_source, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    image = bpy.data.images.new(f"bake_{material.name}", bake["size"], bake["size"], alpha=True, float_buffer=True)
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    tree.nodes.active = node
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    tmp.select_set(True)
    bpy.context.view_layer.objects.active = tmp
    means = []
    pixels = np.zeros(bake["size"] * bake["size"] * 4, dtype=np.float32)
    for frame in bake["frames"]:
        scene.frame_set(frame)
        image.pixels.foreach_set(np.zeros_like(pixels))
        with bpy.context.temp_override(object=tmp, active_object=tmp, selected_objects=[tmp], selected_editable_objects=[tmp]):
            bpy.ops.object.bake(type="EMIT", margin=0, use_clear=False)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(-1, 4)
        covered = rgba[:, 3] > 0.5
        if not covered.any():
            fail(f"bake of {material.name} covered no pixels")
        means.append(rgba[covered, :3].mean(axis=0))
        log(f"bake {material.name} frame {frame}: {int(covered.sum())} texels, mean {tuple(round(float(c), 4) for c in means[-1])}, "
            f"min {tuple(round(float(c), 3) for c in rgba[covered, :3].min(axis=0))} max {tuple(round(float(c), 3) for c in rgba[covered, :3].max(axis=0))}")
    tree.links.new(surface_source, output.inputs["Surface"])
    tree.nodes.remove(emission)
    tree.nodes.remove(node)
    bpy.data.images.remove(image)
    bpy.data.objects.remove(tmp)
    return [float(c) for c in np.mean(means, axis=0)]


def linear_to_srgb_hex(rgb):
    def enc(c):
        c = max(0.0, min(1.0, c))
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return "".join(f"{round(enc(c) * 255):02x}" for c in rgb)


def flatten_materials(spec):
    water = bpy.data.objects[spec["waterObject"]]
    for name in spec["flattenMaterials"]:
        material = bpy.data.materials[name]
        color = bake_base_color(water, material, spec["bake"])
        bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        socket = bsdf.inputs["Base Color"]
        for l in list(socket.links):
            material.node_tree.links.remove(l)
        socket.default_value = (*color, 1.0)
        log(f"flattened {name}: base colour linear {tuple(round(c, 4) for c in color)} = sRGB #{linear_to_srgb_hex(color)}")


def combined_source(spec):
    """Track and water in one bmesh (materials concatenated), keeping only the faces of spec.keepMaterials."""
    bm = bmesh.new()
    materials = []
    for name in (spec["trackObject"], spec["waterObject"]):
        mesh = bpy.data.objects[name].data
        start = len(bm.faces)
        offset = len(materials)
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        for i in range(start, len(bm.faces)):
            bm.faces[i].material_index += offset
        materials += list(mesh.materials)
    drop = [f for f in bm.faces if materials[f.material_index].name not in spec["keepMaterials"]]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    return bm, materials


def cut_piece(source_bm, materials, name, box, pivot, width, inner_plane):
    """Copy of the source cut to box (x0, x1, y0, y1), moved so `pivot` is the origin and scaled by 1 / width."""
    x0, x1, y0, y1 = box
    bm = source_bm.copy()
    for co, no in (((x1, 0, 0), (1, 0, 0)), ((x0, 0, 0), (-1, 0, 0)), ((0, y1, 0), (0, 1, 0)), ((0, y0, 0), (0, -1, 0))):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=EPS,
                               plane_co=Vector(co), plane_no=Vector(no), clear_outer=True)
    # Walls standing in the canal's inner cut plane belonged under the dropped inner rim.
    walls = [f for f in bm.faces if all(abs(v.co.y - inner_plane) < EPS for v in f.verts)]
    bmesh.ops.delete(bm, geom=walls, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    obj = fresh_mesh(name, bm, materials)
    bm.free()
    obj.data.transform(Matrix.Scale(1 / width, 4) @ Matrix.Translation((-pivot[0], -pivot[1], 0)))
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    per_material = {}
    for poly in obj.data.polygons:
        key = obj.data.materials[poly.material_index].name
        per_material[key] = per_material.get(key, 0) + len(poly.vertices) - 2
    log(f"{name}: {triangles(obj.data)} triangles {per_material}, slots {[s.material.name if s.material else None for s in obj.material_slots]}, "
        f"x [{min(xs):.4f}, {max(xs):.4f}] y [{min(ys):.4f}, {max(ys):.4f}] z [{min(zs):.4f}, {max(zs):.4f}] (cells, Blender axes)")
    return obj


def chevron_piece(spec, center, width):
    """One chevron from the south side's canal centre, turned to point +X, origin at its centroid, in cell units."""
    source = bpy.data.objects[spec["chevronObject"]]
    bm = bmesh.new()
    bm.from_mesh(source.data)  # the mesh coordinates are the Basis shape (eval_time 0)
    bm.verts.ensure_lookup_table()
    groups, seen = [], set()
    for v in bm.verts:
        if v in seen:
            continue
        stack, group = [v], []
        seen.add(v)
        while stack:
            cur = stack.pop()
            group.append(cur)
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        groups.append(group)
    target = Vector((0.0, -center, 0.0))
    centroid = lambda g: sum((v.co for v in g), Vector()) / len(g)
    best = min(groups, key=lambda g: (centroid(g).xy - target.xy).length)
    c = centroid(best)
    tip = min(best, key=lambda v: v.co.x)  # on the south side the flow runs -X: the tip is the leftmost vertex
    if abs(tip.co.y - c.y) > 1e-3:
        fail("the chosen chevron's tip is not on its axis; cannot tell its direction")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in set(best)], context="VERTS")
    obj = fresh_mesh("Track_Chevron", bm, source.data.materials)
    bm.free()
    obj.data.transform(Matrix.Scale(1 / width, 4) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation((-c.x, -c.y, 0)))
    tip_x = max(v.co.x for v in obj.data.vertices)
    log(f"Track_Chevron: {len(groups)} chevrons in the rail, spacing kept in render config; picked the one at "
        f"({c.x:.3f}, {c.y:.3f}), height {c.z / width:.4f} cells, tip at +x {tip_x:.4f}")
    return obj


def job_track(spec, out_dir):
    inner, outer, edge = spec["canal"]["inner"], spec["canal"]["outer"], spec["canal"]["edge"]
    width, center = outer - inner, (inner + outer) / 2
    check_art(spec, inner, outer, center)
    flatten_materials(spec)
    source, materials = combined_source(spec)
    pieces = {
        "straight": ((-width / 2, width / 2, -edge, -inner), (0.0, -center)),
        "corner": ((inner, edge, -edge, -inner), (center, -center)),
    }
    for kind, (box, pivot) in pieces.items():
        obj = cut_piece(source, materials, f"Track_{kind.title()}", box, pivot, width, -inner)
        export(os.path.join(out_dir, spec["outputs"][kind]), [obj], export_animations=False, export_skins=False)
    source.free()
    chevron = chevron_piece(spec, center, width)
    export(os.path.join(out_dir, spec["outputs"]["chevron"]), [chevron], export_animations=False, export_skins=False)


def main():
    job, spec, out_dir = cli()
    log(f"job {job} on {bpy.data.filepath} (Blender {bpy.app.version_string}) -> {out_dir}")
    {"fish": job_fish, "track": job_track}[job](spec, out_dir)


main()
