// I luoghi del viaggio, modellati in 3D. Unità: metri, un po' compressi. Ogni
// luogo guarda la strada dal suo +z e ha l'origine a terra. Tutto ciò che è
// dello stesso materiale viene fuso in una geometria sola, con il colore nei
// vertici: un luogo intero costa due chiamate di disegno.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadLego, makeBuildable } from "./lego.js";

const color = new THREE.Color();
const lerp1 = THREE.MathUtils.lerp;
const tint = (hex, to, t) => `#${new THREE.Color(hex).lerp(new THREE.Color(to), t).getHexString()}`;

/* ---------- Materiali dei palazzi ---------- */
const CREAM = "#eedcb6";
const STONE = "#f3e6c8";

class Kit {
  constructor() {
    this.solid = [];
    this.glow = [];
    this.mover = null;
    this.rig = null;
    this.signs = [];
    /* Il materiale di default del luogo: 0 intonaco, 1 mattoni, 2 conci. */
    this.surf = 0;
    /* Le masse piene, per non attraversarle guidando. */
    this.masses = [];
  }

  push(g, hex, list = this.solid) {
    const geo = g.index ? g.toNonIndexed() : g;
    color.set(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "color"].includes(k)) geo.deleteAttribute(k);
    geo.setAttribute("aSurf", new THREE.BufferAttribute(new Float32Array(n).fill(this.surf), 1));
    list.push(geo);
    return geo;
  }

  box(w, h, d, x, y, z, hex, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    if (!ry && h >= 5 && w >= 6 && d >= 6 && y < 2) this.masses.push({ x, z, w, d });
    return this.push(g, hex);
  }

  /* Controluce: due gambe, il busto, la testa e la tavola sottobraccio. */
  surfer(x, y, z, flip = 1, s = 1.25) {
    const ink = "#17110d";
    for (const e of [1, -1]) {
      const leg = new THREE.CapsuleGeometry(0.11 * s, 0.75 * s, 3, 8);
      leg.rotateZ(e * 0.1);
      leg.translate(x + e * 0.15 * s, y + 0.48 * s, z);
      this.push(leg, ink);
    }
    const body = new THREE.CapsuleGeometry(0.2 * s, 0.56 * s, 3, 10);
    body.translate(x, y + 1.3 * s, z);
    this.push(body, ink);
    this.sphere(0.15 * s, x, y + 1.92 * s, z, ink, 1, 1.1, 1, 2);
    const arm = new THREE.CapsuleGeometry(0.075 * s, 0.6 * s, 3, 8);
    arm.rotateZ(flip * 0.5);
    arm.translate(x - flip * 0.32 * s, y + 1.38 * s, z);
    this.push(arm, ink);
    /* La tavola: un'ellisse lunga, di taglio verso chi guarda. */
    const b = new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.06, 18);
    b.rotateX(Math.PI / 2);
    b.scale(4.1, 1, 1);
    b.rotateZ(flip * 0.32);
    b.translate(x + flip * 0.32 * s, y + 1.08 * s, z + 0.12);
    this.push(b, ink);
  }

  plain(w, h, d, x, y, z, hex) {
    return this.box(w, h, d, x, y, z, hex);
  }

  light(w, h, d, x, y, z, hex) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    return this.push(g, hex, this.glow);
  }

  cyl(r, h, x, y, z, hex, seg = 12, rTop = r) {
    const g = new THREE.CylinderGeometry(rTop, r, h, seg);
    g.translate(x, y + h / 2, z);
    return this.push(g, hex);
  }

  /* Colonna con base e capitello. */
  column(r, h, x, y, z, hex, cap = hex) {
    this.cyl(r * 1.35, r * 0.7, x, y, z, cap, 10);
    this.cyl(r, h, x, y + r * 0.7, z, hex, 12, r * 0.86);
    this.cyl(r * 1.05, r * 0.5, x, y + r * 0.7 + h, z, cap, 10, r * 1.45);
  }

  sphere(r, x, y, z, hex, sx = 1, sy = 1, sz = 1, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return this.push(g, hex);
  }

  /* Calotta: una mezza sfera schiacciata o allungata. */
  dome(r, x, y, z, hex, sy = 1, seg = 24) {
    const g = new THREE.SphereGeometry(r, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    return this.push(g, hex);
  }

  /* Un muro con un arco aperto, spessore d, lungo x. */
  arch(w, h, d, x, y, z, hex, ry = 0, spring = 0.55) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h);
    s.lineTo(-w / 2, h);
    s.closePath();
    const r = w * 0.34;
    const top = h * spring;
    const hole = new THREE.Path();
    hole.moveTo(-r, 0);
    hole.lineTo(r, 0);
    hole.lineTo(r, top);
    hole.absarc(0, top, r, 0, Math.PI, false);
    hole.lineTo(-r, 0);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 7 });
    g.translate(0, 0, -d / 2);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.push(g, hex);
  }

  /* Timpano: triangolo in estrusione. */
  gable(w, h, d, x, y, z, hex) {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(x, y, z - d / 2);
    return this.push(g, hex);
  }

  /* Balaustra: colonnine sotto un corrimano. */
  rail(w, x, y, z, hex, ry = 0, h = 0.9) {
    const step = 0.42;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (let t = -w / 2; t <= w / 2; t += step) this.cyl(0.075, h, x + t * c, y, z - t * s, hex, 6, 0.05);
    this.box(w + 0.2, 0.14, 0.32, x, y + h, z, hex, ry);
    this.box(w + 0.2, 0.12, 0.32, x, y, z, hex, ry);
  }

  /* Griglia di finestre su una facciata che guarda +z. */
  /* Tutto ciò che viene costruito dentro fn subisce questo spostamento: una
     facciata si scrive una volta e si appoggia su qualunque lato. */
  frame(x, y, z, ry, fn) {
    const a = this.solid.length;
    const b = this.glow.length;
    const c = this.masses.length;
    fn();
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    const across = Math.abs(Math.sin(ry)) > 0.7;
    for (const mass of this.masses.slice(c)) {
      const p = new THREE.Vector3(mass.x, 0, mass.z).applyMatrix4(m);
      mass.x = p.x;
      mass.z = p.z;
      if (across) [mass.w, mass.d] = [mass.d, mass.w];
    }
    for (const g of this.solid.slice(a)) g.applyMatrix4(m);
    for (const g of this.glow.slice(b)) g.applyMatrix4(m);
  }

  /* Muro con la grana del materiale: ogni riquadro ha la sua tinta, così
     mattoni e pietra non sono una campitura unica. */
  rough(w, h, d, x, y, z, hex, cell = 0.9, amp = 0.09) {
    amp *= 0.3;
    const g = new THREE.BoxGeometry(w, h, d, Math.ceil(w / cell), Math.ceil(h / cell), Math.ceil(d / cell));
    g.translate(x, y + h / 2, z);
    const geo = this.push(g, hex);
    const c = geo.attributes.color;
    let seed = (x * 7 + z * 13 + y * 3) | 0;
    for (let i = 0; i < c.count; i += 6) {
      seed = (seed * 1664525 + 1013904223) | 0;
      const k = 1 + (((seed >>> 16) & 255) / 255 - 0.5) * amp * 2;
      for (let j = i; j < i + 6 && j < c.count; j++) c.setXYZ(j, c.getX(j) * k, c.getY(j) * k, c.getZ(j) * k);
    }
    geo.attributes.aSurf.array.fill(cell < 0.95 ? 1 : cell < 1.3 ? 2 : 0);
    if (h >= 5 && w >= 6 && d >= 6 && y < 2) this.masses.push({ x, z, w, d });
    return geo;
  }

  /* Profilo tornito attorno a un asse: cupole, lanterne, balaustri. */
  lathe(profile, x, y, z, hex, seg = 24) {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    g.translate(x, y, z);
    return this.push(g, hex);
  }

  /* Cornicione a tre aggetti. */
  cornice(w, d, x, y, z, hex, p = 0.35) {
    this.box(w + p, 0.22, d + p, x, y, z, hex);
    this.box(w + p * 2, 0.26, d + p * 2, x, y + 0.22, z, hex);
    this.box(w + p * 3, 0.2, d + p * 3, x, y + 0.48, z, hex);
  }

  /* Balaustra vera: zoccolo, balaustri torniti, pilastrini, corrimano. Corre
     lungo x, ry la gira. */
  balustrade(len, x, y, z, hex, ry = 0, h = 1.1, step = 0.52) {
    this.frame(x, y, z, ry, () => {
      this.box(len, 0.14, 0.5, 0, 0, 0, hex);
      this.box(len + 0.1, 0.13, 0.56, 0, h, 0, hex);
      const n = Math.floor(len / step);
      for (let i = 0; i <= n; i++) {
        const px = -len / 2 + (i * len) / n;
        if (i % 7 === 0) this.box(0.34, h, 0.42, px, 0.1, 0, hex);
        else this.lathe([[0.07, 0], [0.13, 0.28 * h], [0.06, 0.62 * h], [0.09, 0.9 * h]], px, 0.12, 0, hex, 6);
      }
    });
  }

  /* Finestra con spessore. Guarda +z. pediment: "tri", "arc" o niente. */
  win(x, y, z, w, h, { frame = STONE, pane = "#2a3036", shutter = null, sill = true, pediment = null, arched = false } = {}) {
    this.box(w, h, 0.1, x, y, z - 0.02, pane);
    if (arched) {
      this.cyl(w / 2, 0.1, 0, 0, 0, pane, 16);
      const top = this.solid[this.solid.length - 1];
      top.rotateX(Math.PI / 2);
      top.translate(x, y + h, z - 0.02);
      this.arch(w + 0.5, h + w / 2 + 0.25, 0.18, x, y - 0.12, z + 0.08, frame, 0, 0.6);
    } else {
      this.box(0.14, h + 0.28, 0.2, x - w / 2 - 0.07, y - 0.14, z + 0.05, frame);
      this.box(0.14, h + 0.28, 0.2, x + w / 2 + 0.07, y - 0.14, z + 0.05, frame);
      this.box(w + 0.28, 0.14, 0.2, x, y + h, z + 0.05, frame);
      this.box(0.05, h, 0.06, x, y, z + 0.04, frame);
      this.box(w, 0.05, 0.06, x, y + h * 0.62, z + 0.04, frame);
    }
    if (sill) this.box(w + 0.6, 0.16, 0.34, x, y - 0.2, z + 0.1, frame);
    if (shutter) {
      for (const s of [1, -1]) {
        this.box(w * 0.52, h, 0.08, x + s * (w * 0.78), y, z + 0.08, shutter);
        for (let i = 1; i < h / 0.3; i++) this.box(w * 0.46, 0.03, 0.03, x + s * (w * 0.78), y + i * 0.3, z + 0.13, "#00000030".slice(0, 7));
      }
    }
    if (pediment === "tri") this.gable(w + 0.9, 0.5, 0.3, x, y + h + 0.16, z + 0.08, frame);
    if (pediment === "arc") {
      const g = new THREE.CylinderGeometry(w * 0.68, w * 0.68, 0.3, 14, 1, false, -Math.PI / 2, Math.PI);
      g.rotateX(Math.PI / 2);
      g.scale(1, 0.5, 1);
      g.translate(x, y + h + 0.16, z + 0.08);
      this.push(g, frame);
    }
  }

  /* Griglia di finestre, centrata in x. */
  windows(cols, rows, w, h, x, y, z, stepX, stepY, frame, pane, shutter = null, extra = {}) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.win(x + (c - (cols - 1) / 2) * stepX, y + r * stepY, z, w, h, { frame, pane, shutter, ...extra });
      }
    }
  }

  /* Tetto a padiglione. */
  hip(w, d, h, x, y, z, hex, ridge = 0.4) {
    const a = w / 2;
    const b = d / 2;
    const r = Math.max(0, a - b) * (w > d ? 1 : 0);
    const s = Math.max(0, b - a) * (d > w ? 1 : 0);
    const v = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b], [-r, h, -s], [r, h, -s], [r, h, s], [-r, h, s]];
    const tri = [[3, 2, 6], [3, 6, 7], [2, 1, 5], [2, 5, 6], [1, 0, 4], [1, 4, 5], [0, 3, 7], [0, 7, 4], [4, 6, 5], [4, 7, 6]];
    const pos = [];
    for (const t of tri) for (const i of t) pos.push(v[i][0] + x, v[i][1] + y, v[i][2] + z);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.push(g, hex);
    if (ridge) this.box(Math.max(2 * r, 0.2) + 0.1, 0.12, Math.max(2 * s, 0.2) + 0.1, x, y + h - 0.04, z, tint(hex, "#ffffff", 0.25));
  }

  /* Colonna corinzia: fusto rastremato, base a toro, capitello a campana. */
  corinth(r, h, x, y, z, shaft, cap = STONE) {
    this.cyl(r * 1.5, r * 0.3, x, y, z, cap, 12);
    this.cyl(r * 1.25, r * 0.4, x, y + r * 0.3, z, cap, 12, r * 1.1);
    this.cyl(r, h, x, y + r * 0.7, z, shaft, 14, r * 0.84);
    this.lathe([[r * 0.84, 0], [r * 1.05, r * 0.5], [r * 1.5, r * 1.1], [r * 1.65, r * 1.25], [0, r * 1.25]], x, y + r * 0.7 + h, z, cap, 12);
  }

  /* Una figura di pietra, con le ali se è un angelo del ponte. */
  statue(x, y, z, hex, h = 3, wings = false) {
    /* La veste che cade, il busto con le spalle, la testa, un braccio lungo
       il fianco e l'altro teso in avanti. */
    this.cyl(0.17 * h, 0.5 * h, x, y, z, hex, 10, 0.1 * h);
    this.cyl(0.1 * h, 0.27 * h, x, y + 0.5 * h, z, hex, 10, 0.135 * h);
    this.sphere(0.135 * h, x, y + 0.77 * h, z, hex, 1, 0.35, 0.8);
    this.cyl(0.04 * h, 0.06 * h, x, y + 0.78 * h, z, hex, 6);
    this.sphere(0.075 * h, x, y + 0.9 * h, z, hex);
    this.box(0.065 * h, 0.3 * h, 0.07 * h, x - 0.165 * h, y + 0.47 * h, z, hex);
    this.box(0.065 * h, 0.065 * h, 0.3 * h, x + 0.165 * h, y + 0.7 * h, z + 0.13 * h, hex);
    if (wings) for (const s of [1, -1]) this.box(0.08 * h, 0.5 * h, 0.3 * h, x + s * 0.17 * h, y + 0.36 * h, z - 0.08 * h, tint(hex, "#ffffff", 0.3), s * 0.5);
  }

  /* Il pino romano, inclinato se serve: fusto nudo e chioma piatta. */
  stonePine(x, z, h = 16, lean = 0, hex = "#2f5d3a") {
    const trunk = new THREE.CylinderGeometry(0.28, 0.55, h, 8);
    trunk.translate(0, h / 2, 0);
    trunk.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, lean, 0, 0, 0));
    trunk.translate(x, 0, z);
    this.push(trunk, "#6b4a33");
    const cx = x + lean * h;
    for (const [dx, dz, r, dy] of [[0, 0, 5.4, 0.4], [3.6, 1, 3.5, -0.3], [-3.4, 1.3, 3.8, -0.2], [0.8, -3.4, 3.4, -0.5], [-1.4, 3.2, 3.3, -0.4]]) {
      this.sphere(r, cx + dx, h + dy, z + dz, hex, 1, 0.42, 1, 2);
    }
  }

  palm(x, z, h = 6) {
    this.cyl(0.26, h, x, 0, z, "#7a6248", 8, 0.2);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const g = new THREE.ConeGeometry(0.34, 3.4, 4);
      g.rotateZ(-Math.PI / 2 - 0.35);
      g.scale(1, 0.25, 1);
      g.translate(1.7, 0, 0);
      g.rotateY(a);
      g.translate(x, h, z);
      this.push(g, "#3f7a3f");
    }
  }

  /* Lampione a due globi. */
  lamp(x, z, h = 6.5) {
    this.cyl(0.09, h, x, 0, z, "#2c2e31", 8, 0.06);
    this.box(1.1, 0.07, 0.07, x, h, z, "#2c2e31");
    for (const s of [1, -1]) this.sphere(0.27, x + s * 0.55, h - 0.28, z, "#f4f1e6");
  }

  /* Scritta incisa o dipinta. w, h in metri; sta su un piano che guarda +z. */
  sign(text, w, h, x, y, z, { ink = "#3a3126", ground = null, font = "700 64px Georgia, serif" } = {}) {
    this.signs.push({ text, w, h, x, y, z, ink, ground, font });
  }

  pine(x, z, h = 13, y = 0, hex = "#2f5d3a") {
    this.cyl(0.32, h, x, y, z, "#6b4a33", 6, 0.2);
    for (const [dx, dy, dz, r] of [[0, 0, 0, 4.2], [2.8, -0.5, 1, 3], [-2.6, -0.3, -1, 3.2], [0.6, -0.6, 2.8, 2.8], [-0.8, -0.2, -2.7, 2.9]]) {
      this.sphere(r, x + dx, y + h + dy, z + dz, hex, 1, 0.48, 1);
    }
  }

  tree(x, z, r = 2.4, hex = "#4f8a46", y = 0) {
    this.cyl(0.22, r * 1.2, x, y, z, "#6b4a33", 6, 0.14);
    this.sphere(r, x, y + r * 1.9, z, hex, 1, 1.05, 1);
  }

  bush(x, z, r, hex = "#5c8f47", y = 0) {
    this.sphere(r, x, y + r * 0.8, z, hex, 1, 0.85, 1, 2);
  }

  car(x, z, hex, ry = 0, y = 0) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    this.box(3.9, 0.7, 1.7, x, y + 0.3, z, hex, ry);
    this.box(2.1, 0.55, 1.5, x - 0.2 * c, y + 1, z + 0.2 * s, "#1d2730", ry);
    for (const [a, b] of [[1.25, 0.85], [1.25, -0.85], [-1.25, 0.85], [-1.25, -0.85]]) {
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12);
      g.rotateX(Math.PI / 2);
      g.rotateY(ry);
      g.translate(x + a * c + b * s, y + 0.33, z - a * s + b * c);
      this.push(g, "#151515");
    }
  }

  person(x, z, hex = "#17120e", y = 0, h = 1.7) {
    this.cyl(0.2, h * 0.58, x, y, z, hex, 6, 0.26);
    this.sphere(0.17, x, y + h * 0.72, z, hex);
  }
}

