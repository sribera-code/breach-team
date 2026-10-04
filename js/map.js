'use strict';
// Carte en grille fine + raycast + ligne de vue + A*.
//
// Les niveaux sont décrits en ASCII (une case ASCII = U = 32 px). Ils sont convertis en grille fine
// (une case = TILE = 16 px) : chaque case ASCII (x,y) correspond à la petite case (2x,2y), et les petites
// cases intermédiaires relient les murs voisins. Les murs n'ont donc plus qu'une petite case d'épaisseur,
// les portes font trois petites cases de large.
// béton, parquet, carrelage, moquette, dallage de marbre, tôle striée
const FLOOR = { '.': 0, ',': 1, ':': 2, ';': 3, '=': 4, '%': 5 };
const WINDOW_LEN = 3; // largeur d'une fenêtre, en petites cases
const PROPS = {
  c: 'crate', B: 'barrel', T: 'table', p: 'plant', b: 'bed', k: 'desk',
  s: 'sofa', r: 'shelf', a: 'locker', R: 'server', P: 'pallet', C: 'counter',
};
// Meubles qui se posent dos au mur (et se prolongent d'une case à l'autre quand on les aligne).
const PROP_AGAINST_WALL = new Set(['bed', 'sofa', 'shelf', 'locker', 'server', 'counter']);
const DOOR_LEN = 3; // largeur d'une porte, en petites cases
// Crans d'ouverture : fermée, entrebâillée (un filet de vue), entrouverte (on voit une part de la pièce), ouverte.
const DOOR_PASS = 0.6; // à partir de ce cran (« entrouverte »), on se glisse dans l'embrasure
const DOOR_STEPS = [0, 0.3, 0.6, 1];

// Tas binaire minimal pour l'A*.
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

