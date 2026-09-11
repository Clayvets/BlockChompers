"""
Read-only inventory of a .blend file (it never saves, moves or re-writes the file).

Run headless, one .blend at a time:
    blender --factory-startup -b path/to/file.blend --python tools/blender/inspect_blend.py -- --out report.json

Reports, for the file: objects and collections, meshes and polygon counts (as stored and with modifiers applied),
materials and their image textures (packed or external, with missing paths flagged), modifiers, actions, NLA tracks,
armatures and shape keys, and each object's transform, world-space dimensions, origin position and axes. Blender is
Z-up; glTF is Y-up, and the glTF exporter converts (Blender +Z -> glTF +Y, Blender -Y -> glTF +Z). Prints a readable
summary to stdout and, with --out, writes everything as JSON.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def cli_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    return {"out": out}


def r(values, nd=4):
    return [round(float(v), nd) for v in values]


def simple_props(struct, skip=("rna_type", "name", "type")):
    """Every scalar, enum, vector or ID-name property of an RNA struct (for modifiers and constraints)."""
    out = {}
    for prop in struct.bl_rna.properties:
        key = prop.identifier
        if key in skip:
            continue
        try:
            value = getattr(struct, key)
        except AttributeError:
            continue
        if prop.type in {"BOOLEAN", "INT", "FLOAT", "STRING", "ENUM"}:
            if getattr(prop, "is_array", False) or (prop.type in {"INT", "FLOAT", "BOOLEAN"} and getattr(prop, "array_length", 0) > 0):
                try:
                    value = list(value)
                    value = r(value) if prop.type == "FLOAT" else value
                except TypeError:
                    pass
            elif prop.type == "FLOAT":
                value = round(value, 5)
            elif prop.type == "ENUM" and getattr(prop, "is_enum_flag", False):
                value = sorted(value)
            out[key] = value
        elif prop.type == "POINTER" and isinstance(value, bpy.types.ID):
            out[key] = value.name
    return out


def world_bbox(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    corners = [evaluated.matrix_world @ Vector(c) for c in evaluated.bound_box]
    lo = [min(c[i] for c in corners) for i in range(3)]
    hi = [max(c[i] for c in corners) for i in range(3)]
    return lo, hi


def mesh_counts(mesh):
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    return {"vertices": len(mesh.vertices), "edges": len(mesh.edges), "polygons": len(mesh.polygons), "triangles": tris}


def evaluated_counts(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    try:
        mesh = evaluated.to_mesh()
    except RuntimeError:
        return None
    if mesh is None:
        return None
    counts = mesh_counts(mesh)
    evaluated.to_mesh_clear()
    return counts


def mass_offset(obj):
    """Where the vertices' mean sits along each local axis, from -1 (min face of the bbox) to +1 (max face)."""
    if obj.type != "MESH" or not obj.data.vertices:
        return None
    n = len(obj.data.vertices)
    mean = [sum(v.co[i] for v in obj.data.vertices) / n for i in range(3)]
    lo = [min(v.co[i] for v in obj.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in obj.data.vertices) for i in range(3)]
    return [round((2 * (mean[i] - lo[i]) / (hi[i] - lo[i]) - 1) if hi[i] > lo[i] else 0.0, 3) for i in range(3)]


def socket_targets(node_tree, node, depth=2):
    """Where a node's outputs go: 'Node.Socket' strings, following up to `depth` hops (e.g. through a Normal Map)."""
    found = []
    for output in node.outputs:
        for link in output.links:
            target = f"{link.to_node.name}.{link.to_socket.name}"
            found.append(target)
            if depth > 1 and link.to_node.type not in {"BSDF_PRINCIPLED", "OUTPUT_MATERIAL"}:
                found += [f"{target} -> {t}" for t in socket_targets(node_tree, link.to_node, depth - 1)]
    return found