export const LANDMARKS = {
  /* Via Eleonora d'Arborea: palazzi di mattone salmone con le persiane verdi,
     il blocco bianco a balconate, il grande pino e le auto parcheggiate. */
  homeStreet: {
    lego: { file: "models/homeStreet.glb" },
    side: 1,
    offset: 26,
    look: 12,
    build(k) {
      const salmon = "#c98f6d";
      k.rough(30, 21, 15, -16, 0, -6, salmon, 1.1, 0.05);
      k.box(30.4, 3.2, 15.4, -16, 0, -6, "#d9c6a8");
      k.cornice(30.4, 15.4, -16, 21, -6, "#e8dcc5");
      k.hip(31, 16, 2.4, -16, 21.7, -6, "#a9583a");
      k.windows(8, 5, 1.3, 2, -16, 4.4, 1.56, 3.6, 3.3, "#efe3cc", "#39424a", "#2f7a55");
      for (let i = 0; i < 4; i++) k.box(30.2, 0.14, 0.2, -16, 7.1 + i * 3.3, 1.6, "#e8dcc5");
      k.box(16, 24, 15, 13, 0, -6, "#f4f0e6");
      k.cornice(16, 15, 13, 24, -6, "#ffffff");
      for (let i = 0; i < 7; i++) {
        k.box(17, 0.32, 2.4, 13, 3.3 * i + 2.6, 2.4, "#ffffff");
        k.box(17, 1.1, 0.14, 13, 3.3 * i + 2.9, 3.5, "#fbf8f0");
        k.windows(4, 1, 2.2, 2.2, 13, 3.3 * i + 3, 1.56, 3.6, 3.3, "#d58a4f", "#3a4048", null, { sill: false });
      }
      k.stonePine(-29, 13, 15);
      k.stonePine(30, 12, 12);
      k.tree(-6, 12, 3, "#3f7a3f");
      k.tree(5, 13, 2.6, "#4f8a46");
      for (const [x, c] of [[-14, "#8b8f94"], [-8, "#4c5660"], [1, "#e9e9ea"], [9, "#a33434"], [16, "#23272d"]]) k.car(x, 17, c);
      k.box(4, 3, 3, 24, 0, 14, "#d9d3c5");
      k.bush(21, 13, 1.5);
      k.bush(27, 13, 1.5);
      k.box(70, 0.14, 3, 0, 0, 10.5, "#c9c3b6");
    },
  },

  /* Via Gronchi a Melfi: condomini corallo e terracotta con i balconi ad arco,
     i muretti con il cancello, il prato davanti. */
  melfiStreet: {
    lego: { file: "models/melfiStreet.glb" },
    side: 1,
    offset: 25,
    look: 9,
    build(k) {
      for (const [x, hex, h] of [[-17, "#e06a4e", 15], [2, "#ef8a4f", 17], [22, "#d9583f", 14]]) {
        k.box(17, h, 11, x, 0, -3, hex);
        k.cornice(17, 11, x, h, -3, "#f3ece0");
        k.hip(18.4, 12.4, 3, x, h + 0.7, -3, "#b5542f");
        k.windows(4, 3, 1.5, 1.9, x, 2.6, 2.56, 3.8, 3.8, "#f3ece0", "#2e3439");
        k.arch(7, 4.6, 0.5, x + 3.4, h - 4.8, 3.1, "#f6efe2");
        k.box(7, 0.25, 2, x + 3.4, h - 4.9, 2.2, "#f6efe2");
        k.box(6.6, 1, 0.12, x + 3.4, h - 4.7, 3.3, "#2b2f33");
      }
      for (let x = -26; x <= 30; x += 7) {
        k.box(6.6, 1.1, 0.5, x, 0, 8, "#c9c1b3");
        k.box(6.6, 0.8, 0.12, x, 1.1, 8, "#34383c");
        k.box(0.5, 2.2, 0.6, x + 3.4, 0, 8, "#b76f4e");
      }
      k.box(62, 0.1, 5, 2, 0, 5.3, "#7fa04d");
      k.car(-4, 11.5, "#23305f");
      k.car(14, 11.5, "#d7d7d9");
    },
  },

  /* LUISS, la villa: padiglione a tre ordini con il nicchione a catino, la
     balconata, il timpano spezzato con lo stemma; ala gialla a sinistra, ala
     di mattoni a riquadri a destra, e il grande pino inclinato. */
  luissVilla: {
    lego: { file: "models/luissVilla.glb" },
    side: 1,
    offset: 36,
    look: 12,
    build(k) {
      const wall = "#f0dfb9";
      const stone = "#f7ecd2";
      const P = -10; /* asse del padiglione */

      /* Ala sinistra. */
      k.box(18, 13, 14, P - 19, 0, -9, wall);
      k.cornice(18, 14, P - 19, 13, -9, stone);
      k.hip(19.4, 15.4, 2, P - 19, 13.7, -9, "#b86a40");
      k.windows(2, 2, 1.9, 3, P - 19, 2.2, -1.96, 6.6, 5.6, stone, "#1d2125", "#20262a", { pediment: "tri" });

      /* Corpo centrale, dietro il padiglione. */
      k.box(14, 15.5, 14, P + 17, 0, -9, wall);
      k.cornice(14, 14, P + 17, 15.5, -9, stone);
      k.hip(15.4, 15.4, 2, P + 17, 16.2, -9, "#b86a40");
      k.windows(2, 2, 1.7, 3, P + 17, 2, -1.94, 5.8, 6.4, stone, "#20262a", "#20262a");

      /* Il padiglione. */
      const W = 21;
      k.box(W, 8.4, 9, P, 0, -3, wall);
      k.box(W - 3, 14, 8, P, 8.4, -3.5, wall);
      k.box(W - 7, 7, 7, P, 22.4, -4, wall);

      /* Pianterreno: due coppie di colonne su plinti, l'arco e il catino. */
      for (const s of [1, -1]) {
        for (const dx of [7.2, 9.3]) {
          k.box(1.4, 1.6, 1.4, P + s * dx, 0, 3, stone);
          k.corinth(0.48, 5.3, P + s * dx, 1.6, 3, stone, "#fff7e4");
        }
        k.box(5, 1, 2.2, P + s * 8.2, 7.8, 3, stone);
      }
      k.arch(12, 8.2, 2.4, P, 0, 1.8, stone, 0, 0.5);
      k.lathe([[5.2, 0], [4.9, 1.4], [3.7, 2.9], [1.8, 3.9], [0, 4.2]], P, 4.2, -0.6, "#d9a75f", 20);
      k.box(10, 5, 0.3, P, 0, -1, "#e3bf83");
      k.box(3.6, 4.4, 0.3, P, 0, -0.7, "#201b17");
      k.arch(4.4, 5.2, 0.3, P, 0, -0.55, stone, 0, 0.5);

      /* Trabeazione e balconata del primo piano. */
      k.cornice(W + 0.6, 5.4, P, 8.4, 1.2, stone);
      k.balustrade(W + 1.2, P, 9.25, 4, stone);
      for (const s of [1, -1]) k.balustrade(5, P + s * (W / 2 + 0.3), 9.25, 1.5, stone, Math.PI / 2);

      /* Secondo ordine: paraste, porta-finestra, due nicchie. */
      for (const x of [-7.4, -3, 3, 7.4]) k.box(0.9, 8, 0.34, P + x, 9.4, 0.62, stone);
      k.win(P, 9.8, 0.55, 2.6, 4.8, { frame: stone, pane: "#1d2125", shutter: "#1d2125", sill: false, pediment: "tri" });
      for (const s of [1, -1]) {
        k.box(2.2, 2.2, 0.1, P + s * 5.2, 11.4, 0.54, "#e8d2a4");
        k.box(1.6, 1, 0.1, P + s * 5.2, 15, 0.54, "#e8d2a4");
      }
      k.box(W - 2, 0.4, 8.6, P, 17.2, -3.5, stone);

      /* La lunetta a conchiglia sotto l'arco e i riccioli. */
      k.arch(13, 6.4, 1, P, 17.6, 0, stone, 0, 0.42);
      k.lathe([[3.6, 0], [3.3, 1.2], [2.4, 2.2], [1.2, 2.8], [0, 3]], P, 18.8, -0.6, "#ecd4a4", 20);
      for (let i = 0; i < 9; i++) k.box(0.12, 3.8, 0.14, P + (i - 4) * 0.78, 18.8, 0.1, stone);
      for (const s of [1, -1]) {
        k.sphere(1.2, P + s * 7, 18.9, 0.4, stone, 0.5, 1, 0.5);
        k.box(2, 3, 0.8, P + s * 7.2, 17.6, 0, wall);
      }

      /* Attico: balaustra, stemma, vasi. */
      k.cornice(W - 6.4, 7.6, P, 23.8, -4, stone);
      k.balustrade(W - 7, P, 24.6, 0, stone);
      for (const s of [1, -1]) k.balustrade(7.5, P + s * (W / 2 - 3.5), 24.6, -4, stone, Math.PI / 2);
      k.box(2.2, 1.8, 0.6, P, 24.6, 0.1, stone);
      k.sphere(1.25, P, 26.7, 0.1, "#d7bf8f", 1.05, 1.25, 0.45);
      k.cyl(0.05, 2, P + 3, 25.8, -2, "#2c2e31", 5);

      /* L'ala di mattoni: basamento chiaro con tre arconi, riquadri sopra. */
      const X = P + 45;
      k.box(36, 6, 12, X, 0, -8, wall);
      k.rough(36, 7, 11, X, 6, -8.4, "#9f5b40", 0.7, 0.06);
      for (let i = 0; i <= 7; i++) k.box(0.9, 7.4, 0.4, X - 18 + i * (36 / 7), 6, -2.7, stone);
      k.box(36.6, 0.5, 0.5, X, 12.6, -2.7, stone);
      k.cornice(36, 11, X, 13, -8.4, stone);
      k.hip(37.4, 12.4, 2, X, 13.7, -8.4, "#c9794a");
      k.balustrade(36, X, 6.2, -1.6, stone);
      k.box(36.4, 0.4, 2, X, 5.8, -2.4, stone);
      for (let i = 0; i < 4; i++) {
        const x = X - 13.5 + i * 9;
        k.arch(6.6, 5.4, 0.5, x, 0, -1.8, stone, 0, 0.5);
        k.win(x, 2.5, -1.7, 1.5, 0.9, { frame: stone, pane: "#1b1f23", arched: true, sill: false });
      }

      /* Il giardino: pino inclinato, palma, sfere di bosso, olivo in vaso. */
      k.stonePine(P + 28, 3, 25, 0.13, "#2d5c32");
      /* L'aiuola fiorita davanti al muro. */
      for (let i = 0; i < 44; i++) {
        const x = P + 12 + i * 0.86;
        k.sphere(0.34, x, 0.7 + ((i * 7) % 5) * 0.14, 8 + ((i * 3) % 4) * 0.5, ["#d8413c", "#e8a33a", "#d8413c", "#f2d04a", "#5c8f47"][i % 5], 1, 1, 1, 0);
      }
      k.palm(P + 56, 5, 6);
      k.cyl(0.8, 1.2, P + 8, 0, 7, "#a65a38", 12, 1.05);
      k.sphere(1.1, P + 8, 2.8, 7, "#5f7a3e", 1, 0.9, 1);
      k.cyl(0.05, 1, P + 8, 1.1, 7, "#6b4a33", 5);
      k.cyl(0.8, 1.2, P - 8, 0, 7, "#a65a38", 12, 1.05);
      k.sphere(1.25, P - 8, 2.9, 7, "#5f7a3e", 1, 0.9, 1);
      k.cyl(0.05, 1, P - 8, 1.1, 7, "#6b4a33", 5);
      k.lamp(P + 6, 8, 7);
      for (const [x, z, r, c] of [[2, 8, 2, "#4f7d3c"], [6, 9, 1.5, "#4f7d3c"], [10, 8.4, 1.7, "#5c8f47"], [14, 9, 2, "#6e9a4a"], [18, 8.2, 1.4, "#3f6e3a"], [23, 8.8, 2.2, "#5c8f47"], [27, 8, 1.8, "#4f7d3c"], [33, 8.6, 2.3, "#5c8f47"], [38, 8.2, 1.7, "#6e9a4a"]]) k.bush(x, z, r, c);
      k.box(110, 0.06, 7, 8, 0, 8, "#e9e3d4");
      k.box(64, 0.2, 2, 22, 0, 6, "#6f8f4a");
    },
  },

  /* LUISS, il corpo nuovo: la scatola grigia con la vetrata lunga, sospesa sopra
     la corte, il soffitto di legno, i tavolini rossi, la casa gialla accanto. */
  luissGlass: {
    lego: { file: "models/luissGlass.glb" },
    side: -1,
    offset: 30,
    look: 9,
    build(k) {
      const grey = "#55585a";
      /* La scatola, sollevata sui pilastri. */
      k.plain(46, 8.6, 13, -4, 6.4, -6, grey);
      k.plain(47.6, 0.5, 14.6, -4, 15, -6, "#3f4244");
      k.plain(48, 0.34, 15, -4, 5.7, -6, "#dcdad3");
      k.plain(47.6, 0.34, 14.6, -4, 6.04, -6, "#a8683c");
      /* Il soffitto di legno a doghe, che si vede da sotto. */
      for (let i = 0; i < 40; i++) k.plain(1.05, 0.08, 14.4, -27.5 + i * 1.2, 5.62, -6, i % 2 ? "#b5733f" : "#a8683c");
      /* La vetrata a nastro con i riflessi degli alberi. */
      k.plain(36, 6.2, 0.2, -2, 7.4, 0.55, "#26343a");
      const tints = ["#3f6048", "#7a5a3c", "#35505c", "#4f7050", "#8a6a4a", "#2f4a50", "#4a6a54", "#6a4c38"];
      for (let i = 0; i < 8; i++) {
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 3; r++) k.plain(1, 1.9, 0.12, -19.4 + i * 4.5 + c * 1.04, 7.55 + r * 1.98, 0.66, tints[(i * 3 + c * 5 + r * 7) % 8]);
        }
        k.plain(0.22, 6.2, 0.3, -20 + i * 4.5, 7.4, 0.7, "#2c2f31");
      }
      k.plain(36.4, 0.26, 0.4, -2, 13.5, 0.72, "#2c2f31");
      k.plain(36.4, 0.26, 0.4, -2, 7.3, 0.72, "#2c2f31");
      /* Il piano terra arretrato e i pilastri sottili. */
      k.plain(26, 5.6, 8, -6, 0, -9, "#e7e3d9");
      k.plain(24, 3.6, 0.14, -6, 0.6, -4.9, "#3a4a50");
      for (const x of [-24, -12, 0, 12, 16]) k.plain(0.34, 5.8, 0.34, x, 0, 0, "#3a3d3f");

      /* La casa gialla a destra, col tetto di coppi, e quella dietro. */
      k.rough(16, 10, 12, 30, 0, -3, "#ecc98c", 1.8, 0.04);
      k.hip(17.6, 13.6, 2.4, 30, 10.4, -3, "#b5683f");
      k.box(16.4, 0.4, 12.4, 30, 10, -3, "#f1e0ba");
      k.windows(2, 1, 1.5, 2.6, 30, 5.6, 3.08, 6.4, 3, "#f4e7cc", "#2c3138");
      k.plain(0.14, 10, 0.14, 37.9, 0, 3.2, "#6a4a30");
      k.box(16, 15, 11, 26, 0, -18, "#f0dcae");
      k.hip(17.4, 12.4, 2.2, 26, 15.2, -18, "#b5683f");
      k.windows(3, 2, 1.5, 2.4, 26, 7, -12.44, 4.6, 3.8, "#fbf2dc", "#2c3138");

      /* La corte: pietra chiara, tavolini, sedie rosse, gente. */
      k.plain(100, 0.06, 26, 0, 0, 12, "#dcd7cb");
      const chair = (x, z, hex) => {
        k.plain(0.72, 0.08, 0.72, x, 0.72, z, hex);
        k.plain(0.72, 0.8, 0.08, x, 0.78, z - 0.34, hex);
        for (const [a, b] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) k.plain(0.06, 0.72, 0.06, x + a, 0, z + b, hex);
      };
      for (const [x, z] of [[-22, 6], [-14, 12], [-4, 7], [6, 13], [14, 7], [24, 12], [-28, 14]]) {
        k.cyl(0.8, 0.07, x, 1.05, z, "#d8392e", 14);
        k.cyl(0.06, 1.05, x, 0, z, "#6e7072", 6);
        chair(x - 1.2, z, "#d8392e");
        chair(x + 1.2, z, "#e0b531");
        chair(x, z + 1.2, "#d8392e");
        k.person(x - 1.2, z + 0.1, ["#2a2a33", "#7a4a3a", "#f0efe9", "#35507a"][Math.abs(x) % 4], 0.2, 1.6);
      }
      for (const [x, z, c] of [[-10, 15, "#2a2a33"], [-9, 16, "#b35a4a"], [18, 16, "#35507a"]]) k.person(x, z, c);

      /* I grandi alberi che incorniciano la foto. */
      k.tree(-38, 6, 8, "#3f7040");
      k.tree(-44, -8, 7, "#35623a");
      k.tree(-34, -18, 6, "#4f7d43");
      k.tree(42, 12, 5.4, "#4f7d43");
      k.box(4, 1, 4, -36, 0, 16, "#c9c3b6");
    },
  },

  /* Aula Chiesa: il pulmino la percorre sulla striscia di marmo, tra le colonne
     gialle con i capitelli corinzi, le finestre ad arco in alto, la volta. */
  aula: {
    lego: { file: "models/aula.glb", masses: [{ x: 0, z: 14.5, w: 68, d: 2 }, { x: 0, z: -14.5, w: 68, d: 2 }] },
    side: 0,
    offset: 0,
    look: 9,
    through: true,
    build(k) {
      const L = 66;
      const W = 27;
      const H = 13;
      const shaft = "#d8a24a";
      const cap = "#efe2c4";
      const wall = "#f2ead9";
      for (const s of [1, -1]) {
        const zWall = s * (W / 2);
        k.box(L, H + 8, 1, 0, 0, zWall, wall);
        for (let i = 0; i < 9; i++) {
          const x = -L / 2 + 5 + i * ((L - 10) / 8);
          k.box(2.2, 1.6, 2.2, x, 0, s * (W / 2 - 4), "#a68a63");
          k.corinth(0.92, H - 3.4, x, 1.6, s * (W / 2 - 4), shaft, cap);
          /* Le lesene dietro le colonne, a finto marmo. */
          k.box(1.5, H, 0.3, x, 0, s * (W / 2 - 0.65), "#cf8f7a");
          if (i < 8) {
            const m = x + (L - 10) / 16;
            k.box(3.6, 6, 0.2, m, 2, s * (W / 2 - 0.6), "#d9b48a");
            k.box(3, 5.4, 0.2, m, 2.3, s * (W / 2 - 0.72), "#7b4a3a");
            k.sphere(0.46, m, 9.6, s * (W / 2 - 3.8), "#fff8e1");
            k.cyl(0.03, 3, m, 9.8, s * (W / 2 - 3.8), "#2c2e31", 5);
          }
        }
        /* Trabeazione con il fregio a ovuli. */
        k.frame(0, H, s * (W / 2 - 3.6), s > 0 ? Math.PI : 0, () => {
          k.box(L, 0.7, 5.8, 0, 0, 0, cap);
          k.box(L, 0.85, 5.2, 0, 0.7, 0, "#e6d6b3");
          for (let i = 0; i < 64; i++) k.box(0.4, 0.5, 0.14, -L / 2 + 1 + i, 0.86, 2.62, "#b89f70");
          k.box(L + 0.2, 0.5, 6.4, 0, 1.55, 0, cap);
        });
        /* Il cleristorio: finestre ad arco tra le lesene. */
        for (let i = 0; i < 8; i++) {
          const x = -L / 2 + 8.4 + i * ((L - 10) / 8);
          k.frame(x, H + 2.6, s * (W / 2 - 0.45), s > 0 ? Math.PI : 0, () => {
            k.arch(3.6, 5, 0.4, 0, 0, 0, cap, 0, 0.58);
          });
          k.light(2.5, 3.8, 0.1, x, H + 2.9, s * (W / 2 - 0.58), "#fff4d2");
        }
        k.box(L, 0.5, 2.2, 0, H + 7.8, s * (W / 2 - 1.2), cap);
      }
      /* La volta a botte, con i costoloni. */
      const R = W / 2;
      const seg = 28;
      const v = new THREE.CylinderGeometry(R, R, L, seg, 1, true, 0, Math.PI);
      v.rotateZ(Math.PI / 2);
      v.rotateX(-Math.PI / 2);
      const nv = v.toNonIndexed();
      const p = nv.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, Math.abs(p.getY(i)) * 0.55 + H + 8);
      nv.computeVertexNormals();
      k.push(nv, "#e7d9b9");
      for (let i = 0; i <= 8; i++) {
        const x = -L / 2 + 5 + i * ((L - 10) / 8);
        for (let j = 0; j < 14; j++) {
          const a0 = (j / 14) * Math.PI;
          const a1 = ((j + 1) / 14) * Math.PI;
          const y0 = Math.sin(a0) * R * 0.55 + H + 7.7;
          const y1 = Math.sin(a1) * R * 0.55 + H + 7.7;
          const z0 = Math.cos(a0) * R;
          const z1 = Math.cos(a1) * R;
          const len = Math.hypot(y1 - y0, z1 - z0);
          const g = new THREE.BoxGeometry(0.7, 0.3, len);
          g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
          g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
          k.push(g, "#d3c096");
        }
      }
      /* Le due testate: l'abside in alto, con l'edicola a cupoletta, resta
         sopra la strada. */
      for (const e of [1, -1]) {
        k.box(1, 8, W, e * (L / 2), H + 8, 0, wall);
        for (const s of [1, -1]) k.box(1, H + 8, W / 2 - 6, e * (L / 2), 0, s * (W / 4 + 3), wall);
        k.box(1, 3, 12, e * (L / 2), H + 5, 0, wall);
        k.lathe([[3.2, 0], [3, 0.9], [2, 2], [0.8, 2.6], [0.3, 3.4], [0, 4.1]], e * (L / 2 - 2.4), H + 8.4, 0, "#c7b389", 16);
        k.box(2, 0.5, 8.2, e * (L / 2 - 1.2), H + 8, 0, cap);
        for (const s of [1, -1]) k.corinth(0.34, 3.6, e * (L / 2 - 1.2), H + 4.2, s * 3.4, "#cfc0a4", cap);
      }
      /* Il pavimento: fasce di marmo e il tappeto chiaro della strada. */
      k.box(L, 0.04, W - 1, 0, 0, 0, "#d9d3c7");
      for (const s of [1, -1]) {
        k.box(L, 0.05, 1.3, 0, 0.01, s * 5.6, "#8f7346");
        k.box(L, 0.05, 0.3, 0, 0.02, s * 5, "#e8e0cf");
        for (let i = 0; i < 15; i++) k.box(1.6, 0.05, 1.6, -28 + i * 4, 0.015, s * 7.6, "#f3ece0", Math.PI / 4);
      }
      /* Le sedie blu con il pubblico, il pannello bianco con gli schermi. */
      for (const s of [1, -1]) {
        for (let row = 0; row < 3; row++) {
          for (let c = 0; c < 12; c++) {
            const x = -22 + c * 2.3;
            const z = s * (7.3 + row * 1.5);
            k.box(0.9, 0.08, 0.9, x, 0.8, z, "#2b57a8");
            k.box(0.08, 0.9, 0.9, x - 0.42, 0.85, z, "#2b57a8");
            for (const [dx, dz] of [[0.35, 0.35], [0.35, -0.35], [-0.35, 0.35], [-0.35, -0.35]]) k.box(0.05, 0.8, 0.05, x + dx, 0, z + dz, "#20242a");
            if ((c + row) % 3 === 0) k.person(x, z, ["#2a2a33", "#5a3a2a", "#3b4a5f"][c % 3], 0.2, 1.5);
          }
        }
        k.box(0.5, 7, 7, 25, 0, s * 8.6, "#f7f4ea");
        k.light(0.1, 3, 5, 24.7, 3.3, s * 8.6, "#cfe0f7");
        k.box(0.8, 3, 1.3, 23, 0, s * 6.4, "#1c3d78");
      }

      /* Fuori: il tempio di mattoni di Aula Chiesa. Dentro si passa dal portale
         sul timpano, e dall'esterno si legge la foto: due ordini, la terrazza con
         la balaustra, i riquadri, il pronao, gli olivi. */
      const brick = "#a4583e";
      const stone = "#f4ead2";
      const T = 10.6; /* la terrazza */
      const TOP = 21.6;
      for (const s of [1, -1]) {
        const out = s * (W / 2 + 0.9);
        k.rough(L + 2, TOP, 1.2, 0, 0, out, brick, 0.75, 0.06);
        k.plain(L + 3, 0.6, 1.8, 0, 0, out, "#d9cfbb");
        k.frame(0, 0, out, s > 0 ? 0 : Math.PI, () => {
          /* Fascia e terrazza. */
          k.plain(L + 2.6, 0.55, 3.4, 0, T - 0.55, 1.2, stone);
          k.plain(L + 2.9, 0.3, 3.8, 0, T, 1.3, stone);
          k.balustrade(L, 0, T + 0.3, 2.9, stone, 0, 1.2);
          /* Primo ordine: finestre tagliate nel mattone. */
          for (let i = 0; i < 7; i++) k.win(-L / 2 + 9 + i * ((L - 18) / 6), 3, 0.66, 2, 4.2, { frame: stone, pane: "#1f252b" });
          /* Secondo ordine: paraste chiare e pannelli scuri. */
          for (let i = 0; i <= 9; i++) k.plain(1, TOP - T - 1.4, 0.5, -L / 2 + 3 + i * ((L - 6) / 9), T + 0.3, 0.64, "#c78a68");
          for (let i = 0; i < 9; i++) k.plain(4.4, 5.6, 0.14, -L / 2 + 3 + (i + 0.5) * ((L - 6) / 9), T + 2.4, 0.62, "#8d4a35");
          k.plain(L + 2.6, 0.4, 1.4, 0, TOP - 1.2, 0.5, stone);
          k.cornice(L + 2.4, 1.6, 0, TOP - 0.7, 0.4, stone);
        });
      }
      k.masses.push({ x: 0, z: W / 2 + 1, w: L + 2, d: 2 }, { x: 0, z: -W / 2 - 1, w: L + 2, d: 2 });
      /* Il tetto a capanna sopra la volta, e il timpano di pietra davanti. */
      k.frame(0, TOP, 0, Math.PI / 2, () => k.gable(W + 7, 10, L + 3, 0, 0, 0, "#8d7458"));
      for (const e of [-1, 1]) {
        k.frame(e * (L / 2 + 0.9), 0, 0, -e * Math.PI / 2 * 1, () => {
          for (const s of [1, -1]) k.rough(10.4, TOP, 1.2, s * 11.2, 0, 0, brick, 0.75, 0.06);
          k.rough(12.6, TOP - 15, 1.2, 0, 15, 0, brick, 0.75, 0.06);
          k.gable(W + 7, 10, 1.6, 0, TOP, 0.2, stone);
          k.gable(W + 1, 7.4, 0.3, 0, TOP + 0.7, 1, brick);
          k.cornice(W + 6, 1.6, 0, TOP - 0.7, 0.2, stone);
          if (e > 0) return;
          /* Il pronao: colonne sulla fronte, la loggia in alto, due porte finte. */
          for (const x of [-7.6, 7.6]) {
            k.plain(1.8, 1.4, 1.8, x, 0, 3.4, stone);
            k.corinth(0.62, 11.6, x, 1.4, 3.4, stone, "#fff8e8");
            k.corinth(0.5, 5.4, x, T + 3.4, 1.6, stone, "#fff8e8");
          }
          k.plain(18, 1, 5.4, 0, 14.4, 1.9, stone);
          k.cornice(18, 5, 0, 15.4, 1.9, stone);
          k.balustrade(17, 0, 16.1, 3.9, stone, 0, 1.1);
          for (const x of [-11.4, 11.4]) k.win(x, 3.4, 0.66, 2.4, 5, { frame: stone, pane: "#1f252b", pediment: "tri" });
        });
      }
      /* Attorno: gli olivi, il palo rosso, le strisce, l'ala bassa con la fioriera. */
      for (const [x, z, r, c] of [[-54, 20, 3.4, "#7cae4e"], [-48, 25, 2.6, "#8fbc58"], [-42, 19, 2.8, "#6aa24e"], [-54, -22, 3, "#4f7d43"], [-30, 24, 3, "#6a9c4a"], [-8, 24, 3.2, "#5f8f42"], [20, 25, 3, "#6a9c4a"]]) k.tree(x, z, r, c);
      k.plain(0.5, 4.6, 0.3, -42, 0, 8, "#e23b2e");
      for (let i = 0; i < 6; i++) k.plain(4, 0.03, 0.8, -50, 0.03, -4 + i * 1.7, "#ffffff");
      k.box(16, 7, 12, 24, 0, -22, "#b16a4c");
      k.plain(17, 1.2, 13, 24, 7, -22, "#e7dfcd");
      k.plain(17, 1.1, 2.4, 24, 2.2, -15, "#6a4a34");
      for (let i = 0; i < 6; i++) k.bush(17 + i * 2.8, -15, 1.1, "#3f6e3a", 3.4);
    },
  },

  /* San Pietro dal Tevere, come nelle foto: le cinque arcate di pietra con gli
     angeli, l'acqua lunga davanti, la cupola color piombo con i costoloni chiari,
     il tamburo a colonne binate, e Castel Sant'Angelo a destra sopra le mura. */
  tiber: {
    lego: { file: "models/tiber.glb" },
    surf: 2,
    side: 1,
    offset: 66,
    look: 26,
    build(k) {
      const stone = "#cdbfa6";
      const pale = "#ece2cd";
      const lit = "#f4dcae";
      const lead = "#6f8498";
      /* Cinque arcate: le tre centrali più larghe. */
      for (const [x, w] of [[-34, 12], [-19, 17], [0, 18], [19, 17], [34, 12]]) k.arch(w, 8.6, 9, x, -4.2, 0, stone, 0, 0.42);
      for (const x of [-27.5, -9.5, 9.5, 27.5]) {
        k.plain(4.4, 10, 11, x, -4.2, 0, stone);
        for (const s of [1, -1]) k.lathe([[2.2, 0], [2.2, 6], [1.2, 7], [0, 7.3]], x, -4.2, s * 5.5, "#b9ab92", 10);
      }
      k.plain(82, 0.5, 9.4, 0, 3.7, 0, "#c0b297");
      k.plain(82, 0.25, 10, 0, 3.45, 0, pale);
      for (const s of [1, -1]) {
        k.balustrade(82, 0, 4.2, s * 4.5, pale, 0, 1, 0.7);
        for (let i = 0; i < 5; i++) {
          const x = -32 + i * 16;
          k.plain(1.4, 2.4, 1.4, x, 4.1, s * 4.5, "#e0d5bd");
          k.plain(1.7, 0.3, 1.7, x, 6.5, s * 4.5, pale);
          k.statue(x, 6.8, s * 4.5, "#f4ecdc", 3.4, true);
          k.light(0.34, 0.34, 0.34, x + 8, 5.4, s * 4.5, "#ffd27a");
        }
      }

      /* La riva opposta. */
      const far = -86;
      k.plain(260, 3.4, 36, 4, -3.4, far, "#b5a07f");
      k.plain(260, 1.4, 2, 4, -3.4, far + 18, pale);
      for (const [x, w, h, hex] of [[-124, 40, 15, "#d8a06a"], [-92, 30, 19, "#e0b07a"], [-58, 24, 14, "#e8c08a"], [58, 22, 13, "#e8c08a"]]) {
        k.box(w, h, 16, x, 0, far + 6, hex);
        k.cornice(w, 16, x, h, far + 6, pale);
        k.hip(w + 1, 17, 2.4, x, h + 0.7, far + 6, "#b0623c");
        k.windows(Math.floor(w / 5), Math.floor(h / 4.4), 1.3, 2.3, x, 2.4, far + 14.1, 4.6, 4.2, "#f0dcae", "#ffcf80", null, { sill: false });
      }
      /* La chiesetta con il tiburio di cotto, a sinistra. */
      k.box(14, 15, 16, -74, 0, far - 8, "#c08a62");
      k.gable(15, 3.4, 16, -74, 15, far - 8, "#b5784f");
      k.cyl(5.4, 6, -74, 15, far - 16, "#b86a48", 8);
      k.lathe([[6.4, 0], [4, 2.4], [1, 4.4], [0, 5.6]], -74, 21, far - 16, "#7a3f2c", 8);
      k.cyl(1.6, 0.2, 0, 0, 0, "#f0dcae", 12);
      const rose = k.solid[k.solid.length - 1];
      rose.rotateX(Math.PI / 2);
      rose.translate(-74, 10, far);

      /* La basilica. */
      const fz = far - 14;
      k.box(64, 30, 16, 0, 0, fz, "#ecdcbc");
      k.plain(66, 2, 18, 0, 26, fz, lit);
      k.cornice(66, 18, 0, 28, fz, pale);
      for (let i = 0; i < 10; i++) k.corinth(0.95, 22, -29 + i * 6.45, 2.6, fz + 8.6, "#f4e7cc", pale);
      k.gable(24, 5, 18, 0, 28.7, fz, "#e6d6b6");
      k.windows(7, 2, 2.4, 5, 0, 5, fz + 8.12, 8.6, 9.5, "#f4e7cc", "#ffcf80", null, { sill: false, pediment: "arc" });
      for (let i = 0; i < 13; i++) k.statue(-31 + i * 5.16, 29.6, fz + 7.4, "#f8f0e0", 2.8);
      for (const s of [1, -1]) {
        k.cyl(5, 6, s * 28, 29, fz - 4, "#ecdcbc", 16);
        k.lathe([[5, 0], [4.6, 1.7], [3.3, 3.5], [1.4, 4.7], [0.8, 5.6], [0.5, 7], [0, 8.2]], s * 28, 35, fz - 4, lead, 16);
      }
      k.box(48, 26, 40, 0, 0, fz - 26, "#e4d3b2");
      const dz = fz - 30;
      const base = 30;
      k.cyl(24, 7, 0, base, dz, "#e6cf9e", 40);
      k.cyl(25, 1, 0, base + 7, dz, pale, 40);
      /* Il tamburo: colonne binate e finestre accese tra una coppia e l'altra. */
      k.cyl(19, 15, 0, base + 8, dz, "#efe2c6", 40);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const d of [-0.05, 0.05]) k.column(0.68, 11.6, Math.cos(a + d) * 20, base + 8.3, dz + Math.sin(a + d) * 20, "#f8efdc", pale);
        const b = a + Math.PI / 16;
        k.light(2.6, 6.4, 0.3, Math.cos(b) * 18.9, base + 11, dz + Math.sin(b) * 18.9, "#ffc873");
      }
      k.cyl(21, 1.2, 0, base + 22.6, dz, pale, 40);
      /* La calotta di piombo a sesto rialzato, coi costoloni chiari. */
      const prof = [[19.2, 0], [18.7, 5], [17.2, 10.5], [14.8, 15.5], [11.4, 20], [7.4, 23.4], [3.4, 25.4], [0, 26]];
      k.lathe(prof, 0, base + 23.8, dz, lead, 48);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (let j = 0; j < prof.length - 2; j++) {
          const [r0, h0] = prof[j];
          const [r1, h1] = prof[j + 1];
          const len = Math.hypot(r1 - r0, h1 - h0);
          const g = new THREE.BoxGeometry(0.9 - j * 0.08, len + 0.2, 0.5);
          g.rotateZ(Math.atan2(r0 - r1, h1 - h0));
          g.translate((r0 + r1) / 2 + 0.16, (h0 + h1) / 2, 0);
          g.rotateY(a);
          g.translate(0, base + 23.8, dz);
          k.push(g, "#e9e3d2");
        }
      }
      k.cyl(3.6, 6, 0, base + 49, dz, "#efe2c6", 16, 3.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.column(0.32, 4.6, Math.cos(a) * 3.8, base + 49.4, dz + Math.sin(a) * 3.8, pale);
      }
      k.lathe([[3.6, 0], [3, 1.2], [1.4, 2.4], [0.5, 2.8], [0.3, 4.4], [0, 5.4]], 0, base + 55, dz, lead, 16);
      k.sphere(0.5, 0, base + 60.6, dz, "#e8c56a");
      k.plain(0.12, 2, 0.12, 0, base + 60.8, dz, "#e8c56a");
      k.plain(1, 0.12, 0.12, 0, base + 62, dz, "#e8c56a");

      /* Castel Sant'Angelo: le mura di mattoni che scendono al fiume, il grande
         tamburo, il corpo alto, l'angelo in cima, la bandiera. */
      const CX = 92;
      const CZ = far - 2;
      k.rough(80, 11, 20, CX + 8, 0, CZ + 22, "#b0624a", 1.4, 0.07);
      k.plain(81, 0.8, 21, CX + 8, 11, CZ + 22, "#d9b08a");
      for (let i = 0; i < 8; i++) k.plain(1.6, 1.2, 1, CX - 26 + i * 9, 11.8, CZ + 32, "#c47c5c");
      k.cyl(24, 18, CX, 0, CZ, "#bd6c4e", 44);
      k.cyl(24.6, 0.8, CX, 18, CZ, "#dcb18c", 44);
      k.cyl(15, 9, CX, 18.8, CZ, "#c98060", 32);
      k.box(15, 8, 15, CX, 27.8, CZ, "#d09070");
      k.windows(3, 1, 1.2, 2, CX, 29.4, CZ + 7.54, 3.8, 3, "#efe0c0", "#3a2a20", null, { sill: false });
      k.cornice(15, 15, CX, 35.8, CZ, "#dcb18c");
      k.statue(CX, 36.5, CZ, "#9aa0a0", 5, true);
      k.plain(0.14, 8, 0.14, CX + 8, 36.5, CZ + 6, "#3a3b3c");
      k.plain(2.4, 1.3, 0.05, CX + 9.2, 42.8, CZ + 6, "#3f8a4a");
      k.tree(54, far + 13, 7, "#2f5a3a");

      /* I pini sulla riva, scuri contro il cielo. */
      for (const [x, h] of [[-142, 15], [-104, 14], [-48, 16]]) k.stonePine(x, far + 15, h, 0, "#284a30");
      for (const [x, r] of [[-126, 4], [46, 3.6]]) k.tree(x, 20, r, "#3f5e3a");
    },
  },

  /* Il Colosseo come un modello: la base a gradino con le aiuole agli angoli e
     l'anello di pietra, tre ordini e l'attico sul lato alto, il muro che scende a
     gradini dove è crollato, dentro la cavea di cotto con le volte radiali e i
     sotterranei. La camera sale per guardarci dentro. */
  colosseum: {
    lego: { file: "models/colosseum.glb", masses: [{ x: 0, z: 0, w: 66, d: 56 }] },
    surf: 2,
    side: 1,
    offset: 66,
    look: 10,
    view: { h: 62, r: 46 },
    build(k) {
      const a = 37;
      const b = 31;
      const bays = 56;
      const Y0 = 1.4; /* il piano della base */
      const outer = ["#e6dac0", "#dfd2b6", "#d8caad"];
      const cotto = ["#c98a5e", "#bc7c53", "#d39a6e"];
      const ell = (t, s = 1) => [Math.cos(t) * a * s, Math.sin(t) * b * s];
      const rotAt = (t) => Math.atan2(-b * Math.cos(t), -a * Math.sin(t));

      /* La base: il gradino, l'anello lastricato, le aiuole. */
      k.box(116, 0.8, 104, 0, 0, 0, "#c9b08c");
      k.box(112, 0.6, 100, 0, 0.8, 0, "#e3d0ae");
      const ring = new THREE.CylinderGeometry(47, 47, 0.16, 72);
      ring.scale(1, 1, 0.86);
      ring.translate(0, Y0 + 0.02, 0);
      k.push(ring, "#9a9288");
      const curb = new THREE.CylinderGeometry(48.2, 48.2, 0.3, 72);
      curb.scale(1, 1, 0.86);
      curb.translate(0, Y0 - 0.02, 0);
      k.push(curb, "#efe3c9");
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        /* L'aiuola riempie l'angolo tra il bordo e l'anello. */
        const pts = [[55, 49]];
        for (let i = 0; i <= 10; i++) {
          const t = (i / 10) * (Math.PI / 2);
          pts.push([Math.cos(t) * 49.5, Math.sin(t) * 43]);
        }
        pts[1][0] = 55;
        pts[11][1] = 49;
        const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))));
        g.rotateX(Math.PI / 2);
        g.scale(sx, 1, sz);
        g.translate(0, Y0 + 0.08, 0);
        k.push(g, "#7fae4e");
        k.tree(sx * 49, sz * 42, 3.6, "#5f9c50", Y0);
        k.tree(sx * 44, sz * 45, 2.6, "#6fa858", Y0);
      }

      /* I fiori rossi e bianchi e i cipressi della foto. */
      for (let i = 0; i < 80; i++) {
        const t = (i / 80) * Math.PI * 0.86 + Math.PI * 0.07;
        const [x, z] = ell(t, 1.2 + ((i * 7) % 4) * 0.02);
        k.sphere(1.2, x, Y0 + 0.4, z, i % 3 === 0 ? "#fbf6ea" : "#cf2f2a", 1.1, 0.7, 1.1, 0);
        const [x2, z2] = ell(t, 1.27);
        k.sphere(1, x2, Y0 + 0.3, z2, i % 2 ? "#f3efdc" : "#e8dfb8", 1.1, 0.6, 1.1, 0);
      }
      for (const [x, z, h] of [[50, 40, 14], [54, 34, 16], [57, 28, 12]]) {
        k.lathe([[1.5, 0], [2.3, 2], [1.9, h * 0.5], [0.8, h * 0.85], [0, h]], x, Y0, z, "#2f5138", 8);
      }

      /* Quanti ordini ha ogni campata: alto a nord, a gradini verso il crollo. */
      const levels = (i) => {
        const c = Math.min(Math.abs(i - 28), bays - Math.abs(i - 28));
        if (c < 9) return 1;
        if (c < 12) return 2;
        if (c < 15) return 3;
        return 4;
      };
      for (let i = 0; i < bays; i++) {
        const t0 = (i / bays) * Math.PI * 2;
        const t1 = ((i + 1) / bays) * Math.PI * 2;
        const tm = (t0 + t1) / 2;
        const [x, z] = ell(tm);
        const [x0, z0] = ell(t0);
        const [x1, z1] = ell(t1);
        const len = Math.hypot(x1 - x0, z1 - z0);
        const rot = rotAt(tm);
        const n = levels(i);
        let y = Y0;
        for (let tier = 0; tier < Math.min(n, 3); tier++) {
          const h = [9.2, 8.8, 8.4][tier];
          k.arch(len + 0.05, h, 2.6, x, y, z, outer[tier], rot, 0.5);
          k.box(len * 0.54, h * 0.62, 0.2, x * 0.965, y, z * 0.965, "#6f5240", rot);
          k.light(len * 0.5, h * 0.58, 0.12, x * 0.955, y, z * 0.955, "#ffbe6b");
          k.box(len + 0.2, 0.42, 3, x, y + h - 0.2, z, "#f5e6c9", rot);
          y += h;
        }
        if (n === 4) {
          k.box(len + 0.05, 6.4, 2.6, x, y, z, "#e2c9a2", rot);
          if (i % 2) k.box(len * 0.4, 1.3, 0.2, x * 1.036, y + 2.5, z * 1.036, "#6f5240", rot);
          k.box(len + 0.3, 0.45, 3.1, x, y + 6.4, z, "#f5e6c9", rot);
        }
        /* Le lesene sui pilastri. */
        const [cx, cz] = ell(t0, 1.045);
        k.box(0.8, y - Y0, 0.5, cx, Y0, cz, "#f0dfbe", rotAt(t0));

        /* Le volte radiali di cotto, che salgono verso l'esterno. */
        for (const [s, h] of [[0.92, n >= 3 ? 24 : 15], [0.84, n >= 3 ? 19 : 13], [0.76, 14], [0.68, 10]]) {
          const [rx, rz] = ell(t0, s);
          k.box(0.7, h, 6, rx, Y0, rz, cotto[i % 3], -t0 + Math.PI / 2 * 0);
        }
        /* I due anelli interni, con le arcate. */
        for (const [s, h, hex] of [[0.88, n >= 3 ? 22 : 13, "#c98f63"], [0.8, 16, "#bd8158"], [0.72, 11, "#b5784f"]]) {
          const [ix, iz] = ell(tm, s);
          k.arch(len * s + 0.05, 7, 1, ix, Y0, iz, hex, rot, 0.5);
          k.box(len * s + 0.05, h - 7, 1, ix, Y0 + 7, iz, hex, rot);
        }
        /* I gradoni tra un anello e l'altro. */
        for (let g = 0; g < 5; g++) {
          const s = 0.7 - g * 0.035;
          const [gx, gz] = ell(tm, s);
          k.box(len * s + 0.1, 0.8, 1.6, gx, Y0 + 9 - g * 1.7, gz, g % 2 ? "#d9a97c" : "#cf9c70", rot);
        }
      }
      /* Le pareti scoperte alle due estremità del crollo, a gradini. */
      for (const i of [15, 41]) {
        const t = (i / bays) * Math.PI * 2;
        for (let g = 0; g < 4; g++) {
          const [x, z] = ell(t, 1 - g * 0.05);
          k.box(5, 34 - g * 5, 4, x, Y0, z, "#d9b48a", rotAt(t) + Math.PI / 2);
        }
      }

      /* L'arena: il piano di legno a metà e i muri dei sotterranei. */
      const floor = new THREE.CylinderGeometry(a * 0.5, a * 0.5, 0.5, 44);
      floor.scale(1, 1, b / a);
      floor.translate(0, Y0, 0);
      k.push(floor, "#7a5a3f");
      for (let i = -5; i <= 5; i++) {
        k.box(a * 0.82, 1.8, 0.5, 0, Y0 + 0.2, i * 2.4, "#b98f68");
        k.box(0.5, 1.8, b * 0.78, i * 2.8, Y0 + 0.2, 0, "#ad845f");
      }
      k.box(a * 0.4, 0.2, b * 0.8, a * 0.2, Y0 + 2, 0, "#c9a877");
      k.masses.push({ x: 0, z: 0, w: 66, d: 56 });
    },
  },

  /* Il Pantheon in fondo alla via: pronao di granito, timpano con l'iscrizione,
     la cupola a gradoni, il mattone della rotonda; ai lati i palazzi d'ocra e
     d'arancio con le persiane, il portone rosso, il dehors sui sampietrini. */
  pantheon: {
    lego: { file: "models/pantheon.glb", masses: [{ x: 0, z: -26, w: 40, d: 40 }, { x: -37, z: 12, w: 30, d: 16 }, { x: 37, z: 12, w: 30, d: 16 }] },
    side: 1,
    offset: 58,
    look: 14,
    build(k) {
      const granite = "#a9a297";
      const marble = "#d9cfbd";
      const brick = "#b08a66";
      /* La rotonda. */
      k.rough(23, 0.1, 0.1, 0, 0, -26, brick);
      k.cyl(23, 17, 0, 0, -26, brick, 56);
      for (const y of [5.6, 11.4]) k.cyl(23.2, 0.5, 0, y, -26, "#d6c6a8", 56);
      k.cyl(23.4, 1, 0, 16.6, -26, "#d6c6a8", 56);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        k.box(1.5, 3.2, 0.2, Math.cos(a) * 23.05, 6.6, -26 + Math.sin(a) * 23.05, "#98744f", -a + Math.PI / 2);
      }
      /* La cupola: sette anelli a gradini poi la calotta di piombo. */
      for (let i = 0; i < 7; i++) k.cyl(22.8 - i * 1.15, 0.7, 0, 17.6 + i * 0.7, -26, "#c7b597", 56, 22.5 - i * 1.15);
      k.lathe([[15.2, 0], [13.6, 2.4], [10.4, 5], [6.4, 6.8], [4.4, 7.3]], 0, 22.5, -26, "#a59b8c", 48);
      k.cyl(4.6, 0.8, 0, 29.6, -26, "#c9b58f", 24);

      /* Il corpo di raccordo, col secondo timpano. */
      k.box(32, 21, 12, 0, 0, -9, brick);
      k.gable(34, 5.6, 12, 0, 21, -9, marble);
      k.cornice(32, 12, 0, 20, -9, marble);

      /* Il pronao: otto colonne davanti, due file dietro, trabeazione, timpano. */
      const front = 6.5;
      for (let i = 0; i < 8; i++) k.corinth(0.92, 12, -12.25 + i * 3.5, 0.9, front, granite, "#dfd8c9");
      for (const x of [-12.25, -5.25, 5.25, 12.25]) {
        k.corinth(0.92, 12, x, 0.9, front - 6, granite, "#dfd8c9");
        k.corinth(0.92, 12, x, 0.9, front - 11, granite, "#dfd8c9");
      }
      k.box(29, 0.9, 21, 0, 0, -3, "#c9bfae");
      for (let i = 0; i < 3; i++) k.box(30 + i * 1.6, 0.3, 22 + i * 1.6, 0, 0.6 - i * 0.3, -3, "#c9bfae");
      k.box(31, 1.4, 21, 0, 14.6, -3, "#d6ccba");
      k.box(31, 1.8, 21, 0, 16, -3, "#d0c5b2");
      k.sign("M·AGRIPPA·L·F·COS·TERTIVM·FECIT", 26, 1.2, 0, 16.3, 7.54, { ink: "#4a4034" });
      k.cornice(31, 21, 0, 17.8, -3, "#dfd6c5", 0.3);
      k.gable(33, 6.4, 21.8, 0, 18.6, -3, "#d7cfbe");
      k.gable(28, 4.8, 0.4, 0, 19, 7.7, "#bfb4a0");
      k.box(4.6, 9.4, 0.4, 0, 0.9, -8, "#3a3128");
      k.box(4.2, 9, 0.2, 0, 1, -7.7, "#5b4a35");
      k.box(0.1, 9, 0.3, 0, 1, -7.7, "#2a241c");
      for (const x of [-9, 9]) k.box(4, 8, 0.4, x, 1, -8.6, "#d6c9b4");

      /* I palazzi che fanno da quinta. A sinistra ocra e giallo. */
      const left = [[-30, "#e0a64a", 19], [-45, "#d98f3f", 22]];
      for (const [x, hex, h] of left) {
        k.rough(14.6, h, 16, x, 0, 12, hex, 1.6, 0.05);
        k.box(14.8, 3.6, 16.2, x, 0, 12, "#cdb491");
        k.cornice(14.6, 16, x, h, 12, "#ecdab2");
        k.hip(16.4, 18, 2.2, x, h + 0.7, 12, "#a65a38");
        k.windows(3, 4, 1.25, 2.4, x, 5, 20.06, 4.2, 3.6, "#ead7ae", "#2c2622", "#5b4631");
        k.box(2.4, 2.8, 0.1, x - 3.6, 0.2, 20.1, "#2e2822");
        k.box(2.8, 0.5, 1.2, x - 3.6, 3.1, 20.5, "#39424a");
        k.box(1.8, 1.4, 0.1, x + 3.4, 0.9, 20.1, "#d0a44a");
      }
      /* A destra arancio e rosso con il bugnato basso e il portone. */
      for (const [x, hex, h] of [[30, "#d9632c", 20], [45, "#c9502a", 23]]) {
        k.rough(14.6, h, 16, x, 0, 12, hex, 1.5, 0.08);
        for (let i = 0; i < 6; i++) k.box(14.8, 0.1, 16.2, x, 0.7 + i * 0.75, 12, "#b8772f");
        k.cornice(14.6, 16, x, h, 12, "#e6a767");
        k.hip(16.4, 18, 2.2, x, h + 0.7, 12, "#a65a38");
        k.windows(2, 3, 1.5, 2.5, x, 7.6, 20.06, 6, 4, "#e7ad6f", "#2c2622", "#6b3a22");
        k.arch(4.4, 5.4, 0.3, x, 0, 20.06, "#c7ad85", 0, 0.5);
        k.box(3.1, 3.6, 0.14, x, 0, 20.1, "#7a2418");
        k.box(0.08, 3.6, 0.2, x, 0, 20.14, "#3a140e");
      }
      /* I tavolini sotto gli ombrelloni. */
      for (const [x, z] of [[-17, 24], [-11, 27], [-20, 31], [-13, 33]]) {
        k.cyl(0.07, 2.7, x, 0, z, "#f4eddd", 6);
        const g = new THREE.ConeGeometry(2.8, 0.8, 8);
        g.translate(x, 3.1, z);
        k.push(g, "#f4eddd");
        k.cyl(0.6, 0.06, x, 0.74, z, "#3a3129", 8);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) k.box(0.4, 0.8, 0.4, x + dx, 0, z + dz, "#5d4a34");
      }
      /* I sampietrini: la piazza e le righe del selciato. */
      k.box(100, 0.05, 50, 0, 0.01, 27, "#8a8176");
      for (let i = 0; i < 23; i++) k.box(100, 0.02, 0.1, 0, 0.065, 3 + i * 2.1, "#73695e");
      for (const [x, z] of [[3, 27], [6, 25], [12, 29], [-4, 22], [15, 22], [1, 19]]) k.person(x, z, ["#2a2a33", "#7a3f2a", "#3b5a7f"][Math.floor(x + 20) % 3]);
      k.masses.push({ x: 0, z: -26, w: 40, d: 40 });
    },
  },

  /* Il Vittoriano: la scalea, l'altare, il portico curvo di colonne corinzie, i
     due propilei con le quadrighe alate in cima. */
  vittoriano: {
    lego: { file: "models/vittoriano.glb", masses: [{ x: 0, z: -9, w: 112, d: 82 }] },
    surf: 0,
    side: 1,
    offset: 62,
    look: 27,
    build(k) {
      const m = "#fbf8f1";
      const shade = "#e9e3d6";
      const deep = "#a9a08e";
      const bronze = "#4d4b36";
      const gold = "#c9a44a";

      /* La scalea d'ingresso tra i due avancorpi, con i gruppi dorati ai lati. */
      for (let i = 0; i < 16; i++) k.plain(44, (i + 1) * 0.5, 1.15, 0, 0, 31.4 - i * 1.1, i % 2 ? m : shade);
      for (const s of [1, -1]) {
        k.plain(34, 8, 18, s * 39, 0, 23, m);
        k.plain(34.6, 1, 18.6, s * 39, 0, 23, shade);
        k.balustrade(34, s * 39, 8, 31.6, m);
        k.plain(5, 7, 5, s * 24.5, 0, 34.5, m);
        k.cornice(5, 5, s * 24.5, 7, 34.5, shade);
        k.statue(s * 24.5, 7.7, 34.5, gold, 5);
        /* Le fontane dei due mari. */
        k.plain(12, 1.2, 4, s * 41, 0, 34, shade);
        k.plain(11, 0.2, 3, s * 41, 1.2, 34, "#7fb0b8");
        k.statue(s * 41, 1.4, 33, m, 3.4);
        /* Le Vittorie alate sulle colonne. */
        k.corinth(0.8, 9, s * 51, 8, 27, m, shade);
        k.statue(s * 51, 18.6, 27, gold, 3.4, true);
      }

      /* Il primo terrazzo e l'Altare della Patria: la Dea Roma nella nicchia
         d'oro, i fregi ai lati, il Milite Ignoto e i bracieri. */
      k.plain(112, 8, 44, 0, 0, -8, m);
      k.plain(60, 9, 3, 0, 8, 1, m);
      k.cornice(60, 3, 0, 17, 1, shade);
      k.plain(7, 7, 0.4, 0, 9.6, 2.7, gold);
      k.plain(4, 1.6, 2, 0, 8, 3.4, shade);
      k.statue(0, 9.6, 3.4, "#f3ecd8", 6);
      for (const s of [1, -1]) {
        k.plain(24, 4.4, 0.3, s * 17, 10.4, 2.6, "#e2dac8");
        for (let i = 0; i < 9; i++) k.plain(0.5, 4.4, 0.5, s * (5.6 + i * 2.9), 10.4, 2.7, m);
        k.cyl(0.5, 1.6, s * 6, 8, 5.6, bronze, 8);
        k.light(0.6, 0.5, 0.6, s * 6, 9.6, 5.6, "#ffb347");
      }
      k.plain(8, 0.8, 2.4, 0, 8, 5.4, shade);

      /* Le due rampe che salgono al secondo terrazzo. */
      for (const s of [1, -1]) {
        for (let i = 0; i < 18; i++) k.plain(16, (i + 1) * 0.5, 0.8, s * 40, 8, 11.6 - i * 0.8, i % 2 ? m : shade);
        k.plain(8, 11, 16, s * 52, 8, 5, m);
        k.cornice(8, 16, s * 52, 19, 5, shade);
        k.plain(1.2, 10, 15, s * 31.4, 8, 5, m);
      }
      k.plain(112, 9, 30, 0, 8, -15, m);

      /* Il monumento equestre sul suo piedistallo. */
      k.plain(16, 2, 12, 0, 17, -8, shade);
      k.plain(12, 9, 8, 0, 19, -8, m);
      k.plain(12.4, 2.6, 8.4, 0, 20.4, -8, "#cfc6ae");
      k.cornice(12, 8, 0, 28, -8, shade, 0.5);
      k.sphere(1, 0, 34.4, -8, bronze, 1.5, 1.7, 4.4);
      for (const [x, z] of [[0.9, -4.8], [-0.9, -4.8], [0.9, -11.2], [-0.9, -11.2]]) k.plain(0.7, 4.6, 0.7, x, 28.7, z, bronze);
      k.plain(1.7, 3.8, 2, 0, 34.8, -4.4, bronze);
      k.plain(1.2, 1.4, 3.2, 0, 37.6, -3, bronze);
      k.plain(0.7, 3, 0.7, 0, 31.6, -12.6, bronze);
      k.statue(0, 35.6, -8.6, bronze, 5.2);

      /* Il basamento alto del portico. */
      k.plain(112, 13, 34, 0, 17, -33, m);
      k.plain(112.6, 1.2, 34.6, 0, 17, -33, shade);
      k.cornice(112, 34, 0, 30, -33, shade, 0.6);
      for (let x = -52; x <= 52; x += 8) if (Math.abs(x) > 8) k.plain(1.6, 11, 0.6, x, 18.4, -15.7, shade);
      for (const s of [1, -1]) k.plain(5, 8.4, 0.4, s * 20, 18.2, -15.8, "#6a5a40");

      /* Il portico curvo: sedici colonne corinzie, la trabeazione, l'attico
         con le statue delle regioni. Dietro, il muro in ombra. */
      const B = 30.9;
      const R = 95;
      const CZ = 63.9;
      const N = 16;
      const A = 0.335;
      const arc = (a, r = R) => [Math.sin(a) * r, CZ - Math.cos(a) * r];
      const step = ((A * 2) / (N - 1)) * R;
      for (let i = 0; i < N; i++) {
        const a = -A + (i / (N - 1)) * A * 2;
        const [x, z] = arc(a);
        k.corinth(1.05, 14, x, B, z, "#fdfbf6", m);
        const [sx, sz] = arc(a, R + 0.6);
        k.statue(sx, B + 21.6, sz, m, 3.2);
      }
      for (let i = -1; i < N; i++) {
        const mid = -A + ((i + 0.5) / (N - 1)) * A * 2;
        const [px, pz] = arc(mid, R + 6.4);
        k.box(step * 1.16, 16.4, 1, px, B, pz, deep, -mid);
        const [tx, tz] = arc(mid, R + 3);
        k.box(step * 1.2, 2.4, 9, tx, B + 16, tz, m, -mid);
        k.box(step * 1.24, 0.8, 10, tx, B + 18.4, tz, shade, -mid);
        k.box(step * 1.2, 2.4, 7, tx, B + 19.2, tz, m, -mid);
      }

      /* I propilei: fronte di tempio, attico, e sopra la quadriga di bronzo
         con la Vittoria alata. */
      for (const s of [1, -1]) {
        const X = s * 46;
        const Z = -27;
        k.plain(20, 17, 16, X, B, Z, m);
        for (const x of [-7.5, -2.5, 2.5, 7.5]) k.corinth(1.05, 14, X + x, B, Z + 8.8, "#fdfbf6", m);
        k.plain(5, 11, 0.3, X, B + 0.5, Z + 8.1, "#6f6858");
        k.plain(21, 2.4, 19.6, X, B + 16, Z + 1.2, m);
        k.plain(21.6, 0.8, 20.2, X, B + 18.4, Z + 1.2, shade);
        k.gable(21.6, 4, 20.2, X, B + 19.2, Z + 1.2, m);
        k.plain(12, 7, 10, X, B + 19.2, Z - 1, m);
        k.cornice(12, 10, X, B + 26.2, Z - 1, shade, 0.5);
        const Q = B + 27;
        for (let i = 0; i < 4; i++) {
          const x = X - 3.9 + i * 2.6;
          k.sphere(1, x, Q + 3, Z + 0.6, bronze, 0.7, 0.85, 2.3);
          k.plain(0.8, 2.2, 1, x, Q + 3.4, Z + 2.6, bronze);
          k.plain(0.6, 0.7, 1.7, x, Q + 5.3, Z + 3.3, bronze);
          for (const dz of [-0.9, 2]) k.plain(0.34, 2.4, 0.34, x, Q, Z + dz, bronze);
        }
        k.plain(4.8, 2.4, 2.2, X, Q + 0.4, Z - 2.6, bronze);
        k.statue(X, Q + 2.4, Z - 2.5, bronze, 6.4, true);
        k.masses.push({ x: X, z: Z, w: 20, d: 16 });
      }

      /* I pennoni col tricolore. */
      for (const s of [1, -1]) {
        k.cyl(0.22, 30, s * 31, 0, 38, "#d8d8d8", 8, 0.12);
        [["#1f8a4c", 0], ["#f4f4f0", 1], ["#c8303a", 2]].forEach(([hex, n]) => k.plain(1.7, 3.2, 0.1, s * 31 + 1 + n * 1.7, 25.6, 38, hex));
      }

      k.masses.push({ x: 0, z: -9, w: 112, d: 82 });
      k.plain(124, 0.05, 30, 0, 0, 40, "#b8b1a2");
      for (const x of [-64, 64]) k.stonePine(x, 26, 13, 0, "#2f5a3a");
    },
  },

  /* Piazza di Spagna, dal lato della Barcaccia: la barca di travertino nella
     vasca ovale con la ringhiera e i paracarri, la scalinata con le azalee, la
     Trinità dei Monti e l'obelisco, i palazzi rossi e gialli accesi. */
  spagna: {
    lego: { file: "models/spagna.glb", masses: [{ x: 0, z: 26, w: 30, d: 14 }, { x: 0, z: -24, w: 46, d: 54 }] },
    side: -1,
    offset: 44,
    look: 12,
    view: { h: 7, r: 21 },
    build(k) {
      const trav = "#ece3d0";
      const step = "#dbcfb8";
      const boat = "#d8cba9";
      const F = 26; /* il centro della fontana */

      k.plain(120, 0.05, 44, 0, 0, 22, "#5f5a53");

      /* La vasca ovale. */
      const ring = new THREE.CylinderGeometry(15, 15, 0.8, 44);
      ring.scale(1, 1, 0.5);
      ring.translate(0, 0.4, F);
      k.push(ring, "#c9bfa9");
      const rim = new THREE.CylinderGeometry(15.6, 15.6, 0.22, 44);
      rim.scale(1, 1, 0.5);
      rim.translate(0, 0.84, F);
      k.push(rim, trav);
      const water = new THREE.CylinderGeometry(14.2, 14.2, 0.1, 44);
      water.scale(1, 1, 0.5);
      water.translate(0, 0.92, F);
      k.push(water, "#6fc0c4");

      /* La barca: scafo a mezzaluna con prua e poppa rialzate e arricciate. */
      const hull = new THREE.Shape();
      hull.moveTo(-9.6, 3.1);
      hull.quadraticCurveTo(-9.9, 2, -7.4, 1.25);
      hull.quadraticCurveTo(0, 0.5, 7.4, 1.25);
      hull.quadraticCurveTo(9.9, 2, 9.6, 3.1);
      hull.quadraticCurveTo(10.5, 2.2, 9.4, 0.7);
      hull.quadraticCurveTo(0, -0.5, -9.4, 0.7);
      hull.quadraticCurveTo(-10.5, 2.2, -9.6, 3.1);
      const shell = new THREE.ExtrudeGeometry(hull, { depth: 4.6, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, curveSegments: 16 });
      shell.translate(0, 0.5, F - 2.3);
      k.push(shell, boat);
      const inner = new THREE.CylinderGeometry(7.6, 7.6, 0.1, 30);
      inner.scale(1, 1, 0.3);
      inner.translate(0, 1.5, F);
      k.push(inner, "#8fd4d2");
      for (const s of [1, -1]) {
        /* Il volto del sole a prua e a poppa, e i getti. */
        k.sphere(0.95, s * 9.5, 2.6, F, "#c9b98f", 0.7, 1, 1);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          k.plain(0.14, 0.5, 0.14, s * 9.9, 2.5 + Math.sin(a) * 1.1, F + Math.cos(a) * 1.1, boat);
        }
        k.sphere(0.5, s * 10.8, 2.2, F, "#efe6cf", 1, 1, 1);
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          k.sphere(0.12, s * (11 + t * 2), 2.1 - t * t * 1.3, F, "#d8eff1", 1, 1, 1, 0);
        }
      }
      /* La fontanella al centro. */
      k.cyl(0.7, 1.5, 0, 0.9, F, boat, 12, 0.34);
      const bowl = new THREE.CylinderGeometry(2.1, 0.9, 0.6, 18);
      bowl.translate(0, 2.7, F);
      k.push(bowl, trav);
      k.cyl(1.95, 0.06, 0, 3, F, "#8fd4d2", 18);
      k.cyl(0.22, 1, 0, 3, F, trav, 8, 0.12);
      k.sphere(0.3, 0, 4.2, F, "#d8eff1", 1, 1.8, 1);
      /* Paracarri di travertino e ringhiera di ferro. */
      const P = 18;
      const post = (t) => [Math.cos(t) * P, F + Math.sin(t) * P * 0.56];
      for (let i = 0; i < P; i++) {
        const t0 = (i / P) * Math.PI * 2;
        const [x, z] = post(t0);
        k.lathe([[0.55, 0], [0.55, 1], [0.4, 1.3], [0.5, 1.5], [0.3, 1.8], [0, 1.9]], x, 0, z, "#d3c8b0", 10);
        const [x2, z2] = post(((i + 1) / P) * Math.PI * 2);
        const len = Math.hypot(x2 - x, z2 - z);
        const g = new THREE.BoxGeometry(len, 0.07, 0.07);
        g.rotateY(Math.atan2(-(z2 - z), x2 - x));
        g.translate((x + x2) / 2, 1.05, (z + z2) / 2);
        k.push(g, "#23262a");
      }

      /* La scalinata. */
      let y = 0;
      let z = 4;
      const pots = [];
      const flight = (n, w0, w1) => {
        for (let i = 0; i < n; i++) {
          y += 0.34;
          z -= 0.74;
          const w = w0 + ((w1 - w0) * i) / n;
          k.plain(w, y, 0.76, 0, 0, z, i % 2 ? trav : step);
          k.plain(w, 0.04, 0.12, 0, y, z + 0.33, "#b9ad96");
        }
      };
      flight(10, 44, 38);
      k.plain(46, y, 4.6, 0, 0, z - 2.3, trav);
      pots.push([y, z - 1.6, 21]);
      z -= 4.6;
      flight(11, 34, 30);
      k.plain(40, y, 5, 0, 0, z - 2.5, trav);
      pots.push([y, z - 2, 19]);
      z -= 5;
      flight(12, 34, 44);
      k.plain(60, y, 12, 0, 0, z - 6, trav);
      pots.push([y, z - 1, 22]);
      const Y = y;
      const top = z - 12;
      /* Le azalee: file di vasi rosa e l'aiuola in mezzo alle rampe. */
      const azalea = (x, zz, yy) => {
        k.cyl(0.5, 0.7, x, yy, zz, "#7f5a3c", 8, 0.62);
        k.sphere(0.9, x, yy + 1.2, zz, "#3f6e3a", 1, 0.7, 1, 1);
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26;
          k.sphere(0.46, x + Math.cos(a) * 0.55, yy + 1.56, zz + Math.sin(a) * 0.55, i % 2 ? "#e03f8a" : "#f06aa8", 1, 0.7, 1, 0);
        }
      };
      for (const [yy, zz, half] of pots) {
        for (let i = 0; i < 12; i++) {
          const x = -half + 1 + (i / 11) * (2 * half - 2);
          if (Math.abs(x) < 3 && yy < 5) continue;
          azalea(x, zz, yy);
        }
      }
      for (let i = 0; i < 6; i++) {
        azalea(-2.2, 2 - i * 1.4, 0.34 * (i * 1.9) + 0.4);
        azalea(2.2, 2 - i * 1.4, 0.34 * (i * 1.9) + 0.4);
      }
      /* Le balaustre di fianco, in salita. */
      for (const s of [1, -1]) {
        k.balustrade(19, s * 23, 2.2, -5, trav, Math.PI / 2 + s * 0.3, 1);
        k.balustrade(16, s * 20, 6.6, -21, trav, Math.PI / 2 - s * 0.16, 1);
        k.balustrade(16, s * 25, 10.6, -31, trav, Math.PI / 2 + s * 0.2, 1);
        k.plain(1.4, 1.8, 1.4, s * 23, 0, 4, trav);
        k.sphere(0.9, s * 23, 2.5, 4, trav);
        k.lamp(s * 28, -30, 5);
      }
      k.balustrade(44, 0, Y, z + 0.2, trav, 0, 1);
      k.plain(60, Y, 8, 0, 0, top - 4, "#d4c8ae");
      k.tree(23, top - 2, 4, "#2f5a3a", Y);

      /* L'obelisco. */
      const o = top - 2;
      k.plain(3.6, 3.4, 3.6, 0, Y, o, "#e4dac6");
      k.plain(4.4, 0.5, 4.4, 0, Y + 3.2, o, trav);
      const ob = new THREE.CylinderGeometry(0.46, 1.1, 22, 4);
      ob.rotateY(Math.PI / 4);
      ob.translate(0, Y + 14.6, o);
      k.push(ob, "#c9b28c");
      k.sphere(0.5, 0, Y + 25.9, o, "#e0c56a");

      /* La chiesa. */
      const C = top - 14;
      k.rough(30, 19, 8, 0, Y, C, "#f1e9d6", 1.8, 0.03);
      k.cornice(30, 8, 0, Y + 19, C, "#fbf5e6");
      for (let i = 0; i < 5; i++) k.plain(0.9, 16, 0.5, -12 + i * 6, Y + 2, C + 4.2, "#fbf5e6");
      k.arch(5, 8, 0.5, 0, Y + 2, C + 4.2, "#fbf5e6", 0, 0.55);
      k.plain(3.2, 5, 0.2, 0, Y + 2, C + 4.1, "#4a3a2c");
      for (const x of [-6, 6]) k.win(x, Y + 11, C + 4.06, 2, 3.4, { frame: "#fbf5e6", pane: "#4a4640", pediment: "tri" });
      for (let i = 0; i < 10; i++) k.plain(26 - i * 1.6, 0.4, 0.8, 0, Y + i * 0.4, C + 5 + (9 - i) * 0.7, trav);
      for (const s of [1, -1]) {
        const x = s * 10.5;
        k.rough(7, 13, 7, x, Y + 19.6, C, "#f4ecda", 1.8, 0.03);
        k.cornice(7, 7, x, Y + 32.6, C, "#fbf5e6");
        k.win(x, Y + 24.6, C + 3.56, 2.2, 5, { frame: "#fbf5e6", pane: "#3a3a3a", arched: true, sill: false });
        k.cyl(2.6, 1.4, x, Y + 33.3, C, "#f4ecda", 14);
        k.lathe([[2.8, 0], [2.4, 1.6], [1.4, 3], [0.4, 3.8], [0.1, 5.4], [0, 6]], x, Y + 34.7, C, "#5f7f94", 16);
        k.balustrade(12, s * 12, Y + 0.4, C + 8, "#f4ecda", s * 0.7, 1);
      }
      k.palm(21, C + 7, 14);

      /* I palazzi. */
      const house = (x, zc, hex, h, w, d, cols, rows, trim = "#efdcbc") => {
        k.rough(w, h, d, x, 0, zc, hex, 1.5, 0.04);
        k.plain(w + 0.3, 3.8, d + 0.3, x, 0, zc, tint(hex, "#3a2a22", 0.18));
        for (const e of [-1, 1]) for (let i = 0; i < h / 1.6; i++) k.plain(i % 2 ? 1.5 : 1, 0.74, 0.3, x + e * (w / 2 - 0.5), 0.3 + i * 1.6, zc + d / 2 + 0.06, tint(hex, "#ffffff", 0.4));
        k.cornice(w, d, x, h, zc, trim);
        k.hip(w + 1.8, d + 1.8, 3, x, h + 0.7, zc, "#9a4f2c");
        const front = zc + d / 2 + 0.08;
        k.windows(cols, rows, 1.4, 2.7, x, 5.2, front, (w - 5) / Math.max(1, cols - 1), (h - 7) / rows, trim, "#2b2622", "#2f4f3e", { pediment: "tri" });
        for (let i = 0; i < cols; i++) {
          const wx = x - (w - 5) / 2 + (i * (w - 5)) / Math.max(1, cols - 1);
          k.plain(2, 2.9, 0.14, wx, 0.3, front, "#3a2c20");
          k.light(1.6, 2.4, 0.12, wx, 0.5, front + 0.08, "#ffc873");
          k.light(1.1, 2.1, 0.12, wx, 8.9, front + 0.04, "#ffbe6b");
        }
      };
      house(-46, -2, "#b4502c", 25, 34, 30, 6, 4);
      house(-82, -2, "#d99a3c", 21, 26, 30, 5, 4, "#f4e0b4");
      house(-110, 4, "#e9dcc6", 19, 22, 28, 4, 4, "#fbf5e6");
      house(46, -2, "#ecc27e", 22, 34, 30, 6, 4);
      house(82, -2, "#e6b693", 20, 26, 30, 5, 4);
      k.lamp(-30, 18, 5.6);
      k.lamp(30, 18, 5.6);
      k.masses.push({ x: 0, z: F, w: 30, d: 14 }, { x: 0, z: -24, w: 46, d: 54 });
    },
  },

  /* Torre della Scimmia, come nella foto: il corpo d'angolo di pietra con il
     bugnato, il portone ad arco e la porta col cartiglio, la terrazza con la
     balaustra e gli arbusti; dietro la torre di mattoni con gli archetti e le
     finestre bianche, e a destra il palazzo chiaro. */
  tower: {
    lego: { file: "models/tower.glb" },
    side: -1,
    offset: 24,
    look: 17,
    build(k) {
      const stone = "#b9b3a4";
      const quoin = "#8f8a7d";
      const pale = "#e6dfcf";
      const G = 9.4; /* il corpo basso */
      const W = 20;

      /* Il corpo d'angolo. */
      k.rough(W, G, 12, 0, 0, -4, stone, 1.1, 0.05);
      k.plain(W + 0.4, 0.5, 12.4, 0, 0, -4, "#7e796d");
      /* Il bugnato: conci alternati lunghi e corti sui due spigoli e in mezzo. */
      for (const x of [-W / 2 + 0.7, -0.6, W / 2 - 0.7]) {
        for (let i = 0; i < 9; i++) k.plain(i % 2 ? 2.4 : 1.6, 0.82, 0.32, x, 0.3 + i * 0.96, 2.1, quoin);
      }
      /* La fascia e il cornicione. */
      k.plain(W + 0.5, 0.4, 12.5, 0, G - 2.2, -4, pale);
      k.cornice(W, 12, 0, G, -4, pale, 0.3);

      /* A sinistra: la porta scura col telaio di pietra, il cartiglio, la finestra. */
      const L = -5.2;
      k.plain(3.6, 4.6, 0.2, L, 0.3, 2.06, pale);
      k.plain(2.5, 3.9, 0.24, L, 0.3, 2.08, "#191b1c");
      k.plain(4.2, 0.9, 0.3, L, 5, 2.1, "#d9d2c0");
      k.sign("BARBIERE", 3.4, 0.5, L, 5.2, 2.3, { ink: "#26211c", font: "700 60px Arial, sans-serif" });
      k.win(L, 6.2, 2.06, 2.2, 1.3, { frame: pale, pane: "#242829", sill: false });
      for (let i = 0; i < 6; i++) k.plain(0.05, 1.3, 0.05, L - 0.9 + i * 0.36, 6.2, 2.3, "#1e2022");

      /* A destra: l'arco, le bugne a raggio, il portone di legno. */
      const D = 4.6;
      k.arch(8.2, G - 1.6, 0.8, D, 0, 2.2, "#cfc8b6", 0, 0.62);
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * (i / 12);
        k.box(0.62, 1, 0.42, D + Math.cos(a) * 3.3, 4.75 + Math.sin(a) * 2.75, 2.6, i % 2 ? "#dcd5c3" : "#bdb6a4", -a + Math.PI / 2);
      }
      k.plain(5.5, 4.8, 0.14, D, 0, 1.94, "#a29682");
      k.plain(0.1, 4.8, 0.2, D, 0, 1.98, "#5d5240");
      for (const x of [-1.35, 1.35]) for (const y of [0.3, 1.9, 3.3]) k.plain(2.1, y === 3.3 ? 1.2 : 1.35, 0.2, D + x, y, 1.98, "#b5a994");
      const fan = new THREE.CircleGeometry(2.7, 18, 0, Math.PI);
      fan.translate(D, 4.75, 2.04);
      k.push(fan, "#1c1d1e");
      for (let i = 0; i < 7; i++) {
        const g = new THREE.BoxGeometry(0.06, 2.6, 0.06);
        g.translate(0, 1.3, 0);
        g.rotateZ((i - 3) * 0.46);
        g.translate(D, 4.75, 2.1);
        k.push(g, "#77787a");
      }

      /* La terrazza: balaustra con i pilastrini e gli arbusti dietro. */
      k.balustrade(W, 0, G + 0.72, 1.9, pale, 0, 1.3);
      for (const x of [-W / 2 + 0.5, -3.2, 3.2, W / 2 - 0.5]) {
        k.plain(0.9, 1.7, 0.9, x, G + 0.72, 1.9, pale);
        k.sphere(0.44, x, G + 2.8, 1.9, "#d4cdbb", 1, 1.1, 1);
      }
      k.balustrade(12, W / 2, G + 0.72, -4, pale, Math.PI / 2, 1.3);
      for (const [x, r, c] of [[-8, 1.7, "#2f5230"], [-4.6, 2.1, "#263f28"], [-0.8, 1.8, "#35593a"], [3, 2.3, "#2a4a2d"], [6.6, 1.9, "#35593a"], [9, 1.5, "#2f5230"]]) {
        k.bush(x, -0.4, r, c, G + 1.7);
      }

      /* La torre, che sale da dietro la terrazza. */
      const X = -3.6;
      const Z = -6;
      const T = 11;
      k.rough(T, 34, T, X, 0, Z, "#a07a58", 0.7, 0.05);
      k.rough(T + 0.06, 9, T + 0.06, X, 16, Z, "#9a7350", 0.7, 0.05);
      /* Gli archetti su mensole, su tutti e quattro i lati. */
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        k.frame(X, 33.2, Z, a, () => {
          for (let i = 0; i < 7; i++) {
            k.arch(1.42, 1.5, 0.5, -4.3 + i * 1.43, 0.2, T / 2 + 0.2, "#8e6a49", 0, 0.55);
            k.plain(0.26, 0.3, 0.8, -3.58 + i * 1.43, 0, T / 2 + 0.2, pale);
          }
        });
      }
      k.rough(T + 1, 2.2, T + 1, X, 34.9, Z, "#a07a58", 0.7, 0.05);
      k.plain(T + 1.4, 0.3, T + 1.4, X, 37.1, Z, "#7f6346");
      /* Le finestre, una per piano, con il telaio bianco. */
      const f = Z + T / 2 + 0.02;
      k.win(X, 29.6, f, 1.7, 1.7, { frame: "#f4efe3", pane: "#1a1c1e", sill: false });
      k.plain(2.5, 2.5, 0.14, X, 29.2, f - 0.02, "#efe9dc");
      k.win(X, 22.8, f, 1.7, 2, { frame: "#f4efe3", pane: "#25282a" });
      k.win(X, 15.6, f, 2, 4, { frame: "#f4efe3", pane: "#c9c9c2" });
      k.plain(3, 0.14, 0.9, X, 15.2, f + 0.4, "#d9d2c0");
      k.plain(3, 0.9, 0.05, X, 15.3, f + 0.84, "#26282a");
      k.win(X + 5.7, 22, Z, 0.1, 0.1, { frame: "#a07a58", pane: "#a07a58", sill: false });

      /* Il palazzo chiaro a destra, col tetto sporgente. */
      const P = 11.5;
      k.rough(16, 24, 15, P, 0, -11, "#e6cf8f", 1.8, 0.04);
      k.plain(16.4, 0.3, 15.4, P, 16.2, -11, "#f1e2b8");
      k.plain(17.6, 0.5, 16.6, P, 24, -11, "#6e5238");
      k.hip(17, 16, 2, P, 24.5, -11, "#8a5a3a", 0.2);
      for (const y of [11.4, 17.4]) k.windows(2, 1, 2, 3.8, P + 1, y, -3.44, 6, 4, "#f7f0dd", "#cfd0c9", null, { pediment: y < 13 ? "tri" : null });
      k.windows(2, 1, 1.5, 1.3, P + 1, 22, -3.44, 6, 4, "#f7f0dd", "#38322c", null, { sill: false });
      for (const x of [P - 2, P + 4]) k.plain(3, 0.9, 0.05, x, 11.3, -3.1, "#2b2d30");

      /* Le case della via a destra e il palazzo alto a sinistra. */
      k.rough(11, 22, 14, 25, 0, -3, "#c9673a", 1.6, 0.05);
      k.cornice(11, 14, 25, 22, -3, "#ecd4a6");
      k.hip(12.4, 15.4, 2.2, 25, 22.7, -3, "#a2552f");
      k.windows(2, 5, 1.2, 2.2, 25, 3.4, 4.06, 4, 3.7, "#efe6d2", "#3a3129", "#5b4631");
      k.rough(13, 30, 15, -18, 0, -5, "#e8dcc4", 1.8, 0.04);
      k.cornice(13, 15, -18, 30, -5, "#f8f1e0");
      k.hip(14.4, 16.4, 2.2, -18, 30.7, -5, "#a2552f");
      k.windows(2, 7, 1.5, 2.6, -18, 3.6, 2.56, 5.4, 3.8, "#fbf5e6", "#39424a", "#4b5a52");

      /* Il selciato e la fioriera in basso. */
      k.plain(60, 0.05, 20, 2, 0, 11, "#6a6258");
      k.plain(5, 0.7, 1.5, 12.5, 0, 6, "#8f8a7d");
      for (let i = 0; i < 5; i++) k.bush(10.6 + i * 1, 6, 0.8, "#3f7a3f", 1);
      k.lamp(-11, 7, 5);
    },
  },

  /* L'Ascensor da Bica: la via stretta e ripida, le case alte e stinte con i
     ferri dei balconi e le lanterne a muro, il selciato, il carro bianco e giallo
     sulle rotaie, i fili in aria, la luce in fondo. */
  tram: {
    lego: {
      file: "models/tram.glb",
      extra: [{ file: "models/tramStreet.glb", pivotZ: 6, tiltX: 0.16 }],
      mover: { file: "models/tramCar.glb", rig: { rotY: Math.PI / 2, tilt: 0.16, x: 0, y: 0.1, z: 6, base: 30, range: 16 } },
    },
    side: 1,
    offset: 12,
    look: 9,
    build(k) {
      const S = 0.16;
      const up = (z) => (6 - z) * Math.tan(S);
      const strip = (w, x, y, hex, len = 150) => {
        const r = new THREE.BoxGeometry(w, 0.2, len);
        r.rotateX(S);
        r.translate(x, up(-69) + y, -69);
        k.push(r, hex);
      };
      strip(12.4, 0, -0.1, "#6d6a65");
      strip(1.1, 0, 0.03, "#57544f");
      for (const x of [-1.5, -0.7, 0.7, 1.5]) strip(0.1, x, 0.08, "#8d8f92");
      for (const s of [1, -1]) strip(2.6, s * 4.9, 0.1, "#cfc8b8");
      /* I gradini dei marciapiedi. */
      for (const s of [1, -1]) {
        for (let z = -10; z > -140; z -= 2.2) k.plain(2.6, 0.08, 0.16, s * 4.9, up(z) + 0.24, z, "#e4decf");
      }

      /* Una fila di case lungo la salita. */
      const row = (x, face, list) => {
        let z = -6;
        for (const [len, hex, floors, opts = {}] of list) {
          const zc = z - len / 2;
          const base = up(z - len);
          const y0 = up(zc);
          const h = floors * 3.5 + 2;
          k.box(10, h + (up(z - len) - up(z)) * -1 + 4, len, x + face * 5, up(z) - 1, zc, hex);
          k.box(10.5, 0.4, len + 0.3, x + face * 5, base + h, zc, "#efe9dc");
          k.hip(10.8, len + 0.8, 2.2, x + face * 5, base + h + 0.4, zc, "#b8603b");
          k.frame(x, 0, zc, -face * Math.PI / 2, () => {
            k.plain(len, 1.4, 0.14, 0, y0 - 0.5, 0.05, opts.base ?? "#8f8a80");
            const n = Math.max(2, Math.floor(len / 4));
            for (let f = 0; f < floors; f++) {
              for (let i = 0; i < n; i++) {
                const wx = (i - (n - 1) / 2) * (len / n);
                const wy = y0 + 3.2 + f * 3.5;
                k.plain(2, 2.9, 0.14, wx, wy - 0.2, 0.08, "#ece6d8");
                k.plain(1.4, 2.4, 0.18, wx, wy + 0.04, 0.1, opts.pane ?? "#39424a");
                k.plain(0.07, 2.4, 0.24, wx, wy + 0.04, 0.12, "#f3eee2");
                if (opts.balcony && f > 0) {
                  k.plain(2.6, 0.12, 0.9, wx, wy - 0.4, 0.5, "#3b3f3a");
                  k.plain(2.6, 1, 0.05, wx, wy - 0.28, 0.94, "#272b28");
                  for (let b = 0; b < 8; b++) k.plain(0.04, 1, 0.04, wx - 1.2 + b * 0.34, wy - 0.28, 0.94, "#272b28");
                  if ((i + f) % 3 === 0) k.bush(wx + 0.5, 0.8, 0.42, ["#c7415a", "#5c8f47", "#e8a33a"][(i + f) % 3 === 0 ? f % 3 : 0], wy + 0.4);
                }
              }
            }
            k.plain(1.7, 3, 0.14, -len * 0.3, y0, 0.1, "#3c3f40");
            k.plain(2.4, 3.6, 0.1, -len * 0.3, y0, 0.05, "#d3cab8");
            /* La lanterna sul braccio di ferro. */
            k.plain(0.08, 0.08, 1.3, len * 0.3, y0 + 5.6, 0.7, "#23262a");
            k.plain(0.5, 0.8, 0.5, len * 0.3, y0 + 4.7, 1.3, "#f4efd9");
            k.plain(0.6, 0.12, 0.6, len * 0.3, y0 + 5.5, 1.3, "#23262a");
          });
          z -= len + 0.15;
        }
      };
      const left = [[14, "#efe7da", 4], [12, "#ecc9a8", 4, { balcony: true }], [13, "#f1ece0", 5], [12, "#e8dcc4", 4, { balcony: true }], [14, "#f0d9b5", 4], [13, "#efe7da", 3], [14, "#e9c9a8", 3], [13, "#f1ece0", 3], [14, "#e8dcc4", 3], [14, "#ecd9b3", 3]];
      const right = [[13, "#f3df9c", 5, { balcony: true }], [13, "#f1ece0", 4], [12, "#f0d075", 4, { balcony: true }], [14, "#efe7da", 5, { balcony: true }], [12, "#efc26a", 4], [14, "#f3ead6", 4, { balcony: true }], [13, "#e9c9a8", 3], [14, "#f1ece0", 3], [13, "#f0d9b5", 3], [14, "#efe7da", 3]];
      row(-6.4, -1, left);
      row(6.4, 1, right);
      /* Le testate verso la strada, che si vedono per prime. */
      for (const [x, hex, floors] of [[-11.4, "#efe7da", 4], [11.4, "#f3df9c", 5]]) {
        k.windows(2, floors, 1.5, 2.3, x, 3.2, -5.9, 5, 3.5, "#fbf7ee", "#39424a", x < 0 ? "#3b6f5e" : null, { sill: true });
        k.plain(10, 2.4, 0.2, x, 0, -5.9, "#8f8a80");
      }
      /* Dietro le prime file, i tetti del quartiere che sale. */
      for (const s of [1, -1]) {
        for (let i = 0; i < 7; i++) {
          const z = -14 - i * 20;
          const x = s * (24 + (i % 2) * 3);
          const h = 18 + (i % 3) * 3;
          k.box(13, h, 18, x, up(z) - 1, z, ["#efe7da", "#ecd9b3", "#e9c9a8", "#f1ece0"][i % 4]);
          k.hip(14, 19, 2.6, x, up(z) - 1 + h, z, "#b8603b");
          if (i === 0) k.windows(3, 4, 1.4, 2.2, x, 3.4, z + 9.06, 3.8, 3.6, "#fbf7ee", "#39424a", "#3b6f5e");
        }
      }
      /* I fili sopra la via. */
      for (const dx of [-1.6, 1.6]) {
        const w = new THREE.BoxGeometry(0.03, 0.03, 150);
        w.rotateX(S);
        w.translate(dx, up(-69) + 8, -69);
        k.push(w, "#2b2c2f");
      }
      for (const z of [-16, -40, -66, -92, -118]) {
        k.plain(13, 0.03, 0.03, 0, up(z) + 8, z, "#2b2c2f");
        k.plain(13, 0.03, 0.03, 0, up(z) + 9.6, z + 4, "#2b2c2f");
      }

      /* Il carro: giallo sotto, bianco sopra, vetri scuri, il faro tondo. */
      const m = new Kit();
      m.plain(8, 1.7, 2.5, 0, 0.5, 0, "#f2c21a");
      m.plain(8.1, 0.12, 2.56, 0, 2.18, 0, "#c9901a");
      m.plain(8, 1.5, 2.5, 0, 2.3, 0, "#fbf6e8");
      m.plain(8.2, 0.26, 2.66, 0, 3.8, 0, "#efe9d8");
      for (const s of [1, -1]) {
        for (let i = 0; i < 5; i++) {
          m.plain(1.2, 1.2, 0.08, -3 + i * 1.5, 2.42, s * 1.27, "#efe9d8");
          m.plain(1, 1, 0.1, -3 + i * 1.5, 2.52, s * 1.28, "#252f36");
        }
        m.plain(0.08, 1.2, 1.9, s * 4.02, 2.42, 0, "#efe9d8");
        m.plain(0.1, 1, 1.66, s * 4.03, 2.52, 0, "#252f36");
        m.sphere(0.2, s * 4.08, 1.2, 0, "#fff0b8");
      }
      for (const x of [-2.4, 2.4]) m.plain(1.6, 0.5, 2, x, 0, 0, "#2b2b2b");
      m.plain(0.1, 2.2, 0.1, 0.8, 4, 0, "#26282c");
      k.mover = m;
      k.rig = { rotY: Math.PI / 2, tilt: S, x: 0, y: 0.1, z: 6, base: 30, range: 16 };
    },
  },

  /* La Torre di Belém al tramonto: pietra chiara stinta dal mare, il bastione
     basso sull'acqua alla sua sinistra, le garitte, i merli a scudo, e la
     passerella di legno con il parapetto rosso che arriva da riva. */
  belem: {
    lego: { file: "models/belem.glb", masses: [{ x: -3, z: 0, w: 30, d: 30 }] },
    surf: 2,
    side: -1,
    offset: 58,
    look: 19,
    build(k) {
      const stone = "#e3dccd";
      const pale = "#f0ebdf";
      const deep = "#a89c86";
      const merlon = (x, y, z, ry) => {
        k.frame(x, y, z, ry, () => {
          k.plain(1, 1.1, 0.4, 0, 0, 0, pale);
          const g = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10, 1, false, -Math.PI / 2, Math.PI);
          g.rotateX(Math.PI / 2);
          g.rotateZ(Math.PI / 2);
          g.translate(0, 1.1, 0);
          k.push(g, pale);
          k.plain(0.14, 0.7, 0.44, 0, 0.5, 0, deep);
          k.plain(0.5, 0.14, 0.44, 0, 0.74, 0, deep);
        });
      };
      k.frame(0, 0, 0, -2.5, () => {
        const pts = [[-13, -3], [13, -3], [13, 9], [7, 21], [-7, 21], [-13, 9]];
        const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
        const b = new THREE.ExtrudeGeometry(shape, { depth: 7.4, bevelEnabled: false });
        b.rotateX(-Math.PI / 2);
        b.translate(0, -1.4, 0);
        k.push(b, stone);
        /* La striscia scura che lascia la marea. */
        const tide = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false });
        tide.rotateX(-Math.PI / 2);
        tide.scale(1.02, 1, 1.02);
        tide.translate(0, -1.4, 0);
        k.push(tide, "#5f5a50");
        for (let i = 0; i < pts.length; i++) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[(i + 1) % pts.length];
          const len = Math.hypot(bx - ax, bz - az);
          const ry = Math.atan2(-(bz - az), bx - ax);
          if (i !== 0) {
            k.frame((ax + bx) / 2, 0, (az + bz) / 2, ry, () => {
              k.plain(len, 0.3, 0.3, 0, 5.2, 0.1, pale);
              const n = Math.floor(len / 1.75);
              for (let j = 0; j < n; j++) merlon(-len / 2 + (j + 0.5) * (len / n), 6, 0, 0);
              for (let j = 0; j < n / 2; j++) k.plain(0.9, 1.5, 0.2, -len / 2 + 1.4 + j * 3.4, 1.8, 0.04, "#2f2a25");
            });
          }
          k.lathe([[1.2, 0], [1.2, 3.4], [1.5, 3.6], [1.4, 3.9], [1, 4.5], [0.4, 5.1], [0.12, 5.5], [0, 5.9]], ax, 4.4, az, pale, 10);
          for (let j = 0; j < 8; j++) {
            const a = (j / 8) * Math.PI * 2;
            k.plain(0.08, 1.5, 0.08, ax + Math.cos(a) * 1.2, 7.8, az + Math.sin(a) * 1.2, deep);
          }
        }
        k.plain(21, 0.3, 21, 0, 5.9, 8.8, "#d4ccba");

        /* La torre, con la pietra stinta a chiazze. */
        const T = 14;
        const z0 = -7;
        k.rough(T, 13, T, 0, 0, z0, stone, 1.1, 0.12);
        k.rough(T - 1.2, 15, T - 1.2, 0, 13, z0, stone, 1.1, 0.12);
        k.rough(T - 3, 6, T - 3, 0, 28, z0, "#dbd3c2", 1.1, 0.12);
        k.plain(T + 0.3, 1.2, T + 0.3, 0, -1, z0, "#5f5a50");
        for (const [y, w] of [[13, T + 0.8], [21, T - 0.4], [28, T - 0.4]]) {
          k.plain(w, 0.42, w, 0, y, z0, pale);
          for (const s of [1, -1]) {
            for (let i = 0; i < w / 0.6; i++) {
              const x = -w / 2 + i * 0.6;
              k.sphere(0.24, x, y + 0.2, z0 + s * (w / 2 + 0.04), pale, 1.2, 1, 0.7);
              k.sphere(0.24, s * (w / 2 + 0.04), y + 0.2, z0 + x, pale, 0.7, 1, 1.2);
            }
          }
        }
        for (const [y, w] of [[28.5, T - 0.4], [34, T - 3]]) {
          const n = Math.floor(w / 1.75);
          for (let i = 0; i < n; i++) {
            const p = -w / 2 + (i + 0.5) * (w / n);
            merlon(p, y, z0 + w / 2, 0);
            merlon(p, y, z0 - w / 2, Math.PI);
            merlon(w / 2, y, z0 + p, Math.PI / 2);
            merlon(-w / 2, y, z0 + p, -Math.PI / 2);
          }
        }
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const x = sx * (T / 2 - 0.2);
          const z = z0 + sz * (T / 2 - 0.2);
          k.cyl(1.05, 5, x, 24.4, z, pale, 10, 1.25);
          k.lathe([[1.4, 0], [1.3, 0.5], [0.9, 1.1], [0.35, 1.8], [0.1, 2.4], [0, 2.7]], x, 29.4, z, stone, 10);
        }
        k.lathe([[2.4, 0], [2.2, 0.8], [1.4, 2], [0.5, 2.8], [0.14, 3.4], [0, 3.8]], 0, 35, z0, stone, 12);

        /* Ai lati della torre: i balconcini a garitta con la cupoletta. */
        for (const [x, z, ry] of [[-T / 2 - 0.6, z0 + 1, 0], [T / 2 + 0.6, z0 + 1, 0], [0, z0 - T / 2 - 0.6, 0]]) {
          k.cyl(1.2, 3.2, x, 15.4, z, pale, 8, 1.3);
          k.lathe([[1.5, 0], [1.1, 0.8], [0.3, 1.5], [0, 1.9]], x, 18.6, z, deep, 8);
          k.plain(1, 1.8, 0.1, x, 16, z + 1.25, "#2a2521");
        }

        /* La loggia veneziana. */
        const f = z0 + T / 2 - 0.5;
        k.plain(9.6, 0.5, 3.4, 0, 14.2, f + 1.6, pale);
        k.balustrade(9.6, 0, 14.7, f + 3.1, pale, 0, 1);
        for (const s of [1, -1]) k.balustrade(3, s * 4.8, 14.7, f + 1.6, pale, Math.PI / 2, 1);
        for (let i = 0; i < 3; i++) {
          const x = -3 + i * 3;
          k.plain(2.5, 3.8, 0.2, x, 15, f, "#2a2521");
          k.arch(2.9, 5.2, 0.5, x, 14.8, f + 0.3, pale, 0, 0.42);
        }
        for (const x of [-4.4, -1.5, 1.5, 4.4]) k.column(0.2, 3.4, x, 14.8, f + 1.2, pale);
        k.plain(9.8, 0.7, 2.6, 0, 19, f + 1, stone);
        k.plain(2, 2.4, 0.3, 0, 22.4, f + 0.4, pale);
        k.sphere(0.8, 0, 23.6, f + 0.7, deep);
        /* Finestre su ogni lato. */
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          k.frame(0, 0, z0, a, () => {
            k.win(0, 22.4, T / 2 - 0.5, 1.3, 2.6, { frame: pale, pane: "#2a2521", arched: true, sill: false });
            k.win(0, 30, T / 2 - 1.4, 1, 1.8, { frame: pale, pane: "#2a2521", arched: true, sill: false });
            k.win(0, 8.8, T / 2 + 0.02, 1.2, 2, { frame: pale, pane: "#2a2521", arched: true, sill: false });
          });
        }
      });
      /* L'ingresso e la passerella dal lungofiume alla torre. */
      const X = 5;
      k.plain(3.4, 3.6, 1, X, 0, 12, "#2a2521");
      k.frame(X, 0, 30, 0, () => {
        k.plain(3.8, 0.3, 36, 0, 1.3, 0, "#6a5344");
        for (let i = 0; i < 18; i++) k.plain(3.8, 0.04, 0.1, 0, 1.6, -17 + i * 2, "#4d3b30");
        for (const s of [1, -1]) {
          k.plain(0.24, 0.24, 36, s * 1.85, 2.9, 0, "#a8342a");
          k.plain(0.12, 0.12, 36, s * 1.85, 2.2, 0, "#a8342a");
          for (let i = 0; i < 12; i++) {
            k.plain(0.26, 1.5, 0.26, s * 1.85, 1.5, -17 + i * 3.1, "#8f2a22");
            k.plain(0.3, 4, 0.3, s * 1.6, -2.4, -17 + i * 3.1, "#3a2c24");
          }
        }
      });
      /* La banchina a destra, il grande albero e la palma contro il sole. */
      k.plain(52, 2, 12, 66, -1, 8, "#cfc3ae");
      k.plain(52, 0.4, 12.6, 66, 0.9, 8, "#e6dcc8");
      k.tree(60, 8, 6, "#2f4a34", 1);
      k.palm(78, 8, 10);
      k.masses.push({ x: -3, z: 0, w: 30, d: 30 });
    },
  },

  /* Praça do Comércio: la U gialla di portici bianchi aperta sul Tago, i
     torrioni chiari sull'acqua, i tetti di cotto, l'Arco di Rua Augusta, Dom José
     sul suo basamento bianco, e le grandi losanghe bianche sul selciato. */
  comercio: {
    lego: { file: "models/comercio.glb" },
    side: -1,
    offset: 100,
    look: 12,
    view: { h: 30, r: 40 },
    build(k) {
      const yellow = "#ffd34a";
      const trim = "#fbf4e2";
      const roof = "#c2552f";
      const wing = (len, depth = 16) => {
        const bays = Math.round(len / 6.2);
        const b = len / bays;
        k.box(len, 18, depth, 0, 0, -depth / 2, yellow);
        k.plain(len, 6.8, 0.3, 0, 0, 0.1, trim);
        for (let i = 0; i < bays; i++) {
          const x = -len / 2 + (i + 0.5) * b;
          k.arch(b, 6.4, 1.3, x, 0, 0.5, trim, 0, 0.52);
          k.plain(b * 0.6, 4.6, 0.12, x, 0, 0.1, "#3a3129");
          k.light(b * 0.5, 3.6, 0.1, x, 0, 0.2, "#ffcf80");
          k.win(x, 8, 0.06, 1.6, 2.8, { frame: trim, pane: "#2c3a44", pediment: i % 3 === 1 ? "tri" : "arc" });
          k.plain(2.8, 0.14, 0.7, x, 7.6, 0.3, trim);
          k.plain(2.6, 0.7, 0.05, x, 7.72, 0.62, "#2c2f33");
          k.win(x, 13, 0.06, 1.5, 2.2, { frame: trim, pane: "#2c3a44" });
        }
        k.plain(len, 0.34, 0.5, 0, 6.8, 0.2, trim);
        k.cornice(len, depth, 0, 18, -depth / 2, trim);
        k.hip(len + 1, depth + 1, 5.4, 0, 18.7, -depth / 2, roof);
        for (let i = 0; i < bays; i += 2) k.plain(1.2, 1.5, 1.2, -len / 2 + (i + 1) * b, 20.2, -depth / 2 + 3, "#f4eddc");
      };
      /* I torrioni sul fiume, chiari, con il tetto a padiglione. */
      const tower = (x, z) => {
        k.box(21, 22, 21, x, 0, z, "#f4ecd9");
        k.cornice(21, 21, x, 22, z, trim);
        k.hip(23, 23, 6, x, 22.7, z, roof, 0);
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          k.frame(x, 0, z, a, () => {
            for (const wx of [-6, 0, 6]) {
              k.arch(5.6, 6.6, 1, wx, 0, 10.7, trim, 0, 0.52);
              k.win(wx, 8.6, 10.56, 1.9, 3.2, { frame: trim, pane: "#2c3a44", pediment: "tri" });
              k.win(wx, 15, 10.56, 1.7, 2.6, { frame: trim, pane: "#2c3a44" });
            }
            for (const px of [-10.4, 10.4]) k.plain(0.8, 22, 0.4, px, 0, 10.6, trim);
          });
        }
      };
      const backLen = 72;
      for (const s of [1, -1]) {
        k.frame(s * (15 + backLen / 2), 0, 0, 0, () => wing(backLen));
        k.frame(s * 96, 0, 31, -s * Math.PI / 2, () => wing(62));
        tower(s * 100, 74);
      }

      /* L'Arco di Rua Augusta. */
      k.box(30, 13, 8, 0, 0, -1, trim);
      k.arch(13, 20, 8.6, 0, 0, -1, "#efe2c2", 0, 0.5);
      for (const s of [1, -1]) {
        k.box(8.6, 20, 8.2, s * 11, 0, -1, trim);
        k.plain(8.2, 1.2, 9, s * 11, 0, -1, "#d9c9a2");
        for (const x of [7.8, 14.2]) {
          k.plain(2, 3, 2, s * x, 0, 3.8, "#efe2c2");
          k.corinth(0.92, 13.4, s * x, 3, 3.8, "#fdf7e7", "#e9d9b0");
          k.statue(s * x, 18.6, 3.8, "#cdbf9c", 3.4);
        }
      }
      k.plain(32, 1.4, 11, 0, 17.4, 0, "#efe2c2");
      k.cornice(32, 11, 0, 18.8, 0, trim);
      k.box(20, 7, 7, 0, 19.6, -1, trim);
      k.sign("VIRTVTIBVS·MAIORVM", 14, 1, 0, 21.2, 2.56, { ink: "#5a4c32" });
      k.plain(21, 0.6, 8, 0, 26.6, -1, "#e9d9b0");
      k.box(12, 4.4, 6, 0, 27.2, -1, trim);
      k.cyl(1.3, 0.2, 0, 0, 0, "#f7f4ea", 16);
      const clock = k.solid[k.solid.length - 1];
      clock.rotateX(Math.PI / 2);
      clock.translate(0, 29, 2.1);
      k.gable(13, 3, 7, 0, 31.6, -1, "#e9d9b0");
      k.plain(3, 2, 3, 0, 33.6, -1, trim);
      k.statue(0, 35.4, -1, "#b8a678", 5);
      for (const s of [1, -1]) k.statue(s * 2.6, 34, -1, "#b8a678", 3.6);

      /* Dom José: gradini tondi, basamento bianco, gruppi laterali, cavallo. */
      const Z = 44;
      for (let i = 0; i < 6; i++) k.cyl(10.5 - i * 1, 0.42, 0, i * 0.42, Z, i % 2 ? "#f1ece0" : "#dcd5c6", 32);
      k.plain(4.8, 8.4, 7.4, 0, 2.5, Z, "#f4efe4");
      k.plain(5.4, 0.8, 8, 0, 10.9, Z, "#fbf7ee");
      for (const s of [1, -1]) k.statue(s * 4.6, 2.5, Z, "#7d8c80", 4);
      const bronze = "#3f5a4e";
      const body = new THREE.CapsuleGeometry(1.1, 2.6, 4, 10);
      body.rotateX(Math.PI / 2);
      body.translate(0, 13.9, Z + 0.4);
      k.push(body, bronze);
      k.sphere(0.72, 0, 15.8, Z + 2.8, bronze, 0.7, 1, 1.2);
      k.plain(0.8, 1.8, 0.9, 0, 14.2, Z + 2.2, bronze);
      for (const [x, z] of [[0.6, 2.2], [-0.6, 2.2], [0.6, -1.5], [-0.6, -1.5]]) k.plain(0.34, 2, 0.34, x, 11.7, Z + z, bronze);
      k.person(0, Z + 0.2, bronze, 14.6, 2.8);
      k.plain(0.08, 0.08, 1.8, 0.5, 16.8, Z + 0.8, bronze);

      /* Il selciato chiaro e il reticolo di losanghe bianche. */
      k.plain(188, 0.06, 100, 0, 0.02, 48, "#e6dcc6");
      const diag = (c, dir) => {
        let z0 = -2;
        let z1 = 98;
        const a = (-94 - c) / dir;
        const b = (94 - c) / dir;
        z0 = Math.max(z0, Math.min(a, b));
        z1 = Math.min(z1, Math.max(a, b));
        if (z1 <= z0) return;
        const len = Math.hypot(z1 - z0, (z1 - z0) * dir);
        const g = new THREE.BoxGeometry(1.5, 0.03, len);
        g.rotateY(Math.atan2(dir, 1));
        g.translate(c + (dir * (z0 + z1)) / 2, 0.09, (z0 + z1) / 2);
        k.push(g, "#fbf8f0");
      };
      for (let c = -290; c <= 290; c += 58) {
        diag(c, 1);
        diag(c, -1);
      }
      for (let i = 0; i < 26; i++) k.person(-58 + i * 4.6, 18 + ((i * 37) % 60), i % 2 ? "#2a2a33" : "#4a3a2a");
      for (const [x, z] of [[-30, 30], [30, 30], [-30, 62], [30, 62]]) k.lamp(x, z, 6);
    },
  },

  /* Nova SBE: la grande galleria dal tetto chiaro sui pilastri d'acciaio, i
     volumi bianchi a doppia altezza con i nastri di vetro, la piazza con i
     lucernari nel pavimento, i padiglioni col tetto verde, i prati verso il mare. */
  nova: {
    lego: { file: "models/nova.glb", masses: [{ x: 0, z: -9, w: 156, d: 22 }] },
    side: 1,
    offset: 50,
    look: 9,
    view: { h: 24, r: 40 },
    build(k) {
      const white = "#f7f5f0";
      const steel = "#efeeea";
      const glass = "#2d4a5f";
      k.plain(200, 0.06, 104, 0, 0.01, -14, "#7fae55");

      /* Un volume bianco con la fascia alta piena e il nastro vetrato sotto. */
      const block = (x, z, w, d, h, roofGreen = false) => {
        k.box(w, h, d, x, 0, z, white);
        k.plain(w - 1.6, h * 0.56, 0.24, x, 0.3, z + d / 2 + 0.02, glass);
        k.plain(w - 2.6, h * 0.5, 0.1, x, 0.5, z + d / 2 + 0.1, "#f7e7c4");
        for (let i = 0; i <= w / 3; i++) k.plain(0.12, h * 0.56, 0.34, x - w / 2 + i * 3, 0.3, z + d / 2 + 0.1, "#3a3d40");
        k.plain(w + 0.8, 0.4, d + 0.8, x, h, z, "#fbfaf6");
        if (roofGreen) k.plain(w - 2, 0.2, d - 2, x, h + 0.4, z, "#6f9e4c");
        else k.plain(w * 0.5, 1, d * 0.4, x, h + 0.4, z, "#dcd9d1");
      };

      /* La galleria: pilastri ogni nove metri, travi, tetto a falde lunghe. */
      const LEN = 156;
      const Y = 13;
      const Zf = 2;
      const Zb = -20;
      for (let i = 0; i <= 17; i++) {
        const x = -LEN / 2 + i * (LEN / 17);
        for (const z of [Zf, Zb]) k.plain(0.7, Y, 0.7, x, 0, z, steel);
        k.plain(0.4, 0.8, Zf - Zb, x, Y - 0.8, (Zf + Zb) / 2, steel);
      }
      /* Il tetto, con i lucernari a dente di sega. */
      const roof = new THREE.BoxGeometry(LEN + 4, 0.6, Zf - Zb + 6);
      roof.rotateX(-0.06);
      roof.translate(0, Y + 0.6, (Zf + Zb) / 2);
      k.push(roof, "#e4e3de");
      for (let i = 0; i < 26; i++) {
        const g = new THREE.BoxGeometry(4.6, 0.5, Zf - Zb - 2);
        g.rotateZ(0.16);
        g.translate(-72 + i * 5.8, Y + 1.5, (Zf + Zb) / 2);
        k.push(g, i % 2 ? "#d4d6d4" : "#bfc8cc");
      }
      /* La vetrata di fondo, calda dentro. */
      k.plain(LEN, Y - 2, 0.2, 0, 0.3, Zb + 4, glass);
      k.plain(LEN - 2, Y - 3, 0.1, 0, 0.5, Zb + 4.2, "#f7e7c4");
      for (let i = 0; i < 40; i++) k.plain(0.1, Y - 2, 0.24, -LEN / 2 + i * 4, 0.3, Zb + 4.3, "#3a3d40");
      for (const [x, z] of [[-40, -8], [-16, -4], [12, -10], [36, -6]]) k.person(x, z, "#2a2a33");

      /* La piazza e i lucernari nel pavimento. */
      k.plain(LEN + 8, 0.05, 30, 0, 0.03, 18, "#ddd0b8");
      for (let i = 0; i < 7; i++) {
        k.plain(12, 0.05, 6, -54 + i * 18, 0.07, 13, "#dfe8e2");
        for (let j = 0; j < 3; j++) k.plain(0.12, 0.04, 6, -60 + i * 18 + j * 6, 0.11, 13, "#a9b2ae");
        k.plain(12, 0.04, 0.12, -54 + i * 18, 0.11, 13, "#a9b2ae");
      }

      /* I volumi bianchi ai lati della piazza, e la scritta. */
      block(70, 22, 42, 18, 10.5);
      k.sign("Nova SBE", 13, 2, 62, 7.4, 31.4, { ink: "#5a5f66", font: "400 76px Arial, sans-serif" });
      block(-68, 20, 34, 16, 9.5);
      block(-16, -38, 40, 16, 8, true);
      block(40, -40, 34, 18, 9, true);
      block(-66, -36, 26, 16, 8, true);
      /* Padiglione con il tetto verde sul prato davanti. */
      k.plain(30, 0.8, 12, 2, 0, 35, "#efece4");
      k.plain(29, 0.2, 11, 2, 0.8, 35, "#6f9e4c");
      for (let i = 0; i < 14; i++) k.person(-44 + i * 6.4, 16 + Math.sin(i * 1.7) * 7, ["#a22", "#2a2a33", "#f0efe9", "#35507a"][i % 4]);
      for (const [x, z] of [[-100, 12], [-104, -22], [104, -8], [98, 30]]) k.palm(x, z, 7);
      for (let i = 0; i < 8; i++) k.tree(-44 + i * 13, 39 + (i % 2), 1.5, "#6a9c4a");
      k.masses.push({ x: 0, z: -9, w: LEN, d: 22 });
    },
  },

  /* Il Forte di São Julião da Barra: la fortezza bassa a stella sugli scogli,
     le mura scure di salsedine col ciglio chiaro, i bastioni a punta, la casa con
     il tetto arancione, il faro, la bandiera, la spiaggia che comincia a ovest. */
  carcavelos: {
    lego: { file: "models/carcavelos.glb", masses: [{ x: 0, z: 0, w: 90, d: 44 }, { x: 38, z: -32, w: 26, d: 22 }, { x: -34, z: -32, w: 26, d: 22 }] },
    surf: 2,
    side: -1,
    offset: 58,
    look: 4,
    view: { h: 40, r: 46 },
    build(k) {
      const wall = "#5f5549";
      k.plain(190, 0.05, 26, 0, 0, 37, "#b9a878");
      for (let i = 0; i < 14; i++) k.bush(-84 + i * 13, 28 + (i * 7) % 16, 1.6, "#8c8a55");
      const lip = "#d8cdb6";
      const deck = "#c9bda6";
      const outline = [[-52, 22], [44, 22], [58, 10], [44, -4], [62, -30], [40, -44], [24, -22], [-10, -22], [-22, -46], [-48, -40], [-40, -16], [-62, -6]];
      /* Il corpo di pietra e la striscia più chiara in alto. */
      const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const body = new THREE.ExtrudeGeometry(shape, { depth: 7.6, bevelEnabled: false });
      body.rotateX(-Math.PI / 2);
      body.translate(0, -1.2, 0);
      k.push(body, wall);
      const top = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false });
      top.rotateX(-Math.PI / 2);
      top.translate(0, 6.4, 0);
      k.push(top, deck);
      for (let i = 0; i < outline.length; i++) {
        const [ax, az] = outline[i];
        const [bx, bz] = outline[(i + 1) % outline.length];
        const len = Math.hypot(bx - ax, bz - az);
        k.frame((ax + bx) / 2, 0, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), () => {
          k.plain(len + 0.6, 1.5, 1, 0, 7.2, 0, lip);
          k.plain(len + 0.8, 0.2, 1.2, 0, 8.7, 0, "#efe6d2");
          k.plain(len, 3.4, 0.2, 0, -0.6, -0.1, "#3f3a33");
          for (let j = 0; j < len / 9; j++) k.plain(1.2, 1, 0.3, -len / 2 + 4 + j * 9, 7.5, -0.2, "#3f3a33");
        });
      }
      /* Le terrazze a quote diverse. */
      k.plain(40, 2.4, 18, 34, 7.2, 6, deck);
      k.plain(40.6, 0.3, 18.6, 34, 9.6, 6, "#efe6d2");
      k.plain(28, 2, 14, -32, 7.2, -30, deck);
      k.plain(24, 2, 14, 42, 7.2, -28, deck);
      for (const [x, z, w, d] of [[52, -30, 7, 6], [-36, -36, 6, 5]]) {
        k.plain(w, 4, d, x, 9, z, "#efe9db");
        k.plain(w + 0.5, 0.3, d + 0.5, x, 13, z, "#c9bda6");
      }

      /* La casa del governatore: tetto arancione, arcate, torretta. */
      k.box(44, 6.4, 13, -2, 7.2, 2, "#efe3c4");
      k.hip(46, 15, 3.4, -2, 13.6, 2, "#dd6a2f", 0.3);
      for (let i = 0; i < 9; i++) k.win(-18 + i * 4.4, 8, 8.56, 1.5, 2.6, { frame: "#fbf5e6", pane: "#3a3129", arched: i % 2 === 0, sill: false });
      k.box(16, 5, 10, 22, 7.2, 12, "#ecc96a");
      k.hip(17.4, 11.4, 2.2, 22, 12.2, 12, "#b5683f");
      k.box(14, 5, 10, -26, 7.2, 12, "#e9d7a8");
      k.hip(15.4, 11.4, 2.2, -26, 12.2, 12, "#b5683f");

      /* Il faro: torre chiara quadrata, ballatoio, lanterna. */
      const X = -14;
      const Z = -8;
      k.box(7, 13, 7, X, 7.2, Z, "#efe9db");
      k.plain(8, 0.4, 8, X, 20.2, Z, "#c9bda6");
      k.plain(5.6, 4.6, 5.6, X, 20.6, Z, "#e4dac6");
      k.plain(6.4, 0.3, 6.4, X, 25.2, Z, "#b9ad96");
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) k.plain(0.7, 1, 0.7, X + sx * 2.9, 25.5, Z + sz * 2.9, "#b9ad96");
      k.cyl(1.3, 2.4, X, 25.5, Z, "#f4efe2", 10);
      k.lathe([[1.6, 0], [1.1, 0.7], [0.3, 1.3], [0, 1.8]], X, 27.9, Z, "#7a6a54", 10);
      for (let i = 0; i < 3; i++) k.plain(1.1, 1.9, 0.2, X, 10 + i * 3.4, Z + 3.56, "#3d3226");

      /* La bandiera sul bastione. */
      k.plain(0.14, 7, 0.14, 44, 9.6, 14, "#2c2c2e");
      k.plain(1.6, 1.3, 0.05, 44.9, 15.2, 14, "#b02a22");
      k.plain(1.6, 0.44, 0.06, 44.9, 15.6, 14, "#1d1b1a");

      /* Gli scogli attorno. */
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < outline.length; i++) {
        const [ax, az] = outline[i];
        const [bx, bz] = outline[(i + 1) % outline.length];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
        for (let j = 0; j < n; j++) {
          const t = j / n;
          const r = 1.6 + rnd() * 3.4;
          const x = lerp1(ax, bx, t) * 1.08 + rnd() * 3;
          const z = lerp1(az, bz, t) * 1.08 - rnd() * 3;
          if (z > 18) continue;
          k.sphere(r, x, -0.9, z, ["#5c4f40", "#6e5e4a", "#4a4036", "#7d6a52"][i % 4], 1.5, 0.6, 1.2, 0);
        }
      }
      /* Il muro che scende verso la sabbia, a ovest. */
      k.plain(58, 2.2, 5, 88, -0.2, 18, "#a89a82");
      k.plain(58, 0.3, 5.4, 88, 2, 18, "#d8cdb6");
      k.masses.push({ x: 0, z: 0, w: 90, d: 44 }, { x: 38, z: -32, w: 26, d: 22 }, { x: -34, z: -32, w: 26, d: 22 });
    },
  },

  /* Praia de Carcavelos: la spiaggia larga vista verso il forte, come nella foto
     al tramonto: chi passeggia, i surfisti, la pozza di marea che fa da specchio,
     gli ombrelloni, il ristorante basso con le palme, il chiosco tondo. */
  sunsetBeach: {
    lego: { file: "models/sunsetBeach.glb" },
    side: -1,
    offset: 70,
    look: 3,
    view: { h: 8, r: 20, orbit: 1.75 },
    aim: [-170, 8, -6],
    build(k) {
      k.surfer(-18, 0, 25, 1);
      k.surfer(-8, 0, 23, -1);
      k.surfer(14, 0, 27, 1);
      for (const [x, z, c] of [[-44, 30, "#2a2a33"], [-41, 31, "#a23a3a"], [-34, 36, "#35507a"], [-58, 34, "#2a2a33"], [22, 44, "#2a2a33"], [30, 40, "#e0a050"]]) k.person(x, z, c, 0, 1.75);
      /* La pozza di marea: un velo d'acqua che riflette il cielo. */
      for (const [x, z, a, b] of [[-26, 31, 26, 3.4], [6, 34, 18, 2.6]]) {
        const edge = new THREE.CircleGeometry(1, 32);
        edge.rotateX(-Math.PI / 2);
        edge.scale(a + 1.6, 1, b + 1);
        edge.translate(x, 0.03, z);
        k.push(edge, "#cfae78");
        const pool = new THREE.CircleGeometry(1, 32);
        pool.rotateX(-Math.PI / 2);
        pool.scale(a, 1, b);
        pool.translate(x, 0.05, z);
        k.push(pool, "#b4d4c6");
      }
      for (const [x, z, c] of [[44, 42, "#3f8fcf"], [52, 48, "#f2c21a"], [60, 42, "#e4572e"], [38, 50, "#f08a3c"], [70, 50, "#6fbf6a"]]) {
        k.cyl(0.05, 2.2, x, 0, z, "#efe9dc", 5);
        const g = new THREE.ConeGeometry(1.7, 0.7, 10);
        g.translate(x, 2.5, z);
        k.push(g, c);
        k.plain(0.9, 0.04, 1.9, x + 1.3, 0.02, z + 0.4, c);
      }
      /* Il ristorante verso il forte, basso e bianco, con la fila di palme. */
      const X = -120;
      k.plain(44, 4.4, 12, X, 0, 56, "#f4f1e8");
      k.plain(40, 2.6, 0.2, X, 0.8, 49.9, "#3f8a6e");
      k.plain(46, 0.5, 14, X, 4.4, 56, "#e6e2d6");
      k.plain(16, 2.4, 8, X - 8, 4.9, 57, "#f4f1e8");
      for (let i = 0; i < 10; i++) k.palm(X + 26 + i * 5.6, 54 - (i % 2) * 3, 8 + (i % 3));
      /* Il chiosco tondo, in fondo a ovest. */
      k.cyl(8, 4, 96, 0, 54, "#f6f3ea", 24);
      k.cyl(8.6, 0.4, 96, 4, 54, "#dcd6c6", 24);
      k.cyl(6, 2.2, 96, 4.4, 54, "#f6f3ea", 24);
      k.lathe([[6.6, 0], [4, 0.9], [0, 1.3]], 96, 6.6, 54, "#d4cfc0", 24);
    },
  },
};

