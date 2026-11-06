// I luoghi del viaggio, modellati in 3D. Unità: metri, un po' compressi. Ogni
// luogo guarda la strada dal suo +z e ha l'origine a terra. Tutto ciò che è
// dello stesso materiale viene fuso in una geometria sola, con il colore nei
// vertici: un luogo intero costa due chiamate di disegno.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const color = new THREE.Color();

class Kit {
  constructor() {
    this.solid = [];
    this.glow = [];
    this.mover = null;
  }

  push(g, hex, list = this.solid) {
    const geo = g.index ? g.toNonIndexed() : g;
    color.set(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "color"].includes(k)) geo.deleteAttribute(k);
    list.push(geo);
    return geo;
  }

  box(w, h, d, x, y, z, hex, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    return this.push(g, hex);
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
  windows(cols, rows, w, h, x, y, z, stepX, stepY, frame, pane, shutter = null) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x + (c - (cols - 1) / 2) * stepX;
        const py = y + r * stepY;
        this.box(w + 0.24, h + 0.24, 0.1, px, py - 0.12, z, frame);
        this.box(w, h, 0.14, px, py, z, pane);
        if (shutter) {
          this.box(w * 0.5, h, 0.12, px - w * 0.72, py, z + 0.02, shutter);
          this.box(w * 0.5, h, 0.12, px + w * 0.72, py, z + 0.02, shutter);
        }
      }
    }
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

/* ---------- Materiali dei palazzi ---------- */
const CREAM = "#eedcb6";
const STONE = "#f3e6c8";