def image_info(image):
    info = {"name": image.name, "source": image.source, "filepath": image.filepath, "packed": image.packed_file is not None}
    if image.source == "FILE":
        path = bpy.path.abspath(image.filepath, library=image.library)
        info["abspath"] = os.path.normpath(path) if path else ""
        info["exists"] = bool(info["packed"] or (path and os.path.isfile(path)))
        info["missing"] = not info["exists"]
    info["size"] = list(image.size)
    info["colorspace"] = image.colorspace_settings.name
    info["users"] = image.users
    return info


def material_info(mat):
    info = {"name": mat.name, "users": mat.users, "use_nodes": mat.use_nodes, "diffuse_color": r(mat.diffuse_color)}
    for attr in ("blend_method", "surface_render_method", "use_backface_culling"):
        if hasattr(mat, attr):
            info[attr] = getattr(mat, attr)
    if not (mat.use_nodes and mat.node_tree):
        return info
    tree = mat.node_tree
    info["nodes"] = sorted({n.type for n in tree.nodes})
    principled = []
    for node in tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            entry = {"node": node.name}
            for socket_name in ("Base Color", "Metallic", "Roughness", "Alpha", "Normal", "Emission Color", "Emission Strength"):
                socket = node.inputs.get(socket_name)
                if socket is None:
                    continue
                if socket.is_linked:
                    entry[socket_name] = "linked from " + ", ".join(f"{l.from_node.name}.{l.from_socket.name}" for l in socket.links)
                elif hasattr(socket, "default_value"):
                    value = socket.default_value
                    entry[socket_name] = r(value) if hasattr(value, "__len__") else round(float(value), 4)
            principled.append(entry)
    info["principled"] = principled
    textures = []
    for node in tree.nodes:
        if node.type == "TEX_IMAGE":
            textures.append({"node": node.name, "image": image_info(node.image) if node.image else None,
                             "interpolation": node.interpolation, "feeds": socket_targets(tree, node)})
        elif node.type in {"VERTEX_COLOR", "ATTRIBUTE"}:
            textures.append({"node": node.name, "type": node.type, "attribute": getattr(node, "layer_name", getattr(node, "attribute_name", "")),
                             "feeds": socket_targets(tree, node)})
    info["textures"] = textures
    return info


def action_info(action):
    paths = sorted({fc.data_path.split('"]')[0] + '"]' if '["' in fc.data_path else fc.data_path for fc in action.fcurves})
    return {"name": action.name, "frame_range": r(action.frame_range, 2), "fcurves": len(action.fcurves),
            "groups": [g.name for g in action.groups][:40], "channels": paths[:40], "users": action.users,
            "fake_user": action.use_fake_user, "id_root": getattr(action, "id_root", "")}