function bake(list, material) {
  if (!list.length) return null;
  const merged = mergeGeometries(list.map((g) => (g.attributes.normal ? g : (g.computeVertexNormals(), g))));
  /* Vicino a terra la luce arriva meno: è questo che appoggia i volumi al suolo. */
  const pos = merged.attributes.position;
  const col = merged.attributes.color;
  const nor = merged.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    if (nor.getY(i) > 0.7) continue;
    const t = THREE.MathUtils.smoothstep(pos.getY(i), 0, 6);
    const k = 0.74 + 0.26 * t;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  return mesh;
}

/* Una scritta su un piano: costa una chiamata di disegno, e ce ne sono poche. */
function signMesh({ text, w, h, x, y, z, ink, ground, font }) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = Math.max(32, Math.round((1024 * h) / w));
  const g = c.getContext("2d");
  if (ground) {
    g.fillStyle = ground;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fit = Math.min(1, (c.width * 0.96) / g.measureText(text).width);
  g.setTransform(fit, 0, 0, fit, c.width / 2, c.height / 2);
  g.fillStyle = ink;
  g.fillText(text, 0, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.position.set(x, y + h / 2, z);
  return m;
}

/* Costruisce un luogo: un gruppo pronto da mettere lungo la strada. */
export function buildLandmark(name, solid, glow) {
  const spec = LANDMARKS[name];
  if (spec.lego) {
    /* Il modello a mattoncini arriva dopo: intanto il gruppo è vuoto. */
    const group = new THREE.Group();
    /* I luoghi a mattoncini si montano mentre il pulmino arriva. */
    let progress = 1;
    const setters = [];
    const add = (file, parent, build = true) =>
      loadLego(file).then((scene) => {
        const model = scene.clone();
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.receiveShadow = true;
          o.castShadow = !o.isInstancedMesh;
        });
        parent.add(model);
        if (build) {
          const set = makeBuildable(model);
          set(progress);
          setters.push(set);
        }
      });
    add(spec.lego.file, group);
    /* Pezzi in più: una strada inclinata intorno al suo perno. */
    for (const extra of spec.lego.extra ?? []) {
      const pivot = new THREE.Group();
      pivot.position.z = extra.pivotZ ?? 0;
      pivot.rotation.x = extra.tiltX ?? 0;
      group.add(pivot);
      add(extra.file, pivot);
    }
    /* Il carro che sale e scende sul suo telaio inclinato. */
    let mover = null;
    const rig = spec.lego.mover?.rig;
    if (rig) {
      mover = new THREE.Group();
      const turn = new THREE.Group();
      const tilt = new THREE.Group();
      turn.rotation.y = rig.rotY;
      turn.position.set(rig.x, rig.y, rig.z);
      tilt.rotation.z = rig.tilt;
      turn.add(tilt);
      tilt.add(mover);
      group.add(turn);
      add(spec.lego.mover.file, mover, false);
    }
    const setBuild = (p) => {
      progress = p;
      for (const set of setters) set(p);
    };
    return { group, spec, mover, moverBase: rig?.base ?? 0, moverRange: rig?.range ?? 20, masses: spec.lego.masses ?? [], setBuild };
  }
  const kit = new Kit();
  kit.surf = spec.surf ?? 0;
  spec.build(kit);
  const group = new THREE.Group();
  const a = bake(kit.solid, solid);
  const b = bake(kit.glow, glow);
  if (a) group.add(a);
  if (b) group.add(b);
  let mover = null;
  let moverBase = 0;
  let moverRange = 20;
  if (kit.mover) {
    mover = bake(kit.mover.solid, solid);
    /* Il funicolare corre sulla sua rampa: lo si appende a un telaio inclinato. */
    if (kit.rig) {
      const turn = new THREE.Group();
      const tilt = new THREE.Group();
      turn.rotation.y = kit.rig.rotY;
      turn.position.set(kit.rig.x, kit.rig.y, kit.rig.z);
      tilt.rotation.z = kit.rig.tilt;
      turn.add(tilt);
      tilt.add(mover);
      group.add(turn);
      moverBase = kit.rig.base;
      moverRange = kit.rig.range;
    } else group.add(mover);
  }
  for (const t of kit.signs) group.add(signMesh(t));
  return { group, spec, mover, moverBase, moverRange, masses: kit.masses };
}

