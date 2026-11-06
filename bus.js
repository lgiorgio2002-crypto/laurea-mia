// Il pulmino: una sola carrozzeria liscia, in metri. Lo scafo è una superficie
// continua ricavata da sezioni arrotondate; finestre, fughe e passaruota sono
// disegnati nello shader, così restano nitidi a qualunque distanza e non
// spezzano le riflessioni della vernice.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const LENGTH = 4.42;
const WIDTH = 1.76;
const ROOF = 1.96;
const FLOOR = 0.38;
const BELT = 1.17;
export const WHEEL_RADIUS = 0.34;
const AXLE_X = 1.24;
const AXLE_Y = WHEEL_RADIUS;

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

function hullGeometry() {
  const stations = 72;
  const around = 72;
  const positions = [];
  const index = [];
  for (let i = 0; i <= stations; i++) {
    /* Le sezioni si addensano alle estremità: lì la curva è più stretta. */
    const t = 0.5 - 0.5 * Math.cos((i / stations) * Math.PI);
    const x0 = (t - 0.5) * LENGTH;
    const end = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 10)), 1 / 10);
    const top = ROOF - 0.07 * Math.pow(2 * t - 1, 2);
    const bottom = FLOOR + 0.05 * Math.pow(2 * t - 1, 4);
    const yc = (top + bottom) / 2;
    const ry = ((top - bottom) / 2) * end;
    const hw = (WIDTH / 2) * Math.pow(end, 0.9);
    for (let j = 0; j < around; j++) {
      const a = (j / around) * Math.PI * 2;
      const n = 2 / 5.5;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const y = yc + ry * Math.sign(s) * Math.pow(Math.abs(s), n);
      let z = hw * Math.sign(c) * Math.pow(Math.abs(c), n);
      let x = x0;
      /* Fianchi che rientrano verso il tetto, parabrezza inclinato, muso
         appena pieno sotto la cintura. */
      const up = Math.max(0, (y - BELT) / (ROOF - BELT));
      z *= 1 - 0.11 * Math.pow(up, 1.6);
      x -= 0.3 * up * smooth(0.55, 1, t);
      x += 0.14 * up * (1 - smooth(0, 0.45, t));
      x += 0.05 * Math.sin(Math.min(1, Math.max(0, (y - FLOOR) / (BELT - FLOOR))) * Math.PI) * (2 * t - 1);
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      const c = a + around;
      const d = b + around;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function paint(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHull; varying vec3 vHullN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHull = position; vHullN = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHull; varying vec3 vHullN;
float glass;
float rrect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hline(float v, float at, float w) { return 1.0 - smoothstep(w * 0.6, w, abs(v - at)); }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 yellow = vec3(0.93, 0.59, 0.012);
  vec3 cream = vec3(0.90, 0.84, 0.66);
  vec3 ink = vec3(0.012, 0.011, 0.012);
  vec3 col = mix(yellow, cream, step(${BELT.toFixed(3)}, vHull.y));
  float side = smoothstep(0.55, 0.7, abs(vHullN.z));
  float front = smoothstep(0.5, 0.65, vHullN.x);
  float rear = smoothstep(0.5, 0.65, -vHullN.x);
  float x = vHull.x;
  float y = vHull.y;
  float z = vHull.z;

  /* Passaruota veri: lì la carrozzeria non c'è. */
  for (int i = 0; i < 2; i++) {
    float cx = i == 0 ? ${AXLE_X.toFixed(3)} : ${(-AXLE_X).toFixed(3)};
    float d = distance(vec2(x, y), vec2(cx, ${AXLE_Y.toFixed(3)}));
    if (d < 0.455 && abs(z) > 0.45) discard;
    col = mix(col, ink, side * (1.0 - smoothstep(0.455, 0.47, d)));
  }

  /* Tre finestre per lato, con il bordo in gomma. */
  float w1 = rrect(vec2(x + 1.12, y - 1.5), vec2(0.62, 0.235), 0.07);
  float w2 = rrect(vec2(x - 0.12, y - 1.5), vec2(0.55, 0.235), 0.07);
  float w3 = rrect(vec2(x - 1.2, y - 1.5), vec2(0.47, 0.235), 0.09);
  float w = min(min(w1, w2), w3);
  float sideGlass = side * (1.0 - smoothstep(-0.002, 0.003, w));
  float rubber = side * (1.0 - smoothstep(0.012, 0.018, abs(w - 0.007)));

  float screenD = rrect(vec2(z, y - 1.5), vec2(0.7, 0.26), 0.1);
  float frontGlass = front * (1.0 - smoothstep(-0.003, 0.004, screenD));
  float frontRubber = front * (1.0 - smoothstep(0.014, 0.02, abs(screenD - 0.008)));
  float backD = rrect(vec2(z, y - 1.53), vec2(0.56, 0.19), 0.08);
  float backGlass = rear * (1.0 - smoothstep(-0.003, 0.004, backD));
  float backRubber = rear * (1.0 - smoothstep(0.014, 0.02, abs(backD - 0.008)));

  glass = max(max(sideGlass, frontGlass), backGlass);
  col = mix(col, ink, max(max(rubber, frontRubber), backRubber));

  /* Fughe delle porte e presa d'aria posteriore. */
  float seam = side * (hline(x, 0.74, 0.008) + hline(x, -0.5, 0.008) + hline(x, 0.0 + 0.1, 0.0)) * step(0.46, y) * step(y, 1.76);
  seam += side * hline(y, 1.12, 0.006) * step(-0.5, x) * step(x, 0.74);
  col = mix(col, ink * 6.0, clamp(seam, 0.0, 1.0));
  float vent = side * step(-2.03, x) * step(x, -1.83) * step(1.3, y) * step(y, 1.68) * step(0.5, fract(y * 34.0));
  col = mix(col, ink, vent);

  /* Cintura cromata e gocciolatoio sul tetto. */
  col = mix(col, vec3(0.8), hline(y, ${BELT.toFixed(3)}, 0.012) * (1.0 - glass));
  col = mix(col, cream * 0.72, hline(y, 1.8, 0.01) * side);

  diffuseColor.rgb = mix(col, vec3(0.018, 0.03, 0.04), glass);
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.04, glass);"
      );
  };
  return material;
}