def object_info(obj, depsgraph):
    lo, hi = world_bbox(obj, depsgraph)
    dims = [hi[i] - lo[i] for i in range(3)]
    center = [(hi[i] + lo[i]) / 2 for i in range(3)]
    origin = obj.matrix_world.translation
    info = {
        "name": obj.name, "type": obj.type, "data": obj.data.name if obj.data else None,
        "parent": obj.parent.name if obj.parent else None, "parent_type": obj.parent_type if obj.parent else None,
        "parent_bone": obj.parent_bone or None, "children": [c.name for c in obj.children],
        "collections": [c.name for c in obj.users_collection],
        "hidden": {"viewport": obj.hide_viewport, "render": obj.hide_render, "in_view_layer": obj.hide_get()},
        "location": r(obj.location), "rotation_mode": obj.rotation_mode,
        "rotation_euler_deg": r([math.degrees(a) for a in obj.rotation_euler], 2),
        "rotation_quaternion": r(obj.rotation_quaternion), "scale": r(obj.scale),
        "world_location": r(origin), "world_scale": r(obj.matrix_world.to_scale()),
        "world_rotation_deg": r([math.degrees(a) for a in obj.matrix_world.to_euler()], 2),
        "dimensions_world": r(dims), "bbox_world_min": r(lo), "bbox_world_max": r(hi),
        "origin_minus_bbox_center": r([origin[i] - center[i] for i in range(3)]),
        "origin_in_bbox_0to1": r([(origin[i] - lo[i]) / dims[i] if dims[i] > 1e-9 else 0.5 for i in range(3)], 3),
        "unapplied_transform": any(abs(a) > 1e-6 for a in obj.rotation_euler) or any(abs(s - 1) > 1e-6 for s in obj.scale),
        "modifiers": [{"name": m.name, "type": m.type, "show_viewport": m.show_viewport, "show_render": m.show_render,
                       "settings": simple_props(m, skip=("rna_type", "name", "type", "show_viewport", "show_render",
                                                         "show_in_editmode", "show_on_cage", "show_expanded", "is_active",
                                                         "is_override_data", "use_apply_on_spline", "persistent_uid",
                                                         "execution_time", "use_pin_to_last"))} for m in obj.modifiers],
        "constraints": [{"name": c.name, "type": c.type, "settings": simple_props(c)} for c in obj.constraints],
        "material_slots": [s.material.name if s.material else None for s in obj.material_slots],
        "custom_properties": {k: str(obj[k]) for k in obj.keys() if not k.startswith("_")},
    }
    if obj.animation_data:
        ad = obj.animation_data
        info["animation"] = {"action": ad.action.name if ad.action else None, "drivers": len(ad.drivers),
                             "nla_tracks": [{"name": t.name, "mute": t.mute,
                                             "strips": [{"name": s.name, "action": s.action.name if s.action else None,
                                                         "frames": r([s.frame_start, s.frame_end], 2)} for s in t.strips]}
                                            for t in ad.nla_tracks]}
    if obj.type == "MESH":
        mesh = obj.data
        info["mesh"] = mesh_counts(mesh)
        info["mesh_with_modifiers"] = evaluated_counts(obj, depsgraph)
        info["uv_layers"] = [uv.name for uv in mesh.uv_layers]
        info["color_attributes"] = [a.name for a in getattr(mesh, "color_attributes", [])]
        info["vertex_groups"] = [g.name for g in obj.vertex_groups][:40]
        info["shape_keys"] = [k.name for k in mesh.shape_keys.key_blocks] if mesh.shape_keys else []
        info["vertex_mass_offset_local"] = mass_offset(obj)
        dims_local = [max(v.co[i] for v in mesh.vertices) - min(v.co[i] for v in mesh.vertices) for i in range(3)] if mesh.vertices else [0, 0, 0]
        info["longest_local_axis"] = "XYZ"[dims_local.index(max(dims_local))]
    elif obj.type == "CURVE":
        curve = obj.data
        info["curve"] = {"dimensions": curve.dimensions, "resolution_u": curve.resolution_u, "bevel_depth": round(curve.bevel_depth, 4),
                         "bevel_object": curve.bevel_object.name if curve.bevel_object else None, "extrude": round(curve.extrude, 4),
                         "splines": [{"type": s.type, "points": len(s.bezier_points) if s.type == "BEZIER" else len(s.points),
                                      "cyclic": s.use_cyclic_u} for s in curve.splines]}
        info["mesh_with_modifiers"] = evaluated_counts(obj, depsgraph)
    elif obj.type == "ARMATURE":
        arm = obj.data
        info["armature"] = {"bones": len(arm.bones), "pose_position": arm.pose_position,
                            "bones_detail": [{"name": b.name, "parent": b.parent.name if b.parent else None,
                                              "head": r(b.head_local, 3), "tail": r(b.tail_local, 3),
                                              "deform": b.use_deform} for b in arm.bones][:60]}
    return info


def collection_tree(coll, depth=0):
    lines = [f"{'  ' * depth}{coll.name} ({len(coll.objects)} objects){' [excluded/hidden]' if coll.hide_viewport or coll.hide_render else ''}"]
    for child in coll.children:
        lines += collection_tree(child, depth + 1)
    return lines