/* ---------- Facciate e arredo della strada ---------- */
/* Una facciata dipinta: intonaco o mattoni invecchiati, cornici di pietra,
   persiane, balconi, botteghe al piano terra, colature sotto i davanzali. */
/* Le facciate delle case: colori e griglia delle finestre. */
const FACADES = {
  salmon: { wall: "#c98f6d", base: "#b3a083", pane: "#2b333a", shutter: "#2f6a4e", frame: "#efe3cc", cols: 4, rows: 6 },
  coral: { wall: "#e2704f", base: "#b9ad9b", pane: "#262c31", shutter: null, frame: "#f3ece0", cols: 3, rows: 5 },
  ochre: { wall: "#d9a24f", base: "#a8906e", pane: "#2b2520", shutter: "#5b4631", frame: "#e9d6ae", cols: 3, rows: 6 },
  rust: { wall: "#c4642f", base: "#8e735a", pane: "#2b2520", shutter: "#4d3a2a", frame: "#e9d6ae", cols: 3, rows: 6 },
  red: { wall: "#a8392e", base: "#7d6a58", pane: "#231f1c", shutter: "#3d4a3c", frame: "#e6d8bc", cols: 3, rows: 6 },
  brick: { wall: "#9a5a44", base: "#8a8072", pane: "#242624", shutter: null, frame: "#e0d6c0", cols: 4, rows: 6, brick: true },
  yellowBrick: { wall: "#c9a24e", base: "#8a7a5e", pane: "#262422", shutter: "#3a4a3a", frame: "#e8dcc0", cols: 3, rows: 5, brick: true },
  lisbon: { wall: "#f0ead9", base: "#b9b2a0", pane: "#2f373e", shutter: "#3b6f5e", frame: "#ffffff", cols: 3, rows: 5, iron: true },
  lisbonY: { wall: "#efc96f", base: "#a89a7c", pane: "#2f373e", shutter: "#4f6a5e", frame: "#fbf5e6", cols: 3, rows: 5, iron: true },
  lisbonB: { wall: "#9fb7c4", base: "#9a9484", pane: "#2f373e", shutter: "#f0ece0", frame: "#ffffff", cols: 3, rows: 5, iron: true },
};

