"""Generate editable Blender sources and compact GLB folklore characters.

Run with:
  blender --background --python blender/generate_characters.py
"""

from pathlib import Path
from math import pi

import bpy


ROOT = Path(__file__).resolve().parents[1]
GLB_DIR = ROOT / "assets" / "models" / "creatures"
BLEND_DIR = ROOT / "blender" / "characters"

COLORS = {
    "skin": 0xD99868,
    "skin_light": 0xE6B28A,
    "skin_dark": 0xA9674F,
    "ink": 0x30242B,
    "white": 0xFFF8E8,
    "gold": 0xF2C84B,
    "gold_dark": 0xC89224,
    "red": 0xC94D43,
    "pink": 0xE78391,
    "coral": 0xEF8B78,
    "teal": 0x2E9B87,
    "green": 0x397E57,
    "green_light": 0x67AA70,
    "blue": 0x4A84B5,
    "purple": 0x8063A7,
    "orange": 0xD9822B,
    "brown": 0x75452E,
    "dark_brown": 0x35231E,
    "aqua": 0x39A9A6,
}

MATERIALS = {}


def srgb_to_linear(channel):
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def material(name, color):
    if name in MATERIALS:
        return MATERIALS[name]
    value = color if isinstance(color, int) else COLORS[color]
    srgb = (
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
    )
    rgb = tuple(srgb_to_linear(channel) for channel in srgb) + (1,)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgb
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgb
    shader.inputs["Roughness"].default_value = 0.82
    shader.inputs["Metallic"].default_value = 0.0
    MATERIALS[name] = mat
    return mat


def finish(obj, name, mat, smooth=False):
    obj.name = name
    obj.data.materials.append(material(mat, mat))
    if smooth and hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def sphere(name, loc, scale, mat, segments=16, rings=8, smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=loc,
    )
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat, smooth)


def ico(name, loc, scale, mat, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat, False)