function wheel(mats) {
  const group = new THREE.Group();
  const lathe = (points, material) => {
    const g = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), 48);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, material);
    group.add(m);
    return m;
  };
  const R = WHEEL_RADIUS;
  lathe([[0.2, -0.11], [R - 0.05, -0.115], [R - 0.012, -0.1], [R, -0.05], [R, 0.05], [R - 0.012, 0.1], [R - 0.05, 0.115], [0.235, 0.112]], mats.tyre);
  lathe([[0.24, 0.112], [0.228, 0.116], [0.15, 0.1], [0.145, 0.098]], mats.rim);
  lathe([[0.145, 0.098], [0.14, 0.13], [0.1, 0.152], [0.04, 0.162], [0, 0.164]], mats.chrome);
  /* Le asole del cerchio: sono loro a far vedere che la ruota gira. */
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const slot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), mats.ink);
    slot.position.set(Math.cos(a) * 0.185, Math.sin(a) * 0.185, 0.117);
    group.add(slot);
  }
  const mirrored = new THREE.Group();
  mirrored.add(group);
  return { outer: mirrored, spin: group };
}

export function createBus(renderer, environment) {
  const root = new THREE.Group();
  const pose = new THREE.Group();
  const body = new THREE.Group();
  root.add(pose);
  pose.add(body);

  const shared = { envMap: environment, envMapIntensity: 1 };
  const mats = {
    paint: paint(new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, ...shared })),
    white: new THREE.MeshPhysicalMaterial({ color: "#f4efe0", roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1, ...shared }),
    chrome: new THREE.MeshStandardMaterial({ color: "#d8dbdd", roughness: 0.12, metalness: 1, ...shared }),
    rim: new THREE.MeshStandardMaterial({ color: "#efe9d6", roughness: 0.35, metalness: 0.1, ...shared }),
    tyre: new THREE.MeshStandardMaterial({ color: "#121213", roughness: 0.72, ...shared, envMapIntensity: 0.4 }),
    ink: new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 0.6, ...shared, envMapIntensity: 0.3 }),
    lens: new THREE.MeshPhysicalMaterial({ color: "#fff6d8", emissive: "#fff0c0", emissiveIntensity: 0.35, roughness: 0.08, clearcoat: 1, ...shared }),
    amber: new THREE.MeshPhysicalMaterial({ color: "#ff9a1f", roughness: 0.2, clearcoat: 1, ...shared }),
    red: new THREE.MeshPhysicalMaterial({ color: "#c8201c", roughness: 0.2, clearcoat: 1, ...shared }),
  };

  body.add(new THREE.Mesh(hullGeometry(), mats.paint));

  const add = (g, m, x = 0, y = 0, z = 0, parent = body) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const half = WIDTH / 2;

  /* Sottoscocca e passaruota: scuri, si vedono solo dai tagli. */
  add(new THREE.BoxGeometry(LENGTH - 0.5, 0.26, WIDTH - 0.22), mats.ink, 0, 0.5);
  for (const x of [AXLE_X, -AXLE_X]) add(new THREE.CylinderGeometry(0.45, 0.45, WIDTH - 0.08, 32).rotateX(Math.PI / 2), mats.ink, x, AXLE_Y + 0.01);

  /* Paraurti. */
  for (const dir of [1, -1]) {
    add(new RoundedBoxGeometry(0.15, 0.17, WIDTH + 0.06, 6, 0.07), mats.white, dir * (LENGTH / 2 + 0.03), 0.52);
    for (const s of [1, -1]) add(new RoundedBoxGeometry(0.34, 0.17, 0.11, 6, 0.05), mats.white, dir * (LENGTH / 2 - 0.09), 0.52, s * (half + 0.0));
  }

  const nose = LENGTH / 2 - 0.03;
  for (const s of [1, -1]) {
    /* Fari tondi con ghiera, frecce sopra. */
    add(new THREE.TorusGeometry(0.115, 0.02, 14, 40).rotateY(Math.PI / 2), mats.chrome, nose, 0.88, s * 0.58);
    add(new THREE.SphereGeometry(0.105, 28, 18).scale(0.45, 1, 1), mats.lens, nose - 0.02, 0.88, s * 0.58);
    add(new RoundedBoxGeometry(0.04, 0.07, 0.13, 3, 0.015), mats.amber, nose - 0.03, 1.07, s * 0.62);
    /* Fanali dietro. */
    add(new RoundedBoxGeometry(0.04, 0.2, 0.09, 3, 0.015), mats.red, -nose + 0.0, 0.9, s * 0.7);
    add(new RoundedBoxGeometry(0.04, 0.07, 0.09, 3, 0.015), mats.amber, -nose + 0.0, 1.04, s * 0.7);
    /* Specchietto. */
    const arm = add(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8).rotateX(Math.PI / 2 - 0.3), mats.chrome, 1.38, 1.38, s * (half + 0.08));
    arm.rotation.y = s * 0.2;
    add(new RoundedBoxGeometry(0.04, 0.17, 0.11, 4, 0.018), mats.white, 1.4, 1.42, s * (half + 0.2));
    /* Maniglie. */
    add(new RoundedBoxGeometry(0.15, 0.022, 0.018, 3, 0.008), mats.chrome, 0.62, 1.03, s * (half - 0.015));
    add(new RoundedBoxGeometry(0.15, 0.022, 0.018, 3, 0.008), mats.chrome, 0.88, 1.03, s * (half - 0.015));
  }
  /* Sul muso un disco liscio, senza marchi. */
  add(new THREE.CylinderGeometry(0.125, 0.125, 0.015, 40).rotateZ(Math.PI / 2), mats.white, nose + 0.0, 0.98, 0);
  /* Terminale di scarico. */
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 14).rotateZ(Math.PI / 2), mats.chrome, -LENGTH / 2 - 0.08, 0.34, 0.5);

  /* Tappo del carburante, sul lato. */
  const cap = add(new THREE.CircleGeometry(0.06, 28), mats.ink, -1.62, 0.98, half + 0.002);
  cap.visible = true;

  /* Il bollino play: l'unico invito a toccare. */
  const badge = new THREE.Group();
  badge.position.set(0.1, 0.76, half + 0.03);
  add(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 40).rotateX(Math.PI / 2), mats.ink, 0, 0, 0, badge);
  add(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 40).rotateX(Math.PI / 2), mats.white, 0, 0, 0.005, badge);
  const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.07, 0.11), new THREE.Vector2(-0.07, -0.11), new THREE.Vector2(0.12, 0)]));
  add(tri, mats.ink, 0, 0, 0.024, badge);
  body.add(badge);

  const wheels = [];
  for (const x of [AXLE_X, -AXLE_X]) {
    for (const s of [1, -1]) {
      const { outer, spin } = wheel(mats);
      outer.position.set(x, AXLE_Y, s * (half - 0.14));
      if (s < 0) outer.rotation.y = Math.PI;
      pose.add(outer);
      wheels.push({ spin, sign: s });
    }
  }

  /* Ombra morbida a terra. */
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 32, 2, 64, 32, 62);
  r.addColorStop(0, "rgba(16,13,12,.62)");
  r.addColorStop(0.72, "rgba(16,13,12,.34)");
  r.addColorStop(1, "rgba(16,13,12,0)");
  g.setTransform(1, 0, 0, 0.5, 0, 16);
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  root.add(shadow);

  return {
    root,
    pose,
    body,
    badge,
    setRoll(distance) {
      const a = distance / WHEEL_RADIUS;
      for (const w of wheels) w.spin.rotation.z = -a * w.sign;
    },
    /* L'ambiente è uno studio fisso: di notte va abbassato insieme al cielo. */
    setLight(amount) {
      for (const m of Object.values(mats)) m.envMapIntensity = amount * (m === mats.tyre ? 0.4 : m === mats.ink ? 0.3 : 1);
    },
  };
}