def main():
    args = cli_args()
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    report = {
        "file": bpy.data.filepath,
        "saved_with_blender": ".".join(str(v) for v in bpy.data.version),
        "running_blender": bpy.app.version_string,
        "scene": {"name": scene.name, "frame_start": scene.frame_start, "frame_end": scene.frame_end,
                  "fps": round(scene.render.fps / scene.render.fps_base, 3), "unit_system": scene.unit_settings.system,
                  "unit_scale": scene.unit_settings.scale_length, "length_unit": scene.unit_settings.length_unit,
                  "render_engine": scene.render.engine, "view_transform": scene.view_settings.view_transform,
                  "markers": [{"name": m.name, "frame": m.frame} for m in scene.timeline_markers]},
        "scenes": [s.name for s in bpy.data.scenes],
        "collections": collection_tree(scene.collection),
        "libraries": [{"name": lib.name, "filepath": lib.filepath, "exists": os.path.isfile(bpy.path.abspath(lib.filepath))} for lib in bpy.data.libraries],
        "objects": [object_info(o, depsgraph) for o in scene.objects],
        "orphan_objects": [o.name for o in bpy.data.objects if o.name not in scene.objects],
        "meshes": [{"name": m.name, "users": m.users, **mesh_counts(m)} for m in bpy.data.meshes],
        "materials": [material_info(m) for m in bpy.data.materials],
        "images": [image_info(i) for i in bpy.data.images],
        "actions": [action_info(a) for a in bpy.data.actions],
        "armatures": [{"name": a.name, "users": a.users, "bones": len(a.bones)} for a in bpy.data.armatures],
        "node_groups": [{"name": g.name, "type": g.bl_idname, "users": g.users} for g in bpy.data.node_groups],
    }
    report["missing_textures"] = [i["name"] + " -> " + i.get("abspath", "") for i in report["images"] if i.get("missing")]

    lines = [f"FILE {report['file']}  (saved with Blender {report['saved_with_blender']}, read with {report['running_blender']})",
             f"scene {scene.name}: frames {scene.frame_start}-{scene.frame_end} @ {report['scene']['fps']} fps, units {scene.unit_settings.system} x{scene.unit_settings.scale_length}, markers {report['scene']['markers']}",
             "collections:", *["  " + line for line in report["collections"]]]
    for o in report["objects"]:
        lines.append(f"OBJECT {o['name']} [{o['type']}] parent={o['parent']} coll={o['collections']} hidden={o['hidden']}")
        lines.append(f"  loc={o['location']} rot={o['rotation_euler_deg']} scale={o['scale']} dims_world={o['dimensions_world']} origin_in_bbox={o['origin_in_bbox_0to1']}")
        if "mesh" in o:
            lines.append(f"  mesh {o['data']}: {o['mesh']} with modifiers: {o['mesh_with_modifiers']} uv={o['uv_layers']} colors={o['color_attributes']} shape_keys={o['shape_keys']} longest_local={o['longest_local_axis']} mass_offset={o['vertex_mass_offset_local']}")
        if "curve" in o:
            lines.append(f"  curve: {o['curve']}  with modifiers: {o['mesh_with_modifiers']}")
        if "armature" in o:
            lines.append(f"  armature: {o['armature']['bones']} bones, root(s): {[b['name'] for b in o['armature']['bones_detail'] if not b['parent']]}")
        for m in o["modifiers"]:
            lines.append(f"  modifier {m['name']} [{m['type']}] viewport={m['show_viewport']} render={m['show_render']}")
        if o["material_slots"]:
            lines.append(f"  materials: {o['material_slots']}")
        if "animation" in o:
            lines.append(f"  animation: {o['animation']}")
    for m in report["materials"]:
        lines.append(f"MATERIAL {m['name']} users={m['users']} principled={m.get('principled')}")
        for t in m.get("textures", []):
            lines.append(f"  texture {t}")
    for i in report["images"]:
        lines.append(f"IMAGE {i}")
    for a in report["actions"]:
        lines.append(f"ACTION {a['name']} frames={a['frame_range']} fcurves={a['fcurves']} users={a['users']} fake_user={a['fake_user']} channels={a['channels'][:8]}")
    lines.append(f"MISSING TEXTURES: {report['missing_textures'] or 'none'}")
    print("\n".join("INV| " + line for line in lines))

    if args["out"]:
        with open(args["out"], "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, default=str)
        print(f"INV| wrote {args['out']}")


main()