def cube(name, loc, scale, mat, rotation=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.scale = scale
    if bevel:
        modifier = obj.modifiers.new("Soft toy edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return finish(obj, name, mat, False)


def cylinder(name, loc, radius, depth, mat, rotation=(0, 0, 0), vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, mat, True)


def cone(name, loc, radius1, radius2, depth, mat, rotation=(0, 0, 0), vertices=10):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=loc,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, mat, True)


def torus(name, loc, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=16,
        minor_segments=6,
        location=loc,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, mat, True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def eyes(prefix, x=0, z=1.43, spacing=0.15, scale=1.0):
    for side in (-1, 1):
        eye_x = x + side * spacing * scale
        sphere(
            f"{prefix}_eye_white_{side}",
            (eye_x, -0.337 * scale, z),
            (0.062 * scale, 0.035 * scale, 0.072 * scale),
            "white",
            12,
            6,
        )
        sphere(
            f"{prefix}_pupil_{side}",
            (eye_x, -0.372 * scale, z),
            (0.025 * scale, 0.018 * scale, 0.035 * scale),
            "ink",
            10,
            5,
        )


def crown(prefix, x=0, z=1.86, scale=1.0):
    torus(f"{prefix}_crown_band", (x, 0, z), 0.31 * scale, 0.055 * scale, "gold")
    for index in range(-2, 3):
        height = (0.34 + (2 - abs(index)) * 0.07) * scale
        cone(
            f"{prefix}_crown_spire_{index}",
            (x + index * 0.13 * scale, 0, z + 0.18 * scale),
            0.07 * scale,
            0.015 * scale,
            height,
            "red" if index == 0 else "gold",
            vertices=7,
        )


def rounded_hair(prefix, x, z, scale, hair_mat, long_hair=False):
    sphere(
        f"{prefix}_hair_back",
        (x, 0.11 * scale, z + 0.14 * scale),
        (0.4 * scale, 0.31 * scale, 0.28 * scale),
        hair_mat,
        14,
        7,
    )
    for index, fringe_x in enumerate((-0.22, 0, 0.22)):
        sphere(
            f"{prefix}_fringe_{index}",
            (x + fringe_x * scale, -0.285 * scale, z + (0.11 - abs(index - 1) * 0.03) * scale),
            (0.14 * scale, 0.075 * scale, 0.13 * scale),
            hair_mat,
            10,
            5,
        )
    if long_hair:
        sphere(
            f"{prefix}_long_hair",
            (x, 0.19 * scale, z - 0.25 * scale),
            (0.35 * scale, 0.22 * scale, 0.52 * scale),
            hair_mat,
            14,
            7,
        )


def humanoid(
    prefix,
    outfit="teal",
    trim="gold",
    skin="skin",
    hair="dark_brown",
    x=0,
    scale=1.0,
    with_crown=False,
    long_hair=False,
    bald=False,
    robe=True,
):
    cylinder(
        f"{prefix}_torso",
        (x, 0, 0.72 * scale),
        0.29 * scale,
        0.62 * scale,
        outfit,
        vertices=10,
    )
    if robe:
        cone(
            f"{prefix}_robe",
            (x, 0, 0.28 * scale),
            0.45 * scale,
            0.27 * scale,
            0.72 * scale,
            outfit,
            vertices=10,
        )
    torus(f"{prefix}_belt", (x, 0, 0.93 * scale), 0.28 * scale, 0.04 * scale, trim)
    sphere(
        f"{prefix}_head",
        (x, 0, 1.39 * scale),
        (0.37 * scale, 0.33 * scale, 0.38 * scale),
        skin,
        16,
        8,
    )
    eyes(prefix, x, 1.43 * scale, 0.15, scale)
    sphere(
        f"{prefix}_mouth",
        (x, -0.349 * scale, 1.25 * scale),
        (0.055 * scale, 0.018 * scale, 0.024 * scale),
        "pink",
        10,
        5,
    )
    for side in (-1, 1):
        sphere(
            f"{prefix}_cheek_{side}",
            (x + side * 0.25 * scale, -0.333 * scale, 1.31 * scale),
            (0.055 * scale, 0.018 * scale, 0.035 * scale),
            "coral",
            10,
            5,
        )
        cylinder(
            f"{prefix}_arm_{side}",
            (x + side * 0.39 * scale, 0, 0.72 * scale),
            0.068 * scale,
            0.62 * scale,
            skin,
            rotation=(0, side * 0.3, 0),
            vertices=9,
        )
        cylinder(
            f"{prefix}_leg_{side}",
            (x + side * 0.16 * scale, 0, -0.14 * scale),
            0.09 * scale,
            0.42 * scale,
            "brown",
            vertices=9,
        )
    if not bald:
        rounded_hair(prefix, x, 1.61 * scale, scale, hair, long_hair)
    if with_crown:
        crown(prefix, x, 1.82 * scale, scale)


def trident(prefix, x=0.58, scale=1.0):
    cylinder(f"{prefix}_trident_staff", (x, 0, 0.8), 0.032 * scale, 1.9 * scale, "gold_dark", vertices=8)
    for offset in (-0.13, 0, 0.13):
        cone(
            f"{prefix}_trident_tip_{offset}",
            (x + offset * scale, 0, 1.82 - abs(offset) * 0.5),
            0.065 * scale,
            0,
            0.3 * scale,
            "gold",
            vertices=7,
        )


def make_macchanu():
    humanoid("macchanu", "teal", "gold", "skin_light", "white", with_crown=True)
    for side in (-1, 1):
        sphere(
            f"macchanu_ear_{side}",
            (side * 0.4, 0, 1.42),
            (0.13, 0.09, 0.15),
            "skin_light",
            12,
            6,
        )
    cone("macchanu_tail", (0, 0.08, -0.54), 0.3, 0.12, 1.15, "aqua", vertices=10)
    for side in (-1, 1):
        cone(
            f"macchanu_fin_{side}",
            (side * 0.16, 0.08, -1.06),
            0.22,
            0,
            0.52,
            "coral",
            rotation=(0, side * 0.7, 0),
            vertices=7,
        )
    trident("macchanu")


def make_chalawan():
    sphere("chalawan_body", (0, 0.25, 0.48), (0.62, 1.0, 0.46), "green", 16, 8)
    sphere("chalawan_head", (0, -0.78, 0.62), (0.52, 0.58, 0.36), "green", 16, 8)
    sphere("chalawan_snout", (0, -1.25, 0.49), (0.4, 0.46, 0.17), "green_light", 14, 7)
    eyes("chalawan", 0, 0.82, 0.23, 1.0)
    for side in (-1, 1):
        for y in (-0.3, 0.55):
            sphere(
                f"chalawan_leg_{side}_{y}",
                (side * 0.48, y, 0.18),
                (0.25, 0.3, 0.12),
                "green",
                12,
                6,
            )
    cone("chalawan_tail", (0, 1.75, 0.46), 0.45, 0.03, 2.0, "green", rotation=(pi / 2, 0, 0), vertices=10)
    crown("chalawan", 0, 1.13, 0.78)


def make_phra_aphai():
    humanoid("phra_aphai", "blue", "gold", with_crown=True)
    cylinder("phra_aphai_flute", (0, -0.43, 0.96), 0.04, 1.05, "gold_dark", rotation=(0, pi / 2, 0), vertices=10)
    for x in (-0.28, -0.1, 0.1, 0.28):
        sphere(f"phra_aphai_flute_hole_{x}", (x, -0.468, 0.96), (0.016, 0.01, 0.016), "ink", 8, 4)


def make_sea_ogre():
    humanoid("sea_ogre", "pink", "gold", "skin_dark", "purple", long_hair=True)
    for side in (-1, 1):
        sphere(
            f"sea_ogre_shell_{side}",
            (side * 0.48, -0.01, 0.78),
            (0.19, 0.12, 0.24),
            "coral",
            12,
            6,
        )
    for side in (-1, 1):
        cone(
            f"sea_ogre_tusk_{side}",
            (side * 0.14, -0.35, 1.22),
            0.045,
            0,
            0.22,
            "white",
            rotation=(pi, 0, 0),
            vertices=7,
        )


def make_phra_lo():
    humanoid("phra_lo", "red", "gold", with_crown=True)
    for index in range(-2, 3):
        cone(
            f"phra_lo_feather_{index}",
            (index * 0.15, 0.2, 1.1 + abs(index) * 0.03),
            0.13,
            0,
            0.68,
            "teal" if index % 2 else "blue",
            rotation=(0, index * -0.14, 0),
            vertices=7,
        )


def make_twins():
    humanoid("phuean", "pink", "gold", x=-0.36, scale=0.86, with_crown=True, long_hair=True)
    humanoid("phaeng", "purple", "gold", x=0.36, scale=0.86, with_crown=True, long_hair=True)
    sphere("twins_flower", (0, -0.35, 1.08), (0.12, 0.05, 0.12), "coral", 10, 5)


def wings(prefix):
    for side in (-1, 1):
        for index in range(3):
            cone(
                f"{prefix}_wing_{side}_{index}",
                (
                    side * (0.48 + index * 0.12),
                    0.2 + index * 0.03,
                    0.78 - index * 0.09,
                ),
                0.17,
                0.03,
                0.82,
                "gold" if index % 2 == 0 else "teal",
                rotation=(0, side * (0.52 + index * 0.08), 0),
                vertices=7,
            )


def make_manora():
    humanoid("manora", "gold", "teal", with_crown=True, long_hair=True)
    wings("manora")
    cone("manora_tail", (0, 0.13, -0.46), 0.28, 0.08, 1.05, "teal", vertices=9)


def make_suthon():
    humanoid("suthon", "blue", "gold", with_crown=True)
    torus("suthon_bow", (0.58, -0.02, 0.72), 0.43, 0.035, "brown", rotation=(pi / 2, 0, 0))
    cylinder("suthon_bow_string", (0.58, -0.055, 0.72), 0.012, 0.86, "white", vertices=6)


def make_luang_pu_thuad():
    humanoid("luang_pu_thuad", "orange", "gold", bald=True)
    sphere("luang_pu_thuad_scalp", (0, 0.02, 1.56), (0.36, 0.31, 0.22), "skin", 14, 7)
    for index in range(9):
        angle = -0.3 + index * (pi * 1.2 / 8)
        sphere(
            f"luang_pu_thuad_bead_{index}",
            (0.3 * __import__("math").cos(angle), -0.32, 0.92 + 0.22 * __import__("math").sin(angle)),
            (0.04, 0.028, 0.04),
            "brown",
            8,
            4,
        )


BUILDERS = {
    "macchanu": make_macchanu,
    "chalawan": make_chalawan,
    "phra-aphai-mani": make_phra_aphai,
    "nang-phisua-samut": make_sea_ogre,
    "phra-lo": make_phra_lo,
    "phra-phuean-phaeng": make_twins,
    "manora": make_manora,
    "suthon": make_suthon,
    "luang-pu-thuad": make_luang_pu_thuad,
}


def save_character(character_id, builder):
    clear_scene()
    builder()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f"{character_id}.blend"))
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_DIR / f"{character_id}.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    print(f"Generated {character_id}")


def main():
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    BLEND_DIR.mkdir(parents=True, exist_ok=True)
    for character_id, builder in BUILDERS.items():
        save_character(character_id, builder)


if __name__ == "__main__":
    main()
