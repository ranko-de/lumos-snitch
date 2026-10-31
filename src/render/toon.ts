import {
  BackSide,
  Color,
  DataTexture,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  type MeshToonMaterialParameters,
  NearestFilter,
  type Object3D,
  RedFormat,
} from 'three';

/**
 * Illustrated look: cel-shaded materials (a few flat light bands) plus
 * ink-style outlines drawn with the inverted-hull trick.
 */

let gradient: DataTexture | null = null;

/** 4-band light ramp shared by every toon material. */
export function toonGradient(): DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([92, 150, 205, 255]);
  gradient = new DataTexture(data, data.length, 1, RedFormat);
  gradient.minFilter = NearestFilter;
  gradient.magFilter = NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

type ToonParams = MeshToonMaterialParameters & { roughness?: number; metalness?: number; flatShading?: boolean };

/** Drop-in replacement for MeshStandardMaterial params, producing a toon material. */
export function toon(params: ToonParams = {}): MeshToonMaterial {
  const { roughness: _r, metalness: _m, flatShading: _f, ...rest } = params;
  void _r;
  void _m;
  void _f;
  return new MeshToonMaterial({ gradientMap: toonGradient(), ...rest });
}

const outlineMaterials = new Map<string, MeshBasicMaterial>();

/** Shared outline material for a given ink thickness (object-space units). */
export function outlineMaterial(thickness: number, color = 0x241a33): MeshBasicMaterial {
  const key = `${thickness}:${color}`;
  const cached = outlineMaterials.get(key);
  if (cached) return cached;
  const m = new MeshBasicMaterial({ color: new Color(color), side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed += normalize(normal) * ${thickness.toFixed(4)};`,
    );
  };
  m.customProgramCacheKey = () => `outline-${thickness}`;
  outlineMaterials.set(key, m);
  return m;
}

/**
 * Adds an ink outline to every opaque mesh below `root`.
 * The outline shares the mesh's geometry, so it costs one extra draw only.
 */
export function addOutlines(root: Object3D, thickness: number, color?: number): void {
  const targets: Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.outline || mesh.userData.noOutline) return;
    const mat = mesh.material as Material;
    if (Array.isArray(mat) || mat.transparent) return;
    targets.push(mesh);
  });
  for (const mesh of targets) {
    const ol = new Mesh(mesh.geometry, outlineMaterial(thickness, color));
    ol.userData.outline = true;
    ol.renderOrder = mesh.renderOrder;
    mesh.add(ol);
  }
}
