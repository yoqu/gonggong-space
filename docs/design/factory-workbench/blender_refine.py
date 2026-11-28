"""
Gonggong 3D Collectible Figurine Refinement Pipeline — Real Blender 5.2.1 LTS (bpy)
Sculpts all 25 Gonggong figurines (12 Official Agents + 13 Role Personas) with true Blender
organic & hard-surface modeling (Catmull-Clark SUBSURF, 3-segment BEVEL, WEIGHTED_NORMAL,
METABALLS, 3D BEZIER tubes, lathed spin profiles), rigs each into clean named glTF nodes
(Body, Arm_L, Arm_R, Leg_L, Leg_R, Accessory) grounded flush on Y = 0, and exports binary
glTF 2.0 (.glb) files + manifest.json.

Run via:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python blender_refine.py
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Coordinate & Color Utilities (glTF Y-up -> Blender Z-up)
# ─────────────────────────────────────────────────────────────────────────────
# In glTF export with export_yup=True:
#   Blender (X, Y, Z) -> glTF (X, Z, -Y)
# So glTF (x, y_up, z_front) maps to Blender (x, -z_front, y_up).


def pt(x, y_up, z_front):
    return Vector((x, -z_front, y_up))


def sz_bl(sx, sy_up, sz_front):
    return (sx, sz_front, sy_up)


def rot_bl(rx=0.0, ry_up=0.0, rz_front=0.0):
    """Convert glTF Euler (rx pitch, ry yaw, rz roll) to Blender Euler (X, Y, Z)."""
    return Euler((rx, -rz_front, ry_up), "XYZ")


def srgb_to_linear_ch(c):
    c = max(0.0, min(1.0, float(c)))
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    return (r, g, b)


def mix_rgb(a, b, f):
    return (
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Scene & Material System (exact Mat_* naming contract for glb_loader.js)
# ─────────────────────────────────────────────────────────────────────────────


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


class MaterialCache:
    def __init__(self):
        self._cache = {}

    def get(self, family, tag, srgb, alpha=1.0, emissive_srgb=None, emission_strength=2.0):
        """
        family: 'Vinyl' | 'Ceramic' | 'Crystal' | 'Brass' | 'Aluminum' | 'Titanium' | 'Obsidian' | 'Emissive'
        Produces material name `Mat_<family>_<tag>` with linear glTF baseColorFactor.
        """
        key = (family, tag)
        if key in self._cache:
            return self._cache[key]

        name = f"Mat_{family}_{tag}"
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        lin = (
            srgb_to_linear_ch(srgb[0]),
            srgb_to_linear_ch(srgb[1]),
            srgb_to_linear_ch(srgb[2]),
            1.0,
        )
        bsdf.inputs["Base Color"].default_value = lin

        if family == "Vinyl":
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.62
        elif family == "Ceramic":
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.16
            if "Coat Weight" in bsdf.inputs:
                bsdf.inputs["Coat Weight"].default_value = 0.85
                bsdf.inputs["Coat Roughness"].default_value = 0.08
        elif family == "Crystal":
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.08
            bsdf.inputs["Alpha"].default_value = min(0.84, alpha)
            if "IOR" in bsdf.inputs:
                bsdf.inputs["IOR"].default_value = 1.48
        elif family == "Brass":
            bsdf.inputs["Metallic"].default_value = 0.92
            bsdf.inputs["Roughness"].default_value = 0.28
        elif family == "Aluminum":
            bsdf.inputs["Metallic"].default_value = 0.88
            bsdf.inputs["Roughness"].default_value = 0.30
        elif family == "Titanium":
            bsdf.inputs["Metallic"].default_value = 0.78
            bsdf.inputs["Roughness"].default_value = 0.42
        elif family == "Obsidian":
            bsdf.inputs["Metallic"].default_value = 0.05
            bsdf.inputs["Roughness"].default_value = 0.07
            if "Coat Weight" in bsdf.inputs:
                bsdf.inputs["Coat Weight"].default_value = 0.95
        elif family == "Emissive":
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.20
            em = emissive_srgb if emissive_srgb is not None else srgb
            em_lin = (
                srgb_to_linear_ch(em[0]),
                srgb_to_linear_ch(em[1]),
                srgb_to_linear_ch(em[2]),
                1.0,
            )
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = em_lin
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emission_strength

        if alpha < 0.999 and family != "Crystal":
            bsdf.inputs["Alpha"].default_value = alpha

        if emissive_srgb is not None and family != "Emissive":
            em_lin = (
                srgb_to_linear_ch(emissive_srgb[0]),
                srgb_to_linear_ch(emissive_srgb[1]),
                srgb_to_linear_ch(emissive_srgb[2]),
                1.0,
            )
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = em_lin
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emission_strength

        self._cache[key] = mat
        return mat


# Common studio palette helpers
COL_PORCELAIN = (0.96, 0.97, 0.99)
COL_WARM_WHITE = (0.97, 0.96, 0.93)
COL_OBSIDIAN = (0.014, 0.016, 0.028)
COL_TITANIUM = (0.16, 0.17, 0.20)
COL_ALUMINUM = (0.78, 0.80, 0.84)
COL_BRASS = (0.86, 0.70, 0.36)
COL_BLUSH = (1.0, 0.66, 0.75)
COL_WHITE = (1.0, 1.0, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Figurine Builder — Real Blender Sculpting Primitives & Rigged Node Assembly
# ─────────────────────────────────────────────────────────────────────────────


class FigurineBuilder:
    def __init__(self, key):
        self.key = key
        self.mats = MaterialCache()
        self.groups = {
            "Body": [],
            "Arm_L": [],
            "Arm_R": [],
            "Leg_L": [],
            "Leg_R": [],
            "Accessory": [],
        }
        self.pivots = {
            "Body": pt(0.0, 0.56, 0.0),
            "Arm_L": pt(-0.34, 0.54, 0.0),
            "Arm_R": pt(0.34, 0.54, 0.0),
            "Leg_L": pt(-0.16, 0.28, 0.0),
            "Leg_R": pt(0.16, 0.28, 0.0),
            "Accessory": pt(0.0, 0.92, 0.0),
        }
        self._id = 0
        self._allow_float = set()

    def allow_float(self, obj):
        """Mark an explicitly designed levitating part (e.g. hovering ring/sparkle) as allowed to float."""
        if obj is not None:
            self._allow_float.add(obj.name)
        return obj

    def set_pivot(self, group, x, y_up, z_front):
        self.pivots[group] = pt(x, y_up, z_front)

    def _next_name(self, prefix):
        self._id += 1
        return f"{self.key}_{prefix}_{self._id}"

    def _register(self, group, obj, mat, smooth=True):
        bpy.context.collection.objects.link(obj)
        if obj.type == "MESH":
            if obj.data.materials:
                obj.data.materials[0] = mat
            else:
                obj.data.materials.append(mat)
            if smooth:
                for p in obj.data.polygons:
                    p.use_smooth = True
        self.groups[group].append(obj)
        return obj

    def _add_weighted_normal(self, obj):
        wn = obj.modifiers.new(name="WeightedNormal", type="WEIGHTED_NORMAL")
        wn.keep_sharp = True

    def box(
        self,
        group,
        center,
        size,
        mat,
        rot=(0, 0, 0),
        bevel=0.022,
        bevel_segs=3,
        subsurf=0,
    ):
        """Hard-surface chamfered box (BEVEL + WEIGHTED_NORMAL) or soft pill (BEVEL + SUBSURF)."""
        mesh = bpy.data.meshes.new(self._next_name("box"))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        sx, sy_up, sz_front = size
        bmesh.ops.scale(bm, vec=Vector((sx, sz_front, sy_up)), verts=bm.verts)
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)

        min_dim = min(sx, sy_up, sz_front)
        bw = min(bevel, min_dim * 0.42)
        if bw > 0.001:
            bev = obj.modifiers.new(name="Bevel", type="BEVEL")
            bev.width = bw
            bev.segments = bevel_segs
            bev.limit_method = "NONE"
            bev.miter_outer = "MITER_ARC"
        if subsurf > 0:
            sub = obj.modifiers.new(name="Subsurf", type="SUBSURF")
            sub.levels = subsurf
            sub.render_levels = subsurf
        else:
            self._add_weighted_normal(obj)
        return obj

    def pill(self, group, center, size, mat, rot=(0, 0, 0), subsurf=1):
        """Plush rounded designer-vinyl capsule/pillow using Bevel + Catmull-Clark SUBSURF."""
        min_dim = min(size)
        return self.box(
            group,
            center,
            size,
            mat,
            rot=rot,
            bevel=min_dim * 0.34,
            bevel_segs=1,
            subsurf=subsurf,
        )

    def sphere(self, group, center, radii, mat, rot=(0, 0, 0), subdivisions=2, subsurf=1):
        """Smooth organic ellipsoid via Icosphere + Catmull-Clark SUBSURF."""
        mesh = bpy.data.meshes.new(self._next_name("sph"))
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=0.5)
        rx, ry_up, rz_front = radii
        bmesh.ops.scale(bm, vec=Vector((rx, rz_front, ry_up)), verts=bm.verts)
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        if subsurf > 0:
            sub = obj.modifiers.new(name="Subsurf", type="SUBSURF")
            sub.levels = subsurf
            sub.render_levels = subsurf
        return obj

    def cyl(
        self,
        group,
        center,
        diam_x,
        height_y,
        diam_z,
        mat,
        rot=(0, 0, 0),
        segs=20,
        bevel=0.008,
    ):
        """Cylinder aligned along glTF Y-up (Blender Z), with beveled end-caps."""
        mesh = bpy.data.meshes.new(self._next_name("cyl"))
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=segs,
            radius1=0.5,
            radius2=0.5,
            depth=1.0,
        )
        bmesh.ops.scale(bm, vec=Vector((diam_x, diam_z, height_y)), verts=bm.verts)
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        bw = min(bevel, min(diam_x, diam_z, height_y) * 0.25)
        if bw > 0.0015:
            bev = obj.modifiers.new(name="Bevel", type="BEVEL")
            bev.width = bw
            bev.segments = 2
            bev.limit_method = "ANGLE"
            bev.angle_limit = math.radians(35)
        self._add_weighted_normal(obj)
        return obj

    def cone(
        self,
        group,
        center,
        diam_bottom,
        height_y,
        diam_top,
        mat,
        rot=(0, 0, 0),
        segs=20,
    ):
        mesh = bpy.data.meshes.new(self._next_name("cone"))
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=segs,
            radius1=diam_bottom * 0.5,
            radius2=max(0.002, diam_top * 0.5),
            depth=height_y,
        )
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        self._add_weighted_normal(obj)
        return obj

    def torus(
        self,
        group,
        center,
        major_r,
        minor_r,
        mat,
        rot=(0, 0, 0),
        maj_segs=24,
        min_segs=10,
    ):
        """Smooth torus lying in glTF XZ plane (around Y-up) before rotation."""
        mesh = bpy.data.meshes.new(self._next_name("tor"))
        bm = bmesh.new()
        verts_grid = []
        for i in range(maj_segs):
            theta = (2.0 * math.pi * i) / maj_segs
            ct, st = math.cos(theta), math.sin(theta)
            ring = []
            for j in range(min_segs):
                phi = (2.0 * math.pi * j) / min_segs
                cp, sp = math.cos(phi), math.sin(phi)
                r = major_r + minor_r * cp
                x = r * ct
                y_bl = r * st
                z_bl = minor_r * sp
                ring.append(bm.verts.new((x, y_bl, z_bl)))
            verts_grid.append(ring)
        for i in range(maj_segs):
            i2 = (i + 1) % maj_segs
            for j in range(min_segs):
                j2 = (j + 1) % min_segs
                bm.faces.new(
                    (
                        verts_grid[i][j],
                        verts_grid[i2][j],
                        verts_grid[i2][j2],
                        verts_grid[i][j2],
                    )
                )
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        return obj

    def octa(self, group, center, size, mat, rot=(0, 0, 0), bevel=0.012):
        """Faceted diamond/octahedron with crisp beveled edges."""
        mesh = bpy.data.meshes.new(self._next_name("octa"))
        bm = bmesh.new()
        sx, sy_up, sz_front = size
        hx, hy, hz = sx * 0.5, sy_up * 0.5, sz_front * 0.5
        v_top = bm.verts.new((0, 0, hy))
        v_bot = bm.verts.new((0, 0, -hy))
        v_r = bm.verts.new((hx, 0, 0))
        v_l = bm.verts.new((-hx, 0, 0))
        v_f = bm.verts.new((0, -hz, 0))
        v_b = bm.verts.new((0, hz, 0))
        for a, b in [(v_r, v_b), (v_b, v_l), (v_l, v_f), (v_f, v_r)]:
            bm.faces.new((v_top, a, b))
            bm.faces.new((v_bot, b, a))
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        if bevel > 0.001:
            bev = obj.modifiers.new(name="Bevel", type="BEVEL")
            bev.width = min(bevel, min(size) * 0.16)
            bev.segments = 2
        self._add_weighted_normal(obj)
        return obj

    def star4(self, group, center, rx, ry, rz, mat, rot=(0, 0, 0), inner=0.28, bevel=0.014):
        """True sculpted 4-point Gemini crystal star prism with razor-sharp beveled edges."""
        mesh = bpy.data.meshes.new(self._next_name("star4"))
        bm = bmesh.new()
        vf = bm.verts.new((0, -rz * 0.5, 0))
        vb = bm.verts.new((0, rz * 0.5, 0))
        ring = []
        # 8 perimeter points alternating outer tips and inner valleys
        angles = [i * math.pi * 0.25 for i in range(8)]
        for i, a in enumerate(angles):
            scale = 1.0 if i % 2 == 0 else inner
            x = math.sin(a) * rx * 0.5 * scale
            z_bl = math.cos(a) * ry * 0.5 * scale
            ring.append(bm.verts.new((x, 0, z_bl)))
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new((vf, ring[j], ring[i]))
            bm.faces.new((vb, ring[i], ring[j]))
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        if bevel > 0.001:
            bev = obj.modifiers.new(name="Bevel", type="BEVEL")
            bev.width = bevel
            bev.segments = 2
        self._add_weighted_normal(obj)
        return obj

    def metaball(self, group, blobs, mat, resolution=0.042, threshold=0.6, smooth_iters=5):
        """
        True Blender organic Metaball sculpture fused into one seamless mesh!
        blobs: list of (x, y_up, z_front, radius, sx, sy_up, sz_front)
        """
        mball = bpy.data.metaballs.new(self._next_name("mball"))
        mball.resolution = resolution
        mball.render_resolution = resolution
        mball.threshold = threshold
        for blob in blobs:
            x, y_up, z_front, r = blob[:4]
            sx, sy_up, sz_front = blob[4:7] if len(blob) >= 7 else (1.0, 1.0, 1.0)
            el = mball.elements.new(type="ELLIPSOID")
            el.co = pt(x, y_up, z_front)
            el.radius = r
            el.size_x = sx
            el.size_y = sz_front
            el.size_z = sy_up

        mobj = bpy.data.objects.new(mball.name, mball)
        bpy.context.collection.objects.link(mobj)
        bpy.context.view_layer.update()

        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = mobj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(eval_obj)
        bpy.data.objects.remove(mobj, do_unlink=True)
        bpy.data.metaballs.remove(mball, do_unlink=True)

        obj = bpy.data.objects.new(self._next_name("mbmesh"), mesh)
        self._register(group, obj, mat, smooth=True)
        sm = obj.modifiers.new(name="Smooth", type="SMOOTH")
        sm.factor = 0.5
        sm.iterations = smooth_iters
        return obj

    def curve_tube(self, group, points_r, mat, bevel_res=5, res_u=10, cyclic=False):
        """
        True Blender 3D NURBS/Poly-Smooth tube with variable radius per control point!
        points_r: list of (x, y_up, z_front, radius)
        """
        cdata = bpy.data.curves.new(self._next_name("crv"), type="CURVE")
        cdata.dimensions = "3D"
        cdata.resolution_u = res_u
        cdata.bevel_depth = 1.0
        cdata.bevel_resolution = bevel_res
        cdata.use_fill_caps = not cyclic

        spline = cdata.splines.new(type="NURBS")
        spline.points.add(len(points_r) - 1)
        for idx, (x, y_up, z_front, r) in enumerate(points_r):
            p = pt(x, y_up, z_front)
            spline.points[idx].co = (p.x, p.y, p.z, 1.0)
            spline.points[idx].radius = r
        spline.use_cyclic_u = cyclic
        spline.use_endpoint_u = not cyclic
        spline.order_u = min(4, len(points_r))

        cobj = bpy.data.objects.new(cdata.name, cdata)
        bpy.context.collection.objects.link(cobj)
        bpy.context.view_layer.update()

        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = cobj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(eval_obj)
        bpy.data.objects.remove(cobj, do_unlink=True)
        bpy.data.curves.remove(cdata, do_unlink=True)

        obj = bpy.data.objects.new(self._next_name("tube"), mesh)
        self._register(group, obj, mat, smooth=True)
        return obj

    def lathe(self, group, profile_ry, center, mat, rot=(0, 0, 0), segs=24):
        """True Blender lathed surface of revolution around glTF Y-up."""
        mesh = bpy.data.meshes.new(self._next_name("lathe"))
        bm = bmesh.new()
        verts = [bm.verts.new((r, 0.0, y_up)) for (r, y_up) in profile_ry]
        for i in range(len(verts) - 1):
            bm.edges.new((verts[i], verts[i + 1]))
        bmesh.ops.spin(
            bm,
            geom=bm.verts[:] + bm.edges[:],
            cent=(0, 0, 0),
            axis=(0, 0, 1),
            angle=2.0 * math.pi,
            steps=segs,
            use_merge=True,
        )
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.location = pt(*center)
        obj.rotation_euler = rot_bl(*rot)
        self._register(group, obj, mat, smooth=True)
        return obj

    # ── Shared Collector Toy Sub-assemblies ───────────────────────────────────

    def add_eyes(
        self,
        group,
        eye_x,
        eye_y,
        eye_z,
        w=0.072,
        h=0.095,
        d=0.036,
        round_eyes=False,
        catchlight=True,
        x_offset=0.0,
    ):
        m_obs = self.mats.get("Obsidian", "eye", COL_OBSIDIAN)
        m_hi = self.mats.get("Emissive", "catchlight", COL_WHITE, emissive_srgb=COL_WHITE, emission_strength=2.3)
        for sign in (-1, 1):
            cx = x_offset + sign * eye_x
            if round_eyes:
                self.sphere(group, (cx, eye_y, eye_z), (w, h, d), m_obs, subdivisions=2, subsurf=0)
            else:
                self.pill(group, (cx, eye_y, eye_z), (w, h, d), m_obs, subsurf=1)
            if catchlight:
                cr = max(0.015, min(w, h) * 0.28)
                # Deeply seated into front hemisphere of eye (zero air gap from 90 deg side view!)
                self.sphere(
                    group,
                    (cx - w * 0.16, eye_y + h * 0.18, eye_z + d * 0.34),
                    (cr, cr, cr * 0.90),
                    m_hi,
                    subdivisions=1,
                    subsurf=0,
                )
                # Secondary tiny lower-right designer-toy catchlight sparkle seated cleanly in eye
                cr2 = cr * 0.56
                self.sphere(
                    group,
                    (cx + w * 0.15, eye_y - h * 0.16, eye_z + d * 0.32),
                    (cr2, cr2, cr2 * 0.95),
                    m_hi,
                    subdivisions=1,
                    subsurf=0,
                )

    def add_twin_boots(
        self,
        leg_x=0.16,
        hip_y=0.34,
        leg_w=0.138,
        leg_d=0.162,
        leg_mat=None,
        sole_mat=None,
        top_reach=0.44,
    ):
        """Twin collectible legs extending solidly UP into torso (>=0.05m overlap, zero floating gap!)."""
        self.set_pivot("Leg_L", -leg_x, hip_y, 0.0)
        self.set_pivot("Leg_R", leg_x, hip_y, 0.0)
        m_sole = sole_mat or self.mats.get("Titanium", "sole", COL_TITANIUM)
        leg_top = max(hip_y + 0.08, top_reach)
        leg_h = max(0.14, leg_top - 0.042)
        leg_mid = 0.042 + leg_h * 0.5
        for grp, sign in (("Leg_L", -1), ("Leg_R", 1)):
            lx = sign * leg_x
            self.pill(grp, (lx, leg_mid, 0.0), (leg_w, leg_h, leg_d), leg_mat, subsurf=1)
            # Rounded hip socket cap embedded cleanly inside lower torso
            self.sphere(grp, (lx, leg_top - 0.02, 0.0), (leg_w * 0.96, leg_w * 0.90, leg_d * 0.92), leg_mat, subdivisions=1, subsurf=0)
            self.box(
                grp,
                (lx, 0.028, 0.016),
                (leg_w * 1.12, 0.056, leg_d * 1.22),
                m_sole,
                bevel=0.014,
                bevel_segs=2,
            )

    def add_gloved_boots(self, boot_mat, sole_mat, leg_mat, spread=0.155, hip_y=0.28, leg_h=0.22, top_reach=0.36):
        """Role persona boots with legs extending solidly UP into lower torso (zero floating gap!)."""
        self.set_pivot("Leg_L", -spread, hip_y, 0.0)
        self.set_pivot("Leg_R", spread, hip_y, 0.0)
        leg_top = max(hip_y + 0.06, top_reach)
        actual_h = max(leg_h, leg_top - 0.072)
        leg_mid = 0.072 + actual_h * 0.5
        for grp, sign in (("Leg_L", -1), ("Leg_R", 1)):
            lx = sign * spread
            self.cyl(grp, (lx, leg_mid, 0.0), 0.102, actual_h, 0.102, leg_mat, segs=16)
            self.sphere(grp, (lx, leg_top - 0.015, 0.0), (0.108, 0.095, 0.108), leg_mat, subdivisions=1, subsurf=0)
            self.pill(grp, (lx, 0.072, 0.026), (0.155, 0.106, 0.215), boot_mat, subsurf=1)
            self.box(grp, (lx, 0.015, 0.026), (0.162, 0.030, 0.222), sole_mat, bevel=0.008, bevel_segs=2)

    def add_standard_arms(
        self,
        shoulder_x,
        shoulder_y,
        arm_w,
        arm_h,
        arm_d,
        arm_mat,
        cuff_mat=None,
        blocky=False,
        left_x=None,
        right_x=None,
        pin_mat=None,
    ):
        """Articulated arms with deeply seated shoulder sockets overlapping >=0.04m into torso flanks."""
        lx = left_x if left_x is not None else shoulder_x
        rx = right_x if right_x is not None else shoulder_x
        self.set_pivot("Arm_L", -lx, shoulder_y, 0.0)
        self.set_pivot("Arm_R", rx, shoulder_y, 0.0)
        m_pin = pin_mat or self.mats.get("Titanium", "pin", COL_TITANIUM)
        for grp, sign, sx in (("Arm_L", -1, lx), ("Arm_R", 1, rx)):
            # Deeply recessed shoulder socket pin bridging cleanly inside torso
            self.cyl(
                grp,
                (sign * (sx - 0.055), shoulder_y, 0.0),
                arm_d * 0.72,
                0.13,
                arm_d * 0.72,
                m_pin,
                rot=(0, 0, math.pi * 0.5),
                segs=14,
            )
            # Flush matching-color shoulder collar ball tucked cleanly into arm silhouette (no harsh side-view step!)
            self.sphere(grp, (sign * (sx - 0.018), shoulder_y + 0.002, 0.0), (arm_w * 0.96, arm_w * 0.96, arm_d * 0.94), arm_mat, subdivisions=2, subsurf=1)
            if blocky:
                self.box(grp, (sign * sx, shoulder_y - arm_h * 0.36, 0.0), (arm_w, arm_h, arm_d), arm_mat, bevel=0.018, bevel_segs=2)
            else:
                self.pill(grp, (sign * sx, shoulder_y - arm_h * 0.36, 0.0), (arm_w, arm_h, arm_d), arm_mat, subsurf=1)
            if cuff_mat is not None:
                self.cyl(grp, (sign * sx, shoulder_y - arm_h * 0.72, 0.0), arm_w * 1.06, 0.032, arm_d * 1.06, cuff_mat, segs=16)

    def add_gloved_arms(self, x_off, y_off, glove_mat, cuff_mat):
        """Role persona arms with shoulder balls seated >=0.04m into torso flanks."""
        sx = x_off - 0.085
        self.set_pivot("Arm_L", -sx, y_off + 0.02, 0.0)
        self.set_pivot("Arm_R", sx, y_off + 0.02, 0.0)
        for grp, sign in (("Arm_L", -1), ("Arm_R", 1)):
            self.sphere(grp, (sign * sx, y_off + 0.02, 0.0), (0.122, 0.122, 0.122), cuff_mat, subdivisions=2, subsurf=0)
            self.pill(grp, (sign * (sx + 0.048), y_off - 0.022, 0.005), (0.088, 0.125, 0.092), cuff_mat, rot=(0, 0, sign * 0.30), subsurf=1)
            self.cyl(grp, (sign * (sx + 0.075), y_off - 0.075, 0.012), 0.098, 0.042, 0.098, cuff_mat, rot=(0, 0, sign * 0.18), segs=16)
            self.pill(grp, (sign * (sx + 0.082), y_off - 0.142, 0.018), (0.118, 0.132, 0.110), glove_mat, subsurf=1)
            self.sphere(grp, (sign * (sx + 0.024), y_off - 0.132, 0.042), (0.052, 0.058, 0.052), glove_mat, subdivisions=1, subsurf=0)

    # ── Automated 3D Gap / Connectivity Validator (BVHTree) ──────────────────

    @staticmethod
    def _aabb_overlap(a, b, eps=0.0):
        return (
            a[0].x <= b[1].x + eps
            and a[1].x >= b[0].x - eps
            and a[0].y <= b[1].y + eps
            and a[1].y >= b[0].y - eps
            and a[0].z <= b[1].z + eps
            and a[1].z >= b[0].z - eps
        )

    @staticmethod
    def _point_inside_bvh(point, bvh):
        """Odd-even raycast parity test along +Z to detect fully enclosed meshes."""
        hits = 0
        origin = point.copy()
        direction = Vector((0.00013, 0.00017, 1.0)).normalized()
        for _ in range(32):
            loc, _norm, idx, _dist = bvh.ray_cast(origin, direction)
            if idx is None:
                break
            hits += 1
            origin = loc + direction * 1e-4
        return (hits % 2) == 1

    def _validate_connectivity(self, all_baked):
        """
        BVHTree 3D overlap & enclosure connectivity audit across every sculpted part.
        Flags any part not physically intersecting/embedded into the main connected body
        unless explicitly whitelisted via allow_float().
        """
        n = len(all_baked)
        if n == 0:
            return {"totalParts": 0, "connectedParts": 0, "allowedFloating": [], "defects": []}

        bvhs = []
        aabbs = []
        verts_list = []
        volumes = []
        for entry in all_baked:
            mesh = entry["obj"].data
            verts = [v.co.copy() for v in mesh.vertices]
            polys = [tuple(p.vertices) for p in mesh.polygons]
            verts_list.append(verts)
            bvhs.append(BVHTree.FromPolygons(verts, polys))
            xs = [v.x for v in verts]
            ys = [v.y for v in verts]
            zs = [v.z for v in verts]
            mn = Vector((min(xs), min(ys), min(zs)))
            mx = Vector((max(xs), max(ys), max(zs)))
            aabbs.append((mn, mx))
            volumes.append(max(0.0, (mx.x - mn.x) * (mx.y - mn.y) * (mx.z - mn.z)))

        adj = [set() for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                if not self._aabb_overlap(aabbs[i], aabbs[j], eps=0.0):
                    continue
                connected = bool(bvhs[i].overlap(bvhs[j]))
                if not connected:
                    # Check complete enclosure either way
                    if verts_list[i] and self._point_inside_bvh(verts_list[i][0], bvhs[j]):
                        connected = True
                    elif verts_list[j] and self._point_inside_bvh(verts_list[j][0], bvhs[i]):
                        connected = True
                if connected:
                    adj[i].add(j)
                    adj[j].add(i)

        # Anchor main component on the largest-volume Body part
        body_indices = [i for i, e in enumerate(all_baked) if e["group"] == "Body"]
        root = max(body_indices, key=lambda idx: volumes[idx]) if body_indices else max(range(n), key=lambda idx: volumes[idx])

        main_comp = set()
        stack = [root]
        while stack:
            cur = stack.pop()
            if cur in main_comp:
                continue
            main_comp.add(cur)
            for nb in adj[cur]:
                if nb not in main_comp:
                    stack.append(nb)

        allowed_floating = []
        defects = []
        for i in range(n):
            if i in main_comp:
                continue
            # Compute minimum surface air gap (meters) to main connected component
            min_gap = float("inf")
            nearest_part = None
            sample_verts = verts_list[i]
            if len(sample_verts) > 64:
                step = max(1, len(sample_verts) // 64)
                sample_verts = sample_verts[::step]
            for j in main_comp:
                for v in sample_verts:
                    _loc, _norm, _idx, dist = bvhs[j].find_nearest(v)
                    if dist is not None and dist < min_gap:
                        min_gap = dist
                        nearest_part = all_baked[j]["name"]

            mn, mx = aabbs[i]
            # Convert Blender (x, y, z) -> glTF (x, y_up=z, z_front=-y)
            cx = round((mn.x + mx.x) * 0.5, 4)
            cy = round((mn.z + mx.z) * 0.5, 4)
            cz = round(-(mn.y + mx.y) * 0.5, 4)
            sx = round(mx.x - mn.x, 4)
            sy = round(mx.z - mn.z, 4)
            sz = round(mx.y - mn.y, 4)
            rec = {
                "name": all_baked[i]["name"],
                "group": all_baked[i]["group"],
                "material": all_baked[i]["material"],
                "gap_m": round(min_gap, 4),
                "nearest": nearest_part,
                "gltfCenter": [cx, cy, cz],
                "gltfSize": [sx, sy, sz],
            }
            if all_baked[i]["allow_float"]:
                allowed_floating.append(rec)
            else:
                defects.append(rec)

        return {
            "totalParts": n,
            "connectedParts": len(main_comp),
            "allowedFloatingCount": len(allowed_floating),
            "defectCount": len(defects),
            "allowedFloating": allowed_floating,
            "defects": defects,
        }

    # ── Finalize, Bake Modifiers, Join per Rig Node, Ground on Y=0, Export ────

    def finalize_and_export(self, filepath, audit_only=False):
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()

        baked_by_group = {}
        all_baked = []
        for group_name in ("Body", "Arm_L", "Arm_R", "Leg_L", "Leg_R", "Accessory"):
            objs = self.groups[group_name]
            if not objs:
                continue

            # Bake each object's modifiers cleanly via evaluated depsgraph
            baked_objs = []
            for o in objs:
                orig_name = o.name
                mat_name = o.data.materials[0].name if o.data.materials else "None"
                eval_o = o.evaluated_get(depsgraph)
                baked_mesh = bpy.data.meshes.new_from_object(
                    eval_o, preserve_all_data_layers=True, depsgraph=depsgraph
                )
                # Bake world transform into vertices so joining is exact
                baked_mesh.transform(o.matrix_world)
                bo = bpy.data.objects.new(orig_name + "_b", baked_mesh)
                bpy.context.collection.objects.link(bo)
                baked_objs.append(bo)
                all_baked.append(
                    {
                        "group": group_name,
                        "name": orig_name,
                        "material": mat_name,
                        "obj": bo,
                        "allow_float": orig_name in self._allow_float,
                    }
                )
                bpy.data.objects.remove(o, do_unlink=True)
            baked_by_group[group_name] = baked_objs

        # Run automated 3D BVHTree connectivity / zero-gap audit BEFORE joining!
        connectivity = self._validate_connectivity(all_baked)

        if audit_only:
            return {
                "key": self.key,
                "connectivity": connectivity,
            }

        node_objects = []
        for group_name in ("Body", "Arm_L", "Arm_R", "Leg_L", "Leg_R", "Accessory"):
            baked_objs = baked_by_group.get(group_name)
            if not baked_objs:
                continue

            # Join all baked meshes of this rig node into one multi-material mesh
            bpy.ops.object.select_all(action="DESELECT")
            for bo in baked_objs:
                bo.select_set(True)
            bpy.context.view_layer.objects.active = baked_objs[0]
            if len(baked_objs) > 1:
                bpy.ops.object.join()
            joined = bpy.context.view_layer.objects.active
            joined.name = group_name
            joined.data.name = f"{self.key}_{group_name}"

            # Shift origin to the exact joint pivot in Blender coordinates
            pivot = self.pivots[group_name]
            joined.data.transform(Matrix.Translation(-pivot))
            joined.location = pivot
            node_objects.append(joined)

        # Update scene transforms BEFORE computing world-space bounds!
        bpy.context.view_layer.update()

        # Compute exact global min_z (glTF minY) and max_z (glTF maxY)
        min_z = float("inf")
        max_z = float("-inf")
        for obj in node_objects:
            for v in obj.data.vertices:
                wz = (obj.matrix_world @ v.co).z
                if wz < min_z:
                    min_z = wz
                if wz > max_z:
                    max_z = wz

        # Shift all rig nodes so feet sit mathematically flush on Y = 0.000
        if min_z != float("inf"):
            for obj in node_objects:
                obj.location.z -= min_z
            height = max_z - min_z
        else:
            height = 1.0

        bpy.context.view_layer.update()

        # Gather exact triangle & vertex counts + node pivots (in glTF Y-up coords)
        total_tris = 0
        total_verts = 0
        node_info = {}
        materials_used = set()
        for obj in node_objects:
            mesh = obj.data
            mesh.calc_loop_triangles()
            tris = len(mesh.loop_triangles)
            verts = len(mesh.vertices)
            total_tris += tris
            total_verts += verts
            for m in mesh.materials:
                if m:
                    materials_used.add(m.name)
            # Blender (x, y, z) -> glTF (x, z, -y)
            loc = obj.location
            node_info[obj.name] = {
                "triangles": tris,
                "vertices": verts,
                "pivot": [round(loc.x, 4), round(loc.z, 4), round(-loc.y, 4)],
            }

        bpy.ops.export_scene.gltf(
            filepath=filepath,
            export_format="GLB",
            export_normals=True,
            export_materials="EXPORT",
            export_yup=True,
            export_apply=True,
            export_texcoords=False,
        )

        size_bytes = os.path.getsize(filepath)
        return {
            "key": self.key,
            "file": os.path.basename(filepath),
            "bytes": size_bytes,
            "triangles": total_tris,
            "vertices": total_verts,
            "height": round(height, 4),
            "minY": 0.0,
            "nodes": list(node_info.keys()),
            "nodeDetails": node_info,
            "materials": sorted(materials_used),
            "connectivity": {
                "totalParts": connectivity["totalParts"],
                "connectedParts": connectivity["connectedParts"],
                "allowedFloatingCount": connectivity["allowedFloatingCount"],
                "defectCount": connectivity["defectCount"],
            },
        }


# ═════════════════════════════════════════════════════════════════════════════
# 12 OFFICIAL AGENT FIGURINE SCULPTORS (True Blender 5.2.1 Organic + Hard-Surface)
# ═════════════════════════════════════════════════════════════════════════════


def build_claude(b: FigurineBuilder):
    """1. Claude Code — Hero-presence collector micro-beveled terracotta Clawd + crisp leg cuffs + seated limbs"""
    c_main = hex_rgb("#d97757")
    m_shell = b.mats.get("Vinyl", "claude_shell", c_main)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_led = b.mats.get("Emissive", "led", (0.18, 0.96, 0.65), emissive_srgb=(0.18, 0.96, 0.65), emission_strength=2.8)

    b.set_pivot("Body", 0, 0.67, 0)
    # Hero-presence blocky collector torso + crisper top bevel highlight + lower skirt
    b.box("Body", (0, 0.67, 0), (1.04, 0.63, 0.63), m_shell, bevel=0.038, bevel_segs=3)
    b.box("Body", (0, 1.02, 0), (0.80, 0.115, 0.52), m_shell, bevel=0.024, bevel_segs=3)
    b.box("Body", (0, 0.335, 0), (0.94, 0.068, 0.56), m_shell, bevel=0.016, bevel_segs=3)

    # Recessed obsidian eyes + titanium micro-bezel frames (clean +0.028m Z clearance past 0.315)
    eye_z = 0.328
    for s in (-1, 1):
        b.box("Body", (s * 0.19, 0.70, eye_z - 0.008), (0.128, 0.232, 0.028), m_ti, bevel=0.008, bevel_segs=2)
    b.add_eyes("Body", 0.19, 0.70, eye_z + 0.004, w=0.100, h=0.204, d=0.036, round_eyes=False)

    # Flush-recessed top-left status LED bezel + glowing pip
    b.box("Body", (-0.24, 1.072, 0.145), (0.095, 0.024, 0.076), m_alu, bevel=0.006, bevel_segs=2)
    b.box("Body", (-0.24, 1.086, 0.160), (0.066, 0.018, 0.042), m_led, bevel=0.005, bevel_segs=2)

    # Back 12-ray Anthropic brass spark emblem + brushed aluminum nameplate (embedded >=0.02m into torso back -0.315)
    b.set_pivot("Accessory", 0, 0.74, -0.318)
    for r in range(6):
        ang = (r * math.pi) / 6.0
        b.box("Accessory", (0, 0.74, -0.318), (0.024, 0.25, 0.044), m_brass, rot=(0, 0, ang), bevel=0.004, bevel_segs=2)
    b.cyl("Accessory", (0, 0.74, -0.318), 0.070, 0.048, 0.070, m_brass, rot=(math.pi * 0.5, 0, 0), segs=18)
    b.box("Body", (0, 0.51, -0.316), (0.48, 0.100, 0.044), m_alu, bevel=0.006, bevel_segs=2)

    # Snugly seated arm shoulder pegs
    b.add_standard_arms(0.545, 0.65, 0.132, 0.37, 0.152, m_shell, blocky=True)

    # 4 iconic Clawd legs with crisp brushed-aluminum ankle cuff highlights + titanium soles
    b.set_pivot("Leg_L", -0.225, 0.35, 0)
    b.set_pivot("Leg_R", 0.225, 0.35, 0)
    for grp, xs in (("Leg_L", (-0.325, -0.125)), ("Leg_R", (0.125, 0.325))):
        for lx in xs:
            b.box(grp, (lx, 0.21, 0), (0.142, 0.35, 0.162), m_shell, bevel=0.020, bevel_segs=3)
            b.box(grp, (lx, 0.064, 0), (0.146, 0.026, 0.166), m_alu, bevel=0.006, bevel_segs=2)
            b.box(grp, (lx, 0.024, 0), (0.136, 0.048, 0.156), m_ti, bevel=0.008, bevel_segs=2)


def build_codex(b: FigurineBuilder):
    """2. Codex — High-res smooth Metaball cloud-knot + soft-rim face plate + seamless hip join"""
    c_main = hex_rgb("#6864f7")
    c_sec = hex_rgb("#3941ff")
    m_shell = b.mats.get("Vinyl", "codex_cloud", c_main)
    m_sec = b.mats.get("Vinyl", "codex_boots", c_sec)
    m_face = b.mats.get("Ceramic", "codex_face", COL_PORCELAIN)
    m_blush = b.mats.get("Vinyl", "blush", COL_BLUSH)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_cur = b.mats.get("Emissive", "codex_cursor", (0.22, 0.92, 1.0), emissive_srgb=(0.22, 0.92, 1.0), emission_strength=2.6)

    b.set_pivot("Body", 0, 0.60, 0)
    # High-res smooth Metaball cloud + plush lower hip/belly lobes (plump Z depth so face plate & back ring seat deeply!)
    blobs = [
        (0.0, 0.61, 0.00, 0.34, 1.15, 1.00, 1.04),
        (0.0, 0.42, 0.00, 0.27, 1.10, 0.84, 0.96),
    ]
    for i in range(6):
        a = (i * math.pi * 2.0) / 6.0 + math.pi / 6.0
        r = 0.23
        lx = math.cos(a) * r
        ly = 0.62 + math.sin(a) * r * 0.90
        blobs.append((lx, ly, -0.01, 0.228, 1.02, 1.02, 0.98))
    b.metaball("Body", blobs, m_shell, resolution=0.038, threshold=0.60, smooth_iters=6)

    # Thick softly contoured porcelain face plate deeply embedded into cloud body (0.000m side-view gap, ~0.03m proud front!)
    face_z = 0.228
    b.box("Body", (0, 0.61, face_z - 0.072), (0.48, 0.34, 0.165), m_face, bevel=0.042, bevel_segs=2, subsurf=2)

    # Glossy ink-obsidian eyes + embedded catchlights + rosy cheeks seated cleanly into face plate
    b.add_eyes("Body", 0.115, 0.655, face_z + 0.004, w=0.084, h=0.108, d=0.052, round_eyes=True)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.185, 0.575, face_z - 0.007), (0.056, 0.036, 0.040), m_blush, subdivisions=1, subsurf=0)

    # Crisp non-flickering terminal-cursor mouth `_` deeply embedded into face plate
    b.box("Body", (0, 0.535, face_z - 0.004), (0.148, 0.042, 0.036), m_ti, bevel=0.005, bevel_segs=2)
    b.box("Body", (0, 0.535, face_z + 0.006), (0.132, 0.030, 0.032), m_cur, bevel=0.005, bevel_segs=2)

    # Molded brushed-silver back ring badge seated flush into rear cloud surface (zero side-view air gap!)
    b.set_pivot("Accessory", 0, 0.61, -0.188)
    b.torus("Accessory", (0, 0.61, -0.188), 0.135, 0.032, m_alu, rot=(math.pi * 0.5, 0, 0), maj_segs=24, min_segs=10)
    b.sphere("Accessory", (0, 0.61, -0.194), (0.095, 0.095, 0.082), m_cur, subdivisions=2, subsurf=0)

    # Smoothly blended arms & seamless hip-joined legs
    b.add_standard_arms(0.365, 0.55, 0.13, 0.28, 0.13, m_shell, pin_mat=m_shell)
    b.add_twin_boots(0.165, 0.34, 0.150, 0.178, m_sec, top_reach=0.48)


def build_gemini(b: FigurineBuilder):
    """3. Gemini CLI — Razor-sharp beveled 4-point sapphire crystal star + cobalt shoulder collars + clean lower crystal tip"""
    c_main = mix_rgb(hex_rgb("#5c8eff"), (0.16, 0.34, 0.96), 0.55)
    c_sec = mix_rgb(hex_rgb("#3d5fe0"), (0.42, 0.30, 0.96), 0.50)
    m_crys = b.mats.get("Crystal", "gemini_star", c_main, alpha=0.84, emissive_srgb=(0.12, 0.28, 0.85), emission_strength=0.45)
    m_core = b.mats.get("Emissive", "gemini_core", (0.72, 0.86, 1.0), emissive_srgb=(0.55, 0.85, 1.0), emission_strength=1.8)
    m_cer = b.mats.get("Ceramic", "gemini_rim", c_main)
    m_face = b.mats.get("Ceramic", "gemini_face", (0.97, 0.98, 1.0))
    m_blush = b.mats.get("Ceramic", "gemini_blush", (0.78, 0.82, 1.0))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_limb = b.mats.get("Ceramic", "gemini_limbs", c_sec)

    b.set_pivot("Body", 0, 0.64, 0)
    # Razor-sharp 4-point crystal star + compact upper hip core so the lower crystal tip peeks cleanly between legs!
    b.star4("Body", (0, 0.64, 0), 0.88, 0.88, 0.38, m_crys, inner=0.31, bevel=0.008)
    b.octa("Body", (0, 0.48, 0), (0.34, 0.16, 0.22), m_cer, bevel=0.010)
    b.sphere("Body", (0, 0.64, 0), (0.20, 0.20, 0.20), m_core, subdivisions=2, subsurf=0)

    # Seamless glossy porcelain face medallion
    fz = 0.192
    b.cyl("Body", (0, 0.64, fz - 0.012), 0.34, 0.056, 0.34, m_cer, rot=(math.pi * 0.5, 0, 0), segs=24)
    b.cyl("Body", (0, 0.64, fz + 0.006), 0.30, 0.048, 0.30, m_face, rot=(math.pi * 0.5, 0, 0), segs=24)
    b.add_eyes("Body", 0.068, 0.668, fz + 0.036, w=0.048, h=0.072, d=0.026)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.108, 0.622, fz + 0.030), (0.038, 0.024, 0.016), m_blush, subdivisions=1, subsurf=0)
    b.box("Body", (0, 0.586, fz + 0.034), (0.072, 0.022, 0.018), m_obs, bevel=0.005, bevel_segs=2)

    # Orbiting glowing mini twin-star satellite (intentionally levitating)
    b.set_pivot("Accessory", 0.36, 0.96, 0.06)
    b.allow_float(b.star4("Accessory", (0.36, 0.96, 0.06), 0.21, 0.21, 0.09, m_core, inner=0.28, bevel=0.004))

    # Cobalt shoulder collars (no exposed black pegs!) + legs tucked inward into central hip core
    b.add_standard_arms(0.255, 0.56, 0.098, 0.26, 0.10, m_limb, cuff_mat=m_alu, pin_mat=m_limb)
    b.add_twin_boots(0.140, 0.36, 0.105, 0.135, m_limb, top_reach=0.47)


def build_codebuddy(b: FigurineBuilder):
    """4. CodeBuddy — Sculpted teal-violet hooded cyber-buddy + deep recessed visor + angled glowing bar-eyes"""
    c_hood = hex_rgb("#2ea99d")
    c_cloak = hex_rgb("#6c4dff")
    m_hood = b.mats.get("Vinyl", "cb_hood", c_hood)
    m_cloak = b.mats.get("Vinyl", "cb_cloak", c_cloak)
    m_obs = b.mats.get("Obsidian", "cb_visor", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_eye = b.mats.get("Emissive", "cb_eye", (0.78, 1.0, 0.96), emissive_srgb=(0.45, 1.0, 0.95), emission_strength=2.8)

    b.set_pivot("Body", 0, 0.60, 0)
    b.pill("Body", (0, 0.52, -0.02), (0.56, 0.44, 0.42), m_cloak, subsurf=1)
    # Sculpted overarching teal hood cowl + back point
    b.pill("Body", (0, 0.74, -0.02), (0.70, 0.46, 0.52), m_hood, subsurf=1)
    b.cone("Body", (0, 0.92, -0.15), 0.40, 0.32, 0.06, m_hood, rot=(-0.58, 0, 0), segs=20)
    b.torus("Body", (0, 0.70, 0.18), 0.22, 0.042, m_cloak, rot=(math.pi * 0.5, 0, 0), maj_segs=24, min_segs=10)

    # Deep recessed smoked visor + twin angled glowing cyan-white bar-eyes (embedded into visor, zero gap)
    vz = 0.215
    b.pill("Body", (0, 0.70, vz), (0.44, 0.27, 0.12), m_obs, subsurf=1)
    b.pill("Body", (-0.09, 0.685, vz + 0.048), (0.048, 0.125, 0.038), m_eye, rot=(0, 0, 0.46), subsurf=1)
    b.pill("Body", (0.095, 0.725, vz + 0.048), (0.048, 0.125, 0.038), m_eye, rot=(0, 0, 0.46), subsurf=1)
    b.box("Body", (0.02, 0.615, vz + 0.046), (0.09, 0.018, 0.034), m_eye, rot=(0, 0, 0.28), bevel=0.004, bevel_segs=2)

    b.box("Body", (0, 0.35, 0), (0.58, 0.055, 0.44), m_ti, bevel=0.012, bevel_segs=2)
    b.set_pivot("Accessory", 0, 0.54, -0.205)
    b.box("Accessory", (0, 0.54, -0.205), (0.28, 0.08, 0.046), m_alu, bevel=0.006, bevel_segs=2)

    b.add_standard_arms(0.34, 0.54, 0.115, 0.30, 0.125, m_hood, cuff_mat=m_cloak)
    b.add_twin_boots(0.15, 0.29, 0.135, 0.16, m_cloak)


def build_pi(b: FigurineBuilder):
    """5. pi — Precision architectural slate stepped L-block + hopping brushed-brass pixel-cube dot"""
    c_main = hex_rgb("#525b6e")
    c_sec = hex_rgb("#262b36")
    m_shell = b.mats.get("Vinyl", "pi_shell", c_main)
    m_sec = b.mats.get("Vinyl", "pi_sec", c_sec)
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_led = b.mats.get("Emissive", "led", (0.22, 0.96, 0.68), emissive_srgb=(0.22, 0.96, 0.68), emission_strength=2.6)

    b.set_pivot("Body", -0.04, 0.64, 0)
    b.box("Body", (-0.04, 0.78, 0), (0.72, 0.34, 0.38), m_shell, bevel=0.026, bevel_segs=3)
    b.box("Body", (-0.15, 0.50, 0), (0.48, 0.24, 0.38), m_shell, bevel=0.022, bevel_segs=3)
    b.box("Body", (-0.04, 0.962, 0), (0.68, 0.024, 0.34), m_brass, bevel=0.006, bevel_segs=2)
    b.box("Body", (0.22, 0.982, 0.08), (0.065, 0.022, 0.065), m_led, bevel=0.005, bevel_segs=2)

    # Pixel eyes + machined aluminum mouth bar centered on offset lintel (-0.10)
    ez = 0.194
    b.add_eyes("Body", 0.09, 0.80, ez, w=0.075, h=0.125, d=0.036, x_offset=-0.10)
    b.box("Body", (-0.10, 0.695, ez), (0.11, 0.024, 0.032), m_alu, bevel=0.005, bevel_segs=2)

    # Asymmetric shoulders matching offset lintel
    b.add_standard_arms(0.38, 0.74, 0.095, 0.28, 0.105, m_ti, cuff_mat=m_alu, blocky=True, left_x=0.425, right_x=0.345)

    # Left solid pillar leg + right stabilizer foot extending cleanly UP into lower body block (zero gap!)
    b.set_pivot("Leg_L", -0.26, 0.40, 0)
    b.box("Leg_L", (-0.26, 0.22, 0), (0.24, 0.36, 0.36), m_shell, bevel=0.022, bevel_segs=2)
    b.box("Leg_L", (-0.26, 0.022, 0), (0.25, 0.044, 0.37), m_ti, bevel=0.008, bevel_segs=2)

    b.set_pivot("Leg_R", 0.02, 0.38, 0)
    b.box("Leg_R", (0.02, 0.23, 0), (0.13, 0.38, 0.20), m_sec, bevel=0.016, bevel_segs=2)
    b.box("Leg_R", (0.02, 0.022, 0), (0.15, 0.044, 0.22), m_ti, bevel=0.008, bevel_segs=2)

    # Hopping brushed-brass detached pixel-cube companion dot (intentionally separate companion piece)
    b.set_pivot("Accessory", 0.28, 0.20, 0)
    b.allow_float(b.box("Accessory", (0.28, 0.20, 0), (0.21, 0.34, 0.26), m_brass, bevel=0.024, bevel_segs=3))
    b.allow_float(b.box("Accessory", (0.28, 0.016, 0), (0.18, 0.032, 0.22), m_ti, bevel=0.006, bevel_segs=2))


def build_deepseek(b: FigurineBuilder):
    """6. DeepSeek Harness — Smooth Metaball porcelain whale + continuous NURBS curved tail stem + seated legs"""
    c_main = hex_rgb("#5a7cff")
    c_sec = hex_rgb("#3552e8")
    m_shell = b.mats.get("Ceramic", "ds_whale", c_main)
    m_sec = b.mats.get("Ceramic", "ds_tail", c_sec)
    m_belly = b.mats.get("Ceramic", "ds_belly", (0.95, 0.97, 1.0))
    m_blush = b.mats.get("Ceramic", "ds_blush", (1.0, 0.68, 0.78))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_bub = b.mats.get("Crystal", "ds_bubble", (0.68, 0.86, 1.0), alpha=0.80, emissive_srgb=(0.35, 0.85, 1.0), emission_strength=0.9)

    b.set_pivot("Body", 0, 0.56, 0)
    # Smooth high-res Metaball whale torso + rounded forehead melon!
    whale_blobs = [
        (0.0, 0.56, 0.00, 0.35, 1.08, 0.86, 1.04),
        (0.0, 0.62, 0.15, 0.27, 1.02, 0.82, 0.90),
    ]
    b.metaball("Body", whale_blobs, m_shell, resolution=0.038, threshold=0.58, smooth_iters=5)
    # Ivory glazed porcelain belly
    b.sphere("Body", (0, 0.42, 0.09), (0.56, 0.28, 0.54), m_belly, subdivisions=2, subsurf=1)

    # Continuous curved 3D NURBS ceramic whale tail stem sweeping smoothly from rear body up into twin flukes!
    tail_pts = [
        (0.0, 0.54, -0.14, 0.165),
        (0.0, 0.58, -0.32, 0.115),
        (0.0, 0.72, -0.42, 0.075),
        (0.0, 0.84, -0.43, 0.056),
    ]
    b.curve_tube("Body", tail_pts, m_sec, bevel_res=5, res_u=12)
    # Sculpted curved twin whale tail fluke lobes joined seamlessly to tail tip!
    b.sphere("Body", (0.0, 0.84, -0.43), (0.11, 0.09, 0.11), m_sec, subdivisions=2, subsurf=0)
    b.pill("Body", (-0.13, 0.86, -0.44), (0.28, 0.068, 0.17), m_shell, rot=(-0.22, -0.22, 0.36), subsurf=1)
    b.pill("Body", (0.13, 0.86, -0.44), (0.28, 0.068, 0.17), m_shell, rot=(-0.22, 0.22, -0.36), subsurf=1)

    # Glossy ink-obsidian eyes + embedded catchlights + rosy porcelain cheeks + smile seated cleanly in whale forehead
    ez = 0.268
    b.add_eyes("Body", 0.128, 0.630, ez, w=0.068, h=0.088, d=0.052)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.182, 0.560, ez - 0.064), (0.054, 0.032, 0.058), m_blush, subdivisions=1, subsurf=0)
    b.box("Body", (0, 0.530, ez + 0.012), (0.095, 0.022, 0.042), m_obs, bevel=0.005, bevel_segs=2)

    # 2 smooth Subsurf translucent crystal water-droplet bubbles rising above blowhole (intentionally levitating)
    b.set_pivot("Accessory", 0.0, 0.98, 0.06)
    b.allow_float(b.sphere("Accessory", (-0.06, 0.94, 0.06), (0.095, 0.102, 0.095), m_bub, subdivisions=2, subsurf=1))
    b.allow_float(b.sphere("Accessory", (0.07, 1.05, 0.06), (0.125, 0.132, 0.125), m_bub, subdivisions=2, subsurf=1))

    # Snugly seated pectoral whale flippers tucked cleanly into whale torso!
    b.set_pivot("Arm_L", -0.265, 0.52, 0.06)
    b.set_pivot("Arm_R", 0.265, 0.52, 0.06)
    for grp, s in (("Arm_L", -1), ("Arm_R", 1)):
        b.sphere(grp, (s * 0.25, 0.52, 0.06), (0.14, 0.13, 0.14), m_sec, subdivisions=2, subsurf=0)
        b.pill(grp, (s * 0.31, 0.44, 0.06), (0.11, 0.24, 0.14), m_sec, rot=(0, 0, s * 0.42), subsurf=1)

    # Deeply seated porcelain whale legs overlapping cleanly into ivory belly (zero gap!)
    b.add_twin_boots(0.135, 0.28, 0.125, 0.155, m_sec, top_reach=0.44)


def build_antigravity(b: FigurineBuilder):
    """7. Antigravity CLI — Smooth NURBS A-arch hull + floating porcelain face orb + magnetic base & thruster ring"""
    c_main = hex_rgb("#5390ff")
    c_sec = hex_rgb("#3186ff")
    m_arch = b.mats.get("Ceramic", "ag_arch", c_main)
    m_apex = b.mats.get("Ceramic", "ag_apex", c_sec)
    m_face = b.mats.get("Ceramic", "ag_face", COL_PORCELAIN)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_glow = b.mats.get("Emissive", "ag_glow", (0.55, 0.88, 1.0), emissive_srgb=(0.35, 0.85, 1.0), emission_strength=2.6)
    m_crys = b.mats.get("Crystal", "ag_ring", (0.75, 0.92, 1.0), alpha=0.76, emissive_srgb=(0.25, 0.78, 1.0), emission_strength=1.2)

    b.set_pivot("Body", 0, 0.62, 0)
    # TRUE BLENDER 3D NURBS curved A-arch hull!
    arch_pts = [
        (-0.30, 0.28, 0.0, 0.078),
        (-0.22, 0.62, 0.0, 0.088),
        (-0.08, 0.94, 0.0, 0.095),
        (0.00, 1.00, 0.0, 0.105),
        (0.08, 0.94, 0.0, 0.095),
        (0.22, 0.62, 0.0, 0.088),
        (0.30, 0.28, 0.0, 0.078),
    ]
    b.curve_tube("Body", arch_pts, m_arch, bevel_res=6, res_u=12)
    b.sphere("Body", (0, 0.99, 0), (0.24, 0.20, 0.24), m_apex, subdivisions=2, subsurf=1)

    # Floating porcelain face orb nestled inside arch cavity + lower silver collar halo
    orb_y = 0.58
    b.sphere("Body", (0, orb_y, 0.03), (0.36, 0.36, 0.36), m_face, subdivisions=2, subsurf=1)
    b.torus("Body", (0, orb_y - 0.145, 0.03), 0.18, 0.014, m_alu, rot=(0.10, 0, 0), maj_segs=24, min_segs=8)
    b.add_eyes("Body", 0.072, orb_y + 0.03, 0.180, w=0.048, h=0.066, d=0.044)
    b.box("Body", (0, orb_y - 0.04, 0.188), (0.072, 0.020, 0.034), m_obs, bevel=0.005, bevel_segs=2)

    # Tucked magnetic aero-fin hands bridged by cyan energy struts
    b.set_pivot("Arm_L", -0.365, 0.60, 0.03)
    b.set_pivot("Arm_R", 0.365, 0.60, 0.03)
    for grp, s in (("Arm_L", -1), ("Arm_R", 1)):
        b.cyl(grp, (s * 0.295, 0.60, 0.03), 0.024, 0.13, 0.024, m_glow, rot=(0, 0, math.pi * 0.5), segs=12)
        b.pill(grp, (s * 0.365, 0.51, 0.03), (0.095, 0.22, 0.11), m_alu, subsurf=1)
        b.sphere(grp, (s * 0.365, 0.63, 0.03), (0.056, 0.056, 0.056), m_glow, subdivisions=1, subsurf=0)

    # Grounded magnetic levitation base disc (intentionally separated beneath levitating arch)
    b.set_pivot("Leg_L", 0, 0.04, 0)
    b.allow_float(b.cyl("Leg_L", (0, 0.025, 0), 0.52, 0.05, 0.52, m_alu, segs=28, bevel=0.010))
    b.allow_float(b.cyl("Leg_L", (0, 0.054, 0), 0.36, 0.016, 0.36, m_ti, segs=24, bevel=0.004))

    # Hovering glowing anti-grav thruster rings (intentionally levitating)
    b.set_pivot("Accessory", 0, 0.14, 0)
    b.allow_float(b.torus("Accessory", (0, 0.14, 0), 0.22, 0.026, m_glow, maj_segs=28, min_segs=10))
    b.allow_float(b.torus("Accessory", (0, 0.10, 0), 0.16, 0.016, m_crys, maj_segs=24, min_segs=8))


def build_opencode(b: FigurineBuilder):
    """8. OpenCode — Dieter-Rams matte-obsidian architectural nested-frame monolith + glowing aluminum core"""
    c_main = hex_rgb("#2a2c32")
    c_sec = hex_rgb("#0a0a0a")
    m_shell = b.mats.get("Vinyl", "oc_frame", c_main)
    m_sec = b.mats.get("Vinyl", "oc_back", c_sec)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_halo = b.mats.get("Emissive", "oc_halo", (0.85, 0.94, 1.0), emissive_srgb=(0.55, 0.85, 1.0), emission_strength=1.6)
    m_dot = b.mats.get("Emissive", "oc_orange", (1.0, 0.42, 0.12), emissive_srgb=(1.0, 0.42, 0.12), emission_strength=2.4)

    b.set_pivot("Body", 0, 0.60, 0)
    # 4 crisp precision-beveled architectural frame members + rear backing
    b.box("Body", (0, 0.88, 0), (0.72, 0.13, 0.42), m_shell, bevel=0.018, bevel_segs=3)
    b.box("Body", (0, 0.32, 0), (0.72, 0.13, 0.42), m_shell, bevel=0.018, bevel_segs=3)
    b.box("Body", (-0.295, 0.60, 0), (0.13, 0.56, 0.42), m_shell, bevel=0.018, bevel_segs=3)
    b.box("Body", (0.295, 0.60, 0), (0.13, 0.56, 0.42), m_shell, bevel=0.018, bevel_segs=3)
    b.box("Body", (0, 0.60, -0.14), (0.56, 0.52, 0.14), m_sec, bevel=0.012, bevel_segs=2)

    # Recessed brushed-aluminum inner monolith core + LED halo
    b.box("Body", (0, 0.60, 0.02), (0.36, 0.40, 0.24), m_alu, bevel=0.018, bevel_segs=3)
    b.box("Body", (0, 0.60, -0.02), (0.42, 0.45, 0.04), m_halo, bevel=0.008, bevel_segs=2)
    # Braun signal-orange micro-dot
    b.set_pivot("Accessory", -0.285, 0.88, 0.218)
    b.cyl("Accessory", (-0.285, 0.88, 0.218), 0.048, 0.018, 0.048, m_dot, rot=(math.pi * 0.5, 0, 0), segs=16)

    # Minimalist recessed obsidian eyes + catchlights + mouth bar
    ez = 0.148
    b.add_eyes("Body", 0.082, 0.645, ez, w=0.056, h=0.105, d=0.024)
    b.box("Body", (0, 0.535, ez), (0.095, 0.018, 0.016), m_ti, bevel=0.004, bevel_segs=2)

    b.add_standard_arms(0.395, 0.58, 0.105, 0.30, 0.12, m_ti, cuff_mat=m_alu, blocky=True)
    b.add_twin_boots(0.17, 0.29, 0.15, 0.18, m_shell)


def build_qwen(b: FigurineBuilder):
    """9. Qwen Code — Origami-faceted sapphire hexagonal prism + 3 silver-trimmed triad ribbons + crystal jewel"""
    c_main = hex_rgb("#4768ff")
    c_sec = hex_rgb("#082dff")
    m_shell = b.mats.get("Ceramic", "qwen_main", c_main)
    m_mid = b.mats.get("Ceramic", "qwen_mid", mix_rgb(c_main, c_sec, 0.45))
    m_sec = b.mats.get("Ceramic", "qwen_sec", c_sec)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_face = b.mats.get("Ceramic", "qwen_face", COL_PORCELAIN)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_crys = b.mats.get("Crystal", "qwen_jewel", (0.55, 0.78, 1.0), alpha=0.84, emissive_srgb=(0.22, 0.55, 1.0), emission_strength=1.2)

    b.set_pivot("Body", 0, 0.62, 0)
    # True 6-sided sapphire hexagonal prism
    b.cyl("Body", (0, 0.62, 0), 0.64, 0.36, 0.64, m_shell, rot=(math.pi * 0.5, 0, 0), segs=6, bevel=0.018)
    # 3 interlocking sculptural origami ribbon-facets at 120 deg + silver trim
    mats_triad = (m_shell, m_mid, m_sec)
    for i in range(3):
        a = (i * math.pi * 2.0) / 3.0 + math.pi / 6.0
        rx = math.cos(a) * 0.20
        ry = 0.62 + math.sin(a) * 0.20
        b.box("Body", (rx, ry, 0.02), (0.46, 0.15, 0.38), mats_triad[i], rot=(0, 0, a + math.pi * 0.5), bevel=0.016, bevel_segs=2)
        b.box("Body", (rx * 1.16, 0.62 + math.sin(a) * 0.232, 0.03), (0.42, 0.028, 0.40), m_alu, rot=(0, 0, a + math.pi * 0.5), bevel=0.006, bevel_segs=2)

    # Crown crystal facet jewel
    b.set_pivot("Accessory", 0, 0.96, 0)
    b.octa("Accessory", (0, 0.96, 0), (0.17, 0.16, 0.17), m_crys, bevel=0.010)

    # Porcelain face medallion cleanly proud of origami trim
    fz = 0.228
    b.cyl("Body", (0, 0.62, fz - 0.010), 0.34, 0.044, 0.34, m_alu, rot=(math.pi * 0.5, 0, 0), segs=24)
    b.cyl("Body", (0, 0.62, fz + 0.004), 0.30, 0.042, 0.30, m_face, rot=(math.pi * 0.5, 0, 0), segs=24)
    b.add_eyes("Body", 0.068, 0.645, fz + 0.032, w=0.048, h=0.072, d=0.024)
    b.box("Body", (0, 0.568, fz + 0.028), (0.080, 0.020, 0.016), m_obs, bevel=0.004, bevel_segs=2)

    b.add_standard_arms(0.38, 0.56, 0.115, 0.30, 0.12, m_shell, cuff_mat=m_alu, blocky=True)
    b.add_twin_boots(0.16, 0.29, 0.135, 0.155, m_sec)


def build_kimi(b: FigurineBuilder):
    """10. Kimi Code — Midnight-ceramic silhouette + glowing 'K' chest emblem + orbiting pearl moon-orb"""
    c_main = hex_rgb("#303242")
    c_sec = hex_rgb("#0b0b12")
    m_shell = b.mats.get("Ceramic", "kimi_main", c_main)
    m_sec = b.mats.get("Ceramic", "kimi_sec", c_sec)
    m_obs = b.mats.get("Obsidian", "kimi_visor", COL_OBSIDIAN)
    m_alu = b.mats.get("Aluminum", "kimi_k", COL_ALUMINUM, emissive_srgb=(0.45, 0.55, 0.85), emission_strength=0.6)
    m_eye = b.mats.get("Emissive", "kimi_eye", (0.92, 0.96, 1.0), emissive_srgb=(0.85, 0.95, 1.0), emission_strength=2.2)
    m_moon = b.mats.get("Ceramic", "kimi_moon", (0.98, 0.96, 0.92), emissive_srgb=(0.95, 0.92, 0.85), emission_strength=0.9)
    m_ring = b.mats.get("Emissive", "kimi_ring", (0.95, 0.94, 1.0), emissive_srgb=(0.75, 0.82, 1.0), emission_strength=1.5)

    b.set_pivot("Body", 0, 0.60, 0)
    b.pill("Body", (0, 0.58, 0), (0.64, 0.60, 0.44), m_shell, subsurf=1)
    b.sphere("Body", (0, 0.85, 0), (0.58, 0.32, 0.42), m_sec, subdivisions=2, subsurf=1)

    # Dark brow visor + luminous eyes deeply embedded into visor & brow (zero side-view gap)
    vz = 0.192
    b.pill("Body", (0, 0.74, vz), (0.42, 0.15, 0.095), m_obs, subsurf=1)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.095, 0.74, vz + 0.038), (0.044, 0.062, 0.040), m_eye, subdivisions=2, subsurf=0)

    # Embossed angular 'K' chest emblem deeply seated into chest curvature
    kz = 0.204
    b.box("Body", (-0.075, 0.52, kz), (0.048, 0.26, 0.062), m_alu, bevel=0.006, bevel_segs=2)
    b.box("Body", (0.025, 0.58, kz), (0.046, 0.19, 0.062), m_alu, rot=(0, 0, -0.78), bevel=0.006, bevel_segs=2)
    b.box("Body", (0.035, 0.46, kz), (0.046, 0.19, 0.062), m_alu, rot=(0, 0, 0.76), bevel=0.006, bevel_segs=2)

    # Orbiting pearl moon-orb + tilted halo ring (intentionally orbiting)
    b.set_pivot("Accessory", 0.36, 0.95, 0.06)
    b.allow_float(b.sphere("Accessory", (0.36, 0.95, 0.06), (0.19, 0.19, 0.19), m_moon, subdivisions=2, subsurf=1))
    b.allow_float(b.torus("Accessory", (0.36, 0.95, 0.06), 0.135, 0.011, m_ring, rot=(0.65, 0.2, 0.3), maj_segs=24, min_segs=8))

    b.add_standard_arms(0.355, 0.56, 0.11, 0.30, 0.12, m_shell, cuff_mat=m_alu)
    b.add_twin_boots(0.16, 0.29, 0.135, 0.155, m_sec)


def build_goose(b: FigurineBuilder):
    """11. Goose — Smooth S-curved NURBS neck + plump pear vinyl body + hugging curved wings + seated legs"""
    c_white = hex_rgb("#e8e4dc")
    c_char = hex_rgb("#2b2a28")
    c_orange = (0.95, 0.46, 0.17)
    m_white = b.mats.get("Vinyl", "goose_white", c_white)
    m_char = b.mats.get("Vinyl", "goose_charcoal", c_char)
    m_orange = b.mats.get("Vinyl", "goose_orange", c_orange)
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)

    b.set_pivot("Body", 0, 0.56, 0)
    # Plump pear-shaped organic goose body + graceful tapered S-curved NURBS neck + sculpted head
    b.sphere("Body", (0, 0.45, -0.02), (0.58, 0.48, 0.62), m_white, subdivisions=2, subsurf=1)
    neck_pts = [
        (0.0, 0.52, 0.04, 0.155),
        (0.0, 0.66, 0.09, 0.108),
        (0.0, 0.80, 0.04, 0.096),
        (0.0, 0.90, 0.08, 0.118),
    ]
    b.curve_tube("Body", neck_pts, m_white, bevel_res=6, res_u=14)
    b.sphere("Body", (0, 0.91, 0.09), (0.31, 0.28, 0.32), m_white, subdivisions=2, subsurf=1)

    # Matte-orange sculpted goose beak + cute charcoal tail tuft
    b.pill("Body", (0, 0.885, 0.265), (0.145, 0.078, 0.185), m_orange, subsurf=1)
    b.cone("Body", (0, 0.51, -0.34), 0.18, 0.22, 0.03, m_char, rot=(-0.95, 0, 0), segs=18)

    # Glossy jet-black obsidian bead eyes + embedded catchlights
    b.add_eyes("Body", 0.092, 0.942, 0.208, w=0.056, h=0.066, d=0.048, round_eyes=True)

    # Centered coral-orange & brushed-brass studio bowtie seated cleanly onto neck
    b.set_pivot("Accessory", 0, 0.66, 0.184)
    b.box("Accessory", (-0.050, 0.66, 0.180), (0.088, 0.054, 0.052), m_orange, rot=(0, 0, 0.22), bevel=0.008, bevel_segs=2)
    b.box("Accessory", (0.050, 0.66, 0.180), (0.088, 0.054, 0.052), m_orange, rot=(0, 0, -0.22), bevel=0.008, bevel_segs=2)
    b.sphere("Accessory", (0, 0.66, 0.196), (0.046, 0.046, 0.054), m_brass, subdivisions=1, subsurf=0)

    # Sculpted curved feather-taper charcoal wings hugging the plump flanks (zero boxy top edge!)
    b.set_pivot("Arm_L", -0.245, 0.50, -0.04)
    b.set_pivot("Arm_R", 0.245, 0.50, -0.04)
    for grp, s in (("Arm_L", -1), ("Arm_R", 1)):
        wing_pts = [
            (s * 0.225, 0.52, -0.01, 0.058),
            (s * 0.285, 0.46, -0.05, 0.088),
            (s * 0.275, 0.39, -0.13, 0.072),
            (s * 0.215, 0.35, -0.22, 0.032),
        ]
        b.curve_tube(grp, wing_pts, m_char, bevel_res=5, res_u=12)

    # Matte-orange goose legs seated solidly UP into lower belly + webbed feet flush on y = 0
    b.set_pivot("Leg_L", -0.14, 0.28, 0)
    b.set_pivot("Leg_R", 0.14, 0.28, 0)
    for grp, s in (("Leg_L", -1), ("Leg_R", 1)):
        b.cyl(grp, (s * 0.14, 0.19, 0), 0.082, 0.34, 0.082, m_orange, segs=16)
        b.box(grp, (s * 0.14, 0.022, 0.045), (0.17, 0.044, 0.21), m_orange, bevel=0.012, bevel_segs=2)


def build_copilot(b: FigurineBuilder):
    """12. GitHub Copilot CLI — Domed aviator helmet + compact dark torso collar + contoured goggles + seated legs"""
    c_main = hex_rgb("#454d58")
    c_sec = hex_rgb("#1b2028")
    m_shell = b.mats.get("Vinyl", "cop_helmet", c_main)
    m_sec = b.mats.get("Vinyl", "cop_boots", c_sec)
    m_ti = b.mats.get("Titanium", "ti", COL_TITANIUM)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_obs = b.mats.get("Obsidian", "cop_visor", COL_OBSIDIAN)
    m_lens = b.mats.get("Ceramic", "cop_lens", (0.06, 0.11, 0.18), emissive_srgb=(0.04, 0.14, 0.22), emission_strength=0.4)
    m_led = b.mats.get("Emissive", "cop_cyan", (0.55, 0.95, 1.0), emissive_srgb=(0.28, 0.90, 1.0), emission_strength=2.8)

    b.set_pivot("Body", 0, 0.62, 0)
    # Compact dark aviator jacket torso bridging helmet down into seated legs!
    b.pill("Body", (0, 0.38, 0), (0.52, 0.24, 0.38), m_sec, subsurf=1)
    b.cyl("Body", (0, 0.49, 0), 0.44, 0.06, 0.34, m_ti, segs=22)
    # Smooth aviator helmet dome + compact upper body
    b.pill("Body", (0, 0.68, 0), (0.74, 0.56, 0.56), m_shell, subsurf=1)
    b.sphere("Body", (0, 0.85, 0), (0.68, 0.34, 0.52), m_shell, subdivisions=2, subsurf=1)
    b.box("Body", (0, 1.01, 0), (0.10, 0.036, 0.44), m_alu, bevel=0.010, bevel_segs=2)

    # Oversized contoured pilot goggles mounted on upper brow
    gz = 0.278
    b.set_pivot("Accessory", 0, 0.82, gz)
    for s in (-1, 1):
        b.pill("Accessory", (s * 0.165, 0.815, gz - 0.015), (0.27, 0.22, 0.10), m_ti, rot=(0, -s * 0.14, 0), subsurf=1)
        b.pill("Accessory", (s * 0.165, 0.815, gz + 0.025), (0.215, 0.165, 0.068), m_lens, rot=(0, -s * 0.14, 0), subsurf=1)
    b.box("Accessory", (0, 0.82, gz), (0.11, 0.06, 0.08), m_ti, bevel=0.012, bevel_segs=2)

    # Deep recessed lower visor faceplate + twin glowing cyan pill LED eyes
    b.pill("Body", (0, 0.58, 0.245), (0.52, 0.24, 0.11), m_obs, subsurf=1)
    for s in (-1, 1):
        b.pill("Body", (s * 0.105, 0.585, 0.304), (0.058, 0.115, 0.026), m_led, subsurf=1)

    # Aviator ear cups on both sides
    for s in (-1, 1):
        b.cyl("Body", (s * 0.395, 0.69, 0), 0.26, 0.10, 0.26, m_ti, rot=(0, 0, math.pi * 0.5), segs=22)
        b.cyl("Body", (s * 0.44, 0.69, 0), 0.17, 0.042, 0.17, m_alu, rot=(0, 0, math.pi * 0.5), segs=20)

    b.add_standard_arms(0.325, 0.44, 0.115, 0.26, 0.125, m_shell, cuff_mat=m_ti)
    b.add_twin_boots(0.165, 0.30, 0.145, 0.165, m_sec, top_reach=0.40)


# ═════════════════════════════════════════════════════════════════════════════
# 13 OFFICIAL ROLE / PERSONA FIGURINE SCULPTORS
# ═════════════════════════════════════════════════════════════════════════════


def build_role_gong(b: FigurineBuilder):
    """13. role-gong — 共字君 (Signature Gonggong Flagship Mascot + Floating Jade Diamond)"""
    c_pri = hex_rgb("#2f6bff")
    c_sec = hex_rgb("#0fa3a0")
    m_pri = b.mats.get("Vinyl", "gong_cobalt", c_pri)
    m_sec = b.mats.get("Vinyl", "gong_jade", c_sec)
    m_mid = b.mats.get("Vinyl", "gong_pillar", mix_rgb(c_pri, c_sec, 0.32))
    m_por = b.mats.get("Ceramic", "porcelain", COL_PORCELAIN)
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_jade = b.mats.get("Crystal", "gong_jade_gem", (0.32, 0.90, 0.88), alpha=0.86, emissive_srgb=(0.08, 0.55, 0.68), emission_strength=0.8)
    m_blush = b.mats.get("Ceramic", "blush", (1.0, 0.56, 0.69))
    m_obs = b.mats.get("Obsidian", "mouth", (0.10, 0.14, 0.24))

    b.set_pivot("Body", 0, 0.52, 0)
    # Recessed warm-porcelain inner face core
    b.pill("Body", (0, 0.51, 0), (0.44, 0.42, 0.34), m_por, subsurf=1)
    # Twin vertical "共" pillars + brass finials
    for s in (-1, 1):
        b.pill("Body", (s * 0.215, 0.60, 0), (0.135, 0.56, 0.26), m_mid, subsurf=1)
        b.cyl("Body", (s * 0.215, 0.888, 0), 0.095, 0.028, 0.095, m_brass, segs=18)
    # Upper & lower horizontal "共" crossbars + brass architectural trim
    b.pill("Body", (0, 0.71, 0.01), (0.74, 0.125, 0.27), m_pri, subsurf=1)
    b.pill("Body", (0, 0.315, 0.01), (0.66, 0.125, 0.28), m_sec, subsurf=1)
    b.box("Body", (0, 0.372, 0.132), (0.38, 0.026, 0.056), m_brass, bevel=0.006, bevel_segs=2)
    b.box("Body", (0, 0.315, 0.146), (0.115, 0.072, 0.044), m_brass, bevel=0.008, bevel_segs=2)

    # Expressive eyes + blush + smile deeply seated into porcelain face core (zero gap)
    b.add_eyes("Body", 0.092, 0.52, 0.154, w=0.068, h=0.096, d=0.050)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.148, 0.458, 0.122), (0.052, 0.036, 0.052), m_blush, subdivisions=1, subsurf=0)
    b.pill("Body", (0, 0.432, 0.154), (0.082, 0.022, 0.042), m_obs, subsurf=1)

    # Floating Jade Diamond (玉珏) Crest (intentionally levitating)
    b.set_pivot("Accessory", 0, 0.97, 0)
    b.allow_float(b.octa("Accessory", (0, 0.97, 0), (0.15, 0.20, 0.15), m_jade, bevel=0.008))

    b.add_gloved_arms(0.365, 0.40, m_por, m_pri)

    # Splayed "八" character legs + porcelain/cobalt boots
    b.set_pivot("Leg_L", -0.145, 0.29, 0)
    b.set_pivot("Leg_R", 0.145, 0.29, 0)
    for grp, s in (("Leg_L", -1), ("Leg_R", 1)):
        b.pill(grp, (s * 0.19, 0.185, 0), (0.125, 0.24, 0.145), m_sec, rot=(0, 0, -s * 0.28), subsurf=1)
        b.pill(grp, (s * 0.227, 0.068, 0.03), (0.158, 0.105, 0.215), m_por, subsurf=1)
        b.box(grp, (s * 0.227, 0.014, 0.03), (0.164, 0.028, 0.222), m_pri, bevel=0.006, bevel_segs=2)


def build_role_hammock(b: FigurineBuilder):
    """14. role-hammock — 慢想 (True Curved Linen Hammock Cradle + Blue Glazed Head + Crystal Thinking Halo)"""
    c_pri = hex_rgb("#a3b5ff")
    c_sec = hex_rgb("#4b5fd6")
    m_pri = b.mats.get("Ceramic", "ham_head", c_pri)
    m_sec = b.mats.get("Vinyl", "ham_indigo", c_sec)
    m_linen = b.mats.get("Vinyl", "ham_linen", (0.91, 0.85, 0.75))
    m_wood = b.mats.get("Vinyl", "ham_wood", (0.64, 0.45, 0.28))
    m_white = b.mats.get("Ceramic", "white", COL_PORCELAIN)
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_crys = b.mats.get("Crystal", "ham_halo", (0.58, 0.72, 1.0), alpha=0.82, emissive_srgb=(0.28, 0.42, 1.0), emission_strength=0.9)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.16, 0.18, 0.24))

    b.set_pivot("Body", 0, 0.54, 0)
    # Smooth curved hammock sling + indigo base cushion bridging cleanly to boots + wooden spreader bars
    sling_pts = [
        (-0.28, 0.52, 0.0, 0.075),
        (-0.15, 0.37, 0.0, 0.095),
        (0.0, 0.33, 0.0, 0.105),
        (0.15, 0.37, 0.0, 0.095),
        (0.28, 0.52, 0.0, 0.075),
    ]
    b.curve_tube("Body", sling_pts, m_linen, bevel_res=5, res_u=12)
    b.pill("Body", (0, 0.31, 0.0), (0.38, 0.12, 0.24), m_sec, subsurf=1)
    b.pill("Body", (0, 0.34, 0.115), (0.40, 0.044, 0.068), m_sec, subsurf=1)
    # Clean neck collar bridging sling to head
    b.cyl("Body", (0, 0.43, 0), 0.24, 0.08, 0.22, m_sec, segs=18)
    for s in (-1, 1):
        b.cyl("Body", (s * 0.29, 0.525, 0), 0.042, 0.32, 0.042, m_wood, rot=(math.pi * 0.5, 0, 0), segs=14)
        b.torus("Body", (s * 0.315, 0.525, 0), 0.038, 0.009, m_brass, rot=(0, math.pi * 0.5, 0), maj_segs=16, min_segs=8)
        b.cone("Body", (s * 0.315, 0.445, 0), 0.055, 0.095, 0.01, m_sec, segs=12)

    # Plump glazed-blue spherical head + porcelain face medallion + half-lidded eyes seated cleanly into face
    b.sphere("Body", (0, 0.61, 0), (0.46, 0.44, 0.44), m_pri, subdivisions=2, subsurf=1)
    b.sphere("Body", (0, 0.60, 0.075), (0.37, 0.35, 0.34), m_white, subdivisions=2, subsurf=1)
    b.add_eyes("Body", 0.082, 0.612, 0.218, w=0.068, h=0.064, d=0.052)
    for s in (-1, 1):
        b.box("Body", (s * 0.082, 0.646, 0.208), (0.084, 0.024, 0.042), m_sec, bevel=0.006, bevel_segs=2)
    b.pill("Body", (0, 0.542, 0.212), (0.078, 0.020, 0.038), m_obs, subsurf=1)

    # Orbiting crystal thinking halo + 2 thought pearls (intentionally levitating)
    b.set_pivot("Accessory", 0.25, 0.89, 0.02)
    b.allow_float(b.torus("Accessory", (0.25, 0.89, 0.02), 0.11, 0.012, m_crys, rot=(0.55, 0.2, 0.25), maj_segs=22, min_segs=8))
    b.allow_float(b.sphere("Accessory", (0.25, 0.89, 0.02), (0.075, 0.075, 0.075), m_crys, subdivisions=2, subsurf=0))
    b.allow_float(b.sphere("Accessory", (0.14, 0.79, 0.04), (0.044, 0.044, 0.044), m_crys, subdivisions=1, subsurf=0))

    b.add_gloved_arms(0.285, 0.45, m_white, m_sec)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.145, hip_y=0.25, leg_h=0.11)


def build_role_braces(b: FigurineBuilder):
    """15. role-braces — 铁码 (Machined Brushed-Steel { } Side Armor + Chamfered Pixel Core)"""
    c_pri = hex_rgb("#a0a9b5")
    c_sec = hex_rgb("#39424f")
    m_steel = b.mats.get("Aluminum", "br_steel", c_pri)
    m_dark = b.mats.get("Titanium", "br_dark", c_sec)
    m_white = b.mats.get("Vinyl", "br_core", (0.93, 0.95, 0.97))

    b.set_pivot("Body", 0, 0.56, 0)
    b.box("Body", (0, 0.57, 0), (0.42, 0.44, 0.34), m_white, bevel=0.026, bevel_segs=3)
    b.box("Body", (0, 0.315, 0.04), (0.36, 0.042, 0.22), m_steel, bevel=0.008, bevel_segs=2)
    b.box("Body", (-0.04, 0.255, 0.04), (0.26, 0.042, 0.22), m_dark, bevel=0.008, bevel_segs=2)

    # Sculpted 3D machined brushed-steel { and } curly-brace side armor bridged cleanly to core
    b.set_pivot("Accessory", 0, 0.56, 0.01)
    for s in (-1, 1):
        bx = s * 0.295
        b.cyl("Accessory", (s * 0.24, 0.565, 0.01), 0.042, 0.12, 0.042, m_dark, rot=(0, 0, math.pi * 0.5), segs=12)
        b.box("Accessory", (bx, 0.67, 0.01), (0.055, 0.19, 0.18), m_steel, bevel=0.010, bevel_segs=2)
        b.box("Accessory", (bx, 0.46, 0.01), (0.055, 0.19, 0.18), m_steel, bevel=0.010, bevel_segs=2)
        b.box("Accessory", (bx - s * 0.045, 0.775, 0.01), (0.11, 0.052, 0.18), m_steel, bevel=0.010, bevel_segs=2)
        b.box("Accessory", (bx - s * 0.045, 0.355, 0.01), (0.11, 0.052, 0.18), m_steel, bevel=0.010, bevel_segs=2)
        b.box("Accessory", (bx + s * 0.048, 0.565, 0.01), (0.085, 0.085, 0.18), m_dark, rot=(0, 0, s * 0.78), bevel=0.010, bevel_segs=2)

    # Serious furrowed brows + square pixel eyes + flat mouth seated flush into face box (z_front = 0.170)
    b.add_eyes("Body", 0.095, 0.575, 0.172, w=0.074, h=0.074, d=0.032)
    b.box("Body", (-0.098, 0.652, 0.168), (0.105, 0.028, 0.028), m_dark, rot=(0, 0, -0.24), bevel=0.006, bevel_segs=2)
    b.box("Body", (0.098, 0.652, 0.168), (0.105, 0.028, 0.028), m_dark, rot=(0, 0, 0.24), bevel=0.006, bevel_segs=2)
    b.box("Body", (0, 0.475, 0.168), (0.125, 0.024, 0.026), m_dark, bevel=0.005, bevel_segs=2)

    b.add_gloved_arms(0.34, 0.48, m_steel, m_dark)
    b.add_gloved_boots(m_dark, m_dark, m_steel, spread=0.155, hip_y=0.25, leg_h=0.12)


def build_role_focus(b: FigurineBuilder):
    """16. role-focus — 闭关 (Contoured Audiophile Headphones + 3-Tier Illuminated Flamegraph Pedestal)"""
    c_pri = hex_rgb("#7a6dff")
    c_sec = hex_rgb("#23198a")
    m_pri = b.mats.get("Vinyl", "foc_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "foc_sec", c_sec)
    m_white = b.mats.get("Ceramic", "foc_head", (0.96, 0.96, 0.99))
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_ring = b.mats.get("Emissive", "foc_ring", c_pri, emissive_srgb=(0.55, 0.42, 1.0), emission_strength=2.2)
    m_fg1 = b.mats.get("Emissive", "fg_gold", (1.0, 0.85, 0.29), emissive_srgb=(1.0, 0.82, 0.22), emission_strength=1.8)
    m_fg2 = b.mats.get("Emissive", "fg_orange", (1.0, 0.64, 0.29), emissive_srgb=(1.0, 0.56, 0.20), emission_strength=1.9)
    m_fg3 = b.mats.get("Emissive", "fg_coral", (1.0, 0.42, 0.35), emissive_srgb=(1.0, 0.36, 0.28), emission_strength=2.0)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.12, 0.10, 0.24))

    b.set_pivot("Body", 0, 0.54, 0)
    b.pill("Body", (0, 0.62, 0), (0.44, 0.42, 0.38), m_white, subsurf=1)
    b.pill("Body", (0, 0.33, 0), (0.46, 0.21, 0.30), m_sec, subsurf=1)

    # 3-tier illuminated flamegraph bars contoured flush to curved chest (zero undercut/protrusion)
    b.box("Body", (0, 0.385, 0.106), (0.20, 0.038, 0.052), m_fg1, bevel=0.008, bevel_segs=2)
    b.box("Body", (0, 0.335, 0.114), (0.30, 0.038, 0.056), m_fg2, bevel=0.008, bevel_segs=2)
    b.box("Body", (0, 0.285, 0.094), (0.36, 0.038, 0.068), m_fg3, bevel=0.008, bevel_segs=2)

    # Focused eyes + brows + mouth seated flush (~0.010m proud) into curved head
    b.add_eyes("Body", 0.095, 0.615, 0.164, w=0.076, h=0.055, d=0.046)
    for s in (-1, 1):
        b.box("Body", (s * 0.095, 0.672, 0.148), (0.092, 0.024, 0.044), m_sec, bevel=0.005, bevel_segs=2)
    b.box("Body", (0, 0.522, 0.144), (0.075, 0.020, 0.042), m_obs, bevel=0.005, bevel_segs=2)

    # Contoured Audiophile Headphones (smooth NURBS arch band + brass swivels + glowing ear-cups)
    b.set_pivot("Accessory", 0, 0.72, 0)
    hb_pts = [
        (-0.26, 0.64, 0.0, 0.032),
        (-0.23, 0.80, 0.0, 0.036),
        (0.0, 0.87, 0.0, 0.042),
        (0.23, 0.80, 0.0, 0.036),
        (0.26, 0.64, 0.0, 0.032),
    ]
    b.curve_tube("Accessory", hb_pts, m_pri, bevel_res=5, res_u=12)
    for s in (-1, 1):
        b.cyl("Accessory", (s * 0.258, 0.64, 0), 0.072, 0.055, 0.072, m_brass, rot=(0, 0, math.pi * 0.5), segs=16)
        b.cyl("Accessory", (s * 0.268, 0.61, 0), 0.21, 0.095, 0.21, m_sec, rot=(0, 0, math.pi * 0.5), segs=22)
        b.torus("Accessory", (s * 0.315, 0.61, 0), 0.075, 0.012, m_ring, rot=(0, 0, math.pi * 0.5), maj_segs=20, min_segs=8)

    b.add_gloved_arms(0.30, 0.42, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.15, hip_y=0.25, leg_h=0.11)


def build_role_steps(b: FigurineBuilder):
    """17. role-steps — 小步 (Bouncy Emerald Figurine + 3-Step Terrace Blocks + Red/Green CI LED Orbs)"""
    c_pri = hex_rgb("#8be07a")
    c_sec = hex_rgb("#239a3c")
    m_pri = b.mats.get("Vinyl", "st_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "st_sec", c_sec)
    m_white = b.mats.get("Ceramic", "st_head", (0.97, 0.99, 0.97))
    m_green = b.mats.get("Emissive", "ci_green", (0.19, 0.82, 0.38), emissive_srgb=(0.20, 1.0, 0.45), emission_strength=2.2)
    m_red = b.mats.get("Emissive", "ci_red", (1.0, 0.37, 0.34), emissive_srgb=(1.0, 0.30, 0.25), emission_strength=2.2)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.12, 0.22, 0.14))

    b.set_pivot("Body", 0, 0.54, 0)
    b.pill("Body", (0, 0.36, 0), (0.42, 0.22, 0.28), m_sec, subsurf=1)
    b.cyl("Body", (0, 0.47, 0), 0.24, 0.08, 0.22, m_pri, segs=18)
    b.pill("Body", (0, 0.64, 0), (0.44, 0.39, 0.36), m_white, subsurf=1)
    b.pill("Body", (0, 0.835, 0), (0.26, 0.078, 0.20), m_pri, subsurf=1)
    b.add_eyes("Body", 0.095, 0.665, 0.160, w=0.072, h=0.072, d=0.050)
    b.pill("Body", (0, 0.565, 0.160), (0.13, 0.052, 0.046), m_obs, subsurf=1)

    # 3-step terrace belt + CI status orbs seated cleanly onto terrace tops
    b.set_pivot("Accessory", 0, 0.34, 0.06)
    steps = [
        (-0.175, 0.28, 0.16, 0.09, m_sec, m_green),
        (0.0, 0.33, 0.17, 0.14, m_pri, m_green),
        (0.175, 0.38, 0.16, 0.19, m_sec, m_red),
    ]
    for sx, sy, sw, sh, smat, lmat in steps:
        b.box("Accessory", (sx, sy, 0.03), (sw, sh, 0.24), smat, bevel=0.014, bevel_segs=2)
        b.sphere("Accessory", (sx, sy + sh * 0.5 + 0.020, 0.115), (0.064, 0.064, 0.064), lmat, subdivisions=2, subsurf=0)

    b.add_gloved_arms(0.285, 0.52, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.155, hip_y=0.25, leg_h=0.10)


def build_role_blank(b: FigurineBuilder):
    """18. role-blank — 留白 (Minimalist Gallery Porcelain Sphere + Floating Rose-Gold Crop-Mark Frame)"""
    c_pri = hex_rgb("#ffc3d6")
    c_sec = hex_rgb("#d8578a")
    m_por = b.mats.get("Ceramic", "bl_por", (0.985, 0.975, 0.98))
    m_pri = b.mats.get("Vinyl", "bl_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "bl_sec", c_sec)
    m_rgold = b.mats.get("Brass", "bl_rosegold", (0.92, 0.72, 0.74))
    m_blush = b.mats.get("Ceramic", "bl_dot", (1.0, 0.62, 0.75))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)

    b.set_pivot("Body", 0, 0.56, 0)
    b.sphere("Body", (0, 0.58, 0), (0.48, 0.48, 0.46), m_por, subdivisions=2, subsurf=1)
    b.cyl("Body", (0, 0.345, 0), 0.24, 0.065, 0.24, m_pri, segs=22)

    b.add_eyes("Body", 0.088, 0.60, 0.198, w=0.050, h=0.050, d=0.046, round_eyes=True)
    b.pill("Body", (0, 0.522, 0.202), (0.072, 0.018, 0.040), m_obs, subsurf=1)
    b.sphere("Body", (0.125, 0.536, 0.180), (0.038, 0.038, 0.044), m_blush, subdivisions=1, subsurf=0)

    # 4 Floating Rose-Gold Architectural Corner Crop-Mark Brackets (intentionally levitating gallery frame)
    b.set_pivot("Accessory", 0, 0.58, 0.04)
    sp = 0.31
    for cx, cy in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
        px, py = cx * sp, 0.58 + cy * sp
        b.allow_float(b.box("Accessory", (px - cx * 0.048, py, 0.04), (0.115, 0.026, 0.028), m_rgold, bevel=0.005, bevel_segs=2))
        b.allow_float(b.box("Accessory", (px, py - cy * 0.048, 0.04), (0.026, 0.115, 0.028), m_rgold, bevel=0.005, bevel_segs=2))

    b.add_gloved_arms(0.28, 0.48, m_por, m_pri)
    b.add_gloved_boots(m_pri, m_sec, m_por, spread=0.135, hip_y=0.25, leg_h=0.13)


def build_role_no(b: FigurineBuilder):
    """19. role-no — 说不 (Decisive Amber Head + Checklist Clipboard Shield with Red Strikes & Green Check)"""
    c_pri = hex_rgb("#ffcf40")
    c_sec = hex_rgb("#ec7300")
    m_pri = b.mats.get("Vinyl", "no_amber", c_pri)
    m_sec = b.mats.get("Vinyl", "no_orange", c_sec)
    m_white = b.mats.get("Ceramic", "no_sheet", (0.98, 0.97, 0.95))
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_red = b.mats.get("Emissive", "no_red", (1.0, 0.34, 0.32), emissive_srgb=(1.0, 0.28, 0.25), emission_strength=2.2)
    m_green = b.mats.get("Emissive", "no_green", (0.19, 0.82, 0.38), emissive_srgb=(0.20, 1.0, 0.45), emission_strength=2.2)
    m_gray = b.mats.get("Vinyl", "no_gray", (0.68, 0.70, 0.74))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.22, 0.14, 0.08))

    b.set_pivot("Body", 0, 0.56, 0)
    b.sphere("Body", (0, 0.74, 0), (0.36, 0.35, 0.34), m_pri, subdivisions=2, subsurf=1)
    b.sphere("Body", (0, 0.74, 0.06), (0.29, 0.28, 0.27), m_white, subdivisions=2, subsurf=1)
    b.add_eyes("Body", 0.068, 0.745, 0.174, w=0.052, h=0.062, d=0.044)
    for s in (-1, 1):
        b.box("Body", (s * 0.068, 0.798, 0.162), (0.072, 0.020, 0.040), m_sec, bevel=0.005, bevel_segs=2)
    b.box("Body", (0, 0.675, 0.158), (0.082, 0.020, 0.038), m_obs, bevel=0.005, bevel_segs=2)

    # Checklist Clipboard Torso Shield
    b.box("Body", (0, 0.43, 0.02), (0.44, 0.37, 0.24), m_sec, bevel=0.022, bevel_segs=3)
    b.box("Body", (0, 0.43, 0.138), (0.38, 0.32, 0.045), m_white, bevel=0.008, bevel_segs=2)
    b.box("Body", (0, 0.605, 0.158), (0.14, 0.042, 0.036), m_brass, bevel=0.006, bevel_segs=2)

    # Checklist strikes + glowing emerald checkmark embedded into clipboard sheet
    b.set_pivot("Accessory", 0, 0.43, 0.158)
    lz = 0.158
    b.box("Accessory", (-0.02, 0.515, lz), (0.26, 0.026, 0.030), m_red, bevel=0.004, bevel_segs=2)
    b.box("Accessory", (-0.04, 0.432, lz), (0.18, 0.026, 0.028), m_gray, bevel=0.004, bevel_segs=2)
    b.box("Accessory", (-0.02, 0.350, lz), (0.25, 0.026, 0.030), m_red, bevel=0.004, bevel_segs=2)
    b.box("Accessory", (0.085, 0.426, lz + 0.004), (0.055, 0.022, 0.032), m_green, rot=(0, 0, -0.72), bevel=0.004, bevel_segs=2)
    b.box("Accessory", (0.128, 0.446, lz + 0.004), (0.092, 0.022, 0.032), m_green, rot=(0, 0, 0.78), bevel=0.004, bevel_segs=2)

    b.add_gloved_arms(0.285, 0.46, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.15, hip_y=0.25, leg_h=0.10)


def build_role_abacus(b: FigurineBuilder):
    """20. role-abacus — 算盘 (Cerulean Scholar + Brass Spectacles + Coral/Jade/Walnut Brass Abacus Crown)"""
    c_pri = hex_rgb("#5fdcf0")
    c_sec = hex_rgb("#0a82a8")
    m_pri = b.mats.get("Vinyl", "ab_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "ab_sec", c_sec)
    m_white = b.mats.get("Ceramic", "ab_head", (0.96, 0.985, 0.995))
    m_brass = b.mats.get("Brass", "ab_brass", (0.90, 0.70, 0.28))
    m_coral = b.mats.get("Vinyl", "ab_coral", (0.78, 0.12, 0.08))
    m_jade = b.mats.get("Vinyl", "ab_jade", (0.04, 0.42, 0.28))
    m_walnut = b.mats.get("Vinyl", "ab_walnut", (0.24, 0.11, 0.05))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.10, 0.22, 0.28))

    b.set_pivot("Body", 0, 0.56, 0)
    b.pill("Body", (0, 0.345, 0), (0.38, 0.21, 0.28), m_sec, subsurf=1)
    b.cyl("Body", (0, 0.44, 0), 0.24, 0.08, 0.22, m_pri, segs=18)
    b.sphere("Body", (0, 0.58, 0), (0.45, 0.44, 0.43), m_white, subdivisions=2, subsurf=1)
    b.add_eyes("Body", 0.095, 0.595, 0.186, w=0.058, h=0.068, d=0.048)
    # Round brushed-brass scholar spectacles seated onto face with temple arms bridging cleanly into head sides
    gz = 0.208
    for s in (-1, 1):
        b.torus("Body", (s * 0.095, 0.595, gz), 0.074, 0.011, m_brass, rot=(math.pi * 0.5, 0, 0), maj_segs=20, min_segs=8)
        b.cyl("Body", (s * 0.168, 0.595, gz - 0.058), 0.014, 0.125, 0.014, m_brass, rot=(math.pi * 0.5, 0, 0), segs=10)
    b.cyl("Body", (0, 0.595, gz), 0.018, 0.056, 0.018, m_brass, rot=(0, 0, math.pi * 0.5), segs=12)
    b.box("Body", (0, 0.482, 0.166), (0.075, 0.020, 0.042), m_obs, bevel=0.004, bevel_segs=2)

    # Museum-grade 3D Brushed-Brass Abacus Crown with coral/jade/walnut beads
    ab_y = 0.895
    b.set_pivot("Accessory", 0, ab_y, 0)
    b.box("Accessory", (0, ab_y + 0.098, 0), (0.58, 0.030, 0.068), m_brass, bevel=0.006, bevel_segs=2)
    b.box("Accessory", (0, ab_y - 0.098, 0), (0.58, 0.030, 0.068), m_brass, bevel=0.006, bevel_segs=2)
    b.box("Accessory", (0, ab_y + 0.012, 0), (0.54, 0.024, 0.056), m_brass, bevel=0.005, bevel_segs=2)
    for s in (-1, 1):
        b.box("Accessory", (s * 0.275, ab_y, 0), (0.036, 0.22, 0.068), m_brass, bevel=0.006, bevel_segs=2)
    b.cyl("Accessory", (0, ab_y + 0.055, 0), 0.018, 0.52, 0.018, m_brass, rot=(0, 0, math.pi * 0.5), segs=12)
    b.cyl("Accessory", (0, ab_y - 0.044, 0), 0.018, 0.52, 0.018, m_brass, rot=(0, 0, math.pi * 0.5), segs=12)
    for bx, bmat in ((-0.15, m_coral), (0.01, m_jade), (0.18, m_walnut)):
        b.sphere("Accessory", (bx, ab_y + 0.055, 0), (0.072, 0.072, 0.072), bmat, subdivisions=2, subsurf=0)
    for bx, bmat in ((-0.18, m_walnut), (-0.09, m_coral), (0.08, m_jade), (0.19, m_coral)):
        b.sphere("Accessory", (bx, ab_y - 0.044, 0), (0.072, 0.080, 0.072), bmat, subdivisions=2, subsurf=0)

    b.add_gloved_arms(0.275, 0.44, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.145, hip_y=0.25, leg_h=0.11)


def build_role_invert(b: FigurineBuilder):
    """21. role-invert — 反推 (Jade Guardian + Lathed Crystal & Golden-Sand Hourglass)"""
    c_pri = hex_rgb("#57d6b8")
    c_sec = hex_rgb("#0b7d68")
    m_pri = b.mats.get("Vinyl", "inv_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "inv_sec", c_sec)
    m_white = b.mats.get("Ceramic", "inv_head", (0.96, 0.99, 0.98))
    m_brass = b.mats.get("Brass", "brass", COL_BRASS)
    m_crys = b.mats.get("Crystal", "inv_glass", (0.85, 0.98, 0.96), alpha=0.76, emissive_srgb=(0.10, 0.45, 0.42), emission_strength=0.6)
    m_sand = b.mats.get("Emissive", "inv_sand", (1.0, 0.85, 0.29), emissive_srgb=(1.0, 0.82, 0.18), emission_strength=1.8)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.06, 0.22, 0.18))

    b.set_pivot("Body", -0.02, 0.56, 0)
    b.pill("Body", (-0.02, 0.345, 0), (0.40, 0.21, 0.30), m_sec, subsurf=1)
    b.pill("Body", (-0.03, 0.60, 0), (0.44, 0.41, 0.36), m_white, subsurf=1)
    b.pill("Body", (-0.03, 0.60, -0.03), (0.48, 0.45, 0.32), m_pri, subsurf=1)

    # Thoughtful angled brows + vigilant eyes + wavy mouth seated flush (~0.011m proud) into curved head
    b.add_eyes("Body", 0.088, 0.605, 0.158, w=0.064, h=0.078, d=0.046, x_offset=-0.03)
    b.box("Body", (-0.125, 0.678, 0.138), (0.095, 0.022, 0.042), m_sec, rot=(0, 0, 0.32), bevel=0.005, bevel_segs=2)
    b.box("Body", (0.065, 0.678, 0.138), (0.095, 0.022, 0.042), m_sec, rot=(0, 0, -0.32), bevel=0.005, bevel_segs=2)
    b.pill("Body", (-0.03, 0.502, 0.138), (0.105, 0.020, 0.042), m_obs, rot=(0, 0, 0.10), subsurf=1)

    # Lathed 3D Crystal Hourglass with brass plates & golden sand seated cleanly inside glass
    hg_x, hg_y, hg_z = 0.33, 0.53, 0.06
    b.set_pivot("Accessory", hg_x, hg_y, hg_z)
    b.cyl("Accessory", (hg_x, hg_y + 0.155, hg_z), 0.165, 0.026, 0.165, m_brass, segs=20)
    b.cyl("Accessory", (hg_x, hg_y - 0.155, hg_z), 0.165, 0.026, 0.165, m_brass, segs=20)
    # True lathed hourglass glass profile!
    hg_prof = [
        (0.068, -0.142),
        (0.072, -0.095),
        (0.048, -0.038),
        (0.014, 0.0),
        (0.048, 0.038),
        (0.072, 0.095),
        (0.068, 0.142),
    ]
    b.lathe("Accessory", hg_prof, (hg_x, hg_y, hg_z), m_crys, segs=20)
    b.cone("Accessory", (hg_x, hg_y + 0.048, hg_z), 0.142, 0.120, 0.032, m_sand, rot=(math.pi, 0, 0), segs=16)
    b.cone("Accessory", (hg_x, hg_y - 0.112, hg_z), 0.112, 0.088, 0.008, m_sand, segs=16)

    b.add_gloved_arms(0.285, 0.44, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.15, hip_y=0.25, leg_h=0.11)


def build_role_sentry(b: FigurineBuilder):
    """22. role-sentry — 哨兵 (Domed Tactical Helmet + Sweeping Mint Radar Visor + Crimson Antenna Beacon)"""
    c_pri = hex_rgb("#56688a")
    c_sec = hex_rgb("#121a2a")
    m_helmet = b.mats.get("Ceramic", "sen_helmet", (0.94, 0.96, 0.99))
    m_dark = b.mats.get("Titanium", "sen_dark", c_sec)
    m_pri = b.mats.get("Vinyl", "sen_pri", c_pri)
    m_obs = b.mats.get("Obsidian", "sen_visor", (0.04, 0.06, 0.10))
    m_mint = b.mats.get("Emissive", "sen_mint", (0.49, 0.94, 0.77), emissive_srgb=(0.45, 1.0, 0.75), emission_strength=2.5)
    m_alu = b.mats.get("Aluminum", "alu", COL_ALUMINUM)
    m_beacon = b.mats.get("Emissive", "sen_beacon", (1.0, 0.35, 0.32), emissive_srgb=(1.0, 0.28, 0.24), emission_strength=2.8)

    b.set_pivot("Body", 0, 0.56, 0)
    b.box("Body", (0, 0.35, 0), (0.42, 0.22, 0.30), m_dark, bevel=0.022, bevel_segs=2)
    b.box("Body", (0, 0.36, 0.158), (0.24, 0.11, 0.030), m_pri, bevel=0.008, bevel_segs=2)

    # Domed tactical helmet
    b.sphere("Body", (0, 0.63, 0), (0.48, 0.44, 0.44), m_helmet, subdivisions=2, subsurf=1)
    b.cyl("Body", (0, 0.53, 0), 0.46, 0.20, 0.42, m_helmet, segs=24)

    # Deep recessed wrap-around radar visor + glowing mint scanner bar & blip embedded into visor
    vz = 0.194
    b.pill("Body", (0, 0.585, vz), (0.36, 0.145, 0.10), m_obs, subsurf=1)
    b.box("Body", (-0.04, 0.585, vz + 0.038), (0.034, 0.105, 0.036), m_mint, bevel=0.004, bevel_segs=2)
    b.sphere("Body", (0.085, 0.60, vz + 0.038), (0.034, 0.034, 0.038), m_mint, subdivisions=1, subsurf=0)

    # Metallic antenna mast + crimson alert beacon
    b.set_pivot("Accessory", 0, 0.92, 0)
    b.cyl("Accessory", (0, 0.89, 0), 0.026, 0.14, 0.026, m_alu, segs=14)
    b.sphere("Accessory", (0, 0.975, 0), (0.074, 0.074, 0.074), m_beacon, subdivisions=2, subsurf=0)

    b.add_gloved_arms(0.285, 0.43, m_helmet, m_dark)
    b.add_gloved_boots(m_dark, m_dark, m_pri, spread=0.155, hip_y=0.25, leg_h=0.12)


def build_role_spring(b: FigurineBuilder):
    """23. role-spring — 抗摔 (TRUE 3D HELICAL COIL SPRING + Band-Aid Cube Head + Sturdy Ankle Struts)"""
    c_pri = hex_rgb("#c08eff")
    c_sec = hex_rgb("#6a2bd6")
    m_pri = b.mats.get("Vinyl", "sp_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "sp_sec", c_sec)
    m_white = b.mats.get("Ceramic", "sp_head", (0.97, 0.96, 0.995))
    m_metal = b.mats.get("Aluminum", "sp_coil", (0.86, 0.84, 0.90))
    m_ba = b.mats.get("Vinyl", "sp_bandaid", (1.0, 0.85, 0.69))
    m_pad = b.mats.get("Vinyl", "sp_pad", (0.95, 0.72, 0.54))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.16, 0.09, 0.28))

    b.set_pivot("Body", 0, 0.68, 0)
    # Weighted amethyst saucer baseplate
    b.cyl("Body", (0, 0.24, 0), 0.40, 0.055, 0.36, m_sec, segs=24)

    # TRUE BLENDER 3D HELICAL COIL SPRING (continuous 4.25-turn NURBS helix!)
    helix_pts = []
    turns = 4.25
    steps = 26
    for i in range(steps + 1):
        f = i / steps
        ang = f * turns * 2.0 * math.pi
        hx = math.cos(ang) * 0.11
        hz = math.sin(ang) * 0.11
        hy = 0.265 + f * 0.265
        helix_pts.append((hx, hy, hz, 0.022))
    b.curve_tube("Body", helix_pts, m_metal, bevel_res=3, res_u=3)

    # Chamfered cube head + amethyst rear cap
    b.box("Body", (0, 0.72, 0), (0.42, 0.40, 0.38), m_white, bevel=0.032, bevel_segs=3)
    b.box("Body", (0, 0.72, -0.05), (0.44, 0.42, 0.32), m_pri, bevel=0.030, bevel_segs=3)

    # Iconic Diagonal Band-Aid seated cleanly into forehead (zero air gap!)
    b.set_pivot("Accessory", 0.115, 0.855, 0.190)
    b.pill("Accessory", (0.115, 0.855, 0.188), (0.16, 0.062, 0.036), m_ba, rot=(0, 0, -0.58), subsurf=1)
    b.box("Accessory", (0.115, 0.855, 0.196), (0.048, 0.058, 0.030), m_pad, rot=(0, 0, -0.58), bevel=0.004, bevel_segs=2)

    # Quizzical brows + glossy obsidian eyes + embedded catchlights + dry-humor smirk
    b.add_eyes("Body", 0.092, 0.728, 0.192, w=0.066, h=0.072, d=0.048)
    b.box("Body", (-0.095, 0.810, 0.192), (0.090, 0.024, 0.038), m_sec, rot=(0, 0, 0.24), bevel=0.005, bevel_segs=2)
    b.box("Body", (0.095, 0.802, 0.192), (0.084, 0.024, 0.038), m_sec, bevel=0.005, bevel_segs=2)
    b.pill("Body", (0.01, 0.632, 0.190), (0.105, 0.024, 0.038), m_obs, rot=(0, 0, 0.16), subsurf=1)

    b.add_gloved_arms(0.28, 0.65, m_white, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_sec, spread=0.145, hip_y=0.25, leg_h=0.16)


def build_role_compass(b: FigurineBuilder):
    """24. role-compass — 灰度 (Warm Bronze Explorer + True-North Brushed-Brass Compass Crown)"""
    c_pri = hex_rgb("#e8c089")
    c_sec = hex_rgb("#a26a2e")
    m_pri = b.mats.get("Vinyl", "cp_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "cp_sec", c_sec)
    m_cream = b.mats.get("Ceramic", "cp_cream", (0.98, 0.965, 0.935))
    m_brass = b.mats.get("Brass", "cp_brass", (0.88, 0.65, 0.24))
    m_navy = b.mats.get("Obsidian", "cp_dial", (0.10, 0.14, 0.22))
    m_north = b.mats.get("Ceramic", "cp_north", (0.90, 0.22, 0.20), emissive_srgb=(0.55, 0.10, 0.08), emission_strength=0.6)
    m_south = b.mats.get("Aluminum", "cp_south", (0.45, 0.55, 0.62))
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.24, 0.16, 0.08))

    b.set_pivot("Body", 0, 0.56, 0)
    b.pill("Body", (0, 0.345, 0), (0.40, 0.22, 0.30), m_sec, subsurf=1)
    b.cyl("Body", (0, 0.44, 0), 0.25, 0.08, 0.23, m_pri, segs=18)
    b.pill("Body", (0, 0.59, 0), (0.44, 0.40, 0.36), m_cream, subsurf=1)
    b.pill("Body", (0, 0.59, -0.04), (0.47, 0.43, 0.32), m_pri, subsurf=1)

    b.add_eyes("Body", 0.092, 0.605, 0.158, w=0.062, h=0.072, d=0.046)
    for s in (-1, 1):
        b.box("Body", (s * 0.092, 0.670, 0.136), (0.084, 0.022, 0.042), m_sec, bevel=0.005, bevel_segs=2)
    b.pill("Body", (0, 0.515, 0.138), (0.105, 0.020, 0.042), m_obs, subsurf=1)

    # Brushed-brass Compass Crown with N/E/S/W ticks & two-tone needle
    cp_y = 0.905
    b.set_pivot("Accessory", 0, cp_y, 0)
    b.cyl("Accessory", (0, cp_y - 0.115, 0), 0.048, 0.075, 0.048, m_brass, segs=14)
    b.cyl("Accessory", (0, cp_y, -0.010), 0.255, 0.026, 0.255, m_navy, rot=(math.pi * 0.5, 0, 0), segs=24)
    b.torus("Accessory", (0, cp_y, 0), 0.142, 0.022, m_brass, rot=(math.pi * 0.5, 0, 0), maj_segs=26, min_segs=10)
    for tx, ty, tw, th in ((0, 0.132, 0.024, 0.044), (0, -0.132, 0.024, 0.044), (0.132, 0, 0.044, 0.024), (-0.132, 0, 0.044, 0.024)):
        b.box("Accessory", (tx, cp_y + ty, 0.018), (tw, th, 0.024), m_brass, bevel=0.004, bevel_segs=2)
    b.cone("Accessory", (0, cp_y + 0.056, 0.018), 0.050, 0.108, 0.004, m_north, segs=12)
    b.cone("Accessory", (0, cp_y - 0.056, 0.018), 0.050, 0.108, 0.004, m_south, rot=(math.pi, 0, 0), segs=12)
    b.sphere("Accessory", (0, cp_y, 0.026), (0.046, 0.046, 0.046), m_brass, subdivisions=1, subsurf=0)

    b.add_gloved_arms(0.29, 0.44, m_cream, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.15, hip_y=0.25, leg_h=0.11)


def build_role_loop(b: FigurineBuilder):
    """25. role-loop — 复盘 (Radiant Coral-Ivory Sphere + Tilted Retro-Loop Arrow Halo + Sculpted Heart)"""
    c_pri = hex_rgb("#ff9270")
    c_sec = hex_rgb("#d8342c")
    m_pri = b.mats.get("Vinyl", "lp_pri", c_pri)
    m_sec = b.mats.get("Vinyl", "lp_sec", c_sec)
    m_ivory = b.mats.get("Ceramic", "lp_ivory", (1.0, 0.975, 0.96))
    m_blush = b.mats.get("Ceramic", "lp_blush", (1.0, 0.76, 0.69))
    m_crys = b.mats.get("Crystal", "lp_halo", c_pri, alpha=0.84, emissive_srgb=(1.0, 0.44, 0.30), emission_strength=0.9)
    m_heart = b.mats.get("Emissive", "lp_heart", (1.0, 0.36, 0.34), emissive_srgb=(1.0, 0.32, 0.28), emission_strength=2.0)
    m_obs = b.mats.get("Obsidian", "mouth", COL_OBSIDIAN)
    m_ti = b.mats.get("Titanium", "sole", (0.32, 0.10, 0.09))

    b.set_pivot("Body", 0, 0.56, 0)
    b.pill("Body", (0, 0.345, 0), (0.38, 0.20, 0.28), m_sec, subsurf=1)
    b.sphere("Body", (0, 0.58, 0), (0.45, 0.45, 0.44), m_ivory, subdivisions=2, subsurf=1)

    b.add_eyes("Body", 0.086, 0.60, 0.194, w=0.060, h=0.072, d=0.048, round_eyes=True)
    b.pill("Body", (0, 0.512, 0.196), (0.118, 0.048, 0.042), m_obs, subsurf=1)
    for s in (-1, 1):
        b.sphere("Body", (s * 0.135, 0.538, 0.166), (0.048, 0.036, 0.046), m_blush, subdivisions=1, subsurf=0)

    # Tilted Retro-Loop Halo + Directional Arrowhead + Beating Sculpted Heart (intentionally levitating orbit)
    b.set_pivot("Accessory", 0, 0.60, 0)
    b.allow_float(b.torus("Accessory", (0, 0.59, 0), 0.32, 0.016, m_crys, rot=(0.34, 0.0, -0.26), maj_segs=28, min_segs=8))
    b.allow_float(b.cone("Accessory", (0.31, 0.52, 0.02), 0.085, 0.14, 0.004, m_ivory, rot=(math.pi * 0.5, 0, -0.26), segs=14))
    # Sculpted 3D Heart upper-left
    hx, hy, hz = -0.27, 0.85, 0.06
    b.allow_float(b.sphere("Accessory", (hx - 0.032, hy + 0.024, hz), (0.072, 0.072, 0.064), m_heart, subdivisions=2, subsurf=0))
    b.allow_float(b.sphere("Accessory", (hx + 0.032, hy + 0.024, hz), (0.072, 0.072, 0.064), m_heart, subdivisions=2, subsurf=0))
    b.allow_float(b.cone("Accessory", (hx, hy - 0.028, hz), 0.112, 0.095, 0.006, m_heart, rot=(math.pi, 0, 0), segs=16))

    b.add_gloved_arms(0.275, 0.44, m_ivory, m_pri)
    b.add_gloved_boots(m_sec, m_ti, m_pri, spread=0.145, hip_y=0.25, leg_h=0.11)


# ═════════════════════════════════════════════════════════════════════════════
# Master Build Registry (All 25 Gonggong Figurines)
# ═════════════════════════════════════════════════════════════════════════════

BUILDERS = [
    ("claude", "agent", build_claude),
    ("codex", "agent", build_codex),
    ("gemini", "agent", build_gemini),
    ("codebuddy", "agent", build_codebuddy),
    ("pi", "agent", build_pi),
    ("deepseek", "agent", build_deepseek),
    ("antigravity", "agent", build_antigravity),
    ("opencode", "agent", build_opencode),
    ("qwen", "agent", build_qwen),
    ("kimi", "agent", build_kimi),
    ("goose", "agent", build_goose),
    ("copilot", "agent", build_copilot),
    ("role-gong", "role", build_role_gong),
    ("role-hammock", "role", build_role_hammock),
    ("role-braces", "role", build_role_braces),
    ("role-focus", "role", build_role_focus),
    ("role-steps", "role", build_role_steps),
    ("role-blank", "role", build_role_blank),
    ("role-no", "role", build_role_no),
    ("role-abacus", "role", build_role_abacus),
    ("role-invert", "role", build_role_invert),
    ("role-sentry", "role", build_role_sentry),
    ("role-spring", "role", build_role_spring),
    ("role-compass", "role", build_role_compass),
    ("role-loop", "role", build_role_loop),
]


def main():
    t0 = time.time()
    extra_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    audit_only = "--audit-only" in extra_args
    filter_keys = set(a for a in extra_args if not a.startswith("--")) or None
    manifest_path = os.path.join(MODELS_DIR, "manifest.json")
    existing = {}
    if filter_keys and os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            old = json.load(f)
            existing = old.get("figurines", {})

    figurines = dict(existing)
    total_defects = 0
    for key, category, fn in BUILDERS:
        if filter_keys and key not in filter_keys:
            continue
        clear_scene()
        builder = FigurineBuilder(key)
        fn(builder)
        out_path = os.path.join(MODELS_DIR, f"{key}.glb")
        info = builder.finalize_and_export(out_path, audit_only=audit_only)
        conn = info["connectivity"]
        total_defects += conn["defectCount"]
        if audit_only:
            status = "OK" if conn["defectCount"] == 0 else f"DEFECTS={conn['defectCount']}"
            print(
                f"[AUDIT] {key:14s} | parts={conn['totalParts']:2d} connected={conn['connectedParts']:2d} "
                f"allowedFloat={conn['allowedFloatingCount']:2d} | {status}"
            )
            for d in conn["defects"]:
                print(
                    f"   [GAP] {d['group']:9s} {d['name']:24s} ({d['material']:24s}) "
                    f"gap={d['gap_m']:.4f}m center={d['gltfCenter']} size={d['gltfSize']} nearest={d['nearest']}"
                )
            continue
        info["category"] = category
        figurines[key] = info
        flag = "" if conn["defectCount"] == 0 else f" | !! DEFECTS={conn['defectCount']}"
        print(
            f"[Blender 5.2.1] {key:14s} | {info['triangles']:5d} tris | {info['bytes']/1024:6.1f} KB | "
            f"h={info['height']:.3f}m | parts={conn['connectedParts']}/{conn['totalParts']} (float={conn['allowedFloatingCount']}){flag}"
        )

    if audit_only:
        print(f"[AUDIT] Done in {time.time() - t0:.2f}s — total_defects={total_defects}")
        return

    manifest = {
        "generator": f"Blender {bpy.app.version_string}",
        "round": "b4b",
        "count": len(figurines),
        "coordinateSystem": "glTF 2.0 Y-up, grounded flush at Y=0, front facing +Z",
        "nodeContract": ["Body", "Arm_L", "Arm_R", "Leg_L", "Leg_R", "Accessory"],
        "materialPrefixes": [
            "Mat_Vinyl",
            "Mat_Ceramic",
            "Mat_Crystal",
            "Mat_Brass",
            "Mat_Aluminum",
            "Mat_Titanium",
            "Mat_Obsidian",
            "Mat_Emissive",
        ],
        "figurines": figurines,
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    dt = time.time() - t0
    print(f"[Blender 5.2.1] Exported {len(figurines)} figurines to {MODELS_DIR} in {dt:.2f}s")


if __name__ == "__main__":
    main()
