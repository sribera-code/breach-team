'use strict';
// Graphismes procéduraux : sols, murs, mobilier, personnages, décalques.
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
// Interpolation récursive de deux poses (nombres / tableaux / objets de même forme).
function lerpPose(a, b, t) {
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) return a.map((v, i) => lerpPose(v, b[i], t));
  const o = {};
  for (const k in a) o[k] = lerpPose(a[k], b[k], t);
  return o;
}

// Poses du squelette (repère local : le personnage regarde vers +x).
// Debout, vu de dessus : les jambes sont sous le torse, seuls les pieds dépassent.
const POSE_STAND = {
  shadow: { x: 2.5, y: 3.5, rx: 13.5, ry: 11.5 },
  legW: 0,
  legs: [[[-4, -4], [-3, -5.5], [-2, -6.8]], [[-4, 4], [-3, 5.5], [-2, 6.8]]],
  foot: { rx: 4.6, ry: 3 },
  torso: { x: -1.5, y: 0, rx: 8.5, ry: 12 },
  shoulders: [[-2.5, -9.5], [-2.5, 9.5]], shR: 4.3,
  arms: [[[-2, -9.5], [7, -6.5], [17, -0.4]], [[-2, 9.5], [4.5, 7], [9, 3.6]]],
  head: { x: 1, y: 0, r: 6.9 },
  pack: { x: -13, y: -6.5, w: 8, h: 13 },
  vest: { x: -6.5, y: -6.5, w: 11, h: 13 },
  side: 0,
};
// Allongé sur le ventre, tête vers +x.
const POSE_LIE = {
  shadow: { x: 0, y: 3, rx: 25, ry: 12 },
  legW: 6.6,
  legs: [[[-8, -2.5], [-20, -4], [-27, -10]], [[-8, 3], [-18, 6.5], [-22, 14]]],
  foot: { rx: 3.4, ry: 3.4 },
  torso: { x: 0, y: 0, rx: 11.5, ry: 8.5 },
  shoulders: [[7.5, -8], [7.5, 8]], shR: 4,
  arms: [[[7, -8], [16, -13.5], [26, -11.5]], [[7, 8], [3, 14.5], [-6, 13.5]]],
  head: { x: 15.5, y: 1.5, r: 6.2 },
  pack: { x: -7, y: -6, w: 12, h: 12 },
  vest: { x: -5, y: -5.5, w: 10, h: 11 },
  side: 1,
};
const DROPPED_GUN = { x: 14, y: -22, rot: -0.35 };
const DROPPED_SHIELD = { x: 2, y: 22, rot: 0.25 };
// Module laser sur le rail, selon le dessin de l'arme : [début, fin, décalage latéral].
const LASER_MOUNT = { pistol: [12.4, 15.2, 1.3], smg: [15.2, 18.4, 1.9], pdw: [15.4, 18, 1.7], shotgun: [15.6, 18.8, -2.2], ak: [15, 18, 2], rifle: [15.2, 18.2, 2] };
// Arme tenue : avancée devant la tête et un peu épaissie pour rester lisible vue de dessus.
const GUN_SHIFT = 2.5, GUN_THICK = 1.18;
// Distance du centre du personnage à la bouche du canon (utilisée aussi par le jeu pour les tirs).
const muzzleDist = gunLen => 13 + GUN_SHIFT + gunLen;

