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
// Arme tenue : avancée devant la tête et un peu épaissie pour rester lisible vue de dessus.
const GUN_SHIFT = 2.5, GUN_THICK = 1.3;
// Distance du centre du personnage à la bouche du canon (utilisée aussi par le jeu pour les tirs).
const muzzleDist = gunLen => 13 + GUN_SHIFT + gunLen;

const Sprites = {
  // ---- Sols ----
  paintFloor(ctx, type, x, y) {
    if (type === 1) return this.paintWood(ctx, x, y);
    if (type === 2) return this.paintTiles(ctx, x, y);
    return this.paintConcrete(ctx, x, y);
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
  paintProp(ctx, type, cx, cy) {
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
        this.shadow(ctx, cx, cy, 15, 16);
        ctx.fillStyle = '#5a4634'; ctx.fillRect(cx - 15, cy - 16, 30, 32);
        ctx.fillStyle = '#d9d3c4'; ctx.fillRect(cx - 13, cy - 14, 26, 28);
        ctx.fillStyle = '#4f6a8c'; ctx.fillRect(cx - 13, cy - 2, 26, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(cx - 13, cy - 2, 26, 2);
        ctx.fillStyle = '#f1eee6'; ctx.fillRect(cx - 10, cy - 12, 20, 7);
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
        break;
      }
    }
    ctx.restore();
  },

  // ---- Armes (repère local : le personnage regarde vers +x, axe de l'arme à y = AXIS) ----
  gun(ctx, kind, gl) {
    const A = 1.5;          // axe de l'arme (épaulée à droite)
    const M = 13 + gl;      // bouche du canon : doit correspondre à Game.fireWeapon
    const OUT = 'rgba(0,0,0,0.65)';
    // pièce rectangulaire arrondie, centrée sur l'axe (dy = décalage latéral)
    const part = (x0, x1, h, fill, dy = 0, r = 0.8) => {
      roundRect(ctx, x0, A + dy - h / 2, x1 - x0, h, Math.min(r, h / 2));
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 0.6; ctx.strokeStyle = OUT; ctx.stroke();
    };
    // polygone en coordonnées relatives à l'axe
    const poly = (pts, fill) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, A + y) : ctx.moveTo(x, A + y)));
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 0.6; ctx.strokeStyle = OUT; ctx.stroke();
    };
    const shine = (x0, x1, dy, a = 0.16) => { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(x0, A + dy, x1 - x0, 0.5); };
    const dark = (x, dy, w, h, a = 0.45) => { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, A + dy, w, h); };
    const grain = (x0, x1, dys) => {
      ctx.strokeStyle = 'rgba(40,20,5,0.35)'; ctx.lineWidth = 0.35;
      for (const dy of dys) { ctx.beginPath(); ctx.moveTo(x0, A + dy); ctx.quadraticCurveTo((x0 + x1) / 2, A + dy + 0.35, x1, A + dy - 0.1); ctx.stroke(); }
    };

    switch (kind) {
      case 'pistol': {
        part(8.5, 12.5, 3, '#1f2226', 0.2, 1);                 // carcasse / poignée
        part(10, M, 3.4, '#474d56', 0, 0.7);                  // culasse
        for (let x = 10.6; x < 12.8; x += 0.7) dark(x, -1.5, 0.3, 3, 0.5); // stries arrière
        dark(14.2, 0.35, 3, 1.1, 0.6);                        // fenêtre d'éjection
        shine(10.5, M - 0.8, -1.3, 0.22);
        ctx.fillStyle = '#e8e8e8';                            // points de visée
        ctx.fillRect(10.4, A - 0.9, 0.5, 0.5); ctx.fillRect(10.4, A + 0.4, 0.5, 0.5); ctx.fillRect(M - 1.2, A - 0.25, 0.6, 0.5);
        ctx.fillStyle = '#0c0d0f'; ctx.fillRect(M - 0.5, A - 0.6, 0.5, 1.2); // bouche
        break;
      }

      case 'shotgun': {
        poly([[-6, -1.9], [-4.6, -2.1], [5.2, -1.4], [5.2, 1.4], [-4.6, 2.1], [-6, 1.9]], '#6e4527'); // crosse bois
        grain(-4.5, 5, [-0.9, 0.2, 1.1]);
        part(-6.4, -5.2, 4.4, '#1b1c1f', 0, 0.5);             // plaque de couche
        part(5, 13.5, 4.2, '#2d3137', 0, 0.9);                // boîtier
        dark(8, 0.6, 3.6, 1.2, 0.6);                          // fenêtre d'éjection
        shine(5.6, 13, -1.8);
        part(13, M, 1.9, '#1b1d21', -0.8, 0.6);               // canon
        part(13, M - 2.5, 1.6, '#23262b', 1.05, 0.6);         // tube magasin
        part(M - 2.8, M - 1.8, 1.8, '#15171a', 1.05, 0.3);    // bouchon de tube
        shine(13.5, M - 0.5, -1.6, 0.2);
        part(15, 23.5, 4.6, '#7a4d2b', 0.1, 1.2);             // pompe
        for (let x = 16; x < 23; x += 1.3) dark(x, -2.1, 0.45, 4.4, 0.35); // rainures
        ctx.fillStyle = '#d9b44a'; circle(ctx, M - 0.8, A - 0.8, 0.45); ctx.fill(); // guidon (bille)
        break;
      }

      case 'ak': {
        poly([[-6, -1.7], [-4.8, -2], [5.2, -1.3], [5.2, 1.3], [-4.8, 2], [-6, 1.7]], '#7b4a25'); // crosse bois
        grain(-4.6, 5, [-0.8, 0.3, 1.1]);
        part(-6.4, -5.3, 4.1, '#2a2a2c', 0, 0.4);             // plaque de couche
        // chargeur courbe (bakélite) qui dépasse sur le côté
        poly([[8.4, 2.1], [11.8, 2.1], [14.4, 7.6], [11.2, 8.2]], '#4a3322');
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.4;
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(8.4 + k * 0.8, A + 2.1 + k * 1.4); ctx.lineTo(11.8 + k * 0.7, A + 2.1 + k * 1.4); ctx.stroke(); }
        part(5, 14.5, 4.4, '#2b2e33', 0, 0.8);                // boîtier
        for (let x = 6.5; x < 13.5; x += 1.4) dark(x, -1.6, 0.35, 3.2, 0.3); // nervures du couvercle
        dark(10, 0.6, 3, 1.1, 0.6);                           // fenêtre d'éjection
        part(13.8, 14.8, 5, '#23252a', 0, 0.3);               // hausse
        shine(5.5, 14, -1.9);
        part(14.5, 21.5, 4.2, '#8a5329', 0, 1.3);             // garde-main inférieur bois
        grain(15, 21, [-1, 0.9]);
        part(14.5, 23, 1.9, '#6d4222', 0, 0.7);               // cache du tube à gaz
        part(21.5, M - 3, 1.6, '#1c1e22', 0, 0.5);            // canon
        part(23, 24.4, 2.8, '#1c1e22', 0, 0.3);               // bloc de gaz
        poly([[M - 5.2, -1.6], [M - 4.4, -1.6], [M - 4, 0], [M - 5.6, 0]], '#1c1e22'); // guidon
        part(M - 3, M, 2.2, '#16181b', 0, 0.3);               // frein de bouche
        dark(M - 2.2, -1.1, 0.4, 2.2, 0.6);
        break;
      }

      default: { // fusil d'assaut moderne
        part(-6.4, -5, 4.3, '#141518', 0, 0.6);               // talon caoutchouc
        poly([[-5, -2.1], [-1, -2.1], [3.5, -0.9], [3.5, 0.9], [-1, 2.1], [-5, 2.1]], '#383d45'); // crosse
        dark(-4.5, -0.3, 4.5, 0.6, 0.35);                     // appui-joue
        part(3, 6, 1.9, '#24272c', 0, 0.5);                   // tube de crosse
        part(5, 14.5, 4.4, '#4b515b', 0, 0.9);                // boîtier
        part(4.4, 5.6, 2.8, '#2a2d33', 0, 0.3);               // levier d'armement
        dark(8.2, 1.1, 3.4, 1, 0.65);                         // fenêtre d'éjection
        shine(5.5, 14, -1.9);
        // chargeur (dépasse sur le côté)
        poly([[9.2, 2.2], [11.8, 2.2], [12.6, 6.4], [9.8, 6.6]], '#3b4047');
        dark(9.6, 5.2, 2.6, 0.5, 0.35);
        part(14, 23.5, 3.9, '#424952', 0, 1);                 // garde-main
        for (let x = 15; x < 23; x += 1.6) { dark(x, -1.6, 0.8, 0.6, 0.5); dark(x, 1, 0.8, 0.6, 0.5); } // fentes
        shine(14.5, 23, -1.7, 0.18);
        // lampe tactique sur le flanc gauche
        part(18, 21.6, 1.7, '#1d1f23', -2.6, 0.6);
        ctx.fillStyle = '#fff3b0'; ctx.fillRect(21.2, A - 3.2, 0.5, 1.2);
        // viseur holographique sur l'axe
        part(7, 12, 3.2, '#1a1c20', 0, 0.6);
        ctx.fillStyle = '#4fa3e0'; ctx.fillRect(7.8, A - 1, 3.4, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(8.2, A - 0.8, 1.1, 0.5);
        ctx.fillStyle = '#ff4040'; ctx.fillRect(9.9, A - 0.15, 0.35, 0.3);
        part(22.2, 23, 1.6, '#16181b', 0, 0.2);               // guidon rabattable
        part(23.5, M - 3.2, 1.5, '#1a1d21', 0, 0.5);          // canon
        part(24.4, 25.8, 2.3, '#202328', 0, 0.3);             // bloc de gaz
        part(M - 3.4, M, 2.4, '#111316', 0, 0.5);             // cache-flamme
        dark(M - 2.6, -1, 0.35, 0.7, 0.8); dark(M - 1.4, -1, 0.35, 0.7, 0.8);
        dark(M - 2.6, 0.3, 0.35, 0.7, 0.8); dark(M - 1.4, 0.3, 0.35, 0.7, 0.8);
      }
    }
  },
  // Position des mains selon l'arme : [main avant (gauche), main arrière (droite)]
  hands(kind) {
    const S = GUN_SHIFT;
    if (kind === 'pistol') return [[13.5 + S, -1.2], [12.5 + S, 2.8]];
    if (kind === 'shotgun') return [[16.5 + S, -0.4], [8.5 + S, 3.8]];
    return [[17 + S, -0.6], [9 + S, 3.8]];
  },
  // Arme lâchée au sol (repère local, centrée)
  droppedGun(ctx, kind, gl) {
    ctx.save(); ctx.translate(-(13 + gl) / 2 + 4, -1.5);
    this.gun(ctx, kind, gl);
    ctx.restore();
  },

  // ---- Personnages ----
  // Dessin générique d'un personnage à partir d'une pose (voir POSE_STAND / POSE_LIE).
  // st : { body, shoulder, vest, vestLight, pack, sleeve, gloves, skin, boots, helmet | hair/head, band, gun, gunLen }
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
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(V.x - 1.5, V.y - 0.5); ctx.lineTo(V.x + V.w, V.y + V.h - 0.5); ctx.moveTo(V.x - 1.5, V.y + V.h); ctx.lineTo(V.x + V.w, V.y + 0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(V.x + V.w - 2.5, V.y + 2.5, 3, 3); ctx.fillRect(V.x + V.w - 2.5, V.y + V.h - 5.5, 3, 3);
    }
    if (pose.side > 0.5) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(T.x - 2, T.y, T.rx * 0.78, T.ry * 0.7, 0, 0, TAU); ctx.fill(); }
    // bras
    for (const arm of pose.arms) limb(arm, 5.5, st.sleeve);
    // arme tenue
    if (held) {
      ctx.save();
      ctx.translate(GUN_SHIFT, 1.5); ctx.scale(1, GUN_THICK); ctx.translate(0, -1.5);
      this.gun(ctx, st.gun, st.gunLen || 18);
      ctx.restore();
    }
    // mains
    for (const arm of pose.arms) dot(arm[2][0], arm[2][1], 3.1, skin);
    // tête
    ctx.save(); ctx.translate(pose.head.x - 1, pose.head.y); const hs = pose.head.r / 6.9; ctx.scale(hs, hs);
    if (pose.side < 0.5) { if (st.helmet) this.helmet(ctx, st); else this.head(ctx, st); }
    else this.headSide(ctx, st);
    ctx.restore();
    ctx.restore();
  },

  character(ctx, x, y, angle, st, muzzle, walk, moving) {
    const pose = { ...POSE_STAND, arms: [[[-2, -9.5], [7, -6.5], this.hands(st.gun)[0]], [[-2, 9.5], [4.5, 7], this.hands(st.gun)[1]]] };
    this.figure(ctx, x, y, angle, st, pose, true, walk, moving);
    if (muzzle > 0) this.muzzleFlash(ctx, x, y, angle, muzzleDist(st.gunLen || 18), muzzle);
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

  muzzleFlash(ctx, x, y, angle, ml, t) {
    const mx = x + Math.cos(angle) * ml, my = y + Math.sin(angle) * ml;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(angle);
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
    if (st.gun) {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(rot); ctx.translate(DROPPED_GUN.x, DROPPED_GUN.y); ctx.rotate(DROPPED_GUN.rot);
      this.droppedGun(ctx, st.gun, st.gunLen || 18);
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
    if (!held && st.gun) {
      // l'arme part de la main et retombe à côté du corps
      const g = smoothstep(clamp((k - 0.12) / 0.5, 0, 1));
      const h = this.hands(st.gun)[0];
      const sx = a.x + Math.cos(a.angle) * h[0] - Math.sin(a.angle) * h[1], sy = a.y + Math.sin(a.angle) * h[0] + Math.cos(a.angle) * h[1];
      const ex = a.x + Math.cos(bodyAngle) * DROPPED_GUN.x - Math.sin(bodyAngle) * DROPPED_GUN.y, ey = a.y + Math.sin(bodyAngle) * DROPPED_GUN.x + Math.cos(bodyAngle) * DROPPED_GUN.y;
      const gx = lerp(sx, ex, g), gy = lerp(sy, ey, g) - Math.sin(g * Math.PI) * 10;
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(lerp(a.angle, bodyAngle + DROPPED_GUN.rot, g) + (1 - g) * d.spin * 3);
      this.droppedGun(ctx, st.gun, st.gunLen || 18);
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
    ctx.restore();
  },

  // ---- Décalques persistants ----
  decal(ctx, d) {
    switch (d.type) {
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

const STYLE_PLAYER = {
  body: '#2f3f52', shoulder: '#283649', vest: '#1e2a36', vestLight: '#33455a', pack: '#1a232d',
  sleeve: '#33455a', gloves: '#141618', skin: '#d3a684', boots: '#141618', helmet: '#3a4b5e',
};
