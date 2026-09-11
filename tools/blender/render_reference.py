"""
Reference render of the art as it looks in Blender, from the game's top-down orthographic view (never saves).

  blender --factory-startup -b $ART_DIR/Fish_Rail.blend --python tools/blender/render_reference.py -- \
      --art $ART_DIR/Art.blend --out reference.png [--fish-length 1.304] [--center 1.3 -2.6] [--size 3.2] [--px 800]

Uses Fish_Rail.blend's own lights, world and colour management (AgX, EEVEE). The fish is appended from Art.blend in
memory, posed at frame 1 of Fish_Swim, and floated in the south canal heading west (clockwise travel there) at
`fish-length` canal widths long (Level 1: 0.6 / 0.46 = 1.304). The camera looks straight down at `center` and shows
`size` metres. Compare the image with an in-game close-up of the same corner.
"""
import os
import sys

import bpy
from mathutils import Vector


def opt(argv, name, default=None, count=1):
    if name not in argv:
        return default
    i = argv.index(name)
    return argv[i + 1] if count == 1 else argv[i + 1:i + 1 + count]


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
art = opt(argv, "--art")
out = os.path.abspath(opt(argv, "--out", "reference.png"))
fish_length = float(opt(argv, "--fish-length", 1.304))
cx, cy = (float(v) for v in opt(argv, "--center", ["1.3", "-2.6"], 2))
size = float(opt(argv, "--size", 3.2))
px = int(opt(argv, "--px", 800))
canal_width, canal_center, water_z = 1.25, 2.825, 0.46

scene = bpy.context.scene
for name in ("PreviewCamera",):
    if name in bpy.data.objects:
        bpy.data.objects[name].hide_render = True

if art:
    with bpy.data.libraries.load(art, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("Armature_Fish", "Mesh_0")]
        dst.actions = list(src.actions)
    rig = next(o for o in dst.objects if o.type == "ARMATURE")
    for obj in dst.objects:
        scene.collection.objects.link(obj)
    scale = fish_length * canal_width / 1.0004  # the model is 1.0004 m long
    rig.scale = (scale, scale, scale)
    # Float the fish in the south canal, 1.4 m west of the corner, facing -X (its own forward axis).
    rig.location = (canal_center - 2.1, -canal_center, water_z + 0.2 * scale)
    swim = bpy.data.actions.get("Fish_Swim")
    if swim:
        rig.animation_data_create()
        for track in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(track)
        rig.animation_data.action = swim
    scene.frame_set(1)

cam_data = bpy.data.cameras.new("ReferenceCam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size
cam = bpy.data.objects.new("ReferenceCam", cam_data)
scene.collection.objects.link(cam)
cam.location = (cx, cy, 20)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam
scene.render.resolution_x = px
scene.render.resolution_y = px
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = out
print("REF|", f"engine {scene.render.engine}, view {scene.view_settings.view_transform}, fish length {fish_length} canal widths")
bpy.ops.render.render(write_still=True)
print("REF|", f"wrote {out}")
