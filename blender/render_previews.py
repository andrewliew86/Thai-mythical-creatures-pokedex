"""Render quick review images for every generated GLB.

Run with:
  blender --background --python blender/render_previews.py
"""

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "assets" / "models" / "creatures"
OUTPUT_DIR = ROOT / "blender" / "previews"


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def add_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    return mat


def set_stage():
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.42))
    bpy.context.object.data.materials.append(add_material("Preview ground", (0.62, 0.78, 0.47)))

    bpy.ops.object.light_add(type="AREA", location=(-3.5, -4.5, 6))
    bpy.context.object.data.energy = 900
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 5
    look_at(bpy.context.object, (0, 0, 0.8))

    bpy.ops.object.light_add(type="AREA", location=(3, 1, 3))
    bpy.context.object.data.energy = 350
    bpy.context.object.data.size = 4
    look_at(bpy.context.object, (0, 0, 0.9))

    bpy.ops.object.camera_add(location=(3.8, -6.2, 3.2))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 3.7
    look_at(camera, (0, 0, 0.8))
    bpy.context.scene.camera = camera

    world = bpy.context.scene.world
    world.color = (0.55, 0.72, 0.82)


def configure_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 360
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    configure_render()
    for model_path in sorted(MODEL_DIR.glob("*.glb")):
        clear_scene()
        bpy.ops.import_scene.gltf(filepath=str(model_path))
        set_stage()
        bpy.context.scene.render.filepath = str(OUTPUT_DIR / f"{model_path.stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {model_path.stem}")


if __name__ == "__main__":
    main()
