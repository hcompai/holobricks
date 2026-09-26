"""Render the Brickyard icon, a white 2x2 brick printed with the H Company logo: blender -b -P scripts/brick-icon.py -- OUT.png"""

import math
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/brick.png"
SIZE = 1024
FILL = 0.94
WIDTH, HEIGHT = 1.6, 1.36
STUD_RADIUS, STUD_HEIGHT = 0.264, 0.22
PRINT = 0.002


def material(name, color, roughness, coat=0.0, specular=0.5):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Specular IOR Level"].default_value = specular
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    bsdf.inputs["Subsurface Weight"].default_value = 0.08 if coat else 0
    bsdf.inputs["Subsurface Radius"].default_value = (0.05, 0.05, 0.05)
    return m


def finish(obj, mat, bevel, segments=8):
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def box(size, location, mat, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(obj, mat, bevel)


def cylinder(radius, depth, location, mat, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=192, radius=radius, depth=depth, location=location, rotation=rotation)
    return finish(bpy.context.object, mat, bevel)


def letter_h(tall, depth, location, mat, bevel=0.0, rotation=(0, 0, 0)):
    """The H Company logo's H as one prism, `tall` high along local y and `depth` thick along local z."""
    wide = tall * 197 / 220
    a, b, c, t = wide / 2, wide / 2 - wide * 54 / 197, tall * 45 / 440, tall / 2
    outline = (
        (-a, -t),
        (-b, -t),
        (-b, -c),
        (b, -c),
        (b, -t),
        (a, -t),
        (a, t),
        (b, t),
        (b, c),
        (-b, c),
        (-b, t),
        (-a, t),
    )
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, -depth / 2)) for x, y in outline]
    top = [bm.verts.new((x, y, depth / 2)) for x, y in outline]
    bm.faces.new(reversed(bottom))
    bm.faces.new(top)
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    mesh = bpy.data.meshes.new("H")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("H", mesh)
    obj.location, obj.rotation_euler = location, rotation
    bpy.context.scene.collection.objects.link(obj)
    return finish(obj, mat, bevel)


def studio(scene):
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    lights = bpy.utils.system_resource("DATAFILES", path="studiolights")
    env.image = bpy.data.images.load(f"{lights}/world/studio.exr")
    links.new(env.outputs["Color"], nodes["Background"].inputs["Color"])
    nodes["Background"].inputs["Strength"].default_value = 0.35
    for name, location, size, power in (
        ("Key", (-1.5, -2.5, 6), (5, 5), 900),
        ("Left strip", (-1.5, -6, 1.6), (1.2, 5), 700),
        ("Right strip", (6, 1.5, 1.6), (1.2, 5), 500),
        ("Rim", (-5, 5, 4), (3, 3), 400),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.shape = "RECTANGLE"
        light.size, light.size_y = size
        light.energy = power
        obj = bpy.data.objects.new(name, light)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 0.7)) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)


def frame(scene, camera):
    """Zoom and shift the camera so the brick fills FILL of the square frame, centered."""
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    bpy.context.view_layer.update()
    rim = [
        Vector((x + STUD_RADIUS * math.cos(a), y + STUD_RADIUS * math.sin(a), HEIGHT + STUD_HEIGHT))
        for x in (-0.4, 0.4)
        for y in (-0.4, 0.4)
        for a in (i * math.pi / 32 for i in range(64))
    ]
    corners = [Vector((x, y, z)) for x in (-WIDTH / 2, WIDTH / 2) for y in (-WIDTH / 2, WIDTH / 2) for z in (0, HEIGHT)]
    points = [world_to_camera_view(scene, camera, p) for p in rim + corners]
    us, vs = [p.x for p in points], [p.y for p in points]
    zoom = FILL / max(max(us) - min(us), max(vs) - min(vs))
    camera.data.lens *= zoom
    camera.data.shift_x = ((min(us) + max(us)) / 2 - 0.5) * zoom
    camera.data.shift_y = ((min(vs) + max(vs)) / 2 - 0.5) * zoom


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    plastic = material("ABS white", (0.86, 0.86, 0.84), 0.12, coat=0.6)
    ink = material("Print black", (0, 0, 0), 0.25, specular=0.02)

    box((WIDTH, WIDTH, HEIGHT), (0, 0, HEIGHT / 2), plastic, bevel=0.035)
    for x in (-0.4, 0.4):
        for y in (-0.4, 0.4):
            cylinder(STUD_RADIUS, STUD_HEIGHT + 0.02, (x, y, HEIGHT + STUD_HEIGHT / 2 - 0.01), plastic, bevel=0.03)
            letter_h(0.25, 0.036, (x, y, HEIGHT + STUD_HEIGHT), plastic, 0.006, (0, 0, math.radians(45)))

    face = HEIGHT / 2
    cylinder(HEIGHT * 0.3, PRINT, (0, -WIDTH / 2 - PRINT / 2, face), ink, rotation=(math.pi / 2, 0, 0))
    letter_h(HEIGHT * 0.46, PRINT, (WIDTH / 2 + PRINT / 2, 0, face), ink, rotation=(math.pi / 2, 0, math.pi / 2))

    studio(scene)
    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    camera.data.lens = 100
    camera.location = Vector((1, -1, 0.85)).normalized() * 11.5
    camera.rotation_euler = (Vector((0, 0, 0.78)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(camera)
    scene.camera = camera
    frame(scene, camera)

    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)


main()
