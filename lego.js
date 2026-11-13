// I modelli a mattoncini: caricati una volta, poi montati pezzo per pezzo.
// Ogni pezzo porta nel modello il suo turno (buildAt, da 0 a 1, dal basso in
// alto con un po' di caso): quando il cantiere arriva al suo turno il pezzo
// cade dall'alto e si incastra. Tutto avviene nello shader, non costa nulla.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map();

export function loadLego(file) {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(file).then((g) => g.scene));
  return cache.get(file);
}

const HEAD = "attribute float buildAt;\nuniform float uBuild;\nuniform float uDrop;\n";
const BODY = `
float brickT = clamp((uBuild * 1.2 - buildAt) / 0.2, 0.0, 1.0);
transformed.y += (1.0 - brickT) * (1.0 - brickT) * uDrop;
transformed *= step(0.001, brickT);
`;

/* Il materiale di un pezzo che si monta: stesso aspetto, più il turno. */
export function buildMaterial(material, uBuild, drop) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBuild = uBuild;
    shader.uniforms.uDrop = { value: drop };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${BODY}`);
  };
  m.customProgramCacheKey = () => "lego-build";
  return m;
}

/* Il turno di ogni pezzo, come attributo che lo shader legge. */
export function prepareBuild(geometry, instanced) {
  if (geometry.getAttribute("buildAt")) return true;
  const raw = geometry.getAttribute("_build") || geometry.getAttribute("_BUILD");
  if (!raw) return false;
  geometry.setAttribute("buildAt", instanced ? new THREE.InstancedBufferAttribute(raw.array, 1) : raw);
  return true;
}

/* Rende un modello montabile; restituisce chi ne regola l'avanzamento. */
export function makeBuildable(model, drop = 7) {
  const uBuild = { value: 1 };
  const meshes = [];
  model.updateMatrixWorld(true);
  const rootInv = model.matrixWorld.clone().invert();
  const scale = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  model.traverse((o) => {
    if (!o.isMesh || !prepareBuild(o.geometry, o.isInstancedMesh)) return;
    m4.multiplyMatrices(rootInv, o.matrixWorld).decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    o.material = buildMaterial(o.material, uBuild, drop / (scale.y || 1));
    meshes.push(o);
  });
  let shadows = null;
  return (p) => {
    uBuild.value = p;
    /* Le ombre solo a lavoro finito: i pezzi in volo non ne fanno. */
    const done = p >= 0.999;
    if (done !== shadows) {
      shadows = done;
      for (const o of meshes) o.castShadow = done && !o.isInstancedMesh;
    }
  };
}

/* Gli oggetti di strada (case, alberi, auto) sono istanze: ognuna si monta
   quando il pulmino si avvicina al suo punto della strada (atS), e resta
   montata dopo. uBusS è dove si trova il pulmino. */
export const street = { uBusS: { value: 1e9 } };
const STREET_HEAD = "attribute float buildAt;\nattribute float atS;\nuniform float uBusS;\nuniform float uDrop;\n";
const STREET_BODY = `
float aheadS = atS - uBusS;
float siteP = 1.0 - smoothstep(35.0, 175.0, aheadS);
float brickT = clamp((siteP * 1.2 - buildAt) / 0.2, 0.0, 1.0);
transformed.y += (1.0 - brickT) * (1.0 - brickT) * uDrop;
transformed *= step(0.001, brickT);
`;

export function streetMaterial(material, drop) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBusS = street.uBusS;
    shader.uniforms.uDrop = { value: drop };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${STREET_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${STREET_BODY}`);
  };
  m.customProgramCacheKey = () => "lego-street";
  return m;
}

/* Un modello del kit, ridotto alle geometrie a virgola mobile, girato e
   portato dentro la scatola della forma che sostituisce. */
export async function kitPieces(file, box, turn = 0) {
  const scene = await loadLego(file);
  scene.updateMatrixWorld(true);
  const pieces = [];
  const bounds = new THREE.Box3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    for (const [name, size] of [["position", 3], ["normal", 3]]) {
      const a = src.getAttribute(name);
      const out = new Float32Array(a.count * size);
      for (let i = 0; i < a.count; i++) {
        out[i * size] = a.getX(i);
        out[i * size + 1] = a.getY(i);
        out[i * size + 2] = a.getZ(i);
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
    const b = src.getAttribute("_build");
    g.setAttribute("buildAt", b ? new THREE.BufferAttribute(new Float32Array(b.array), 1) : new THREE.BufferAttribute(new Float32Array(src.getAttribute("position").count).fill(0), 1));
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(o.matrixWorld);
    if (turn) g.rotateY(turn);
    g.computeBoundingBox();
    bounds.union(g.boundingBox);
    pieces.push({ geometry: g, material: o.material, paint: o.material.name === "#901f76" });
  });
  const size = bounds.getSize(new THREE.Vector3());
  const [lo, hi] = box;
  const sx = (hi[0] - lo[0]) / size.x, sy = (hi[1] - lo[1]) / size.y, sz = (hi[2] - lo[2]) / size.z;
  for (const p of pieces) {
    p.geometry.translate(-bounds.min.x, -bounds.min.y, -bounds.min.z);
    p.geometry.scale(sx, sy, sz);
    p.geometry.translate(lo[0], lo[1], lo[2]);
    p.geometry.computeVertexNormals();
  }
  return { pieces, drop: (hi[1] - lo[1]) * 0.9 };
}

/* I bottoncini per terra: una normal map di un bottoncino, ripetuta ogni
   1,32 unità (un modulo dei modelli). La lastra sotto tiene il suo colore. */
export function studNormalMap(anisotropy = 4) {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  const img = g.createImageData(n, n);
  const r = n * 0.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      const d = Math.hypot(dx, dy);
      let nx = 0;
      let ny = 0;
      /* Il bordo del bottoncino e la sua ombra stretta alla base. */
      const edge = Math.max(0, 1 - Math.abs(d - r) / 2.2);
      if (edge > 0) {
        const k = (d < r ? 0.9 : -0.55) * edge;
        nx = (dx / d) * k;
        ny = (dy / d) * k;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const i = (y * n + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/* La luce sui bottoncini di una piastra: un grigio da moltiplicare per il
   colore, chiaro sul cappello, scuro nell'ombra stretta alla base. */
export function studShadeMap(anisotropy = 4) {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  const img = g.createImageData(n, n);
  const r = n * 0.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      const d = Math.hypot(dx, dy);
      let v = 0.86;
      if (d < r - 1) v = 0.98 - ((dx + dy) / r) * 0.06;
      else if (d < r + 1) v = 0.78;
      /* Ombra del bottoncino verso il basso a destra. */
      const sx = dx - 3, sy = dy - 3;
      if (d >= r + 1 && Math.hypot(sx, sy) < r + 1) v = 0.7;
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}
