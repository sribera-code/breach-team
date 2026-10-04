'use strict';
const gunStyle = w => (w ? { gun: w.kind, gunLen: w.gunLen, gunTint: w.tint, gunSup: !!w.suppressed } : { gun: null });
// Bouclier porté (tenu, ou lâché à côté du corps).
const shieldStyle = a => ({ shield: a.shield ? a.shield.look : null });
// Geste en cours (porte, grenade) transmis au dessin du personnage.
const actStyle = a => (a.act ? { act: { type: a.act.type, k: a.act.t / a.act.dur } }
  : a.cooking ? { act: { type: 'grenade', k: 0.55 } } // dégoupillée, bras armé, en attente du lancer
  : a.fiber ? { act: { type: 'fiber', k: 1 } }
  // rechargement : pas un geste à deux mains (on peut marcher), mais il s'anime pareil
  : a.reloadT > 0 && a.reloadDur ? { act: { type: 'reload', k: 1 - a.reloadT / a.reloadDur } } : null);
// Teinte des sols sur les plans réduits, dans l'ordre de FLOOR (js/map.js).
const MINI_FLOORS = ['#2f3742', '#3a3327', '#2d3a3d', '#3d2a30', '#403d37', '#343b42'];
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
    this.miniC = document.createElement('canvas');     // plan réduit (sols, murs, portes, fenêtres)
    this.miniExpC = document.createElement('canvas');  // masque des cases déjà vues
    this.miniTmpC = document.createElement('canvas');  // composition des deux
    this.miniArrC = document.createElement('canvas');  // pièce où la dernière vague d'assaut est entrée
    this.noiseC = document.createElement('canvas');    // halo du dernier bruit du joueur (une case = un pixel)
    this.darkC = document.createElement('canvas');     // obscurité quand le courant est coupé, trouée par les lumières
    this._noiseId = 0;
    this.miniScale = 4;
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
    for (const c of [this.staticC, this.decalC, this.fogC, this.exploredC, this.darkC]) { c.width = W; c.height = H; }
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
    for (const w of m.windows) Sprites.paintWindow(ctx, w);
    for (const p of m.props) Sprites.paintProp(ctx, p);
    this.decalC.getContext('2d').clearRect(0, 0, W, H);
    this.buildMinimap();
    this.cam.x = this.game.player.x; this.cam.y = this.game.player.y;
    this.tx = this.canvas.width / 2 - this.cam.x * this.zoom;
    this.ty = this.canvas.height / 2 - this.cam.y * this.zoom;
  }

  // Plan réduit : une petite case de la grille fine devient un carré de miniScale pixels.
  buildMinimap() {
    const m = this.game.map;
    const s = this.miniScale;
    for (const c of [this.miniC, this.miniExpC, this.miniTmpC, this.miniArrC]) { c.width = m.w * s; c.height = m.h * s; }
    this._arrivalFor = null;
    const ctx = this.miniC.getContext('2d');
    ctx.clearRect(0, 0, this.miniC.width, this.miniC.height);
    Renderer.paintPlan(ctx, m, s, false);
    this.miniExpC.getContext('2d').clearRect(0, 0, this.miniExpC.width, this.miniExpC.height);
  }

  // Plan réduit d'une carte, une petite case par carré de s pixels : sols, murs, mobilier, fenêtres,
  // et les portes (fermées) si on le demande. Sert à la minimap et aux aperçus du choix de mission.
  static paintPlan(ctx, m, s, doors) {
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.tile(x, y);
      if (t === 2) continue;
      ctx.fillStyle = t === 1 ? '#6a737f' : MINI_FLOORS[m.floor(x, y)] || MINI_FLOORS[0];
      ctx.fillRect(x * s, y * s, s, s);
    }
    ctx.fillStyle = 'rgba(170,180,190,0.3)'; // mobilier : il arrête les pas, pas le regard
    for (const i of m.propAt.keys()) ctx.fillRect((i % m.w) * s, Math.floor(i / m.w) * s, s, s);
    ctx.fillStyle = '#7fd7ff';
    for (const w of m.windows) for (const c of w.cells) ctx.fillRect(c.x * s, c.y * s, s, s);
    if (doors) {
      ctx.fillStyle = '#a9713f';
      for (const d of m.doors) for (const c of d.cells) ctx.fillRect(c.x * s, c.y * s, s, s);
    }
  }

  // Vague d'assaut qui vient d'entrer : sa pièce d'arrivée clignote en rouge sur la minimap et
  // l'ouverture franchie émet des ondes, une flèche pointée vers l'intérieur.
  drawArrival(t, arr, age) {
    const m = this.game.map, s = this.miniScale;
    if (this._arrivalFor !== arr) {
      this._arrivalFor = arr;
      const a = this.miniArrC.getContext('2d');
      a.clearRect(0, 0, this.miniArrC.width, this.miniArrC.height);
      a.fillStyle = '#ef5350';
      for (const i of arr.room) a.fillRect((i % m.w) * s, Math.floor(i / m.w) * s, s, s);
    }
    const fade = clamp((ARRIVAL_ALERT - age) / 2, 0, 1); // s'efface sur les deux dernières secondes
    t.save();
    t.globalAlpha = (0.32 + 0.26 * (0.5 + 0.5 * Math.cos(age * 7))) * fade;
    t.drawImage(this.miniArrC, 0, 0);
    const b = arr.breach, bx = b.cx / TILE * s, by = b.cy / TILE * s;
    t.strokeStyle = '#ff8a80'; t.lineWidth = 1.5;
    for (let k = 0; k < 2; k++) {
      const ph = (age * 1.2 + k / 2) % 1;
      t.globalAlpha = fade * (1 - ph);
      t.beginPath(); t.arc(bx, by, 3 + ph * 14, 0, TAU); t.stroke();
    }
    const a = b.angle, cs = Math.cos(a), sn = Math.sin(a);
    t.globalAlpha = fade;
    t.fillStyle = '#ffd6d4';
    t.beginPath();
    t.moveTo(bx + cs * 11, by + sn * 11);
    t.lineTo(bx + cs * 3 - sn * 4.5, by + sn * 3 + cs * 4.5);
    t.lineTo(bx + cs * 3 + sn * 4.5, by + sn * 3 - cs * 4.5);
    t.closePath(); t.fill();
    t.restore();
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
    this.drawCharges();
    for (const h of g.hostages) {
      if (!this.hostageShown(h)) continue;
      if (h.standing) Sprites.hostageStanding(ctx, h); else Sprites.hostage(ctx, h);
    }
    for (const e of g.enemies) {
      if (!e.visible) continue;
      if (e.dying) Sprites.dying(ctx, e, this.enemyStyle(e), e.dying);
      else if (e.alive && e.surrender) Sprites.kneeling(ctx, e, this.enemyStyle(e));
      else if (e.alive) this.drawEnemy(e);
    }
    this.drawGrenades();
    ctx.save(); this.clipToVision(); this.drawBullets(); ctx.restore();
    for (const a of [...g.ops, ...g.enemies]) a.walk = (a.walk || 0) + (a.alive && a.moving ? dt * (a.walkMode ? 8 : 13) : 0);
    for (const h of g.hostages) if (h.moving) h.walk += dt * 10;
    if (g.orderMarker) this.drawOrderMarker(g.orderMarker);
    if (g.orderDrag) this.drawOrderDrag(g.orderDrag);
    for (const mt of g.mates) {
      const st = { ...mt.style, ...gunStyle(mt.weapon), ...shieldStyle(mt), ...actStyle(mt) };
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
    const pst = { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon), ...shieldStyle(g.player), ...actStyle(g.player) };
    const p = g.player;
    if (p.dying) Sprites.dying(ctx, p, pst, p.dying);
    else if (p.alive) {
      const k = this.kickOffset(p);
      Sprites.character(ctx, p.x + k.x, p.y + k.y, p.angle, pst, p.muzzleT, p.walk, p.moving);
    }
    if (p.fiber) this.drawFiber(p, p.fiber);
    ctx.save(); this.clipToVision(); this.drawLaser(g.laserBeam(p)); this.drawEffects(); ctx.restore();
    this.drawLamps();
    if (g.dark) this.drawDark();
    this.drawOwnNoise();
    this.drawFog();
    if (g.dark) this.drawGlimpsed();
    this.drawFlashes();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawVignette();
    this.drawBlind();
    this.drawHeard();
    this.drawCrosshair();
    if (g.minimap) this.drawMinimap();
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
      if (d.broken) {
        // serrure arrachée : bois éclaté à la place de la poignée
        ctx.fillStyle = '#2a2016';
        ctx.beginPath(); ctx.moveTo(L - 11, -2.5); ctx.lineTo(L - 4, -0.5); ctx.lineTo(L - 10, 2.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,200,0.25)'; ctx.fillRect(L - 9, -2.5, 1, 5);
      } else if (d.locked && d.lockKnown) {
        // fermée à clé (on l'a essayée) : serrure rouge
        ctx.fillStyle = '#e0533d'; ctx.fillRect(L - 9, -1.6, 4, 3.2);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.6; ctx.strokeRect(L - 9, -1.6, 4, 3.2);
      } else ctx.fillStyle = '#d8c06a', ctx.fillRect(L - 8, -1, 3, 2);
      ctx.fillStyle = '#2a2016'; ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();
    }
  }

  // Charge de brèche posée : un boudin d'explosif collé au battant, une diode qui clignote.
  drawCharges() {
    const ctx = this.ctx;
    for (const c of this.game.charges) {
      const d = c.door;
      ctx.save();
      ctx.translate(c.x, c.y);
      if (!d.horizontal) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#5b6347'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8;
      roundRect(ctx, -11, -1.8, 22, 3.6, 1.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2f26'; ctx.fillRect(-3, -2.4, 6, 4.8);
      ctx.fillStyle = Math.sin(c.t * 9) > 0 ? '#ff4a3d' : '#5a1a16';
      ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  // Faisceau des lampes : une lueur chaude dans le cône éclairé (bien plus marquée courant coupé).
  drawLamps() {
    const g = this.game, ctx = this.ctx;
    for (const a of g.ops) {
      if (!g.lampLit(a)) continue;
      const poly = g.visionPolys.find(q => q.lamp && q.x === a.x && q.y === a.y);
      const R = LAMP_RANGE, alpha = g.dark ? 0.09 : 0.05;
      ctx.save();
      ctx.beginPath();
      if (poly) { ctx.moveTo(poly.x, poly.y); for (const q of poly.pts) ctx.lineTo(q.x, q.y); ctx.closePath(); }
      else {
        // bâtiment éclairé : pas de cône de vision dédié, on le trace ici, arrêté par les murs
        ctx.moveTo(a.x, a.y);
        for (let i = 0; i <= 12; i++) { const r = g.map.castRay(a.x, a.y, a.angle - LAMP_HALF + 2 * LAMP_HALF * i / 12, 5 * U, false); ctx.lineTo(r.x, r.y); }
        ctx.closePath();
      }
      ctx.clip();
      const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, R);
      grad.addColorStop(0, `rgba(255,244,214,${alpha * 1.6})`); grad.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad; ctx.fillRect(a.x - R, a.y - R, 2 * R, 2 * R);
      ctx.restore();
    }
  }

  // Courant coupé : un voile sombre sur tout le bâtiment, troué par les faisceaux des lampes, les flammes de
  // bouche, les flashs et un peu autour de soi (les yeux s'habituent).
  drawDark() {
    const g = this.game, c = this.darkC, d = c.getContext('2d');
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, c.width, c.height);
    d.fillStyle = 'rgba(2,4,12,0.62)';
    d.fillRect(0, 0, c.width, c.height);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => {
      const grad = d.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${a})`); grad.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = grad; d.beginPath(); d.arc(x, y, r, 0, TAU); d.fill();
    };
    for (const q of g.visionPolys) {
      if (!q.lamp) continue;
      d.save();
      d.beginPath(); d.moveTo(q.x, q.y); for (const r of q.pts) d.lineTo(r.x, r.y); d.closePath(); d.clip();
      hole(q.x, q.y, LAMP_RANGE, 0.95);
      d.restore();
    }
    const p = g.player;
    if (p.alive) hole(p.x, p.y, DARK_SIGHT, 0.45);
    for (const a of [...g.ops, ...g.enemies]) if (a.alive && a.glowT > 0) hole(a.x, a.y, 2.5 * U, 0.8 * a.glowT / SHOT_GLOW);
    for (const f of g.effects) if (f.type === 'flash' || f.type === 'frag') hole(f.x, f.y, 8 * U, 1 - f.t / f.life);
    d.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(c, 0, 0);
  }

  // Dans le noir, un suspect trahi par la flamme de son arme (ou pris dans un faisceau hors du champ) se devine
  // un instant par-dessus le brouillard.
  drawGlimpsed() {
    const g = this.game, ctx = this.ctx;
    for (const e of g.enemies) {
      if (!e.alive || !e.visible || g.seesPoint(e.x, e.y)) continue;
      ctx.save();
      ctx.globalAlpha = 0.75;
      if (e.surrender) Sprites.kneeling(ctx, e, this.enemyStyle(e)); else this.drawEnemy(e);
      ctx.restore();
    }
  }

  drawBodies() {
    const g = this.game;
    for (const e of g.enemies) if (!e.alive && !e.dying && e.bodySeen) Sprites.body(this.ctx, e, this.enemyStyle(e));
    if (!g.player.alive && !g.player.dying) Sprites.body(this.ctx, g.player, { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon), ...shieldStyle(g.player) });
    for (const mt of g.mates) if (!mt.alive && !mt.dying) Sprites.body(this.ctx, mt, { ...mt.style, ...gunStyle(mt.weapon), ...shieldStyle(mt) });
    for (const h of g.hostages) if (!h.alive && h.bodySeen) Sprites.body(this.ctx, h, STYLE_HOSTAGE);
  }

  // Un otage à genoux reste dessiné là où on l'a vu (il ne bouge pas) ; un otage qui marche ne se
  // voit que dans le champ de vision, sinon il trahirait son escorte à travers le brouillard.
  hostageShown(h) {
    if (!h.alive || h.evacuated) return false;
    return h.visible || (!h.escort && !h.exiting && this.game.map.isExplored(h.tx, h.ty));
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
    // suspect alerté par un bruit : « ? » quand il va voir ou qu'il cherche, plus pâle quand il guette
    if (!e.target && !(e instanceof Operator) && (e.state === 'investigate' || e.suspicion >= 0.5)) {
      const ctx = this.ctx, searching = e.state === 'investigate';
      ctx.save();
      ctx.font = `bold ${searching ? 12 : 10}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText('?', e.x, e.y - 20);
      ctx.fillStyle = searching ? 'rgba(255,213,79,0.95)' : 'rgba(255,213,79,0.55)';
      ctx.fillText('?', e.x, e.y - 20);
      ctx.restore();
    }
    if (e.stun > 0) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,240,120,0.9)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { const a = this.game.time * 5 + i * TAU / 3; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12 - 6, 1.8, 0, TAU); ctx.stroke(); }
    }
  }

  drawCasings() {
    const ctx = this.ctx;
    for (const c of this.game.casings) {
      if (!this.game.seesPoint(c.x, c.y)) continue; // douille éjectée hors de vue
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
      ctx.fillStyle = gr.kind === 'frag' ? '#4f5b3a' : '#9aa7ae'; ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2f3a40'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = '#3e4c55'; ctx.fillRect(-1.6, -6, 3.2, 3);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(2, -1.5, 2, 1.2);
      ctx.restore();
      // mèche : anneau qui se referme pendant les derniers instants
      // compte à rebours visible dès que la grenade est au sol, pas seulement à la dernière seconde
      const reste = gr.fuse - gr.t - (gr.cooked || 0);
      {
        // l'anneau se vide : ce qu'il reste de mèche, et il rougit sur la fin
        const part = clamp(reste / gr.fuse, 0, 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(gr.x, gr.y - h, 7, 0, TAU); ctx.stroke();
        ctx.strokeStyle = reste < 0.6 ? 'rgba(239,83,80,0.95)' : 'rgba(255,240,150,0.85)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(gr.x, gr.y - h, 7, -Math.PI / 2, -Math.PI / 2 + TAU * part); ctx.stroke();
      }
    }
  }

  // Traçantes, gerbes de sang, éclats : seulement dans ce que le groupe voit en ce moment,
  // sinon un tir à travers une porte trahit ce qui se passe derrière.
  clipToVision() {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const p of this.game.visionPolys) {
      ctx.moveTo(p.x, p.y);
      for (const q of p.pts) ctx.lineTo(q.x, q.y);
      ctx.closePath();
    }
    ctx.clip();
  }

  // Faisceau du laser : un trait rouge ténu qui pâlit en s'éloignant, et le point là où il touche.
  drawLaser(b) {
    if (!b) return;
    const ctx = this.ctx;
    ctx.save();
    const grad = ctx.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
    grad.addColorStop(0, 'rgba(255,60,50,0.4)'); grad.addColorStop(1, 'rgba(255,60,50,0.12)');
    ctx.strokeStyle = grad; ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
    if (b.hit || b.on) {
      const glow = ctx.createRadialGradient(b.x1, b.y1, 0, b.x1, b.y1, 4.5);
      glow.addColorStop(0, 'rgba(255,90,70,0.85)'); glow.addColorStop(1, 'rgba(255,40,30,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(b.x1, b.y1, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd9d2'; ctx.beginPath(); ctx.arc(b.x1, b.y1, 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
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
      if (f.type === 'frag') {
        // boule de feu brève puis fumée
        const k = f.t / f.life, r = (18 + 70 * Math.sqrt(k)) * (f.small ? 0.6 : 1);
        ctx.globalAlpha = (1 - k) * 0.9;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, k < 0.25 ? '#fff3c4' : '#6b6259'); g.addColorStop(0.45, k < 0.35 ? 'rgba(255,140,40,0.85)' : 'rgba(70,64,58,0.7)'); g.addColorStop(1, 'rgba(40,36,32,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
        continue;
      }
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
      const mc = this.miniExpC.getContext('2d');
      const s = this.miniScale;
      mc.fillStyle = '#fff';
      for (const i of m.newlyExplored) {
        const x = i % m.w, y = Math.floor(i / m.w);
        ec.fillRect(x * TILE, y * TILE, TILE, TILE);
        mc.fillRect(x * s, y * s, s, s);
      }
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

  // Halo de votre dernier bruit : les cases qu'il atteint (murs et portes compris), plus clair là où il
  // porte le plus fort. Il passe sous le brouillard : il ne révèle rien du plan.
  drawOwnNoise() {
    const g = this.game, n = g.ownNoise, m = g.map;
    if (!n) return;
    const age = g.time - n.at;
    if (age < 0 || age > 0.8) return;
    if (this._noiseId !== n.id) {
      this._noiseId = n.id;
      const c = this.noiseC;
      if (c.width !== m.w || c.height !== m.h) { c.width = m.w; c.height = m.h; }
      const nc = c.getContext('2d'), img = nc.createImageData(m.w, m.h), d = img.data;
      for (let j = 0; j < n.cells.length; j += 2) {
        const o = n.cells[j] * 4;
        d[o] = 255; d[o + 1] = 236; d[o + 2] = 200; d[o + 3] = Math.round(40 + 140 * n.cells[j + 1]);
      }
      nc.putImageData(img, 0, 0);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.28 * (1 - age / 0.8);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.noiseC, 0, 0, m.w * TILE, m.h * TILE);
    ctx.restore();
  }

  // Bruits entendus hors de vue : un arc autour du joueur, dans leur direction. Plus le bruit est fort,
  // plus l'arc est épais, opaque et resserré ; sa couleur dit sa nature (voir NOISE_KINDS).
  drawHeard() {
    const g = this.game, p = g.player;
    if (!p.alive || !g.heard.length) return;
    const ctx = this.ctx, d = this.dpr;
    const px = p.x * this.zoom + this.tx, py = p.y * this.zoom + this.ty;
    const R = 26 * this.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    for (const n of g.heard) {
      const K = NOISE_KINDS[n.kind];
      const a = (1 - n.t / K.life) * (0.35 + 0.65 * n.i);
      const half = (26 - 14 * n.i) * DEG;
      ctx.strokeStyle = 'rgba(0,0,0,' + (a * 0.5) + ')'; ctx.lineWidth = (4 + 7 * n.i) * d;
      ctx.beginPath(); ctx.arc(px, py, R, n.a - half, n.a + half); ctx.stroke();
      ctx.strokeStyle = 'rgba(' + K.col + ',' + a + ')'; ctx.lineWidth = (2 + 5 * n.i) * d;
      ctx.beginPath(); ctx.arc(px, py, R, n.a - half, n.a + half); ctx.stroke();
      if (n.kind === 'voice') {
        // un cri : « ! » au bout de l'arc
        const gx = px + Math.cos(n.a) * (R + 13 * d), gy = py + Math.sin(n.a) * (R + 13 * d);
        ctx.font = `bold ${Math.round(13 * d)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(' + K.col + ',' + a + ')'; ctx.fillText('!', gx, gy);
      }
    }
    ctx.restore();
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

  // Minimap en haut à droite : le plan connu, les portes, et qui est visible en ce moment.
  drawMinimap() {
    const g = this.game, m = g.map, ctx = this.ctx;
    const s = this.miniScale;
    // on ne montre que ce qui a été exploré : masque blanc puis plan par-dessus
    const t = this.miniTmpC.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, this.miniTmpC.width, this.miniTmpC.height);
    t.drawImage(this.miniExpC, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.drawImage(this.miniC, 0, 0);
    t.globalCompositeOperation = 'source-over';
    // portes (leur état change en cours de partie) et points d'entrée
    for (const d of m.doors) {
      if (!m.isExplored(d.x, d.y)) continue;
      t.fillStyle = d.open ? '#4d7f5a' : d.progress > 0 ? '#c8a95a' : d.locked && d.lockKnown ? '#c0392b' : '#a9713f';
      for (const c of d.cells) t.fillRect(c.x * s, c.y * s, s, s);
    }
    const arr = g.siege && g.siege.arrival;
    if (arr && g.time - arr.at < ARRIVAL_ALERT) this.drawArrival(t, arr, g.time - arr.at);
    const dot = (x, y, r, col) => { t.fillStyle = col; t.beginPath(); t.arc(x / TILE * s, y / TILE * s, r, 0, TAU); t.fill(); };
    // vous escortez : les sorties (portes extérieures et fenêtres) battent en vert
    if (g.hostages.some(h => h.escort === g.player && h.alive && !h.evacuated)) {
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 5);
      t.strokeStyle = `rgba(110,230,140,${0.55 + 0.4 * pulse})`; t.lineWidth = 1.6;
      for (const b of m.breaches) { t.beginPath(); t.arc(b.cx / TILE * s, b.cy / TILE * s, 4 + pulse * 2.5, 0, TAU); t.stroke(); }
    }
    // otage escorté : vert s'il vous suit, orange si l'intervention l'emmène (siège)
    for (const h of g.hostages) {
      if (!this.hostageShown(h)) continue;
      dot(h.x, h.y, 2.2, !h.escort ? '#e8eef5' : h.escort.team === 'ops' ? '#9be7a6' : '#ffb347');
    }
    for (const e of g.enemies) if (e.alive && e.visible) dot(e.x, e.y, 2.2, e.cuffed ? '#9aa4ae' : e.surrender ? '#ffb347' : '#ef5350');
    for (const mt of g.mates) if (mt.alive) dot(mt.x, mt.y, 2.2, mt.accent || '#7fd18a');
    const p = g.player;
    if (p.alive) {
      // joueur : petite flèche orientée
      const px = p.x / TILE * s, py = p.y / TILE * s, a = p.angle;
      t.fillStyle = '#ffffff';
      t.beginPath();
      t.moveTo(px + Math.cos(a) * 5, py + Math.sin(a) * 5);
      t.lineTo(px + Math.cos(a + 2.5) * 4, py + Math.sin(a + 2.5) * 4);
      t.lineTo(px + Math.cos(a - 2.5) * 4, py + Math.sin(a - 2.5) * 4);
      t.closePath(); t.fill();
    }
    // cadre à l'écran, en haut à droite
    const scale = clamp(this.canvas.width * 0.22 / this.miniTmpC.width, 0.4, 1.6);
    const w = this.miniTmpC.width * scale, h = this.miniTmpC.height * scale;
    // sous la barre du haut du HUD, pour ne pas croiser le chrono
    const pad = 10 * this.dpr, x0 = this.canvas.width - w - pad, y0 = 40 * this.dpr;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(8,10,13,0.72)';
    ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
    ctx.strokeStyle = 'rgba(160,175,190,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 3.5, y0 - 3.5, w + 7, h + 7);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniTmpC, x0, y0, w, h);
    ctx.restore();
  }

  drawCrosshair() {
    const g = this.game, p = g.player, ctx = this.ctx;
    const x = this.mouse.sx * this.dpr, y = this.mouse.sy * this.dpr;
    const w = p.weapon;
    // Le viseur montre l'erreur réelle à la distance du curseur : tan(dispersion) * distance.
    const spread = g.spreadOf(p);
    const gap = Math.max(5 * this.dpr, Math.tan(spread) * (p.aimDist || 0) * this.zoom + 3 * this.dpr);
    const len = 10 * this.dpr;
    const color = p.cooking ? 'rgba(239,83,80,0.95)' : p.reloadT > 0 || p.act ? 'rgba(255,170,60,0.95)' : p.walkMode ? 'rgba(140,255,170,0.95)' : 'rgba(255,255,255,0.95)';
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
    if (p.reloadT > 0 || p.act || p.cooking) {
      // mèche en cours : l'anneau se vide, en rouge, au lieu de se remplir
      const c = p.cooking;
      const k = c ? 1 - clamp(c.t / c.fuse, 0, 1) : p.act ? clamp(p.act.t / p.act.dur, 0, 1) : 1 - p.reloadT / w.reload;
      const r = gap + len + 8 * this.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = c ? 'rgba(239,83,80,0.95)' : 'rgba(255,170,60,0.95)'; ctx.lineWidth = 4 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    }
  }
}
