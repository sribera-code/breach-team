'use strict';
const gunStyle = w => ({ gun: w.kind, gunLen: w.gunLen, gunTint: w.tint });
// Geste en cours (porte, grenade) transmis au dessin du personnage.
const actStyle = a => (a.act ? { act: { type: a.act.type, k: a.act.t / a.act.dur } }
  : a.fiber ? { act: { type: 'fiber', k: 1 } } : null);
// Rendu canvas : calque statique (sols, murs, mobilier), décalques, entités, brouillard, HUD canvas.
class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.staticC = document.createElement('canvas');
    this.decalC = document.createElement('canvas');
    this.fogC = document.createElement('canvas');
    this.exploredC = document.createElement('canvas');
    this.dpr = 1;
    this.zoom = 2;
    this.cam = { x: 0, y: 0 };
    this.tx = 0; this.ty = 0;
    this.mouse = { sx: 0, sy: 0 };
    game.on('level', () => this.buildStatic());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    this.zoom = 1.9 * this.dpr * clamp(r.width / 1280, 0.75, 1.3);
  }

  buildStatic() {
    const m = this.game.map;
    const W = m.w * TILE, H = m.h * TILE;
    for (const c of [this.staticC, this.decalC, this.fogC, this.exploredC]) { c.width = W; c.height = H; }
    this.exploredC.getContext('2d').clearRect(0, 0, W, H);
    m.newlyExplored = [];
    for (let i = 0; i < m.explored.length; i++) if (m.explored[i]) m.newlyExplored.push(i);
    const ctx = this.staticC.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tile(x, y) === 0) Sprites.paintFloor(ctx, m.floor(x, y), x * TILE, y * TILE);
    Sprites.paintConcreteStains(ctx, m);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tile(x, y) === 0) Sprites.paintShadows(ctx, m, x, y);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tile(x, y) === 1) Sprites.paintWall(ctx, m, x, y);
    for (const d of m.doors) Sprites.paintDoorFrame(ctx, d);
    for (const p of m.props) Sprites.paintProp(ctx, p.type, p.cx, p.cy);
    this.decalC.getContext('2d').clearRect(0, 0, W, H);
    this.cam.x = this.game.player.x; this.cam.y = this.game.player.y;
    this.tx = this.canvas.width / 2 - this.cam.x * this.zoom;
    this.ty = this.canvas.height / 2 - this.cam.y * this.zoom;
  }

  toWorld(sx, sy) {
    const px = sx * this.dpr, py = sy * this.dpr;
    return { x: (px - this.tx) / this.zoom, y: (py - this.ty) / this.zoom };
  }

  updateCamera(dt) {
    const g = this.game, p = g.player;
    if (!isFinite(this.cam.x) || !isFinite(this.cam.y)) { this.cam.x = p.x; this.cam.y = p.y; }
    const m = this.toWorld(this.mouse.sx, this.mouse.sy);
    const lx = p.x + clamp((m.x - p.x) * 0.25, -90, 90), ly = p.y + clamp((m.y - p.y) * 0.25, -70, 70);
    const k = 1 - Math.pow(0.001, dt);
    this.cam.x = lerp(this.cam.x, lx, k); this.cam.y = lerp(this.cam.y, ly, k);
    const sh = g.camShake;
    const ox = (sh ? rand(-sh, sh) * this.dpr : 0) + g.camKick.x * this.zoom;
    const oy = (sh ? rand(-sh, sh) * this.dpr : 0) + g.camKick.y * this.zoom;
    this.tx = this.canvas.width / 2 - this.cam.x * this.zoom + ox;
    this.ty = this.canvas.height / 2 - this.cam.y * this.zoom + oy;
  }

  draw(dt) {
    const g = this.game, ctx = this.ctx, m = g.map;
    this.updateCamera(dt);
    // décalques en attente
    if (g.decals.length) { const dc = this.decalC.getContext('2d'); for (const d of g.decals) Sprites.decal(dc, d); g.decals = []; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07090b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.tx, this.ty);
    ctx.imageSmoothingEnabled = true;

    ctx.drawImage(this.staticC, 0, 0);
    ctx.drawImage(this.decalC, 0, 0);
    this.drawCasings();
    this.drawBodies();
    this.drawDoors();
    for (const h of g.hostages) if (h.alive && (h.visible || m.isExplored(h.tx, h.ty))) Sprites.hostage(ctx, h);
    for (const e of g.enemies) {
      if (!e.visible) continue;
      if (e.dying) Sprites.dying(ctx, e, this.enemyStyle(e), e.dying);
      else if (e.alive) this.drawEnemy(e);
    }
    this.drawGrenades();
    this.drawBullets();
    for (const a of [...g.ops, ...g.enemies]) a.walk = (a.walk || 0) + (a.alive && a.moving ? dt * (a.walkMode ? 8 : 13) : 0);
    if (g.orderMarker) this.drawOrderMarker(g.orderMarker);
    if (g.orderDrag) this.drawOrderDrag(g.orderDrag);
    for (const mt of g.mates) {
      const st = { ...mt.style, ...gunStyle(mt.weapon), ...actStyle(mt) };
      if (mt.dying) Sprites.dying(ctx, mt, st, mt.dying);
      else if (mt.alive) {
        const k = this.kickOffset(mt);
        Sprites.character(ctx, mt.x + k.x, mt.y + k.y, mt.angle, st, mt.muzzleT, mt.walk, mt.moving);
        ctx.fillStyle = mt.accent; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(mt.name.toUpperCase(), mt.x, mt.y - 17);
        // rappel discret de la direction imposée, tant qu'il n'a pas de contact
        if (mt.coverAngle !== null && !mt.target) {
          const cs = Math.cos(mt.coverAngle), sn = Math.sin(mt.coverAngle);
          ctx.save();
          ctx.globalAlpha = 0.3; ctx.strokeStyle = mt.accent; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(mt.x + cs * 15, mt.y + sn * 15); ctx.lineTo(mt.x + cs * 1.7 * U, mt.y + sn * 1.7 * U); ctx.stroke();
          ctx.restore();
        }
        if (mt.stun > 0) { ctx.strokeStyle = 'rgba(255,240,120,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mt.x, mt.y, 15, 0, TAU); ctx.stroke(); }
      }
    }
    const pst = { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon), ...actStyle(g.player) };
    const p = g.player;
    if (p.dying) Sprites.dying(ctx, p, pst, p.dying);
    else if (p.alive) {
      const k = this.kickOffset(p);
      Sprites.character(ctx, p.x + k.x, p.y + k.y, p.angle, pst, p.muzzleT, p.walk, p.moving);
    }
    if (p.fiber) this.drawFiber(p, p.fiber);
    this.drawEffects();
    this.drawFog();
    this.drawFlashes();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawVignette();
    this.drawBlind();
    this.drawCrosshair();
    for (const a of [...g.ops, ...g.enemies]) if (a.muzzleT > 0) a.muzzleT -= dt;
  }

  drawDoors() {
    const ctx = this.ctx;
    for (const d of this.game.map.doors) {
      const L = d.len * TILE;
      const a = d.open ? 1 : d.progress;
      ctx.save();
      // charnière à une extrémité, battant le long de l'ouverture puis pivotant à 90°
      if (d.horizontal) { ctx.translate(d.cx - L / 2, d.cy); ctx.rotate(-a * Math.PI / 2); }
      else { ctx.translate(d.cx, d.cy - L / 2); ctx.rotate(Math.PI / 2 + a * Math.PI / 2); }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(2, 0, L - 1, 5);
      ctx.fillStyle = '#9a6a3c';
      ctx.strokeStyle = '#3b2a18'; ctx.lineWidth = 1;
      ctx.fillRect(0, -2.5, L - 1, 5); ctx.strokeRect(0, -2.5, L - 1, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(2, -1.8, L - 5, 1.5);
      ctx.fillStyle = '#d8c06a'; ctx.fillRect(L - 8, -1, 3, 2);
      ctx.fillStyle = '#2a2016'; ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();
    }
  }

  drawBodies() {
    const g = this.game, m = g.map;
    for (const e of g.enemies) if (!e.alive && !e.dying && m.isExplored(e.tx, e.ty)) Sprites.body(this.ctx, e, this.enemyStyle(e));
    if (!g.player.alive && !g.player.dying) Sprites.body(this.ctx, g.player, { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon) });
    for (const mt of g.mates) if (!mt.alive && !mt.dying) Sprites.body(this.ctx, mt, { ...mt.style, ...gunStyle(mt.weapon) });
    for (const h of g.hostages) if (!h.alive) Sprites.body(this.ctx, h, { body: '#8a97a8', sleeve: '#8a97a8', hair: '#3b2a1a', pants: '#3b4250', skin: '#d9b48f' });
  }

  enemyStyle(e) {
    if (e.style) return { ...e.style, ...gunStyle(e.weapon), ...actStyle(e) }; // opérateurs du mode siège
    const l = e.look;
    return { body: l.jacket, shoulder: l.jacket, vest: null, pack: null, sleeve: l.jacket, skin: l.skin, hair: l.head === 'mask' ? '#1c1c20' : l.hair, head: l.head, pants: l.pants, band: l.head === 'hair' ? '#b33a2b' : null, ...gunStyle(e.weapon), ...actStyle(e) };
  }

  // Fibre optique : le câble passe sous le battant, l'objectif est de l'autre côté.
  drawFiber(p, f) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,255,0.75)'; ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(f.x, f.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(160,220,255,0.95)';
    ctx.beginPath(); ctx.arc(f.x, f.y, 2.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.5)';
    ctx.beginPath(); ctx.arc(f.x, f.y, 4 + Math.sin(this.game.time * 6) * 0.8, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  drawOrderMarker(o) {
    const ctx = this.ctx, t = this.game.time;
    const col = o.mate && o.mate.alive ? o.mate.accent : '#7fd18a';
    ctx.strokeStyle = col; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(o.x, o.y, 9 + Math.sin(t * 6) * 1.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(o.x, o.y - 4); ctx.lineTo(o.x + 4, o.y); ctx.lineTo(o.x, o.y + 4); ctx.lineTo(o.x - 4, o.y); ctx.closePath(); ctx.fill();
    if (o.angle !== null && o.angle !== undefined) this.drawCoverArrow(o.x, o.y, o.angle, col, 0.85);
    ctx.globalAlpha = 1;
  }

  // Direction à couvrir : cône léger et flèche partant du point d'arrivée.
  drawCoverArrow(x, y, angle, col, alpha) {
    const ctx = this.ctx, L = 1.9 * U, cs = Math.cos(angle), sn = Math.sin(angle);
    ctx.save();
    ctx.globalAlpha = alpha * 0.18;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, L, angle - 22 * DEG, angle + 22 * DEG); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + cs * 10, y + sn * 10); ctx.lineTo(x + cs * L, y + sn * L); ctx.stroke();
    const hx = x + cs * L, hy = y + sn * L;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - Math.cos(angle - 0.4) * 7, hy - Math.sin(angle - 0.4) * 7);
    ctx.lineTo(hx - Math.cos(angle + 0.4) * 7, hy - Math.sin(angle + 0.4) * 7);
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  }

  // Ordre en cours de tracé : clic droit maintenu, la souris fixe la direction à couvrir.
  drawOrderDrag(o) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#7fd18a'; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(o.x, o.y, 9, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    if (o.angle !== null) this.drawCoverArrow(o.x, o.y, o.angle, '#7fd18a', 0.9);
  }

  // Recul visuel : le personnage est repoussé de quelques pixels à l'opposé du tir.
  kickOffset(a) {
    const k = a.kick * a.kick * (a.weapon.heavy ? 5 : 3);
    return { x: -Math.cos(a.angle) * k, y: -Math.sin(a.angle) * k };
  }

  drawEnemy(e) {
    const k = this.kickOffset(e);
    Sprites.character(this.ctx, e.x + k.x, e.y + k.y, e.angle, this.enemyStyle(e), e.muzzleT, e.walk, e.moving);
    if (e.stun > 0) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,240,120,0.9)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { const a = this.game.time * 5 + i * TAU / 3; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12 - 6, 1.8, 0, TAU); ctx.stroke(); }
    }
  }

  drawCasings() {
    const ctx = this.ctx;
    for (const c of this.game.casings) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = '#e0b638'; ctx.fillRect(-2, -0.8, 4, 1.6);
      ctx.restore();
    }
  }

  drawGrenades() {
    const ctx = this.ctx;
    for (const gr of this.game.grenades) {
      const h = gr.h || 0;
      ctx.fillStyle = `rgba(0,0,0,${0.3 - h * 0.012})`; ctx.beginPath(); ctx.arc(gr.x + 2 + h * 0.3, gr.y + 3 + h * 0.3, 3.5 - h * 0.08, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(gr.x, gr.y - h); ctx.rotate(gr.spin || 0);
      ctx.fillStyle = '#9aa7ae'; ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2f3a40'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = '#3e4c55'; ctx.fillRect(-1.6, -6, 3.2, 3);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(2, -1.5, 2, 1.2);
      ctx.restore();
      // mèche : anneau qui se referme pendant les derniers instants
      if (gr.fuse - gr.t < 0.6) {
        ctx.strokeStyle = 'rgba(255,240,150,0.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(gr.x, gr.y - h, 7, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - (gr.fuse - gr.t) / 0.6)); ctx.stroke();
      }
    }
  }

  drawBullets() {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const b of this.game.bullets) {
      const l = Math.hypot(b.vx, b.vy), ux = b.vx / l, uy = b.vy / l;
      const grad = ctx.createLinearGradient(b.x - ux * b.trail, b.y - uy * b.trail, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,220,140,0)'); grad.addColorStop(1, 'rgba(255,240,200,0.95)');
      ctx.strokeStyle = grad; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(b.x - ux * b.trail, b.y - uy * b.trail); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const f of this.game.effects) {
      const k = f.t / f.life;
      if (f.type === 'hit') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#c62828';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(f.x + Math.cos(i * 1.7 + f.life) * 8 * k, f.y + Math.sin(i * 1.7 + f.life) * 8 * k, 2.2 * (1 - k), 0, TAU); ctx.fill(); }
      } else if (f.type === 'splinter') {
        // éclats de bois projetés de l'autre côté du battant
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#8a5a2b';
        for (let i = 0; i < 5; i++) {
          const a = f.angle + (i - 2) * 0.22, d = 14 * k;
          ctx.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 1.6, 1.6);
        }
      } else if (f.type === 'spark') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#ffe082';
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.5 * (1 - k) + 0.5, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawFlashes() {
    const ctx = this.ctx;
    for (const f of this.game.effects) {
      if (f.type !== 'flash') continue;
      const k = f.t / f.life;
      ctx.globalAlpha = (1 - k) * 0.95;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 30 + 200 * k);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, 'rgba(255,255,240,0.8)'); g.addColorStop(1, 'rgba(255,255,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 30 + 200 * k, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFog() {
    const g = this.game, m = g.map, f = this.fogC.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = 'rgba(4,5,7,0.9)';
    f.fillRect(0, 0, this.fogC.width, this.fogC.height);
    f.globalCompositeOperation = 'destination-out';
    // zones explorées : calque mis à jour seulement pour les nouvelles cases
    if (m.newlyExplored.length) {
      const ec = this.exploredC.getContext('2d');
      ec.fillStyle = 'rgba(0,0,0,0.45)';
      for (const i of m.newlyExplored) ec.fillRect((i % m.w) * TILE, Math.floor(i / m.w) * TILE, TILE, TILE);
      m.newlyExplored = [];
    }
    f.drawImage(this.exploredC, 0, 0);
    f.fillStyle = 'rgba(0,0,0,1)';
    for (const p of g.visionPolys) {
      f.beginPath(); f.moveTo(p.x, p.y);
      for (const q of p.pts) f.lineTo(q.x, q.y);
      f.closePath(); f.fill();
    }
    f.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.fogC, 0, 0);
  }

  drawVignette() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const p = this.game.player;
    if (p.alive && p.hp < 40) {
      const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.6);
      r.addColorStop(0, 'rgba(160,0,0,0)'); r.addColorStop(1, `rgba(160,0,0,${0.5 * (1 - p.hp / 40)})`);
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
  }

  drawBlind() {
    const p = this.game.player;
    if (p.flashT <= 0) return;
    this.ctx.fillStyle = `rgba(255,255,255,${clamp(p.flashT / 1.2, 0, 1)})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawCrosshair() {
    const g = this.game, p = g.player, ctx = this.ctx;
    const x = this.mouse.sx * this.dpr, y = this.mouse.sy * this.dpr;
    const w = p.weapon;
    // Le viseur montre l'erreur réelle à la distance du curseur : tan(dispersion) * distance.
    const spread = g.spreadOf(p);
    const gap = Math.max(5 * this.dpr, Math.tan(spread) * (p.aimDist || 0) * this.zoom + 3 * this.dpr);
    const len = 10 * this.dpr;
    const color = p.reloadT > 0 || p.act ? 'rgba(255,170,60,0.95)' : p.walkMode ? 'rgba(140,255,170,0.95)' : 'rgba(255,255,255,0.95)';
    ctx.lineCap = 'round';
    const ticks = () => {
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * gap, y + dy * gap); ctx.lineTo(x + dx * (gap + len), y + dy * (gap + len)); }
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5.5 * this.dpr; ticks(); // liseré sombre
    ctx.strokeStyle = color; ctx.lineWidth = 3.2 * this.dpr; ticks();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x, y, 3 * this.dpr, 0, TAU); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.8 * this.dpr, 0, TAU); ctx.fill();
    if (p.reloadT > 0 || p.act) {
      const k = p.act ? clamp(p.act.t / p.act.dur, 0, 1) : 1 - p.reloadT / w.reload;
      const r = gap + len + 8 * this.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,170,60,0.95)'; ctx.lineWidth = 4 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    }
  }
}