/* ---------- I luoghi ---------- */
export const LANDMARKS = {
  /* La via di casa: palazzi di mattone salmone con le persiane verdi, il blocco
     bianco a balconate, il grande pino e le auto parcheggiate. */
  homeStreet: {
    side: 1,
    offset: 26,
    look: 12,
    build(k) {
      const salmon = "#c98f6d";
      k.box(30, 21, 15, -16, 0, -6, salmon);
      k.box(30.6, 0.5, 15.6, -16, 21, -6, "#e8dcc5");
      k.box(30.4, 3.2, 15.4, -16, 0, -6, "#d9c6a8");
      k.windows(8, 5, 1.3, 2, -16, 4.4, 1.5, 3.6, 3.3, "#efe3cc", "#39424a", "#2f7a55");
      k.box(16, 24, 15, 13, 0, -6, "#f4f0e6");
      for (let i = 0; i < 7; i++) {
        k.box(17, 0.32, 2.4, 13, 3.3 * i + 2.6, 2.4, "#ffffff");
        k.box(17, 1.1, 0.14, 13, 3.3 * i + 2.9, 3.5, "#fbf8f0");
        k.windows(4, 1, 2.2, 2.2, 13, 3.3 * i + 3, 1.56, 3.6, 3.3, "#d58a4f", "#3a4048");
      }
      k.pine(-29, 13, 15);
      k.pine(30, 12, 12);
      k.tree(-6, 12, 3, "#3f7a3f");
      k.tree(5, 13, 2.6, "#4f8a46");
      k.car(-14, 17, "#8b8f94");
      k.car(-8, 17, "#4c5660");
      k.car(1, 17, "#e9e9ea");
      k.car(9, 17, "#a33434");
      k.car(16, 17, "#23272d");
      k.box(4, 3, 3, 24, 0, 14, "#d9d3c5");
      k.bush(21, 13, 1.5);
      k.bush(27, 13, 1.5);
    },
  },

  /* Il quartiere di Melfi: condomini corallo e terracotta con i balconi ad
     arco, i muretti con il cancello, il prato davanti. */
  melfiStreet: {
    side: 1,
    offset: 25,
    look: 9,
    build(k) {
      const blocks = [[-17, "#e06a4e", 15], [2, "#ef8a4f", 17], [22, "#d9583f", 14]];
      for (const [x, hex, h] of blocks) {
        k.box(17, h, 11, x, 0, -3, hex);
        k.box(19, 0.4, 13, x, h, -3, "#f3ece0");
        k.box(14, 2.2, 8, x, h + 0.4, -3, "#e8e1d4");
        const g = new THREE.ConeGeometry(11.5, 2.2, 4);
        g.rotateY(Math.PI / 4);
        g.scale(1, 1, 0.7);
        g.translate(x, h + 3.7, -3);
        k.push(g, "#b5542f");
        k.windows(4, 3, 1.5, 1.9, x, 2.6, 2.56, 3.8, 3.8, "#f3ece0", "#2e3439");
        /* Balconata ad arco, l'elemento che distingue questi palazzi. */
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

  /* La villa con la loggia, la balaustra e il grande pino inclinato. */
  luissVilla: {
    side: 1,
    offset: 27,
    look: 11,
    build(k) {
      k.box(20, 11, 12, 13, 0, -6, CREAM);
      k.box(20.6, 0.5, 12.6, 13, 11, -6, STONE);
      k.windows(4, 2, 1.5, 2.4, 13, 1.6, 0.06, 4.2, 4.6, STONE, "#2a2f33", "#46503c");
      k.rail(20, 13, 11.5, 0.2, STONE);
      k.box(14, 12, 15, -9, 0, -6, "#f1dfb9");
      k.box(10.5, 15.5, 8, -9, 0, -2, "#f4e3bf");
      k.box(11.2, 0.5, 8.7, -9, 7.6, -2, STONE);
      k.rail(10.8, -9, 8.1, 2.3, STONE);
      k.arch(10.4, 7.6, 1.5, -9, 0, 2.1, STONE, 0, 0.58);
      k.box(4.2, 5, 0.3, -9, 0, 1.2, "#2a2420");
      for (const x of [-13.4, -4.6]) {
        k.column(0.42, 6.4, x, 0, 3.4, STONE);
        k.column(0.42, 6.4, x + (x < -9 ? 1.1 : -1.1), 0, 3.4, STONE);
      }
      /* La nicchia con la conchiglia in cima alla loggia. */
      k.arch(8.4, 4.8, 0.6, -9, 10.4, 2, STONE, 0, 0.3);
      k.dome(2.5, -9, 11.8, 1, "#e3cda3", 1);
      k.box(11.2, 0.45, 8.7, -9, 15.5, -2, STONE);
      k.rail(10.6, -9, 15.95, 2.1, STONE);
      k.sphere(0.75, -9, 17.8, 2, "#ddc8a0", 1.3, 1, 0.4);
      k.pine(25, 4, 19, 0, "#2d5c32");
      k.bush(-1, 7, 1.7);
      k.bush(3, 8, 1.2, "#4f7d3c");
      k.bush(6.5, 7.4, 1.5);
      k.bush(10, 8, 1.1, "#6e9a4a");
      k.bush(15, 7.2, 1.7);
      k.cyl(0.7, 1, -14.5, 0, 7, "#b8603b", 12, 0.95);
      k.sphere(1, -14.5, 2, 7, "#5f7a3e");
      k.cyl(0.08, 7, -3, 0, 8, "#2f3236", 6);
      k.sphere(0.32, -3, 7.2, 8, "#f4f1e6");
    },
  },

  /* Il palazzo di mattoni con il timpano e la terrazza. */
  luissHouse: {
    side: -1,
    offset: 26,
    look: 10,
    build(k) {
      const brick = "#a75f43";
      k.box(30, 10.5, 15, 0, 0, -6, brick);
      k.box(31, 0.5, 16, 0, 5.1, -6, STONE);
      k.box(31, 0.6, 16, 0, 10.5, -6, STONE);
      k.box(10, 4, 11, -9, 11.1, -6, brick);
      k.gable(11.4, 2.6, 12, -9, 15.1, -6, STONE);
      k.box(11.4, 0.4, 12, -9, 15, -6, STONE);
      k.windows(7, 1, 1.5, 2.6, 0, 6.5, 1.56, 4, 4, STONE, "#232a31");
      k.windows(4, 1, 1.5, 2.6, 5, 1.2, 1.56, 5.4, 4, STONE, "#232a31");
      k.rail(30, 0, 11.1, 1.5, STONE);
      for (let i = 0; i < 4; i++) k.column(0.42, 3.8, -13.6 + i * 3.1, 0, 3.4, STONE);
      k.box(11, 0.5, 3.6, -9, 4.2, 2.8, STONE);
      k.tree(-2, 9, 2.6, "#5f9c50");
      k.tree(3, 10, 2.1, "#7cae4e");
      k.tree(8, 9, 2.4, "#6aa24e");
      k.tree(14, 8, 3, "#3f6e4c");
      k.pine(-22, 8, 13);
      k.box(0.5, 2.6, 0.2, -18, 0, 12, "#e4572e");
    },
  },

  /* L'aula: il pulmino la attraversa tra le colonne, sotto la volta, con la
     platea e il palco ai lati. */
  aula: {
    side: 0,
    offset: 0,
    look: 8,
    through: true,
    build(k) {
      const L = 62;
      const W = 25;
      const H = 15;
      for (const s of [1, -1]) {
        k.box(L, H, 1, 0, 0, s * W * 0.5, "#efe4cf");
        k.box(L, 1, 0.8, 0, H - 2.4, s * (W * 0.5 - 0.7), "#d9c28a");
        for (let i = 0; i < 8; i++) {
          const x = -L / 2 + 4 + i * ((L - 8) / 7);
          k.column(0.75, 9.4, x, 0, s * (W * 0.5 - 3.4), "#c98a4b", "#e2cfa6");
          k.box(2, 3, 0.2, x + 4, 9.6, s * (W * 0.5 - 0.55), "#fbf6e6");
          k.light(1.7, 2.6, 0.1, x + 4, 9.8, s * (W * 0.5 - 0.68), "#ffe9b8");
          k.sphere(0.34, x + 3.8, 11, s * (W * 0.5 - 3.4), "#fff8e1");
        }
        /* File di sedie blu rivolte verso il palco. */
        for (let row = 0; row < 3; row++) {
          for (let c = 0; c < 15; c++) {
            const x = -20 + c * 2.1;
            const z = s * (8 + row * 1.6);
            k.box(0.9, 0.5, 0.9, x, 0.4, z, "#2b57a8");
            k.box(0.14, 0.9, 0.9, x - 0.4, 0.8, z, "#2b57a8");
            if ((c + row) % 3 === 0) k.person(x, z, ["#2a2a33", "#5a3a2a", "#3b4a5f"][c % 3], 0.2, 1.5);
          }
        }
      }
      /* Volta a botte, lasciata aperta sulla strada. */
      const vault = new THREE.CylinderGeometry(W / 2 - 0.2, W / 2 - 0.2, L, 32, 1, true, Math.PI / 2 * 3 - Math.PI / 2, Math.PI);
      vault.rotateZ(Math.PI / 2);
      vault.rotateX(0);
      const v = vault.toNonIndexed();
      const p = v.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, Math.abs(p.getY(i)) * 0.58 + H - 0.2);
      /* Le facce vanno viste da sotto: si invertono. */
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
      }
      v.computeVertexNormals();
      k.push(v, "#d9cdb2");
      /* Il palco in fondo, oltre le auto: schermo e tavolo. */
      for (const s of [1, -1]) {
        k.box(14, 8, 0.4, 26, 1.2, s * 9.4, "#f7f4ea");
        k.light(5, 3, 0.1, 26, 3.4, s * 9.15, "#cfe0f7");
        k.box(0.4, 0.2, 0.2, 26, 0, s * 9.4, "#222");
      }
      k.box(L, 0.04, W - 1, 0, 0, 0, "#d9d3c7");
    },
  },

  /* Il Tevere: il ponte con le statue, il cupolone dietro. */
  tiber: {
    side: 1,
    offset: 62,
    look: 18,
    build(k) {
      const stone = "#d8b98a";
      for (let i = 0; i < 5; i++) {
        k.arch(15, 8, 8.6, -30 + i * 15, -4.2, 0, stone, 0, 0.42);
        k.cyl(1.8, 8, -37.5 + i * 15, -4.2, 4.5, stone, 8);
        k.cyl(1.8, 8, -37.5 + i * 15, -4.2, -4.5, stone, 8);
      }
      k.box(77, 0.5, 9, 0, 3.8, 0, "#c9a877");
      for (const s of [1, -1]) {
        k.box(76, 1, 0.5, 0, 4.3, s * 4.2, stone);
        for (let i = 0; i < 6; i++) {
          k.box(1, 2, 1, -32 + i * 13, 5.3, s * 4.2, "#e8d4ae");
          k.cyl(0.42, 2.4, -32 + i * 13, 7.3, s * 4.2, "#efe6d2", 6, 0.3);
          k.sphere(0.34, -32 + i * 13, 10, s * 4.2, "#efe6d2");
          k.light(0.5, 0.5, 0.5, -25.5 + i * 13, 5.5, s * 4.2, "#ffd27a");
        }
      }
      /* La riva opposta e la basilica. */
      const far = -72;
      k.box(190, 3, 34, 4, -3, far, "#b98b59");
      k.box(70, 13, 16, -56, 0, far + 10, "#c98f5c");
      k.box(46, 10, 16, 58, 0, far + 10, "#d6a463");
      k.windows(9, 2, 1.4, 2.4, -56, 3, far + 18.1, 7, 4.6, "#e6c893", "#ffcf80");
      k.box(58, 22, 24, 2, 0, far - 2, "#e0c493");
      k.gable(20, 5, 26, 2, 22, far - 2, "#e0c493");
      k.windows(8, 2, 1.8, 4, 2, 5, far + 10.1, 7, 8.5, "#efdcae", "#ffcf80");
      for (let i = 0; i < 10; i++) k.column(0.8, 14, -24 + i * 5.3, 3, far + 11.5, "#ead5a8");
      k.cyl(15, 12, 2, 22, far - 16, "#e8d09c", 28);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        k.column(0.55, 9.6, 2 + Math.cos(a) * 15.6, 22, far - 16 + Math.sin(a) * 15.6, "#f0dfb8");
        k.light(0.9, 6, 0.2, 2 + Math.cos(a + 0.15) * 15.1, 24, far - 16 + Math.sin(a + 0.15) * 15.1, "#ffc873");
      }
      k.dome(14.4, 2, 34, far - 16, "#c8ad82", 1.28, 32);
      k.cyl(3.2, 6, 2, 51.5, far - 16, "#ead5a8", 12, 2.4);
      k.dome(2.4, 2, 57.5, far - 16, "#c8ad82", 1.3);
      k.cyl(0.25, 3.4, 2, 60.4, far - 16, "#e8d09c", 6, 0.08);
      k.pine(-78, far + 12, 13, 0, "#284a30");
      k.pine(68, far + 12, 14, 0, "#284a30");
      k.pine(44, far + 13, 11, 0, "#284a30");
    },
  },

  /* Il Colosseo di notte, con le arcate illuminate. */
  colosseum: {
    side: 1,
    offset: 76,
    look: 13,
    build(k) {
      const a = 34;
      const b = 28;
      const bays = 46;
      const tiers = [[8.6, "#d9b98c"], [8.2, "#d2b083"], [7.8, "#caa77a"]];
      for (let i = 0; i < bays; i++) {
        const t0 = (i / bays) * Math.PI * 2;
        const t1 = ((i + 1) / bays) * Math.PI * 2;
        const tm = (t0 + t1) / 2;
        const x = Math.cos(tm) * a;
        const z = Math.sin(tm) * b;
        const len = Math.hypot(Math.cos(t1) * a - Math.cos(t0) * a, Math.sin(t1) * b - Math.sin(t0) * b);
        /* La tangente all'ellisse, non il raggio. */
        const rot = Math.atan2(-b * Math.cos(tm), -a * Math.sin(tm));
        /* Il lato verso nord è crollato: si ferma al secondo ordine. */
        const ruined = i > 28 && i < 40;
        let y = 0;
        tiers.forEach(([h, hex], tier) => {
          if (ruined && tier === 2) return;
          k.arch(len + 0.05, h, 2.2, x, y, z, hex, rot, 0.5);
          k.light(len * 0.5, h * 0.62, 0.15, x * 0.975, y, z * 0.975, "#ffbe6b");
          y += h;
        });
        if (!ruined) k.box(len + 0.05, 5.2, 2.2, x, y, z, "#c2a071", rot);
      }
      const arena = new THREE.CylinderGeometry(31, 19, 19, 48, 1, true);
      arena.scale(1, 1, b / a);
      const inside = arena.toNonIndexed();
      const p = inside.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
      }
      inside.computeVertexNormals();
      inside.translate(0, 9.5, 0);
      k.push(inside, "#7f6b52");
      k.cyl(19.5, 0.2, 0, 0.2, 0, "#b89b72", 32);
      k.box(170, 0.06, 120, 0, 0.02, 0, "#6d6960");
      k.pine(-54, 26, 12, 0, "#284a30");
      k.pine(52, 28, 13, 0, "#284a30");
      k.pine(-61, -18, 14, 0, "#284a30");
      k.tree(40, 38, 3, "#3f6e4c");
      k.tree(-38, 40, 3.2, "#3f6e4c");
    },
  },

  /* La piazza del Pantheon: pronao, timpano, cupola bassa, palazzi ocra. */
  pantheon: {
    side: 1,
    offset: 52,
    look: 14,
    build(k) {
      const old = "#c9b190";
      k.cyl(19, 15, 0, 0, -19, "#b89a78", 40);
      k.cyl(19.4, 1, 0, 15, -19, old, 40);
      k.dome(18.6, 0, 15.6, -19, "#a39a8c", 0.46, 40);
      k.cyl(3.2, 0.7, 0, 24, -19, old, 20);
      k.box(26, 17, 14, 0, 0, -3, old);
      k.gable(30, 6.2, 18, 0, 15.6, 3.4, old);
      k.box(30, 2.1, 18, 0, 13.5, 3.4, "#d4bea0");
      k.box(4.6, 7, 0.4, 0, 0, -3, "#2a221c");
      for (let i = 0; i < 8; i++) k.column(0.82, 11.4, -11.4 + i * 3.26, 0.4, 11, "#cdb8a0", "#d9c8b2");
      for (let i = 0; i < 4; i++) k.column(0.82, 11.4, -11.4 + i * 7.6, 0.4, 5.6, "#cdb8a0", "#d9c8b2");
      k.box(30, 0.5, 20, 0, 0, 4, "#c7b89e");
      k.box(90, 0.05, 54, 0, 0.01, 16, "#b7a68b");
      /* I palazzi che incorniciano la piazza. */
      for (const [x, hex, h] of [[-34, "#d98f3f", 18], [-49, "#c9702f", 21], [34, "#c85a2c", 19], [49, "#e0a23f", 17]]) {
        k.box(14, h, 16, x, 0, 8, hex);
        k.box(14.8, 0.5, 16.8, x, h, 8, "#e9d6ae");
        k.windows(3, 4, 1.2, 2.1, x, 4, 16.04, 4, 3.5, "#e9d6ae", "#3a3129", "#5b4631");
      }
      /* Ombrelloni e tavolini del bar. */
      for (const [x, z] of [[-18, 25], [-11, 28], [-20, 31]]) {
        k.cyl(0.07, 2.5, x, 0, z, "#f4eddd", 6);
        const g = new THREE.ConeGeometry(2.4, 0.9, 10);
        g.translate(x, 2.9, z);
        k.push(g, "#f4eddd");
        k.cyl(0.7, 0.08, x, 0.74, z, "#3a3129", 8);
      }
      for (const [x, z] of [[3, 27], [6, 25], [12, 29], [-4, 22], [15, 22]]) k.person(x, z, ["#2a2a33", "#7a3f2a", "#3b5a7f"][Math.floor(x + 20) % 3]);
    },
  },

  /* La torre di mattoni sopra il palazzo con il portale e la terrazza. */
  tower: {
    side: -1,
    offset: 30,
    look: 14,
    build(k) {
      const brick = "#a67c56";
      k.box(10, 33, 10, -4, 0, -7, brick);
      for (let i = 0; i < 11; i++) {
        const x = -8.6 + i * 0.92;
        k.box(0.62, 1.1, 0.5, x, 33, -1.9, "#94694a");
      }
      for (const [x, y, w] of [[-4, 29.4, 1.6], [-6.6, 21.2, 1.2], [-1.4, 21.2, 1.2], [-4, 15.6, 1.5]]) k.windows(1, 1, w, 2.2, x, y, -1.94, 1, 1, "#e8dcc5", "#23282c");
      k.box(9.6, 13, 13, 8.5, 0, -6, "#e7c989");
      k.box(10, 0.4, 13.4, 8.5, 13, -6, "#c58e4e");
      k.windows(2, 2, 1.3, 2.2, 8.5, 5.8, 0.56, 4.2, 4, "#efe6d2", "#2e3439");
      k.box(21, 8, 3, 0, 0, 1, "#d9d0bd");
      for (let y = 0; y < 8; y += 1.05) k.box(5.2, 0.52, 0.2, -6.9, y, 2.56, "#c8bda7");
      k.box(7.6, 8, 0.3, 3, 0, 2.5, "#cfc2a8");
      k.arch(5.8, 8, 0.5, 3, 0, 2.7, "#b7a98e", 0, 0.58);
      k.box(3.9, 5.4, 0.2, 3, 0, 2.5, "#c5b48c");
      k.box(0.1, 5.4, 0.3, 3, 0, 2.5, "#7a6a50");
      k.column(0.4, 6.2, -0.5, 0.2, 3.3, "#9d9180");
      k.column(0.4, 6.2, 6.5, 0.2, 3.3, "#9d9180");
      k.box(3, 3.6, 0.3, -6.8, 0, 2.7, "#231d17");
      k.light(2.8, 0.5, 0.1, -6.8, 3.7, 2.85, "#f3e6c8");
      k.rail(20, 0, 8.1, 2.1, "#e4dac6");
      k.box(21.4, 0.25, 3.4, 0, 7.95, 1.1, "#d9d0bd");
      k.bush(-5, 1, 1.7, "#3f6e3a", 8.2);
      k.bush(3, 1.1, 1.9, "#2f5d32", 8.2);
      k.bush(7, 1, 1.6, "#3f6e3a", 8.2);
      k.box(9, 26, 11, 25, 0, -2, "#d79a4a");
      k.box(9, 19, 11, -21, 0, -2, "#e3c28b");
      k.windows(2, 5, 1.2, 2.2, 25, 4, 3.56, 3.6, 4, "#efe6d2", "#3a3129", "#5b4631");
      k.windows(2, 4, 1.2, 2.2, -21, 3, 3.56, 3.6, 3.9, "#efe6d2", "#3a3129", "#5b4631");
    },
  },

  /* Il tram giallo su una salita di case bianche. */
  tram: {
    side: 1,
    offset: 9.5,
    look: 3,
    build(k) {
      const m = new Kit();
      m.box(7, 1.25, 2.4, 0, 0.55, 0, "#f3b81e");
      m.box(7.2, 0.26, 2.5, 0, 0.32, 0, "#a3271f");
      m.box(7.2, 1.45, 2.42, 0, 1.8, 0, "#fbf4e2");
      m.box(7.5, 0.3, 2.7, 0, 3.25, 0, "#f7f1e0");
      m.box(7.3, 0.14, 2.56, 0, 1.78, 0, "#a3271f");
      for (let i = 0; i < 5; i++) {
        m.box(1.1, 1.1, 2.5, -2.7 + i * 1.35, 1.95, 0, "#d9862c");
        m.box(0.86, 0.9, 2.6, -2.7 + i * 1.35, 2.05, 0, "#28333a");
      }
      m.box(1.5, 1.2, 0.14, 3.62, 2, 0, "#28333a");
      m.sphere(0.2, 3.66, 1.05, 0, "#fff0b8");
      for (const x of [-2, 2]) {
        m.box(1.4, 0.4, 2, x, 0, 0, "#2b2b2b");
      }
      m.box(0.1, 1.4, 0.1, 0.4, 3.5, 0.2, "#26282c");
      m.box(1.3, 0.1, 1.1, 0.4, 4.9, 0.2, "#26282c");
      k.mover = m;

      for (const s of [1, -1]) k.box(90, 0.03, 0.14, 0, 0.02, s * 0.75, "#8d8f90");
      /* Le case: intonaco chiaro, una gialla, panni e lampioni. */
      const colors = ["#f5f1e6", "#f3e9c8", "#f7d774", "#f1ece0", "#ecd9b3", "#f5f1e6"];
      colors.forEach((hex, i) => {
        const x = -48 + i * 19;
        const h = 14 + (i % 3) * 3.5;
        k.box(18, h, 12, x, 0, -11, hex);
        const roof = new THREE.ConeGeometry(14, 2.6, 4);
        roof.rotateY(Math.PI / 4);
        roof.scale(1, 1, 0.66);
        roof.translate(x, h + 1.3, -11);
        k.push(roof, "#c0653f");
        k.windows(3, 3, 1.3, 2.3, x, 3.6, -4.94, 5, 3.7, "#ffffff", "#39424a", i % 2 ? "#3b6f5e" : null);
      });
      for (const x of [-30, -8, 16, 38]) {
        k.cyl(0.08, 5, x, 0, -3.8, "#26282c", 6);
        k.sphere(0.34, x, 5.2, -3.8, "#fff4cf");
      }
      k.box(100, 0.09, 1.8, 0, 0, -3.4, "#d8d0bf");
    },
  },

  /* La torre sull'acqua, con il bastione e le torrette. */
  belem: {
    side: 1,
    offset: 56,
    look: 15,
    build(k) {
      const stone = "#dcc093";
      const pale = "#ead3a6";
      const g = new THREE.CylinderGeometry(11.5, 14, 6.5, 6);
      g.rotateY(Math.PI / 6);
      g.scale(1.25, 1, 1);
      g.translate(0, -0.9, 7);
      k.push(g, stone);
      k.box(12, 30, 12, 0, 0, -5, stone);
      k.box(13.4, 0.5, 13.4, 0, 12, -5, pale);
      k.box(13.4, 0.5, 13.4, 0, 21, -5, pale);
      k.box(9, 5, 9, 0, 30, -5, "#d4b786");
      for (const [x, z] of [[-6.6, 1.5], [6.6, 1.5], [-6.6, -11.5], [6.6, -11.5]]) {
        k.cyl(1.2, 5, x, 26, z, pale, 8);
        k.dome(1.3, x, 31, z, stone, 1.3, 10);
        k.cyl(0.14, 1, x, 32.4, z, pale, 6);
      }
      k.dome(1.5, 0, 35, -5, stone, 1.3, 12);
      for (let i = 0; i < 3; i++) {
        k.arch(2.8, 4.6, 0.5, -3.3 + i * 3.3, 14, 1.2, pale, 0, 0.45);
        k.box(1.2, 1.6, 0.2, -3.3 + i * 3.3, 22.6, 1, "#39312a");
      }
      k.rail(12, 0, 13, 1.2, pale, 0, 1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.box(1.2, 1.6, 1.2, Math.cos(a) * 13, 2.5, 7 + Math.sin(a) * 11, pale);
      }
      for (const a of [0, 1, 2, 3, 4, 5]) {
        const x = Math.cos(a * 1.047 + 0.5) * 14;
        const z = 7 + Math.sin(a * 1.047 + 0.5) * 12;
        k.cyl(0.9, 4, x, 2, z, pale, 8);
        k.dome(1, x, 6, z, stone, 1.3, 10);
      }
      k.box(30, 0.5, 2.6, -28, 1, 2, "#6a4a30");
    },
  },

  /* La piazza: l'arco, i portici gialli, la statua, l'albero di luci. */
  comercio: {
    side: 1,
    offset: 58,
    look: 15,
    build(k) {
      const yellow = "#e9b94d";
      for (const s of [1, -1]) {
        for (let i = 0; i < 9; i++) {
          k.arch(6.4, 6, 1.4, s * (14 + i * 6.4), 0, 0, STONE);
          k.light(3, 3.2, 0.1, s * (14 + i * 6.4), 0, -0.6, "#ffcf80");
        }
        k.box(60, 12, 18, s * 40, 6, -9, yellow);
        k.box(61, 0.5, 19, s * 40, 18, -9, "#f4e7c8");
        const r = new THREE.ConeGeometry(42, 5, 4);
        r.rotateY(Math.PI / 4);
        r.scale(1, 1, 0.3);
        r.translate(s * 40, 21, -9);
        k.push(r, "#a84c33");
        k.windows(9, 2, 1.4, 2.6, s * 40, 7.6, 0.06, 6.2, 5, "#f4e7c8", "#2c3a44");
      }
      k.arch(25, 22, 7, 0, 0, -1, STONE, 0, 0.45);
      k.box(26.4, 2, 8, 0, 21, -1, "#f4e7c8");
      k.box(17, 7, 5.6, 0, 23, -1, STONE);
      for (const s of [1, -1]) {
        k.column(0.95, 15, s * 11.6, 0.5, 3, "#f7efd8");
        k.column(0.95, 15, s * 8.4, 0.5, 3, "#f7efd8");
      }
      k.gable(13, 3.4, 5.6, 0, 30, -1, "#f4e7c8");
      k.person(0, -1, "#b89a58", 33.4, 3);
      /* Statua al centro della piazza. */
      k.cyl(4.4, 1.6, 0, 0, 38, "#cdbf9f", 16, 3.8);
      k.box(3, 6, 3, 0, 1.6, 38, "#d9cdb0");
      k.box(1.2, 2, 3.4, 0, 7.6, 38, "#3f5a4e");
      k.person(0, 38, "#3f5a4e", 9, 2.6);
      k.box(130, 0.06, 86, 0, 0.02, 40, "#b3aa96");
      /* Le linee diagonali del selciato. */
      for (let i = -3; i <= 3; i++) {
        k.box(120, 0.02, 0.5, 0, 0.1, 40 + i * 11, "#e7e0cf", 0.6);
        k.box(120, 0.02, 0.5, 0, 0.1, 40 + i * 11, "#e7e0cf", -0.6);
      }
      /* L'albero di luci. */
      for (let i = 0; i < 5; i++) {
        const g = new THREE.ConeGeometry(7 - i * 1.25, 6, 12);
        g.translate(44, 4 + i * 4.2, 28);
        k.push(g, "#f2c766", k.glow);
      }
      for (let i = 0; i < 18; i++) k.person(-40 + i * 5, 30 + Math.sin(i * 2.3) * 16, i % 2 ? "#2a2a33" : "#4a3a2a");
    },
  },

  /* Il campus sul mare: tetti piatti bianchi, vetrate, prati e panchine. */
  nova: {
    side: -1,
    offset: 40,
    look: 7,
    build(k) {
      const white = "#f5f3ee";
      const wing = (x, z, w, d, h) => {
        k.box(w, h, d, x, 0, z, white);
        k.box(w + 1.4, 0.5, d + 1.4, x, h, z, "#fbfaf6");
        k.box(w - 0.6, h - 1.8, 0.2, x, 0.6, z + d / 2 + 0.04, "#2d4a5f");
        for (let i = 0; i < Math.floor(w / 3); i++) k.box(0.18, h - 1.2, 0.3, x - w / 2 + 1.5 + i * 3, 0.4, z + d / 2 + 0.1, white);
      };
      wing(-26, -2, 30, 14, 7);
      wing(10, -10, 44, 12, 9);
      wing(36, 4, 22, 16, 6.5);
      k.box(66, 0.6, 26, 2, 11, -14, "#fbfaf6");
      for (let i = 0; i < 7; i++) k.column(0.34, 10, -28 + i * 10, 0, 1.4, "#ece9e2");
      for (let i = 0; i < 5; i++) k.box(6, 0.12, 9, -14 + i * 7, 11.7, -16, "#2f3f5f", 0);
      k.box(150, 0.05, 40, 0, 0.02, 14, "#6fa24d");
      k.box(70, 0.06, 13, 0, 0.04, 9, "#d9ccb2");
      for (let i = 0; i < 9; i++) k.tree(-32 + i * 9, 13, 1.5, "#6a9c4a");
      k.box(6, 0.4, 1, -5, 0.05, 8, "#8d8678");
      k.box(6, 0.4, 1, 9, 0.05, 7, "#8d8678");
      for (let i = 0; i < 9; i++) k.person(-20 + i * 5, 6 + Math.sin(i) * 3, i % 2 ? "#a22" : "#2a2a33");
    },
  },

  /* La spiaggia con il forte in lontananza e i surfisti in controluce. */
  carcavelos: {
    side: 1,
    offset: 58,
    look: 7,
    build(k) {
      const fort = "#7e6a50";
      k.box(70, 7, 16, 18, -3, -10, fort);
      k.box(26, 5, 13, 22, 4, -10, "#8a7558");
      k.box(7, 11, 7, 27, 4, -10, "#8a7558");
      k.cyl(2.4, 5, 27, 15, -10, "#8a7558", 12);
      k.dome(2.5, 27, 20, -10, "#7e6a50", 1.2);
      const g = new THREE.CylinderGeometry(10, 12, 8, 6);
      g.translate(-20, 0, -10);
      k.push(g, fort);
      for (const [x, z, flip] of [[-14, 22, 1], [-5, 30, -1], [3, 26, 1]]) {
        k.person(x, z, "#17120e", -2.4, 1.8);
        const b = new THREE.CylinderGeometry(0.28, 0.28, 2.2, 10);
        b.rotateZ(Math.PI / 2 - 0.25 * flip);
        b.scale(1, 1, 0.3);
        b.translate(x + 0.2, -1.2, z + 0.1);
        k.push(b, "#17120e");
      }
    },
  },

  /* L'ultima spiaggia: il sole si butta in acqua e arriva un'onda lunga. */
  sunsetBeach: {
    side: 1,
    offset: 46,
    look: 6,
    build(k) {
      for (const [z, w, h] of [[14, 90, 1.1], [-2, 120, 1.5], [-22, 150, 1.8]]) {
        const g = new THREE.CapsuleGeometry(h, w, 4, 12);
        g.rotateZ(Math.PI / 2);
        g.scale(1, 0.5, 1);
        g.translate(0, -3.8, z);
        k.push(g, "#f4d9c3");
      }
      k.person(-10, 24, "#17120e", -4, 1.8);
      k.box(1, 0.2, 0.2, -10, -2.6, 24, "#17120e");
      k.box(30, 5, 12, 92, -3, -44, "#2a2230");
    },
  },
};