export function facadeTexture(style, sharp = true) {
  const k = sharp ? 2 : 1;
  const c = document.createElement("canvas");
  c.width = 256 * k;
  c.height = 512 * k;
  const g = c.getContext("2d");
  g.scale(k, k);
  const s = FACADES[style];
  const W = 256;
  const H = 512;
  const FOOT = 74;
  let seed = style.length * 97 + 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  g.fillStyle = s.wall;
  g.fillRect(0, 0, W, H);
  if (s.brick) {
    for (let y = 0, r = 0; y < H; y += 5, r++) {
      for (let x = (r % 2) * -6; x < W; x += 12) {
        const v = 0.86 + rnd() * 0.26;
        g.fillStyle = `rgba(${v > 1 ? "255,240,220" : "30,16,10"},${Math.abs(v - 1) * 0.9})`;
        g.fillRect(x, y, 11, 4);
      }
      g.fillStyle = "rgba(226,216,198,.28)";
      g.fillRect(0, y + 4, W, 1);
    }
  } else {
    /* L'intonaco a chiazze, con qualche crepa. */
    for (let i = 0; i < 340; i++) {
      const r = 3 + rnd() * 26;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,246,226,${rnd() * 0.05})` : `rgba(44,30,18,${rnd() * 0.06})`;
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, r, r * (0.4 + rnd()), 0, 0, 7);
      g.fill();
    }
  }
  /* Le colature di pioggia dall'alto. */
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const h = 40 + rnd() * 240;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(30,22,16,.22)");
    grad.addColorStop(1, "rgba(30,22,16,0)");
    g.fillStyle = grad;
    g.fillRect(x, 8, 4 + rnd() * 12, h);
  }

  const cw = W / s.cols;
  const rh = (H - FOOT - 26) / s.rows;
  for (let r = 0; r < s.rows; r++) {
    /* Il marcapiano. */
    g.fillStyle = s.frame;
    if (r === 0 || r === 1) g.fillRect(0, 26 + (r + 1) * rh - 3 + (r ? 0 : 0), W, r ? 0 : 0);
    for (let col = 0; col < s.cols; col++) {
      const w = cw * 0.38;
      const h = rh * 0.66;
      const x = col * cw + (cw - w) / 2;
      const y = 26 + r * rh + (rh - h) * 0.42;
      g.fillStyle = "rgba(20,14,10,.3)";
      g.fillRect(x - 5, y - 3, w + 12, h + 9);
      g.fillStyle = s.frame;
      g.fillRect(x - 5, y - 5, w + 10, h + 10);
      if (r < 2) {
        g.beginPath();
        g.moveTo(x - 8, y - 5);
        g.lineTo(x + w / 2, y - 16);
        g.lineTo(x + w + 8, y - 5);
        g.fill();
      }
      g.fillStyle = s.pane;
      g.fillRect(x, y, w, h);
      const sky = g.createLinearGradient(x, y, x + w, y + h);
      sky.addColorStop(0, "rgba(190,214,232,.5)");
      sky.addColorStop(0.5, "rgba(190,214,232,0)");
      g.fillStyle = sky;
      g.fillRect(x, y, w, h);
      g.fillStyle = s.frame;
      g.fillRect(x + w / 2 - 1, y, 2, h);
      g.fillRect(x, y + h * 0.4, w, 2);
      if (s.shutter) {
        const open = rnd() > 0.28;
        g.fillStyle = s.shutter;
        const sw = w * 0.5;
        g.fillRect(x - sw - 5, y, sw, h);
        g.fillRect(x + w + 5, y, sw, h);
        if (!open) g.fillRect(x, y, w, h);
        g.fillStyle = "rgba(0,0,0,.22)";
        for (let b = 2; b < h; b += 4) {
          g.fillRect(x - sw - 5, y + b, sw, 1);
          g.fillRect(x + w + 5, y + b, sw, 1);
          if (!open) g.fillRect(x, y + b, w, 1);
        }
      }
      /* Davanzale, ombra sotto e colatura. */
      g.fillStyle = s.frame;
      g.fillRect(x - 9, y + h + 5, w + 18, 4);
      g.fillStyle = "rgba(24,16,10,.26)";
      g.fillRect(x - 7, y + h + 9, w + 14, 3);
      g.fillStyle = "rgba(24,16,10,.1)";
      g.fillRect(x + 2, y + h + 12, 4, 24);
      g.fillRect(x + w - 6, y + h + 12, 3, 16);
      /* Il balcone di ferro. */
      if (s.iron || (r === 1 && col !== 1)) {
        g.fillStyle = "#23262a";
        g.fillRect(x - 10, y + h - 12, w + 20, 2);
        g.fillRect(x - 10, y + h + 2, w + 20, 2);
        for (let b = x - 10; b < x + w + 10; b += 4) g.fillRect(b, y + h - 12, 1, 14);
      }
    }
  }
  /* Il cornicione. */
  g.fillStyle = s.frame;
  g.fillRect(0, 0, W, 10);
  g.fillStyle = "rgba(20,14,10,.34)";
  g.fillRect(0, 10, W, 5);
  g.fillStyle = s.frame;
  for (let x = 2; x < W; x += 11) g.fillRect(x, 10, 5, 7);

  /* Il piano terra: zoccolo di pietra a blocchi, portone e bottega. */
  const y0 = H - FOOT;
  g.fillStyle = s.base;
  g.fillRect(0, y0, W, FOOT);
  g.fillStyle = s.frame;
  g.fillRect(0, y0 - 3, W, 5);
  g.fillStyle = "rgba(24,18,12,.28)";
  for (let r = 0; r < 5; r++) {
    g.fillRect(0, y0 + 13 + r * 13, W, 1);
    for (let x = (r % 2) * 16; x < W; x += 32) g.fillRect(x, y0 + r * 13, 1, 13);
  }
  /* Portone di legno ad arco. */
  const dx = W * 0.22;
  g.fillStyle = s.frame;
  g.beginPath();
  g.roundRect(dx - 24, y0 + 6, 48, FOOT, [24, 24, 0, 0]);
  g.fill();
  g.fillStyle = "#4a2e1c";
  g.beginPath();
  g.roundRect(dx - 19, y0 + 11, 38, FOOT, [19, 19, 0, 0]);
  g.fill();
  g.fillStyle = "rgba(0,0,0,.3)";
  g.fillRect(dx - 1, y0 + 11, 2, FOOT);
  for (let i = 1; i < 4; i++) g.fillRect(dx - 19, y0 + 12 + i * 14, 38, 1);
  /* La bottega. */
  const sx = W * 0.56;
  const shop = ["#7a2a22", "#2f5a4a", "#26364a", "#5a4a22"][style.length % 4];
  g.fillStyle = shop;
  g.fillRect(sx, y0 + 8, W * 0.38, FOOT - 8);
  g.fillStyle = "#e9c98a";
  g.fillRect(sx + 6, y0 + 22, W * 0.38 - 12, FOOT - 34);
  g.fillStyle = shop;
  g.fillRect(sx + W * 0.19 - 1, y0 + 22, 3, FOOT - 34);
  g.fillStyle = "rgba(255,255,255,.2)";
  g.fillRect(sx + 6, y0 + 22, W * 0.09, FOOT - 34);
  /* Lo sporco che sale da terra e il pluviale. */
  const dirt = g.createLinearGradient(0, H - 46, 0, H);
  dirt.addColorStop(0, "rgba(26,20,14,0)");
  dirt.addColorStop(1, "rgba(26,20,14,.5)");
  g.fillStyle = dirt;
  g.fillRect(0, H - 46, W, 46);
  g.fillStyle = "rgba(40,38,36,.75)";
  g.fillRect(W - 7, 12, 3, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* Il rilievo di una facciata: cornici, davanzali, persiane, balconi e
   cornicione veri, appoggiati sopra quelli dipinti e vestiti con gli stessi
   pezzi di texture. Sta nel cubo unitario della casa (larga wide, profonda
   deep) e copre le due facce lunghe, quelle che guardano la strada. */
export function facadeRelief(style, wide, deep) {
  const s = FACADES[style];
  const W = 256;
  const H = 512;
  const FOOT = 74;
  const parts = [];
  /* Un blocchetto sul muro. x e y sono in pixel della texture, depth e off
     (lo stacco dal muro) in metri. Davanti porta il suo pezzo di texture, ai
     lati il colore del punto at. */
  const block = (face, x0, y0, x1, y1, depth, off = 0, at = null) => {
    const w = (x1 - x0) / W;
    const h = (y1 - y0) / H;
    const d = depth / deep;
    const g = new THREE.BoxGeometry(w, h, d);
    const cx = (x0 + x1) / 2 / W - 0.5;
    g.translate(face * cx, 0.5 - (y0 + y1) / 2 / H, face * (0.5 + off / deep + d / 2));
    const uv = g.attributes.uv;
    const front = face > 0 ? 4 : 5;
    const su = at ? at[0] / W : (x0 + x1) / 2 / W;
    const sv = 1 - (at ? at[1] : (y0 + y1) / 2) / H;
    for (let i = 0; i < uv.count; i++) {
      if (Math.floor(i / 4) === front) uv.setXY(i, (x0 + (x1 - x0) * uv.getX(i)) / W, 1 - (y1 - (y1 - y0) * uv.getY(i)) / H);
      else uv.setXY(i, su, sv);
    }
    parts.push(g);
  };

  const cw = W / s.cols;
  const rh = (H - FOOT - 26) / s.rows;
  const y0 = H - FOOT;
  for (const face of [1, -1]) {
    for (let r = 0; r < s.rows; r++) {
      for (let col = 0; col < s.cols; col++) {
        const w = cw * 0.38;
        const h = rh * 0.66;
        const x = col * cw + (cw - w) / 2;
        const y = 26 + r * rh + (rh - h) * 0.42;
        /* Cornice: due stipiti e l'architrave, poi il davanzale. */
        block(face, x - 5, y - 5, x, y + h + 5, 0.24);
        block(face, x + w, y - 5, x + w + 5, y + h + 5, 0.24);
        block(face, x - 8, y - 8, x + w + 8, y - 1, 0.4, 0, [x - 3, y + h / 2]);
        block(face, x - 9, y + h + 5, x + w + 9, y + h + 9, 0.5);
        if (s.shutter) {
          const sw = w * 0.5;
          block(face, x - sw - 5, y, x - 5, y + h, 0.09, 0.14);
          block(face, x + w + 5, y, x + w + sw + 5, y + h, 0.09, 0.14);
        }
        if (s.iron || (r === 1 && col !== 1)) {
          const stone = [x - 3, y + h / 2];
          const iron = [x - 9.5, y + h - 11];
          block(face, x - 12, y + h + 1, x + w + 12, y + h + 4.5, 1, 0, stone);
          block(face, x - 12, y + h - 13.5, x + w + 12, y + h - 12, 0.08, 0.9, iron);
          const n = 7;
          for (let i = 0; i <= n; i++) {
            const bx = x - 11.5 + ((w + 22) * i) / n;
            block(face, bx, y + h - 12, bx + 1, y + h + 1, 0.05, 0.92, iron);
          }
        }
      }
    }
    /* Cornicione a due gradini, marcapiano e zoccolo che sporge. */
    block(face, 0, 0, W, 11, 0.85);
    block(face, 0, 11, W, 18, 0.4);
    block(face, 0, y0 - 3, W, y0 + 2, 0.32);
    block(face, 0, y0 + 2, W, H, 0.14);
  }
  return mergeGeometries(parts);
}

/* Passa la grana di una scansione su una facciata già dipinta. */
export function weatherFacade(texture, image, strength) {
  const c = texture.image;
  const g = c.getContext("2d");
  const k = c.width / 256;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "overlay";
  g.globalAlpha = strength;
  const p = g.createPattern(image, "repeat");
  p.setTransform(new DOMMatrix().scale((k * 256) / 768 / 3.4));
  g.fillStyle = p;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
  texture.needsUpdate = true;
}

/* ---------- Il selciato ----------
   Tessere da ripetere: un tile in un quadrato, con la stessa scala del mondo. */
function tile(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function groundTexture(size) {
  return tile(size, (g, S) => {
    g.fillStyle = "#c9c9c9";
    g.fillRect(0, 0, S, S);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const r = 2 + rnd() * 22;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${rnd() * 0.09})` : `rgba(0,0,0,${rnd() * 0.1})`;
      const x = rnd() * S;
      const y = rnd() * S;
      for (const [a, b] of [[0, 0], [S, 0], [0, S], [-S, 0], [0, -S]]) {
        g.beginPath();
        g.arc(x + a, y + b, r, 0, 7);
        g.fill();
      }
    }
  });
}