class GameMap {
  constructor(def) {
    const rows = def.map;
    const AH = rows.length;
    const AW = Math.max(...rows.map(r => r.length));
    const ch = (x, y) => (rows[y] && rows[y][x]) || ' ';
    const wallish = c => c === '#' || c === 'D' || c === 'X' || c === 'W';

    this.w = AW * 2 - 1;
    this.h = AH * 2 - 1;
    const N = this.w * this.h;
    this.tiles = new Uint8Array(N);     // 0 sol, 1 mur, 2 vide
    this.floorType = new Uint8Array(N); // 0 béton, 1 parquet, 2 carrelage
    this.explored = new Uint8Array(N);
    this.nearWall = new Uint8Array(N);
    this.newlyExplored = []; // cases découvertes depuis le dernier rendu du brouillard
    this.doors = [];
    this.doorAt = new Map();
    this.windows = [];
    this.windowAt = new Map();
    this.breaches = []; // points d'entrée depuis l'extérieur (portes extérieures et fenêtres)
    this.props = [];
    this.propAt = new Map();
    this.spawns = [];
    this.enemySpawns = [];
    this.hostageSpawns = [];

    // Type de sol des cases ASCII : caractère du sol, sinon majorité des voisins.
    const aFloor = new Uint8Array(AW * AH);
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      const c = ch(x, y);
      if (c in FLOOR) { aFloor[y * AW + x] = FLOOR[c]; continue; }
      const votes = Object.values(FLOOR).map(() => 0);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const n = ch(x + dx, y + dy);
        if (n in FLOOR) votes[FLOOR[n]]++;
      }
      aFloor[y * AW + x] = votes.indexOf(Math.max(...votes));
    }

    // Conversion en grille fine.
    for (let sy = 0; sy < this.h; sy++) for (let sx = 0; sx < this.w; sx++) {
      // cases ASCII qui contribuent à cette petite case
      const xs = sx % 2 ? [(sx - 1) / 2, (sx + 1) / 2] : [sx / 2];
      const ys = sy % 2 ? [(sy - 1) / 2, (sy + 1) / 2] : [sy / 2];
      const contrib = [];
      for (const ay of ys) for (const ax of xs) contrib.push({ x: ax, y: ay, c: ch(ax, ay) });
      let t;
      if (contrib.every(k => wallish(k.c))) t = 1;
      else if (contrib.some(k => k.c === ' ')) t = 2;
      else t = 0;
      const i = sy * this.w + sx;
      this.tiles[i] = t;
      const fl = contrib.find(k => !wallish(k.c) && k.c !== ' ');
      this.floorType[i] = fl ? aFloor[fl.y * AW + fl.x] : 0;
    }

    const facing = { '^': -Math.PI / 2, 'v': Math.PI / 2, '<': Math.PI, '>': 0 };
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      const c = ch(x, y);
      const sx = 2 * x, sy = 2 * y;
      switch (c) {
        case 'X':
        case 'D': {
          const horizontal = wallish(ch(x - 1, y)) && wallish(ch(x + 1, y));
          const d = {
            x: sx, y: sy, cx: (sx + 0.5) * TILE, cy: (sy + 0.5) * TILE, len: DOOR_LEN, horizontal,
            open: false, ajar: false, opening: false, progress: 0, target: 0, duration: 0.4, cells: [],
          };
          const half = (DOOR_LEN - 1) / 2;
          for (let k = -half; k <= half; k++) {
            const cx = horizontal ? sx + k : sx, cy = horizontal ? sy : sy + k;
            if (!this.inBounds(cx, cy)) continue;
            const idx = cy * this.w + cx;
            this.tiles[idx] = 0;
            this.floorType[idx] = this.floorType[(horizontal ? sy + 1 : sy) * this.w + (horizontal ? sx : sx + 1)] || 0;
            this.doorAt.set(idx, d);
            d.cells.push({ x: cx, y: cy });
          }
          this.doors.push(d);
          if (c === 'X') this.addBreach('door', sx, sy, horizontal, d);
          break;
        }

        case 'W': {
          // Fenêtre : on voit et on tire au travers, on ne la franchit pas à pied.
          const horizontal = wallish(ch(x - 1, y)) && wallish(ch(x + 1, y));
          const win = { x: sx, y: sy, cx: (sx + 0.5) * TILE, cy: (sy + 0.5) * TILE, len: WINDOW_LEN, horizontal, cells: [] };
          const halfW = (WINDOW_LEN - 1) / 2;
          for (let k = -halfW; k <= halfW; k++) {
            const wx = horizontal ? sx + k : sx, wy = horizontal ? sy : sy + k;
            if (!this.inBounds(wx, wy)) continue;
            const idx = wy * this.w + wx;
            this.tiles[idx] = 0; // le regard et les balles passent...
            this.windowAt.set(idx, win); // ...mais pas les pieds (voir blocksMove)
            win.cells.push({ x: wx, y: wy });
          }
          this.windows.push(win);
          this.addBreach('window', sx, sy, horizontal, null);
          break;
        }
        case 'S': this.spawns.push({ x: sx, y: sy }); break;
        case 'E': this.enemySpawns.push({ x: sx, y: sy, angle: null }); break;
        case 'H': this.hostageSpawns.push({ x: sx, y: sy }); break;
        default:
          if (c in facing) this.enemySpawns.push({ x: sx, y: sy, angle: facing[c] });
          else if (c in PROPS) {
            // un meuble occupe un bloc 2×2 de petites cases
            const p = { x: sx, y: sy, cx: (sx + 1) * TILE, cy: (sy + 1) * TILE, type: PROPS[c], rot: 0, link: { l: false, r: false } };
            if (PROP_AGAINST_WALL.has(p.type)) this.fitProp(p, ch, x, y, wallish);
            this.props.push(p);
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              const px = sx + dx, py = sy + dy;
              if (this.inBounds(px, py) && this.tiles[py * this.w + px] === 0) this.propAt.set(py * this.w + px, p);
            }
          }
      }
    }

    // Cases collées à un obstacle : pénalisées par l'A* pour garder les trajets centrés.
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.blocksMove(x, y)) continue;
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.blocksMove(x + dx, y + dy)) { near = 1; break; }
      }
      this.nearWall[y * this.w + x] = near;
    }
  }

  // Orientation d'un meuble : dos au mur voisin (rot 0 : dos en haut, face vers le bas), sinon dans
  // l'axe de la rangée qu'il forme avec ses semblables. link.l / link.r : même meuble à sa gauche /
  // à sa droite (vu de face), pour dessiner un canapé ou un comptoir de plusieurs cases d'un tenant.
  fitProp(p, ch, x, y, wallish) {
    const c = ch(x, y);
    const rowH = ch(x - 1, y) === c || ch(x + 1, y) === c, rowV = ch(x, y - 1) === c || ch(x, y + 1) === c;
    const backs = [[0, -1, 0], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2], [0, 1, Math.PI]]
      .filter(([dx, dy]) => wallish(ch(x + dx, y + dy)));
    // une rangée ne s'adosse qu'au mur qui la longe (le bout d'une rangée peut toucher un autre mur)
    const wall = backs.find(([dx, dy]) => (rowH && dy) || (rowV && dx)) || (rowH || rowV ? null : backs[0]);
    if (wall) p.rot = wall[2];
    else if (rowV && !rowH) p.rot = Math.PI / 2; // rangée verticale au milieu d'une pièce
    const rx = Math.round(Math.cos(p.rot)), ry = Math.round(Math.sin(p.rot));
    p.link = { l: ch(x - rx, y - ry) === c, r: ch(x + rx, y + ry) === c };
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tile(x, y) { return this.inBounds(x, y) ? this.tiles[y * this.w + x] : 2; }
  floor(x, y) { return this.inBounds(x, y) ? this.floorType[y * this.w + x] : 0; }
  isWall(x, y) { return this.tile(x, y) !== 0; }
  // Une porte laisse passer dès qu'elle est entrouverte : on se glisse dans l'embrasure.
  doorPassable(d) { return d.open || d.progress >= DOOR_PASS - 1e-6; }
  door(x, y) { return this.inBounds(x, y) ? this.doorAt.get(y * this.w + x) : undefined; }
  prop(x, y) { return this.propAt.get(y * this.w + x); }
  blocksSight(x, y) {
    if (this.isWall(x, y)) return true;
    const d = this.door(x, y);
    // Une porte même à peine entrouverte ne bloque plus l'embrasure : c'est le battant lui-même
    // (leafSeg / leafBlock) qui arrête le regard, sauf par l'entrebâillement.
    return d ? !(d.open || d.ajar) : false;
  }

  // Battant d'une porte : segment partant du gond, le long de l'embrasure quand elle est fermée,
  // perpendiculaire quand elle est grande ouverte.
  leafSeg(d) {
    const L = d.len * TILE, a = d.progress;
    const hx = d.horizontal ? d.cx - L / 2 : d.cx, hy = d.horizontal ? d.cy : d.cy - L / 2;
    const ang = d.horizontal ? -a * Math.PI / 2 : Math.PI / 2 + a * Math.PI / 2;
    return { x0: hx, y0: hy, x1: hx + Math.cos(ang) * L, y1: hy + Math.sin(ang) * L };
  }

  // Distance à laquelle un battant coupe le rayon (maxT si aucun). Les portes fermées sont déjà
  // traitées par les cases ; ici on ne regarde que celles qui ont commencé à s'ouvrir.
  leafBlock(x, y, dx, dy, maxT) {
    let best = maxT, hit = null;
    for (const d of this.doors) {
      if (d.progress <= 0) continue;
      const rx = d.cx - x, ry = d.cy - y, reach = best + d.len * TILE;
      if (rx * rx + ry * ry > reach * reach) continue;
      const s = this.leafSeg(d);
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const px = s.x0 - x, py = s.y0 - y;
      const t = (px * ey - py * ex) / den;   // distance le long du rayon
      const u = (px * dy - py * dx) / den;   // position sur le battant (0 au gond, 1 au bord libre)
      if (t > 0.01 && t < best && u >= 0 && u <= 1) { best = t; hit = d; }
    }
    return { t: best, door: hit };
  }
  window(x, y) { return this.inBounds(x, y) ? this.windowAt.get(y * this.w + x) : undefined; }
  blocksMove(x, y) { return this.isWall(x, y) || this.propAt.has(y * this.w + x) || this.windowAt.has(y * this.w + x); }

  // Point d'entrée depuis l'extérieur : on mémorise le côté intérieur, seul côté praticable.
  addBreach(kind, sx, sy, horizontal, door) {
    const inside = [[0, 2], [0, -2], [2, 0], [-2, 0]]
      .map(([dx, dy]) => ({ x: sx + dx, y: sy + dy }))
      .find(t => this.inBounds(t.x, t.y) && this.tiles[t.y * this.w + t.x] === 0 && !this.blocksMove(t.x, t.y));
    if (!inside) return;
    this.breaches.push({
      kind, door, horizontal,
      x: sx, y: sy, cx: (sx + 0.5) * TILE, cy: (sy + 0.5) * TILE,
      inside: { x: (inside.x + 0.5) * TILE, y: (inside.y + 0.5) * TILE },
      angle: Math.atan2(inside.y - sy, inside.x - sx),
    });
  }

  // Nom lisible d'un point d'entrée : « Fenêtre nord », « Porte est »... Le côté est celui de la façade
  // percée ; deux ouvertures de même nature sur la même façade se distinguent par leur position.
  breachLabel(b) {
    const side = o => {
      const ix = Math.round(Math.cos(o.angle)), iy = Math.round(Math.sin(o.angle)); // vers l'intérieur
      return iy > 0 ? 'nord' : iy < 0 ? 'sud' : ix > 0 ? 'ouest' : 'est';
    };
    const s = side(b);
    let label = (b.kind === 'window' ? 'Fenêtre ' : 'Porte ') + s;
    if (this.breaches.some(o => o !== b && o.kind === b.kind && side(o) === s)) {
      const ns = s === 'nord' || s === 'sud';
      const t = ns ? b.cx / (this.w * TILE) : b.cy / (this.h * TILE);
      label += t < 0.4 ? (ns ? ' (ouest)' : ' (nord)') : t > 0.6 ? (ns ? ' (est)' : ' (sud)') : ' (centre)';
    }
    return label;
  }

  // Pièce contenant le point (x,y) en pixels : cases fines reliées sans franchir mur, porte ni fenêtre.
  // Les meubles n'y font pas obstacle (ils sont dans la pièce).
  roomOf(x, y) {
    const room = new Set();
    const start = Math.floor(y / TILE) * this.w + Math.floor(x / TILE);
    const open = i => this.tiles[i] === 0 && !this.doorAt.has(i) && !this.windowAt.has(i);
    if (!open(start)) return room;
    const stack = [start];
    room.add(start);
    while (stack.length) {
      const i = stack.pop(), tx = i % this.w, ty = (i - tx) / this.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy, n = ny * this.w + nx;
        if (this.inBounds(nx, ny) && !room.has(n) && open(n)) { room.add(n); stack.push(n); }
      }
    }
    return room;
  }
  markExplored(x, y) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (!this.explored[i]) { this.explored[i] = 1; this.newlyExplored.push(i); }
  }
  isExplored(x, y) { return this.inBounds(x, y) && this.explored[y * this.w + x] === 1; }

  // Un cercle de rayon r centré en (cx,cy) ne touche aucun obstacle (test par AABB, conservateur).
  // solidDoors : les portes fermées bloquent aussi (déplacement du joueur).
  circleFree(cx, cy, r, solidDoors) {
    const x0 = Math.floor((cx - r) / TILE), x1 = Math.floor((cx + r) / TILE);
    const y0 = Math.floor((cy - r) / TILE), y1 = Math.floor((cy + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (this.blocksMove(x, y)) return false;
      if (solidDoors) { const d = this.door(x, y); if (d && !this.doorPassable(d)) return false; }
    }
    return true;
  }

  // Lance un rayon (DDA) et s'arrête au premier obstacle visuel ou à maxDist.
  castRay(x, y, angle, maxDist, mark) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const lb = this.leafBlock(x, y, dx, dy, maxDist); // arrêté par un battant ?
    const lim = lb.t, leafHit = lim < maxDist;
    let door = null;
    let tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? (tx + 1) * TILE - x : x - tx * TILE) / Math.abs(dx) : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (ty + 1) * TILE - y : y - ty * TILE) / Math.abs(dy) : Infinity;
    let t = 0, hit = false;
    if (mark) this.markExplored(tx, ty);
    for (let i = 0; i < 800; i++) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
      else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
      if (t >= lim) { t = lim; hit = leafHit; door = leafHit ? lb.door : null; break; }
      if (mark) this.markExplored(tx, ty);
      if (this.blocksSight(tx, ty)) { hit = true; door = this.door(tx, ty) || null; break; }
    }
    // door : l'obstacle touché est une porte (battant ou embrasure), donc perforable
    return { x: x + dx * t, y: y + dy * t, dist: t, hit, tx, ty, door };
  }

  hasLOS(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    if (d < 1) return true;
    const r = this.castRay(x0, y0, Math.atan2(y1 - y0, x1 - x0), d, false);
    return r.dist >= d - 0.01;
  }

  // A* sur la grille (8 directions, pas de coupe de coin, portes traversées en ligne droite).
  // opts.noClosedDoors : les portes non ouvertes sont infranchissables (coéquipiers en suivi).
  // opts.passableDoors : seules les portes où l'on se glisse (doorPassable) sont franchissables (otages).
  // opts.avoid : [{x, y, r}] zones à contourner (alliés), fortement pénalisées.
  findPath(sx, sy, tx, ty, opts) {
    const noClosed = !!(opts && opts.noClosedDoors);
    const passOnly = !!(opts && opts.passableDoors);
    const avoid = (opts && opts.avoid) || [];
    if (!this.inBounds(tx, ty) || this.blocksMove(tx, ty)) return null;
    if (!this.inBounds(sx, sy)) return null;
    const w = this.w, N = w * this.h;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heur = (x, y) => { const ax = Math.abs(x - tx), ay = Math.abs(y - ty); return Math.max(ax, ay) + 0.414 * Math.min(ax, ay); };
    const open = new MinHeap();
    const start = sy * w + sx, goal = ty * w + tx;
    g[start] = 0;
    open.push(heur(sx, sy), start);
    while (open.size) {
      const ck = open.pop();
      if (closed[ck]) continue;
      closed[ck] = 1;
      if (ck === goal) {
        const out = [];
        let k = ck;
        while (k !== -1) { out.push({ x: k % w, y: (k / w) | 0 }); k = came[k]; }
        return out.reverse();
      }
      const cx = ck % w, cy = (ck / w) | 0;
      const curDoor = this.doorAt.has(ck);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny) || this.blocksMove(nx, ny)) continue;
        const nk = ny * w + nx;
        if (closed[nk]) continue;
        const diag = dx !== 0 && dy !== 0;
        const dObj = this.doorAt.get(nk);
        if (noClosed && dObj && !dObj.open) continue;
        if (passOnly && dObj && !this.doorPassable(dObj)) continue;
        if (diag) {
          if (this.blocksMove(cx + dx, cy) || this.blocksMove(cx, cy + dy)) continue;
          if (curDoor || dObj) continue;
        }
        let cost = (diag ? 1.414 : 1) + (dObj ? 1 : 0) + (this.nearWall[nk] ? 2.5 : 0);
        if (avoid.length && nk !== goal) {
          const wx = (nx + 0.5) * TILE, wy = (ny + 0.5) * TILE;
          for (const a of avoid) if (Math.abs(wx - a.x) < a.r && Math.abs(wy - a.y) < a.r && Math.hypot(wx - a.x, wy - a.y) < a.r) { cost += 40; break; }
        }
        const ng = g[ck] + cost;
        if (ng < g[nk]) { g[nk] = ng; came[nk] = ck; open.push(ng + heur(nx, ny), nk); }
      }
    }
    return null;
  }

  segmentFree(ax, ay, bx, by, r) {
    const allowed = new Set([
      Math.floor(ay / TILE) * this.w + Math.floor(ax / TILE),
      Math.floor(by / TILE) * this.w + Math.floor(bx / TILE),
    ]);
    const d = dist(ax, ay, bx, by);
    const steps = Math.max(1, Math.ceil(d / 4));
    for (let i = 0; i <= steps; i++) {
      const x = lerp(ax, bx, i / steps), y = lerp(ay, by, i / steps);
      if (!this.circleFree(x, y, r, false)) return false;
      const k = Math.floor(y / TILE) * this.w + Math.floor(x / TILE);
      if (this.doorAt.has(k) && !allowed.has(k)) return false;
    }
    return true;
  }

  // Lissage glouton vers l'avant (coût linéaire) : on prolonge tant que le segment reste libre.
  smoothPath(pts, r) {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && j + 1 - i <= 48 && this.segmentFree(pts[i].x, pts[i].y, pts[j + 1].x, pts[j + 1].y, r)) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // Chemin monde depuis (sx,sy) vers la case (tx,ty). Retourne les waypoints sans le point de départ.
  routeTo(sx, sy, tx, ty, r, opts) {
    const tiles = this.findPath(Math.floor(sx / TILE), Math.floor(sy / TILE), tx, ty, opts);
    if (!tiles) return null;
    const pts = tiles.map(t => {
      const p = { x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE };
      // on passe les portes par leur milieu
      const d = this.door(t.x, t.y);
      if (d) { if (d.horizontal) p.x = d.cx; else p.y = d.cy; }
      return p;
    });
    pts[0] = { x: sx, y: sy };
    const sm = this.smoothPath(pts, r);
    sm.shift();
    return sm;
  }
}