const Sprites = {
  // ---- Sols ----
  paintFloor(ctx, type, x, y) {
    switch (type) {
      case 1: return this.paintWood(ctx, x, y);
      case 2: return this.paintTiles(ctx, x, y);
      case 3: return this.paintCarpet(ctx, x, y);
      case 4: return this.paintMarble(ctx, x, y);
      case 5: return this.paintMetal(ctx, x, y);
      default: return this.paintConcrete(ctx, x, y);
    }
  },
  // Les motifs dépendent des coordonnées monde (pas de la case) : aucun quadrillage visible.
  hash(a, b) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },
  paintConcrete(ctx, x, y) {
    ctx.fillStyle = 'rgb(110,114,120)';
    ctx.fillRect(x, y, TILE, TILE);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + Math.random() * TILE, y + Math.random() * TILE, rand(0.6, 1.6), rand(0.6, 1.6));
    }
    if (Math.random() < 0.05) {
      ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      let px = x + rand(0, TILE), py = y;
      ctx.moveTo(px, py);
      for (let i = 0; i < 3; i++) { px += rand(-4, 4); py += TILE / 3; ctx.lineTo(px, py); }
      ctx.stroke();
    }
  },
  // Taches douces sur le béton (usure, humidité), limitées aux cases de béton.
  paintConcreteStains(ctx, map) {
    ctx.save();
    ctx.beginPath();
    let any = false;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.tile(x, y) === 0 && map.floor(x, y) === 0) { ctx.rect(x * TILE, y * TILE, TILE, TILE); any = true; }
    }
    if (any) {
      ctx.clip();
      const n = Math.floor(map.w * map.h / 25);
      for (let i = 0; i < n; i++) {
        const cx = rand(0, map.w * TILE), cy = rand(0, map.h * TILE), r = rand(18, 70);
        const dark = Math.random() < 0.6;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, dark ? `rgba(0,0,0,${rand(0.03, 0.08)})` : `rgba(255,255,255,${rand(0.02, 0.05)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
    }
    ctx.restore();
  },
  paintWood(ctx, x, y) {
    const ph = 6, len = 70; // lames de parquet : 6 px de large, ~70 px de long, joints décalés
    for (let py = y; py < y + TILE; py += ph) {
      const row = Math.floor(py / ph);
      const off = Math.floor(this.hash(row, 7) * len);
      const seg = Math.floor((x + off) / len);
      const v = Math.floor(this.hash(row, seg) * 20 - 10);
      ctx.fillStyle = `rgb(${140 + v},${104 + v * 0.8},${70 + v * 0.6})`;
      ctx.fillRect(x, py, TILE, ph);
      ctx.fillStyle = 'rgba(60,35,15,0.18)';
      ctx.fillRect(x, py + 2 + Math.floor(this.hash(row, seg + 3) * 3), TILE, 0.7);
      ctx.fillStyle = 'rgba(40,22,8,0.42)';
      ctx.fillRect(x, py, TILE, 0.8);
      // joint de bout de lame s'il tombe dans cette case
      const jx = (seg + 1) * len - off;
      if (jx >= x && jx < x + TILE) ctx.fillRect(jx, py, 0.9, ph);
    }
  },
  paintTiles(ctx, x, y) {
    const S = 12; // carreaux de 12 px
    for (let ty = Math.floor(y / S) * S; ty < y + TILE; ty += S) {
      for (let tx = Math.floor(x / S) * S; tx < x + TILE; tx += S) {
        const v = Math.floor(this.hash(tx, ty) * 12 - 6);
        const x0 = Math.max(x, tx), y0 = Math.max(y, ty);
        const x1 = Math.min(x + TILE, tx + S), y1 = Math.min(y + TILE, ty + S);
        ctx.fillStyle = `rgb(${166 + v},${170 + v},${176 + v})`;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        if (ty + 1 >= y && ty + 1 < y + TILE) ctx.fillRect(x0, ty + 1, x1 - x0, 1.5);
        ctx.fillStyle = 'rgba(40,45,55,0.32)';
        if (tx >= x) ctx.fillRect(tx, y0, 0.8, y1 - y0);
        if (ty >= y) ctx.fillRect(x0, ty, x1 - x0, 0.8);
      }
    }
  },
  // Moquette : fibres serrées et motif discret de losanges, calé sur le monde comme le reste.
  paintCarpet(ctx, x, y) {
    const P = 24;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip();
    ctx.fillStyle = 'rgb(102,44,52)';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(224,180,110,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath();
    // diagonales x + y = k·P puis x − y = k·P qui traversent la case
    for (let k = Math.floor((x + y) / P); k * P <= x + y + 2 * TILE; k++) { ctx.moveTo(k * P - y, y); ctx.lineTo(k * P - y - TILE, y + TILE); }
    for (let k = Math.floor((x - y - TILE) / P); k * P <= x - y + TILE; k++) { ctx.moveTo(k * P + y, y); ctx.lineTo(k * P + y + TILE, y + TILE); }
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = Math.random() < 0.55 ? 'rgba(0,0,0,0.14)' : 'rgba(255,210,210,0.07)';
      ctx.fillRect(x + Math.random() * TILE, y + Math.random() * TILE, 1, 1);
    }
    ctx.restore();
  },
  // Dallage de marbre : dalles de 32 px en damier clair, veinées. Teinte et veine viennent de la
  // dalle (pas de la case) : elles se raccordent d'une case à l'autre.
  paintMarble(ctx, x, y) {
    const S = 32;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip();
    for (let sy = Math.floor(y / S) * S; sy < y + TILE; sy += S) for (let sx = Math.floor(x / S) * S; sx < x + TILE; sx += S) {
      const v = Math.floor(this.hash(sx, sy) * 12 - 6), base = ((sx + sy) / S) % 2 ? 176 : 194;
      ctx.fillStyle = `rgb(${base + v},${base - 3 + v},${base - 10 + v})`;
      ctx.fillRect(sx, sy, S, S);
      ctx.strokeStyle = 'rgba(96,90,82,0.24)'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      let py = sy + this.hash(sx + 1, sy) * S;
      ctx.moveTo(sx, py);
      for (let k = 1; k <= 4; k++) { py = clamp(py + (this.hash(sx + 7 * k, sy + 3) - 0.5) * 16, sy + 2, sy + S - 2); ctx.lineTo(sx + S * k / 4, py); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(70,64,56,0.34)';
      ctx.fillRect(sx, sy, S, 0.8); ctx.fillRect(sx, sy, 0.8, S);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(sx + 0.8, sy + 0.8, S - 0.8, 0.8);
    }
    ctx.restore();
  },
  // Tôle striée : chevrons en relief alternés, joints de plaques tous les 64 px, quelques rayures.
  paintMetal(ctx, x, y) {
    const P = 8, S = 64;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip();
    ctx.fillStyle = 'rgb(94,100,107)';
    ctx.fillRect(x, y, TILE, TILE);
    for (let py = Math.floor(y / P) * P; py < y + TILE; py += P) for (let px = Math.floor(x / P) * P; px < x + TILE; px += P) {
      const d = ((px + py) / P) % 2 ? 1 : -1, mx = px + P / 2, my = py + P / 2;
      ctx.strokeStyle = 'rgba(18,22,26,0.38)'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(mx - 2 + 0.6, my + 2 * d + 0.7); ctx.lineTo(mx + 2 + 0.6, my - 2 * d + 0.7); ctx.stroke();
      ctx.strokeStyle = 'rgba(214,222,230,0.3)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(mx - 2, my + 2 * d); ctx.lineTo(mx + 2, my - 2 * d); ctx.stroke();
    }
    const jx = Math.ceil(x / S) * S, jy = Math.ceil(y / S) * S;
    ctx.fillStyle = 'rgba(12,14,16,0.5)';
    if (jx < x + TILE) ctx.fillRect(jx - 0.5, y, 1, TILE);
    if (jy < y + TILE) ctx.fillRect(x, jy - 0.5, TILE, 1);
    if (Math.random() < 0.15) {
      ctx.strokeStyle = 'rgba(230,236,240,0.12)'; ctx.lineWidth = 0.6;
      const a = rand(0, TAU), ox = x + rand(3, TILE - 3), oy = y + rand(3, TILE - 3);
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a) * 9, oy + Math.sin(a) * 9); ctx.stroke();
    }
    ctx.restore();
  },

  // ---- Murs (fins, continus) ----
  paintWall(ctx, map, tx, ty) {
    const x = tx * TILE, y = ty * TILE;
    const open = (dx, dy) => map.tile(tx + dx, ty + dy) === 0;
    ctx.fillStyle = '#3b424d';
    ctx.fillRect(x, y, TILE, TILE);
    // léger relief au sommet du mur
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y + TILE / 2 - 1, TILE, 2);
    ctx.fillStyle = '#20252c';
    if (open(0, -1)) ctx.fillRect(x, y, TILE, 2);
    if (open(0, 1)) ctx.fillRect(x, y + TILE - 2, TILE, 2);
    if (open(-1, 0)) ctx.fillRect(x, y, 2, TILE);
    if (open(1, 0)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    if (open(0, -1)) ctx.fillRect(x, y + 2, TILE, 1);
    if (open(-1, 0)) ctx.fillRect(x + 2, y, 1, TILE);
  },
  paintShadows(ctx, map, tx, ty) {
    const x = tx * TILE, y = ty * TILE;
    const grad = (x0, y0, x1, y1, a) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
    if (map.isWall(tx, ty - 1)) { ctx.fillStyle = grad(x, y, x, y + 9, 0.42); ctx.fillRect(x, y, TILE, 9); }
    if (map.isWall(tx - 1, ty)) { ctx.fillStyle = grad(x, y, x + 9, y, 0.36); ctx.fillRect(x, y, 9, TILE); }
    if (map.isWall(tx + 1, ty)) { ctx.fillStyle = grad(x + TILE, y, x + TILE - 5, y, 0.18); ctx.fillRect(x + TILE - 5, y, 5, TILE); }
    if (map.isWall(tx, ty + 1)) { ctx.fillStyle = grad(x, y + TILE, x, y + TILE - 5, 0.18); ctx.fillRect(x, y + TILE - 5, TILE, 5); }
  },
  paintDoorFrame(ctx, d) {
    const L = d.len * TILE;
    ctx.save();
    ctx.translate(d.cx, d.cy);
    if (!d.horizontal) ctx.rotate(Math.PI / 2);
    // seuil puis montants aux deux extrémités (repère : la porte court le long de x)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-L / 2, -4, L, 8);
    ctx.fillStyle = '#6b5a48';
    ctx.fillRect(-L / 2, -TILE / 2, 2.5, TILE);
    ctx.fillRect(L / 2 - 2.5, -TILE / 2, 2.5, TILE);
    ctx.restore();
  },

  // ---- Mobilier ----
  shadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 4, rx, ry, 0, 0, TAU); ctx.fill();
  },
  // Ombre d'un meuble rectangulaire de w × h (vu dos en haut), toujours portée vers le bas à droite.
  shadowBox(ctx, cx, cy, w, h, rot) {
    if (Math.abs(Math.sin(rot)) > 0.5) [w, h] = [h, w];
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, cx - w / 2 + 3, cy - h / 2 + 4, w, h, 3); ctx.fill();
  },
  // p : meuble de la carte (type, centre cx/cy). Ceux qui se posent contre un mur ont aussi rot (repère
  // local : dos vers -y, face vers +y) et link.l / link.r quand le même meuble se prolonge à côté.
  paintProp(ctx, p) {
    const { type, cx, cy } = p;
    ctx.save();
    switch (type) {
      case 'crate': {
        this.shadow(ctx, cx, cy, 14, 14);
        ctx.translate(cx, cy); ctx.rotate(rand(-0.08, 0.08));
        ctx.fillStyle = '#8a5a2e'; ctx.fillRect(-13, -13, 26, 26);
        ctx.strokeStyle = '#4e3116'; ctx.lineWidth = 2; ctx.strokeRect(-13, -13, 26, 26);
        ctx.strokeStyle = 'rgba(255,220,160,0.25)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-11, -11); ctx.lineTo(11, 11); ctx.moveTo(11, -11); ctx.lineTo(-11, 11); ctx.stroke();
        ctx.strokeStyle = '#4e3116'; ctx.lineWidth = 1; ctx.strokeRect(-9, -9, 18, 18);
        break;
      }
      case 'barrel': {
        this.shadow(ctx, cx, cy, 12, 12);
        ctx.fillStyle = '#4d5964'; circle(ctx, cx, cy, 12); ctx.fill();
        ctx.strokeStyle = '#2a3138'; ctx.lineWidth = 2; ctx.stroke();
        circle(ctx, cx, cy, 7); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; circle(ctx, cx - 4, cy - 4, 5); ctx.fill();
        break;
      }
      case 'table': {
        this.shadow(ctx, cx, cy, 16, 16);
        ctx.fillStyle = '#5c3f26'; ctx.fillRect(cx - 16, cy - 16, 32, 32);
        ctx.fillStyle = '#7a5433'; ctx.fillRect(cx - 14, cy - 14, 28, 28);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
        for (let i = -10; i <= 10; i += 5) { ctx.beginPath(); ctx.moveTo(cx - 14, cy + i); ctx.lineTo(cx + 14, cy + i); ctx.stroke(); }
        break;
      }
      case 'desk': {
        this.shadow(ctx, cx, cy, 16, 14);
        ctx.fillStyle = '#3f444c'; ctx.fillRect(cx - 16, cy - 13, 32, 26);
        ctx.fillStyle = '#545a63'; ctx.fillRect(cx - 14, cy - 11, 28, 22);
        ctx.fillStyle = '#1c1f24'; ctx.fillRect(cx - 7, cy - 9, 14, 9);
        ctx.fillStyle = '#3f8fd6'; ctx.fillRect(cx - 6, cy - 8, 12, 7);
        ctx.fillStyle = '#26292f'; ctx.fillRect(cx - 8, cy + 3, 16, 5);
        ctx.fillStyle = '#e6e2d6'; ctx.fillRect(cx + 5, cy + 1, 7, 9);
        break;
      }
      case 'bed': {
        // tête de lit contre le mur
        this.shadow(ctx, cx, cy, 15, 16);
        ctx.translate(cx, cy); ctx.rotate(p.rot || 0);
        ctx.fillStyle = '#5a4634'; ctx.fillRect(-15, -16, 30, 32);
        ctx.fillStyle = '#d9d3c4'; ctx.fillRect(-13, -14, 26, 28);
        ctx.fillStyle = '#4f6a8c'; ctx.fillRect(-13, -2, 26, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-13, -2, 26, 2);
        ctx.fillStyle = '#f1eee6'; ctx.fillRect(-10, -12, 20, 7);
        break;
      }
      case 'sofa': {
        // canapé de cuir : dossier contre le mur, accoudoirs aux extrémités, un coussin par case
        const x0 = p.link.l ? -16 : -15, x1 = p.link.r ? 16 : 15;
        this.shadowBox(ctx, cx, cy, 30, 28, p.rot);
        ctx.translate(cx, cy); ctx.rotate(p.rot);
        ctx.fillStyle = '#4a3122'; ctx.fillRect(x0, -14, x1 - x0, 28);
        ctx.fillStyle = '#6b4731'; ctx.fillRect(x0, -14, x1 - x0, 8);
        ctx.fillStyle = 'rgba(255,235,210,0.1)'; ctx.fillRect(x0, -13, x1 - x0, 2);
        ctx.fillStyle = '#6b4731';
        if (!p.link.l) { roundRect(ctx, x0, -14, 5, 28, 2); ctx.fill(); }
        if (!p.link.r) { roundRect(ctx, x1 - 5, -14, 5, 28, 2); ctx.fill(); }
        const a0 = p.link.l ? -16 : x0 + 5, a1 = p.link.r ? 16 : x1 - 5;
        roundRect(ctx, a0 + 0.6, -5.5, a1 - a0 - 1.2, 18, 2.5);
        ctx.fillStyle = '#84593b'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillStyle = 'rgba(255,235,210,0.14)'; ctx.fillRect(a0 + 2.5, -4, a1 - a0 - 5, 2);
        break;
      }
      case 'shelf': {
        // rayonnage métallique : lisses orange, montants, cartons et bacs posés dessus
        const x0 = p.link.l ? -16 : -15, x1 = p.link.r ? 16 : 15;
        this.shadowBox(ctx, cx, cy, 30, 26, p.rot);
        ctx.translate(cx, cy); ctx.rotate(p.rot);
        ctx.fillStyle = '#4c5259'; ctx.fillRect(x0, -13, x1 - x0, 26);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let yy = -9; yy < 11; yy += 5) ctx.fillRect(x0, yy, x1 - x0, 0.7);
        const loads = ['#b08a58', '#a27d4f', '#c49c66', '#3f6fa0', '#8b9199', '#b08a58'];
        for (let bx = x0 + 1.5; bx < x1 - 5;) {
          const w = rand(6, 10), d = rand(13, 22);
          if (bx + w > x1 - 1.5) break;
          const col = loads[Math.floor(Math.random() * loads.length)];
          ctx.fillStyle = col; ctx.fillRect(bx, -11, w, d);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx + w - 1, -11, 1, d);
          if (col !== '#3f6fa0' && col !== '#8b9199') { ctx.fillStyle = 'rgba(240,225,190,0.35)'; ctx.fillRect(bx + w / 2 - 0.6, -11, 1.2, d); }
          bx += w + rand(0.8, 2.5);
        }
        ctx.fillStyle = '#d9772b';
        ctx.fillRect(x0, -13, x1 - x0, 2); ctx.fillRect(x0, 11, x1 - x0, 2);
        ctx.fillStyle = '#2b3036';
        ctx.fillRect(x0, -13, 2.5, 2.5); ctx.fillRect(x0, 10.5, 2.5, 2.5);
        if (!p.link.r) { ctx.fillRect(x1 - 2.5, -13, 2.5, 2.5); ctx.fillRect(x1 - 2.5, 10.5, 2.5, 2.5); }
        break;
      }
      case 'locker': {
        // armoire métallique à deux portes, vue de dessus ; un carton oublié dessus, parfois
        const x0 = p.link.l ? -16 : -14, x1 = p.link.r ? 16 : 14;
        this.shadowBox(ctx, cx, cy, 28, 26, p.rot);
        ctx.translate(cx, cy); ctx.rotate(p.rot);
        ctx.fillStyle = '#4f5a66'; ctx.fillRect(x0, -13, x1 - x0, 26);
        ctx.fillStyle = '#687683'; ctx.fillRect(x0 + 1, -12, x1 - x0 - 2, 21);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0 + 1, -12, x1 - x0 - 2, 1.5);
        ctx.fillStyle = '#39424c'; ctx.fillRect(x0, 9, x1 - x0, 4);
        ctx.fillStyle = '#20262c'; ctx.fillRect(-0.4, 9, 0.8, 4);
        ctx.fillStyle = '#c9cfd4'; ctx.fillRect(-3, 10.5, 1.6, 1.2); ctx.fillRect(1.4, 10.5, 1.6, 1.2);
        if (p.link.r) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(15.4, -13, 0.8, 26); }
        if (Math.random() < 0.45) {
          ctx.translate(rand(-5, 5), rand(-6, 1)); ctx.rotate(rand(-0.4, 0.4));
          ctx.fillStyle = '#a88355'; ctx.fillRect(-4.5, -3.5, 9, 7);
          ctx.fillStyle = 'rgba(245,230,200,0.35)'; ctx.fillRect(-4.5, -0.5, 9, 1);
        }
        break;
      }
      case 'server': {
        // baie de serveurs : toit ajouré, façade à voyants, câbles qui partent par l'arrière
        const x0 = p.link.l ? -16 : -14, x1 = p.link.r ? 16 : 14;
        this.shadowBox(ctx, cx, cy, 28, 28, p.rot);
        ctx.translate(cx, cy); ctx.rotate(p.rot);
        ctx.fillStyle = '#15181c'; ctx.fillRect(x0, -14, x1 - x0, 28);
        ctx.fillStyle = '#242a31'; ctx.fillRect(x0 + 1.5, -12.5, x1 - x0 - 3, 20);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        for (let yy = -10; yy < 6; yy += 3) ctx.fillRect(x0 + 4, yy, x1 - x0 - 8, 1.2);
        ctx.fillStyle = '#0b0d10'; ctx.fillRect(x0, 9, x1 - x0, 5);
        const leds = ['#39d353', '#39d353', '#39d353', '#3fa7ff', '#ffb000'];
        for (let lx = x0 + 2.5; lx < x1 - 2; lx += 2.6) {
          ctx.fillStyle = leds[Math.floor(Math.random() * leds.length)];
          ctx.fillRect(lx, Math.random() < 0.5 ? 10.2 : 11.8, 1.2, 1.2);
        }
        ctx.strokeStyle = '#2d5d8a'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(-5, -14); ctx.quadraticCurveTo(-4, -17, 0, -16); ctx.moveTo(4, -14); ctx.quadraticCurveTo(5, -16.5, 9, -16); ctx.stroke();
        if (p.link.r) { ctx.fillStyle = 'rgba(90,100,110,0.5)'; ctx.fillRect(15.4, -14, 0.8, 28); }
        break;
      }
      case 'pallet': {
        // palette chargée : sacs ou cartons sous film plastique
        this.shadowBox(ctx, cx, cy, 28, 28, 0);
        ctx.translate(cx, cy); ctx.rotate(rand(-0.06, 0.06) + (Math.random() < 0.5 ? 0 : Math.PI / 2));
        ctx.fillStyle = '#9c7a4f';
        for (let i = -14; i < 14; i += 7) ctx.fillRect(-14, i, 28, 5);
        ctx.fillStyle = 'rgba(60,40,20,0.4)';
        for (let i = -14; i < 14; i += 7) ctx.fillRect(-14, i + 4, 28, 1);
        if (Math.random() < 0.5) {
          for (let i = 0; i < 6; i++) {
            const bx = -12 + (i % 2) * 12, by = -12 + Math.floor(i / 2) * 8;
            roundRect(ctx, bx + rand(-0.8, 0.8), by, 11, 7.5, 3);
            ctx.fillStyle = i % 3 ? '#cdbd9c' : '#c3b28f'; ctx.fill();
            ctx.strokeStyle = 'rgba(80,65,40,0.45)'; ctx.lineWidth = 0.7; ctx.stroke();
          }
        } else {
          for (let i = 0; i < 4; i++) {
            const bx = -12 + (i % 2) * 12, by = -12 + Math.floor(i / 2) * 12;
            ctx.fillStyle = i === 3 ? '#a27d4f' : '#b08a58'; ctx.fillRect(bx, by, 11.5, 11.5);
            ctx.fillStyle = 'rgba(240,225,190,0.35)'; ctx.fillRect(bx + 5.2, by, 1.2, 11.5);
          }
        }
        ctx.fillStyle = 'rgba(210,230,255,0.13)'; ctx.fillRect(-12.5, -12.5, 25, 25);
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-11, -11, 18, 1.2);
        break;
      }
      case 'counter': {
        // comptoir (accueil, bar, cuisine) : plateau de pierre sur caisson de bois, et ce qu'on y a posé
        const x0 = p.link.l ? -16 : -15, x1 = p.link.r ? 16 : 15;
        this.shadowBox(ctx, cx, cy, 30, 26, p.rot);
        ctx.translate(cx, cy); ctx.rotate(p.rot);
        ctx.fillStyle = '#5b3d27'; ctx.fillRect(x0, -13, x1 - x0, 26);
        ctx.fillStyle = '#8e908b'; ctx.fillRect(x0, -13, x1 - x0, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillRect(x0, -12, x1 - x0, 1.5);
        ctx.fillStyle = 'rgba(40,36,30,0.35)'; ctx.fillRect(x0, 8.4, x1 - x0, 0.8);
        if (p.link.r) { ctx.fillStyle = 'rgba(40,36,30,0.3)'; ctx.fillRect(15.6, -13, 0.6, 22); }
        const r = Math.random();
        if (r < 0.35) {
          ctx.fillStyle = '#1c1f24'; ctx.fillRect(-6, -9, 12, 2.5);  // écran, vu par la tranche
          ctx.fillStyle = '#3a3f46'; ctx.fillRect(-1.5, -6.5, 3, 2.5);
          ctx.fillStyle = '#2a2e34'; ctx.fillRect(-5, -1, 10, 3.5); // clavier
        } else if (r < 0.65) {
          ctx.rotate(rand(-0.3, 0.3));
          ctx.fillStyle = '#ece8dc'; ctx.fillRect(-4, -8, 7, 9);
          ctx.fillStyle = 'rgba(60,60,70,0.35)';
          for (let k = 0; k < 3; k++) ctx.fillRect(-3, -6 + k * 2.4, 5, 0.6);
        } else if (r < 0.85) {
          ctx.fillStyle = '#3a3f46'; ctx.fillRect(-4.5, -9, 9, 8); // machine à café / caisse
          ctx.fillStyle = '#d0453a'; ctx.fillRect(-3, -7.5, 1.4, 1.4);
        }
        break;
      }
      case 'plant': {
        this.shadow(ctx, cx, cy, 9, 9);
        ctx.fillStyle = '#7a4a2a'; circle(ctx, cx, cy, 8); ctx.fill();
        for (let i = 0; i < 7; i++) {
          const a = TAU * i / 7 + rand(-0.2, 0.2);
          ctx.fillStyle = i % 2 ? '#3f7d3a' : '#4f9448';
          ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 8, 3.5, a, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#5fae55'; circle(ctx, cx, cy, 3.5); ctx.fill();
        if (Math.random() < 0.5) {
          // en fleurs
          const col = ['#f06292', '#ffd54f', '#f5f5f5', '#ba68c8'][Math.floor(Math.random() * 4)];
          for (let i = 0; i < 5; i++) {
            const a = rand(0, TAU), d = rand(2, 9);
            ctx.fillStyle = col; circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.7); ctx.fill();
            ctx.fillStyle = 'rgba(120,70,0,0.6)'; circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.6); ctx.fill();
          }
        }
        break;
      }
    }
    ctx.restore();
  },

  // ---- Armes (repère local : le personnage regarde vers +x, axe de l'arme à y = AXIS) ----
  // t : variante de couleurs / de forme (WEAPONS[..].tint)
  gun(ctx, kind, gl, t = {}) {
    const A = 1.5;          // axe de l'arme (épaulée à droite)
    const M = 13 + gl;      // bouche du canon : doit correspondre à Game.fireWeapon
    const OUT = 'rgba(0,0,0,0.45)';
    // Vue de dessus, une arme est étroite et longue : boîtier ~3, garde-main ~2.6, canon ~1.1
    // (l'épaisseur dessinée est encore multipliée par GUN_THICK quand l'arme est tenue).
    const STEEL = '#2a2d32', STEEL_D = '#1d1f23', BARREL = '#15171a', POLY = '#26292e', WOOD = '#6b4726';
    // pièce rectangulaire arrondie, centrée sur l'axe (dy = décalage latéral)
    const part = (x0, x1, h, fill, dy = 0, r = 0.4) => {
      roundRect(ctx, x0, A + dy - h / 2, x1 - x0, h, Math.min(r, h / 2));
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 0.5; ctx.strokeStyle = OUT; ctx.stroke();
    };
    // polygone en coordonnées relatives à l'axe
    const poly = (pts, fill) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, A + y) : ctx.moveTo(x, A + y)));
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 0.5; ctx.strokeStyle = OUT; ctx.stroke();
    };
    const shine = (x0, x1, dy, a = 0.12) => { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(x0, A + dy, x1 - x0, 0.4); };
    const dark = (x, dy, w, h, a = 0.45) => { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, A + dy, w, h); };
    const grain = (x0, x1, dys) => {
      ctx.strokeStyle = 'rgba(40,20,5,0.35)'; ctx.lineWidth = 0.3;
      for (const dy of dys) { ctx.beginPath(); ctx.moveTo(x0, A + dy); ctx.quadraticCurveTo((x0 + x1) / 2, A + dy + 0.3, x1, A + dy - 0.1); ctx.stroke(); }
    };
    // rainures régulières : rail supérieur, fentes de garde-main, stries
    const ribs = (x0, x1, step, dy, h, a = 0.3) => { for (let x = x0; x <= x1; x += step) dark(x, dy - h / 2, step * 0.45, h, a); };
    // Optique vue de dessus : boîtier sombre et verre noir à peine reflétant.
    // (Le point rouge n'est visible que par le tireur, pas d'en haut.)
    const optic = (x0, x1, h) => {
      part(x0, x1, h, '#16181b', 0, 0.3);
      const cx = (x0 + x1) / 2, r = Math.min(h, x1 - x0) * 0.3;
      ctx.fillStyle = '#0a0c0f'; circle(ctx, cx, A, r); ctx.fill();
      ctx.strokeStyle = 'rgba(150,170,190,0.35)'; ctx.lineWidth = 0.22; ctx.stroke();
      ctx.fillStyle = 'rgba(150,180,205,0.2)'; circle(ctx, cx - r * 0.3, A - r * 0.3, r * 0.45); ctx.fill();
    };
    // Lampe tactique : petit tube sombre, lentille grise (jamais allumée d'en haut).
    const light = (x0, x1, dy) => {
      part(x0, x1, 1.2, '#1b1d21', dy, 0.3);
      ctx.fillStyle = '#bcc3c9'; ctx.fillRect(x1 - 0.55, A + dy - 0.4, 0.5, 0.8);
    };

    switch (kind) {
      case 'pistol': {
        part(8.2, 12.8, 2.3, '#17191c', 0.5, 0.45);            // carcasse / poignée
        part(12.6, M - 2.6, 1.3, '#1c1f22', 1, 0.3);           // rail sous le canon
        part(9.8, M, 2, t.slide || '#3e434b', 0, 0.3);         // culasse
        for (let x = 10.3; x < 12.4; x += 0.55) dark(x, -0.9, 0.22, 1.8, 0.45); // stries de manœuvre
        dark(14.2, 0.2, 2.6, 0.7, 0.6);                        // fenêtre d'éjection
        shine(10.2, M - 0.8, -0.8, 0.18);
        ctx.fillStyle = '#dfe3e6';                             // points de visée
        ctx.fillRect(10.2, A - 0.6, 0.35, 0.35); ctx.fillRect(10.2, A + 0.25, 0.35, 0.35); ctx.fillRect(M - 1, A - 0.18, 0.4, 0.36);
        ctx.fillStyle = '#0a0b0d'; ctx.fillRect(M - 0.4, A - 0.4, 0.4, 0.8); // bouche
        break;
      }

      case 'shotgun': { // Remington 870, ou Benelli M4 (t.semi)
        if (t.semi) {
          part(-6.5, -5.4, 2.9, '#131418', 0, 0.3);            // talon caoutchouc
          poly([[-5.4, -1.5], [-1.4, -1.6], [4.4, -1.1], [4.4, 1.1], [-1.4, 1.6], [-5.4, 1.5]], '#212327'); // crosse synthétique
          dark(-5, -0.35, 4.6, 0.7, 0.35);                     // appui-joue
          dark(-1.2, -1.5, 0.45, 3, 0.45); dark(0.2, -1.4, 0.45, 2.8, 0.45); // crans de réglage
        } else {
          part(-6.4, -5.4, 2.9, '#1a1b1e', 0, 0.3);            // plaque de couche
          poly([[-5.4, -1.45], [-4.4, -1.6], [4.6, -1.15], [4.6, 1.15], [-4.4, 1.6], [-5.4, 1.45]], WOOD); // crosse bois
          grain(-4.3, 4.4, [-0.75, 0.15, 0.95]);
        }
        part(4.4, 13.4, 3.2, '#2b2e33', 0, 0.4);               // boîtier
        dark(7.6, 0.95, 3, 0.7, 0.6);                          // fenêtre d'éjection
        shine(5, 13.2, -1.45);
        part(13.2, M, 1.45, '#191b1e', -0.85, 0.3);            // canon
        part(13.2, M - 3.2, 1.3, '#23262b', 1, 0.3);           // tube magasin
        part(M - 3.6, M - 2.8, 1.5, '#15171a', 1, 0.25);       // bouchon de tube
        shine(13.6, M - 1, -1.35, 0.15);
        if (t.semi) {
          part(15, 21.8, 2.8, '#1f2125', 0.1, 0.8);            // garde-main synthétique
          ribs(16, 21, 1.5, 0.1, 2.2);
          part(8.2, 11, 2.7, '#16181b', 0, 0.4);               // hausse à œilleton
          ctx.fillStyle = '#0c0d0f'; circle(ctx, 9.6, A, 0.6); ctx.fill();
          part(9, 10.6, 0.9, '#8d949c', 2.1, 0.25);            // levier d'armement
          part(M - 2.4, M - 1.4, 2.1, '#16181b', -0.85, 0.25); // guidon à ailettes
        } else {
          part(15.2, 22.6, 3, '#75491f', 0.1, 0.9);            // pompe bois
          for (let x = 16; x < 22.2; x += 1.15) dark(x, -1.35, 0.4, 3, 0.32); // rainures
          ctx.fillStyle = '#c8a54a'; circle(ctx, M - 0.9, A - 0.85, 0.36); ctx.fill(); // guidon (bille)
        }
        break;
      }

      case 'smg': { // HK MP5
        part(-5.3, -4.3, 2.5, '#131418', 0, 0.3);              // plaque de crosse
        part(-4.3, 4.2, 2.4, STEEL_D, 0, 0.3);                 // crosse rétractable (rentrée)
        dark(-4, -0.3, 8, 0.6, 0.4);                           // jointure des deux rails
        part(4, 14, 2.9, STEEL, 0, 0.35);                      // boîtier
        part(4.3, 5.9, 2.3, '#191b1f', 0, 0.5);                // hausse à tambour
        ctx.fillStyle = '#0d0f12'; circle(ctx, 5.1, A, 0.55); ctx.fill();
        dark(9.1, 0.8, 2.3, 0.6, 0.55);                        // fenêtre d'éjection
        shine(4.6, 13.8, -1.3);
        poly([[9.5, 1.3], [11.6, 1.3], [12.6, 4.5], [10.7, 4.8]], '#202327'); // chargeur courbe
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.3;
        ctx.beginPath(); ctx.moveTo(10.3, A + 1.8); ctx.lineTo(11.4, A + 4.4); ctx.stroke();
        part(14, 20.6, 2.6, '#22252a', 0, 0.8);                // garde-main
        ribs(15, 20, 1.1, 0, 1.6, 0.25);
        part(14.4, 19.4, 0.9, STEEL_D, -1.7, 0.3);             // tube du levier d'armement
        part(15.1, 16.2, 1.1, '#141619', -1.95, 0.3);          // poignée d'armement
        part(20.6, 22.2, 2.5, '#191b1f', 0, 0.6);              // guidon annulaire
        ctx.fillStyle = '#0d0f12'; circle(ctx, 21.4, A, 0.5); ctx.fill();
        part(22.2, M, 1.15, BARREL, 0, 0.3);                   // canon
        part(M - 1.4, M, 1.5, '#0f1114', 0, 0.25);             // ergots de fixation
        break;
      }

      case 'pdw': { // HK MP7 (chargeur logé dans la poignée : invisible d'en haut)
        part(-2.6, -1.7, 2.5, '#131418', 0, 0.3);              // plaque de crosse
        part(-1.7, 3.4, 2.2, STEEL_D, 0, 0.3);                 // crosse télescopique rentrée
        dark(-1.4, -0.28, 4.6, 0.56, 0.4);
        poly([[3, -1.5], [13.4, -1.5], [15.2, -1], [15.2, 1], [13.4, 1.5], [3, 1.5]], POLY); // carcasse polymère
        ribs(4.2, 13, 0.85, 0, 1);                             // rail supérieur
        dark(9.4, 0.5, 1.9, 0.5, 0.5);                         // fenêtre d'éjection
        shine(3.4, 13, -1, 0.1);
        part(4.2, 5.4, 0.9, '#16181b', 1.55, 0.2);             // levier d'armement
        optic(7, 10.4, 2);                                     // point rouge compact
        part(15.2, 18.2, 1.9, '#212428', 0, 0.4);              // manchon avant
        part(18.2, M, 1, BARREL, 0, 0.3);                      // canon
        part(M - 1.2, M, 1.35, '#0f1114', 0, 0.25);
        break;
      }

      case 'ak': { // AKM
        part(-6.4, -5.4, 2.9, '#26282b', 0, 0.3);              // plaque de couche
        poly([[-5.4, -1.4], [-4.4, -1.55], [4.8, -1.2], [4.8, 1.2], [-4.4, 1.55], [-5.4, 1.4]], '#70441f'); // crosse bois
        grain(-4.3, 4.6, [-0.7, 0.2, 1]);
        part(4.6, 14, 3.1, '#2c2e32', 0, 0.35);                // boîtier
        ribs(6, 13.4, 1.15, 0, 1.4, 0.25);                     // nervures du couvercle
        dark(9.6, 0.9, 2.8, 0.7, 0.55);                        // fenêtre d'éjection
        shine(5.2, 13.8, -1.4);
        poly([[8.5, 1.4], [11.2, 1.4], [12.7, 4.8], [10.3, 5.1]], '#4a3220'); // chargeur bakélite courbe
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.32;
        for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(8.9 + k * 0.5, A + 1.9 + k * 1.05); ctx.lineTo(11.4 + k * 0.45, A + 1.9 + k * 1.05); ctx.stroke(); }
        part(13.8, 14.8, 3.1, '#23252a', 0, 0.25);             // hausse
        part(14.8, 20.8, 2.7, '#7a4a24', 0, 0.9);              // garde-main bois
        grain(15.2, 20.4, [-0.8, 0.7]);
        part(14.8, 22.4, 1.4, '#5e3a1d', 0, 0.4);              // cache du tube à gaz
        part(20.8, M - 2.6, 1.2, '#1a1c1f', 0, 0.3);           // canon
        part(22.4, 23.6, 1.9, '#1c1e22', 0, 0.25);             // bloc de gaz
        poly([[M - 4.6, -1.2], [M - 3.8, -1.2], [M - 3.5, 0], [M - 4.9, 0]], '#1c1e22'); // guidon
        part(M - 2.6, M, 1.8, '#141619', 0, 0.3);              // frein de bouche
        dark(M - 2, -0.85, 0.35, 1.7, 0.55);
        break;
      }

      default: { // fusil d'assaut moderne : HK416, ou SCAR-H (variante sable, chargeur droit)
        const body = t.body || '#3a3f47', furn = t.dark || '#2e333a', magc = t.mag || '#31363d';
        part(-6.3, -5.3, 2.4, '#131418', 0, 0.3);              // talon caoutchouc
        poly([[-5.3, -1.15], [-1.6, -1.35], [2.6, -0.95], [2.6, 0.95], [-1.6, 1.35], [-5.3, 1.15]], furn); // crosse télescopique
        dark(-4.9, -0.35, 4.4, 0.7, 0.3);                      // appui-joue
        part(2.4, 5.4, 1.5, STEEL_D, 0, 0.4);                  // tube de crosse
        part(5, 14.2, 3, body, 0, 0.35);                       // boîtier
        part(4.4, 5.4, 2.1, STEEL_D, 0, 0.2);                  // levier d'armement
        ribs(6, 13.8, 0.85, 0, 1.1);                           // rail supérieur
        dark(9.6, 0.85, 2.6, 0.65, 0.55);                      // fenêtre d'éjection
        shine(5.4, 14, -1.35);
        if (t.straightMag) poly([[9.3, 1.3], [11.5, 1.3], [11.4, 3.9], [9.4, 3.9]], magc); // 7,62 : chargeur droit
        else poly([[9.3, 1.3], [11.5, 1.3], [11.9, 4.1], [9.9, 4.2]], magc);               // 5,56 : légèrement courbe
        dark(9.7, 3.2, 1.8, 0.35, 0.3);
        part(14.2, 23.8, 2.6, body, 0, 0.35);                  // garde-main
        ribs(15, 23, 1.05, 0, 0.9);
        for (let x = 15.4; x < 23; x += 1.7) { dark(x, -1.25, 0.9, 0.35, 0.45); dark(x, 0.9, 0.9, 0.35, 0.45); } // fentes de ventilation
        light(18.6, 21.8, -2);                                 // lampe tactique sur le flanc
        optic(7.4, 11.6, 2.4);                                 // viseur holographique
        part(23.8, M - 2.6, 1.1, BARREL, 0, 0.3);              // canon
        part(24.5, 25.9, 1.7, '#202328', 0, 0.25);             // bloc de gaz
        part(23.4, 24.3, 1.9, STEEL_D, 0, 0.2);                // guidon rabattable
        part(M - 2.6, M, 1.6, '#101215', 0, 0.3);              // cache-flamme
        dark(M - 2, -0.75, 0.3, 0.5, 0.75); dark(M - 2, 0.25, 0.3, 0.5, 0.75);
        dark(M - 1.1, -0.75, 0.3, 0.5, 0.75); dark(M - 1.1, 0.25, 0.3, 0.5, 0.75);
      }
    }
    // silencieux : un manchon sombre vissé au bout du canon (t.sup : sa longueur)
    if (t.sup) {
      const h = kind === 'pistol' ? 2.2 : 2.6;
      part(M - t.sup, M, h, '#1b1d21', 0, h / 2);
      shine(M - t.sup + 0.6, M - 0.6, -h / 2 + 0.35, 0.13);
      dark(M - t.sup + 0.8, -0.15, 0.3, 0.3, 0.35);
    }
    // module laser sur le rail : un petit boîtier, lentille rouge vers l'avant
    if (t.laser) {
      const [x0, x1, dy] = LASER_MOUNT[kind] || LASER_MOUNT.rifle;
      part(x0, x1, 1.3, '#4a4436', dy, 0.3);
      ctx.fillStyle = '#ff4433'; ctx.fillRect(x1 - 0.5, A + dy - 0.35, 0.45, 0.7);
    }
  },

  // Bouclier tenu, vu de dessus : on n'en voit que la tranche, un arc devant le porteur (repère du
  // personnage, regard vers +x ; s : SHIELDS[..].look).
  shieldHeld(ctx, s) {
    const cx = -3;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(cx, 0, s.r, -s.span, s.span);
    ctx.lineWidth = s.thick + 2.2; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
    ctx.lineWidth = s.thick; ctx.strokeStyle = s.color; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, 0, s.r - s.thick * 0.15, -s.span * 0.96, s.span * 0.96);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke(); // arête supérieure, éclairée
    // lampe fixée sur le bord gauche
    const a = -s.span * 0.72, lr = s.r + s.thick / 2 + 1;
    ctx.save(); ctx.translate(cx + Math.cos(a) * lr, Math.sin(a) * lr); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#16181b'; ctx.fillRect(-2.2, -1.2, 4.4, 2.4);
    ctx.fillStyle = '#c9d0d6'; ctx.fillRect(-0.5, -1.2, 1, 0.8);
    ctx.restore();
    ctx.restore();
  },

  // Bouclier posé à plat (lâché au sol) : on voit sa face, la lucarne et la bande « POLICE ».
  shieldFlat(ctx, s) {
    const W = s.r * 0.95, L = s.r * 1.7;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(ctx, -L / 2 + 1.5, -W / 2 + 2, L, W, 3); ctx.fill();
    roundRect(ctx, -L / 2, -W / 2, L, W, 3);
    ctx.fillStyle = s.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(-L / 2 + 2, -W / 2 + 1.5, L - 4, 1.6);
    ctx.fillStyle = '#0c1014'; roundRect(ctx, L / 2 - 8.5, -W * 0.3, 4.5, W * 0.6, 1); ctx.fill(); // lucarne
    ctx.fillStyle = 'rgba(160,190,215,0.3)'; ctx.fillRect(L / 2 - 7.8, -W * 0.25, 1.1, W * 0.45);
    ctx.fillStyle = '#dfe3e7'; ctx.fillRect(-L * 0.2, -W * 0.38, 3.4, W * 0.76);                   // bande
    ctx.fillStyle = 'rgba(30,34,40,0.8)';
    for (let k = 0; k < 4; k++) ctx.fillRect(-L * 0.2 + 1.2, -W * 0.3 + k * W * 0.16, 1, W * 0.1);  // lettres
  },
  // Geste à deux mains : la pose est modifiée sur place et le style renvoyé porte l'inclinaison
  // de l'arme (tenue d'une seule main) et, pour une grenade, sa position dans la main.
  // st.act = { type: 'door' | 'grenade', k } avec k l'avancement du geste (0..1).
  actionPose(st, pose, h) {
    const k = clamp(st.act.k, 0, 1);
    if (st.act.type === 'fiber') {
      // bras tendu vers le bas de la porte, et qui y reste tant qu'on observe
      pose.arms[0] = [[-2, -9.5], [9, -7.5], [h[0][0] + k * 10, h[0][1] - k * 2]];
      return { ...st, gunRot: 0.55 * k };
    }
    if (st.act.type === 'door') {
      // la main avant lâche le garde-main, va sur la poignée et revient
      const e = Math.sin(k * Math.PI);
      pose.arms[0] = [[-2, -9.5], [9 + e * 2, -8.2], [h[0][0] + e * 8, h[0][1] - e * 4]];
      return { ...st, gunRot: 0.5 * e };
    }
    if (st.act.type === 'pickup' || st.act.type === 'hostage') {
      // arme basse, la main avant descend saisir l'arme au sol (ou relever l'otage) puis revient
      const e = Math.sin(k * Math.PI);
      pose.arms[0] = [[-2, -9.5], [8, -10 - e * 3], [h[0][0] + e * 5, h[0][1] - e * 9]];
      return { ...st, gunRot: 0.75 * e };
    }
    if (st.act.type === 'reload') {
      // chargeur : la main avant lâche le garde-main, descend chercher un chargeur, le remonte
      // dans le puits, puis réarme d'un coup sec. Pour un fusil à pompe, c'est le même va-et-vient.
      const down = clamp(k / 0.35, 0, 1), up = clamp((k - 0.35) / 0.45, 0, 1), rack = clamp((k - 0.8) / 0.2, 0, 1);
      const rx = lerp(lerp(h[0][0], 4, down), h[0][0] + 2, up) - Math.sin(rack * Math.PI) * 5;
      const ry = lerp(lerp(h[0][1], 16, down), h[0][1], up);
      pose.arms[0] = [[-2, -9.5], [lerp(7, 1, down) + up * 5, lerp(-8.5, 6, down) - up * 11], [rx, ry]];
      const held = down > 0.25 && up < 0.9;
      return { ...st, gunRot: 0.62 * down - 0.4 * up, mag: held ? [rx, ry] : null };
    }
    // grenade : armé du bras en arrière (w) puis lancer vers l'avant (f)
    const w = clamp(k / 0.55, 0, 1), f = clamp((k - 0.55) / 0.45, 0, 1);
    const hx = lerp(lerp(h[1][0], -2, w), 19, f), hy = lerp(lerp(h[1][1], 13.5, w), 3.5, f);
    pose.arms[1] = [[-2, 9.5], [lerp(3, -4, w) + f * 11, lerp(11, 14, w) - f * 3], [hx, hy]];
    return { ...st, gunRot: 0.35 + 0.3 * w - f * 0.15, grenade: f < 0.98 ? [hx, hy] : null };
  },

  // Position des mains selon l'arme : [main avant (gauche), main arrière (droite)]
  hands(kind) {
    const S = GUN_SHIFT;
    if (kind === 'pistol') return [[13.5 + S, -1.2], [12.5 + S, 2.8]];
    if (kind === 'shotgun') return [[16.5 + S, -0.4], [8.5 + S, 3.8]];
    if (kind === 'smg') return [[16 + S, -0.5], [8.5 + S, 3.6]];
    if (kind === 'pdw') return [[14.5 + S, -0.8], [9 + S, 3.4]];
    return [[17 + S, -0.6], [9 + S, 3.8]];
  },
  // Arme lâchée au sol (repère local, centrée)
  droppedGun(ctx, kind, gl, t) {
    ctx.save(); ctx.translate(-(13 + gl) / 2 + 4, -1.5);
    this.gun(ctx, kind, gl, t);
    ctx.restore();
  },

  // Fenêtre : encadrement dans le mur et vitre. On la voit de l'intérieur, on ne la franchit pas.
  paintWindow(ctx, w) {
    const L = w.len * TILE, T = TILE;
    const x = w.cx - (w.horizontal ? L / 2 : T / 2), y = w.cy - (w.horizontal ? T / 2 : L / 2);
    const ww = w.horizontal ? L : T, hh = w.horizontal ? T : L;
    ctx.fillStyle = '#2b3138'; ctx.fillRect(x, y, ww, hh);                   // tableau
    ctx.fillStyle = '#6f8b9a'; ctx.fillRect(x + 1.5, y + 1.5, ww - 3, hh - 3); // vitre
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    if (w.horizontal) ctx.fillRect(x + 2, y + 2.5, ww - 4, 2); else ctx.fillRect(x + 2.5, y + 2, 2, hh - 4);
    ctx.fillStyle = '#39424a';                                              // montants
    if (w.horizontal) { ctx.fillRect(x + ww / 3 - 0.8, y, 1.6, hh); ctx.fillRect(x + 2 * ww / 3 - 0.8, y, 1.6, hh); }
    else { ctx.fillRect(x, y + hh / 3 - 0.8, ww, 1.6); ctx.fillRect(x, y + 2 * hh / 3 - 0.8, ww, 1.6); }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
  },

  // ---- Personnages ----
  // Dessin générique d'un personnage à partir d'une pose (voir POSE_STAND / POSE_LIE).
  // st : { body, shoulder, vest, vestLight, pack, sleeve, gloves, skin, boots, helmet | hair/head, band, gun, gunLen, gunTint }
  // held : true si l'arme est tenue (mains dessus), walk : phase de marche, moving : bool
  figure(ctx, x, y, angle, st, pose, held, walk, moving) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(pose.shadow.x, pose.shadow.y, pose.shadow.rx, pose.shadow.ry, angle, 0, TAU); ctx.fill();
    ctx.rotate(angle);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const limb = (pts, w, col) => {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineWidth = w + 2.2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };
    const dot = (px, py, r, col) => { ctx.fillStyle = 'rgba(0,0,0,0.5)'; circle(ctx, px, py, r + 0.9); ctx.fill(); ctx.fillStyle = col; circle(ctx, px, py, r); ctx.fill(); };
    const sw = moving ? Math.sin(walk || 0) : 0;
    const pants = st.pants || '#2a2d33', boots = st.boots || '#17181b', skin = st.gloves || st.skin || '#d2a583';
    // jambes + pieds
    for (let i = 0; i < 2; i++) {
      const leg = pose.legs[i], side = i ? 1 : -1;
      const foot = [leg[2][0] - sw * side * 4.5 * (1 - pose.side), leg[2][1]];
      if (pose.legW > 0.6) limb([leg[0], leg[1], foot], pose.legW, pants);
      ctx.fillStyle = boots;
      ctx.beginPath(); ctx.ellipse(foot[0], foot[1], pose.foot.rx, pose.foot.ry, 0, 0, TAU); ctx.fill();
      if (pose.legW > 0.6) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // sac à dos
    if (st.pack) {
      ctx.fillStyle = st.pack; roundRect(ctx, pose.pack.x, pose.pack.y, pose.pack.w, pose.pack.h, 2.5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(pose.pack.x + 1, pose.pack.y + 1, pose.pack.w - 2, 2);
    }
    // torse
    const T = pose.torso;
    ctx.fillStyle = st.body;
    ctx.beginPath(); ctx.ellipse(T.x, T.y, T.rx, T.ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = st.shoulder || st.body;
    for (const s of pose.shoulders) { circle(ctx, s[0], s[1], pose.shR); ctx.fill(); ctx.stroke(); }
    // gilet tactique ou brelage
    const V = pose.vest;
    if (st.vest) {
      ctx.fillStyle = st.vest; roundRect(ctx, V.x, V.y, V.w, V.h, 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(V.x, V.y + V.h / 2 - 1, V.w, 2);
      ctx.fillStyle = st.vestLight || 'rgba(255,255,255,0.1)'; ctx.fillRect(V.x + V.w / 2 - 1.1, V.y, 2.2, V.h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(V.x, V.y, V.w, 2.5);
    } else if (!st.civil) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(V.x - 1.5, V.y - 0.5); ctx.lineTo(V.x + V.w, V.y + V.h - 0.5); ctx.moveTo(V.x - 1.5, V.y + V.h); ctx.lineTo(V.x + V.w, V.y + 0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(V.x + V.w - 2.5, V.y + 2.5, 3, 3); ctx.fillRect(V.x + V.w - 2.5, V.y + V.h - 5.5, 3, 3);
    }
    if (pose.side > 0.5) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(T.x - 2, T.y, T.rx * 0.78, T.ry * 0.7, 0, 0, TAU); ctx.fill(); }
    // bras
    for (const arm of pose.arms) limb(arm, 5.5, st.sleeve);
    // bouclier au bras gauche, devant le torse : l'arme de poing et la main passent par-dessus le bord
    if (held && st.shield) this.shieldHeld(ctx, st.shield);
    // arme tenue
    if (held) {
      ctx.save();
      // arme abaissée pendant un geste : pivot près de la main arrière, avant l'épaississement
      if (st.gunRot) { ctx.translate(11, 2.5); ctx.rotate(st.gunRot); ctx.translate(-11, -2.5); }
      ctx.translate(GUN_SHIFT, 1.5); ctx.scale(1, GUN_THICK); ctx.translate(0, -1.5);
      this.gun(ctx, st.gun, st.gunLen || 18, st.gunTint);
      ctx.restore();
    }
    // mains
    for (const arm of pose.arms) dot(arm[2][0], arm[2][1], 3.1, skin);
    // chargeur encore en main pendant le rechargement
    if (st.mag) {
      ctx.save(); ctx.translate(st.mag[0], st.mag[1]); ctx.rotate(0.4);
      ctx.fillStyle = '#31363d'; ctx.fillRect(-1.6, -3.4, 3.2, 6.8);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-1.6, -3.4, 1, 6.8);
      ctx.restore();
    }
    // grenade encore en main pendant le lancer
    if (st.grenade) {
      dot(st.grenade[0], st.grenade[1], 2.5, '#47543c');
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(st.grenade[0] - 0.7, st.grenade[1] - 2.3, 1.4, 1.1);
    }
    // tête
    ctx.save(); ctx.translate(pose.head.x - 1, pose.head.y); const hs = pose.head.r / 6.9; ctx.scale(hs, hs);
    if (pose.side < 0.5) { if (st.helmet) this.helmet(ctx, st); else this.head(ctx, st); }
    else this.headSide(ctx, st);
    ctx.restore();
    ctx.restore();
  },

  character(ctx, x, y, angle, st, muzzle, walk, moving) {
    const h = this.hands(st.gun);
    // avec un bouclier, la main gauche tient sa poignée et la droite l'arme de poing, bras tendu
    const pose = st.shield
      ? { ...POSE_STAND, arms: [[[-2, -9.5], [3, -11], [8.5, -5.5]], [[-2, 9.5], [6.5, 7], h[1]]] }
      : { ...POSE_STAND, arms: [[[-2, -9.5], [7, -6.5], h[0]], [[-2, 9.5], [4.5, 7], h[1]]] };
    if (st.act) st = this.actionPose(st, pose, h);
    this.figure(ctx, x, y, angle, st, pose, true, walk, moving);
    if (muzzle > 0) this.muzzleFlash(ctx, x, y, angle, muzzleDist(st.gunLen || 18), muzzle, st.gunSup ? 0.3 : 1);
  },

  helmet(ctx, st) {
    ctx.fillStyle = '#15171a'; circle(ctx, 0.5, -6.8, 2.4); ctx.fill(); circle(ctx, 0.5, 6.8, 2.4); ctx.fill();
    ctx.fillStyle = st.helmet; circle(ctx, 1, 0, 6.9); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1; circle(ctx, 1, 0, 5.3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.17)'; ctx.beginPath(); ctx.ellipse(-0.5, -2, 3.4, 2.2, -0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#101214'; ctx.fillRect(5.6, -3.6, 2.6, 7.2);
    ctx.fillStyle = '#8fd0ff'; ctx.fillRect(6.2, -2.9, 1.5, 2.2); ctx.fillRect(6.2, 0.7, 1.5, 2.2);
    ctx.fillStyle = '#b8ff6a'; ctx.fillRect(-5.4, -1.2, 1.6, 2.4);
  },

  head(ctx, st) {
    const skin = st.skin || '#d2a583';
    ctx.fillStyle = skin; circle(ctx, 1.5, 0, 6.2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; circle(ctx, 1.5, -6, 1.6); ctx.fill(); circle(ctx, 1.5, 6, 1.6); ctx.fill();
    switch (st.head) {
      case 'cap':
        ctx.fillStyle = st.hair; circle(ctx, 0.8, 0, 6.3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = st.hair; ctx.fillRect(5, -4.5, 4.5, 9);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(5, -4.5, 1, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; circle(ctx, 0.8, 0, 2.2); ctx.fill();
        break;
      case 'mask':
        ctx.fillStyle = '#1c1c20'; circle(ctx, 1.2, 0, 6.4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = skin; ctx.fillRect(5.2, -2.4, 2.4, 4.8);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.ellipse(-0.5, -1.5, 3, 2, 0, 0, TAU); ctx.fill();
        break;
      default:
        ctx.fillStyle = st.hair;
        ctx.beginPath(); ctx.ellipse(-0.6, 0, 5, 6.3, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(1.5, 0, 6.2, Math.PI * 0.62, Math.PI * 1.38); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.ellipse(-1, -1.5, 2.6, 1.6, 0, 0, TAU); ctx.fill();
        if (st.band) { ctx.fillStyle = st.band; ctx.fillRect(2, -6.4, 2.6, 12.8); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(2, -6.4, 0.8, 12.8); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; circle(ctx, 7, 0, 1.2); ctx.fill();
  },

  // Tête tournée sur le côté (corps au sol)
  headSide(ctx, st) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.4;
    if (st.helmet) {
      ctx.fillStyle = '#15171a'; circle(ctx, 0, 6.6, 2.3); ctx.fill();
      ctx.fillStyle = st.helmet; circle(ctx, 1, 0, 6.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(-0.5, -2, 3.2, 2.1, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#101214'; ctx.fillRect(3.5, 3.6, 5, 2.4);
    } else {
      const skin = st.skin || '#d2a583';
      ctx.fillStyle = skin; circle(ctx, 1, 0, 6.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = st.head === 'mask' ? '#1c1c20' : st.hair || '#2a1e14';
      ctx.beginPath(); ctx.arc(1, 0, 6.5, Math.PI * 1.15, Math.PI * 2.25); ctx.lineTo(1, 0); ctx.closePath(); ctx.fill();
      if (st.head === 'cap') { ctx.fillStyle = st.hair; ctx.fillRect(4, -7.5, 5, 4); }
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; circle(ctx, 2.2, 5.6, 1.4); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(4, 3, 2.2, 1.2);
    }
  },

  // k : taille de la flamme (un silencieux l'étouffe presque entièrement)
  muzzleFlash(ctx, x, y, angle, ml, t, k = 1) {
    const mx = x + Math.cos(angle) * ml, my = y + Math.sin(angle) * ml;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(angle); ctx.scale(k, k);
    ctx.globalAlpha = Math.min(1, t / 0.04);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 36);
    g.addColorStop(0, 'rgba(255,230,150,0.6)'); g.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = g; circle(ctx, 0, 0, 36); ctx.fill();
    ctx.fillStyle = '#fff4c8';
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(4, -5.5); ctx.lineTo(14, -1.5); ctx.lineTo(22, 0); ctx.lineTo(14, 1.5); ctx.lineTo(4, 5.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, -2); ctx.lineTo(13, 0); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
    ctx.restore();
  },

  // Corps au sol
  body(ctx, a, st) {
    const rot = a.bodyAngle === undefined ? a.angle + 0.9 : a.bodyAngle;
    if (st.shield) {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(rot); ctx.translate(DROPPED_SHIELD.x, DROPPED_SHIELD.y); ctx.rotate(DROPPED_SHIELD.rot);
      this.shieldFlat(ctx, st.shield);
      ctx.restore();
    }
    if (st.gun) {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(rot); ctx.translate(DROPPED_GUN.x, DROPPED_GUN.y); ctx.rotate(DROPPED_GUN.rot);
      this.droppedGun(ctx, st.gun, st.gunLen || 18, st.gunTint);
      ctx.restore();
    }
    this.figure(ctx, a.x, a.y, rot, st, POSE_LIE, false, 0, false);
  },

  // Animation de mort : chaque membre glisse de la pose debout vers la pose allongée,
  // le corps pivote vers son orientation finale et l'arme est lâchée en tournoyant.
  dying(ctx, a, st, d) {
    const k = clamp(d.t / d.dur, 0, 1);
    const bodyAngle = a.bodyAngle === undefined ? a.angle + 0.9 : a.bodyAngle;
    // petit temps de latence (impact) puis effondrement accéléré, avec un léger rebond
    let e = k < 0.12 ? 0 : smoothstep((k - 0.12) / 0.7);
    if (k > 0.82) e = 1 + Math.sin((k - 0.82) / 0.18 * Math.PI) * 0.03;
    const pose = lerpPose(POSE_STAND, POSE_LIE, clamp(e, 0, 1));
    pose.side = e > 0.55 ? 1 : 0;
    pose.arms = e < 0.01 ? [[[-2, -9.5], [7, -6.5], this.hands(st.gun)[0]], [[-2, 9.5], [4.5, 7], this.hands(st.gun)[1]]] : pose.arms;
    const rot = a.angle + angleDiff(a.angle, bodyAngle) * smoothstep(e);
    const held = k < 0.12;
    if (!held && st.shield) {
      // le bouclier bascule vers l'avant et tombe à plat à côté du corps
      const g = smoothstep(clamp((k - 0.12) / 0.6, 0, 1));
      const sx = a.x + Math.cos(a.angle) * 10, sy = a.y + Math.sin(a.angle) * 10;
      const ex = a.x + Math.cos(bodyAngle) * DROPPED_SHIELD.x - Math.sin(bodyAngle) * DROPPED_SHIELD.y, ey = a.y + Math.sin(bodyAngle) * DROPPED_SHIELD.x + Math.cos(bodyAngle) * DROPPED_SHIELD.y;
      ctx.save(); ctx.translate(lerp(sx, ex, g), lerp(sy, ey, g)); ctx.rotate(lerp(a.angle, bodyAngle + DROPPED_SHIELD.rot, g));
      ctx.scale(lerp(0.2, 1, g), 1); // vu par la tranche, puis à plat
      this.shieldFlat(ctx, st.shield);
      ctx.restore();
    }
    if (!held && st.gun) {
      // l'arme part de la main et retombe à côté du corps
      const g = smoothstep(clamp((k - 0.12) / 0.5, 0, 1));
      const h = this.hands(st.gun)[0];
      const sx = a.x + Math.cos(a.angle) * h[0] - Math.sin(a.angle) * h[1], sy = a.y + Math.sin(a.angle) * h[0] + Math.cos(a.angle) * h[1];
      const ex = a.x + Math.cos(bodyAngle) * DROPPED_GUN.x - Math.sin(bodyAngle) * DROPPED_GUN.y, ey = a.y + Math.sin(bodyAngle) * DROPPED_GUN.x + Math.cos(bodyAngle) * DROPPED_GUN.y;
      const gx = lerp(sx, ex, g), gy = lerp(sy, ey, g) - Math.sin(g * Math.PI) * 10;
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(lerp(a.angle, bodyAngle + DROPPED_GUN.rot, g) + (1 - g) * d.spin * 3);
      this.droppedGun(ctx, st.gun, st.gunLen || 18, st.gunTint);
      ctx.restore();
    }
    this.figure(ctx, a.x, a.y, rot, st, pose, held, 0, false);
  },

  // Otage à genoux, mains sur la tête
  hostage(ctx, h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(2, 3, 11, 10, 0, 0, TAU); ctx.fill();
    ctx.rotate(h.angle);
    ctx.lineCap = 'round';
    ctx.lineWidth = 5.5; ctx.strokeStyle = '#3b4250';
    ctx.beginPath(); ctx.moveTo(-4, -4.5); ctx.lineTo(-14, -5.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, 4.5); ctx.lineTo(-14, 5.5); ctx.stroke();
    ctx.fillStyle = '#17181b'; circle(ctx, -15, -6, 2.8); ctx.fill(); circle(ctx, -15, 6, 2.8); ctx.fill();
    ctx.fillStyle = '#8a97a8';
    ctx.beginPath(); ctx.ellipse(-1, 0, 7.5, 10, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineWidth = 4.6; ctx.strokeStyle = '#8a97a8';
    ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(5, -9); ctx.lineTo(4, -5.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, 8); ctx.lineTo(5, 9); ctx.lineTo(4, 5.5); ctx.stroke();
    ctx.fillStyle = '#d9b48f'; circle(ctx, 1.5, 0, 5.8); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#3b2a1a'; ctx.beginPath(); ctx.ellipse(-0.5, 0, 4.5, 5.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9b48f'; circle(ctx, 4, -5.5, 2.7); ctx.fill(); circle(ctx, 4, 5.5, 2.7); ctx.fill();
    if (h.wounded) {
      // blessé : chemise tachée de sang
      ctx.fillStyle = 'rgba(150,12,14,0.85)';
      ctx.beginPath(); ctx.ellipse(-4, 3, 3.6, 2.6, 0.4, 0, TAU); ctx.fill();
      circle(ctx, -6.5, -2, 1.3); ctx.fill();
    }
    ctx.restore();
  },

  // Otage debout (escorté, ou qui sort) : il marche les mains sur la tête ; il s'efface en franchissant
  // la façade (h.exiting.alpha).
  hostageStanding(ctx, h) {
    const pose = { ...POSE_STAND, arms: [[[-2.5, -9.5], [1, -13.5], [2.8, -8]], [[-2.5, 9.5], [1, 13.5], [2.8, 8]]] };
    ctx.save();
    if (h.exiting) ctx.globalAlpha = h.exiting.alpha;
    this.figure(ctx, h.x, h.y, h.angle, STYLE_HOSTAGE, pose, false, h.walk, h.moving);
    if (h.wounded) {
      ctx.translate(h.x, h.y); ctx.rotate(h.angle);
      ctx.fillStyle = 'rgba(150,12,14,0.85)';
      ctx.beginPath(); ctx.ellipse(-4, 3, 3.6, 2.6, 0.4, 0, TAU); ctx.fill();
      circle(ctx, -6.5, -2, 1.3); ctx.fill();
    }
    ctx.restore();
  },

  // ---- Décalques persistants ----
  decal(ctx, d) {
    switch (d.type) {
      case 'scorch': {
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 26);
        g.addColorStop(0, 'rgba(12,10,8,0.7)'); g.addColorStop(1, 'rgba(12,10,8,0)');
        ctx.fillStyle = g; circle(ctx, d.x, d.y, 26); ctx.fill();
        break;
      }
      case 'blood':
        ctx.fillStyle = `rgba(${110 + Math.floor(rand(0, 30))},8,10,${rand(0.5, 0.8)})`;
        circle(ctx, d.x, d.y, d.r); ctx.fill();
        for (let i = 0; i < 3; i++) { circle(ctx, d.x + rand(-6, 6), d.y + rand(-6, 6), rand(0.7, 1.8)); ctx.fill(); }
        break;
      case 'pool':
        ctx.fillStyle = 'rgba(95,8,10,0.75)';
        ctx.beginPath(); ctx.ellipse(d.x + 3, d.y + 2, 17, 12, d.rot, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(120,10,12,0.6)';
        for (let i = 0; i < 5; i++) { circle(ctx, d.x + rand(-20, 20), d.y + rand(-16, 16), rand(1.5, 4)); ctx.fill(); }
        break;
      case 'hole':
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; circle(ctx, d.x, d.y, 1.6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; circle(ctx, d.x, d.y, 3); ctx.fill();
        break;
      case 'casing':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = '#c9a227'; ctx.fillRect(-2, -0.8, 4, 1.6);
        ctx.restore();
        break;
    }
  },
};

// Tenue du groupe armé (mode siège) : ni casque ni gilet, des vêtements civils.
const STYLE_MILITANT = {
  body: '#4a3d33', shoulder: '#3f342c', vest: null, vestLight: null, pack: null,
  sleeve: '#4a3d33', gloves: '#2a2520', skin: '#c4906a', boots: '#22201d', head: 'mask', hair: '#1c1c20',
};
// Le chef (celui que l'on incarne) : même tête cagoulée que ses hommes, juste une veste plus sombre.
const STYLE_BOSS = {
  ...STYLE_MILITANT, body: '#3b3f46', shoulder: '#33373d', sleeve: '#3b3f46',
};

// Otage : chemise claire, sans équipement (civil : pas de brelage dessiné).
const STYLE_HOSTAGE = {
  body: '#8a97a8', shoulder: '#8a97a8', sleeve: '#8a97a8', vest: null, pack: null, civil: true,
  pants: '#3b4250', boots: '#17181b', skin: '#d9b48f', hair: '#3b2a1a', head: 'hair',
};

const STYLE_PLAYER = {
  body: '#2f3f52', shoulder: '#283649', vest: '#1e2a36', vestLight: '#33455a', pack: '#1a232d',
  sleeve: '#33455a', gloves: '#141618', skin: '#d3a684', boots: '#141618', helmet: '#3a4b5e',
};