function bake(list, material) {
  if (!list.length) return null;
  const merged = mergeGeometries(list.map((g) => (g.attributes.normal ? g : (g.computeVertexNormals(), g))));
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  return mesh;
}

/* Costruisce un luogo: un gruppo pronto da mettere lungo la strada. */
export function buildLandmark(name, solid, glow) {
  const spec = LANDMARKS[name];
  const kit = new Kit();
  spec.build(kit);
  const group = new THREE.Group();
  const a = bake(kit.solid, solid);
  const b = bake(kit.glow, glow);
  if (a) group.add(a);
  if (b) group.add(b);
  let mover = null;
  if (kit.mover) {
    mover = bake(kit.mover.solid, solid);
    group.add(mover);
  }
  return { group, spec, mover };
}

/* ---------- Facciate e arredo della strada ---------- */
export function facadeTexture(style) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d");
  const s = {
    salmon: { wall: "#c98f6d", base: "#d9c6a8", pane: "#39424a", shutter: "#2f7a55", frame: "#efe3cc", cols: 4, rows: 7 },
    coral: { wall: "#e2704f", base: "#d8cfc0", pane: "#2e3439", shutter: null, frame: "#f3ece0", cols: 3, rows: 5 },
    ochre: { wall: "#d9a24f", base: "#c9b08a", pane: "#3a3129", shutter: "#5b4631", frame: "#e9d6ae", cols: 3, rows: 6 },
    rust: { wall: "#c4642f", base: "#a88a6a", pane: "#3a3129", shutter: "#5b4631", frame: "#e9d6ae", cols: 3, rows: 6 },
    lisbon: { wall: "#f4efe3", base: "#d9d2c0", pane: "#39424a", shutter: "#3b6f5e", frame: "#ffffff", cols: 3, rows: 5 },
  }[style];
  g.fillStyle = s.wall;
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = s.base;
  g.fillRect(0, 462, 256, 50);
  g.fillStyle = s.frame;
  g.fillRect(0, 0, 256, 12);
  const cw = 256 / s.cols;
  const rh = 450 / s.rows;
  for (let r = 0; r < s.rows; r++) {
    for (let col = 0; col < s.cols; col++) {
      const w = cw * 0.34;
      const h = rh * 0.58;
      const x = col * cw + (cw - w) / 2;
      const y = 14 + r * rh + (rh - h) / 2;
      g.fillStyle = s.frame;
      g.fillRect(x - 4, y - 4, w + 8, h + 8);
      g.fillStyle = s.pane;
      g.fillRect(x, y, w, h);
      if (s.shutter) {
        g.fillStyle = s.shutter;
        g.fillRect(x - w * 0.62, y, w * 0.5, h);
        g.fillRect(x + w * 1.12, y, w * 0.5, h);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
