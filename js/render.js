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
// Cadrage : le zoom montre au moins VIEW_HALF de monde au-dessus et au-dessous du centre de l'écran (sur un écran
// large, c'est la hauteur qui manque), et la vue se décale vers le curseur de LOOK_AHEAD de l'écart entre le joueur et
// le point visé, jusqu'à LOOK_MAX de la demi-hauteur de l'écran (la plus petite des deux dimensions), dans les deux
// axes. Viser vers le bord de l'écran montre ainsi au moins une fois et demie VIEW_HALF devant soi : plus loin que
// AI_FIRE_RANGE, d'où l'adversaire ouvre le feu.
const VIEW_HALF = 7 * U, LOOK_AHEAD = 0.4, LOOK_MAX = 0.5;
// Stratégie : la vue de départ montre STRAT_VIEW de champ de bataille en hauteur ; la molette zoome par crans de
// STRAT_ZOOM_STEP, de toute la carte jusqu'au cadrage du jeu à pied ; les touches et les bords de l'écran (souris
// verrouillée, à STRAT_EDGE px) font glisser la vue à STRAT_PAN px d'écran par seconde.
const STRAT_VIEW = 30 * U, STRAT_ZOOM_STEP = 1.15, STRAT_PAN = 900, STRAT_EDGE = 14;
// Teinte des sols sur les plans réduits, dans l'ordre de FLOOR (js/map.js).
const MINI_FLOORS = ['#2f3742', '#3a3327', '#2d3a3d', '#3d2a30', '#403d37', '#343b42', '#2c3d26', '#46413a', '#3e3b35', '#26292e'];
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
    this.fitZoom();
  }

  // À pied : à la largeur, sans montrer moins de VIEW_HALF en hauteur (ni descendre sous 1,1 dans une toute petite
  // fenêtre). En stratégie, ce cadrage est le zoom le plus fort ; le plus faible montre toute la carte ; reset : la vue
  // de départ (STRAT_VIEW en hauteur), sinon le zoom choisi, gardé dans ces bornes.
  fitZoom(reset) {
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr, g = this.game;
    const foot = this.dpr * Math.max(1.1, Math.min(1.9 * clamp(W / 1280, 0.75, 1.3), H / (2 * VIEW_HALF)));
    if (!g.strat || !g.map) { this.zoom = foot; return; }
    this.zoomMax = foot;
    this.zoomMin = Math.min(foot, this.dpr * 0.95 * Math.min(W / (g.map.w * TILE), H / (g.map.h * TILE)));
    this.zoom = clamp(reset || !this.stratZoomed ? this.dpr * H / STRAT_VIEW : this.zoom, this.zoomMin, this.zoomMax);
    this.stratZoomed = true;
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
    Sprites.paintGoal(ctx, m);  // escorte : la zone d'extraction (point B)...
    Sprites.paintStart(ctx, m); // ...et le point A
    Sprites.paintBases(ctx, m, this.homeBase()); // guerre totale : la base de chaque armée
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tile(x, y) === 1) Sprites.paintWall(ctx, m, x, y);
    for (const d of m.doors) Sprites.paintDoorFrame(ctx, d);
    for (const w of m.windows) Sprites.paintWindow(ctx, w);
    for (const p of m.props) Sprites.paintProp(ctx, p);
    this.decalC.getContext('2d').clearRect(0, 0, W, H);
    this.buildMinimap();
    // (en stratégie, la vue de départ, sur votre base)
    this.fitZoom(true);
    this.scopeAim = null;
    this.cam.x = this.game.player.x; this.cam.y = this.game.player.y;
    if (this.game.strat) this.clampCam();
    this.tx = this.canvas.width / 2 - this.cam.x * this.zoom;
    this.ty = this.canvas.height / 2 - this.cam.y * this.zoom;
  }

  // Stratégie : la vue ne sort guère de la carte (deux cases de marge), et la centre si elle la montre tout entière.
  clampCam() {
    const m = this.game.map, hw = this.canvas.width / 2 / this.zoom, hh = this.canvas.height / 2 / this.zoom;
    const fit = (c, half, size) => (size + 4 * U > 2 * half ? clamp(c, half - 2 * U, size - half + 2 * U) : size / 2);
    this.cam.x = fit(this.cam.x, hw, m.w * TILE);
    this.cam.y = fit(this.cam.y, hh, m.h * TILE);
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
    // guerre totale : votre base en bleu, celle d'en face en rouge
    const home = this.homeBase();
    m.bases.forEach((b, i) => {
      ctx.fillStyle = i === home ? 'rgba(100,181,246,0.55)' : 'rgba(239,106,90,0.55)';
      for (const c of b.cells) ctx.fillRect(c.x * s, c.y * s, s, s);
    });
    this.miniExpC.getContext('2d').clearRect(0, 0, this.miniExpC.width, this.miniExpC.height);
  }

  // Indice de la base de votre armée dans map.bases (guerre totale), -1 hors de ce mode.
  homeBase() {
    const g = this.game;
    return g.war ? g.map.bases.indexOf(g.war.bases.ops) : -1;
  }

  // Plan réduit d'une carte, une petite case par carré de s pixels : sols, murs, mobilier, fenêtres,
  // et les portes (fermées) si on le demande. Sert à la minimap et aux aperçus du choix de mission.
  static paintPlan(ctx, m, s, doors) {
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.tile(x, y);
      if (t === 2) continue;
      ctx.fillStyle = t === 1 ? (m.hedgeAt && m.hedgeAt.has(y * m.w + x) ? '#3f6b35' : '#6a737f') : MINI_FLOORS[m.floor(x, y)] || MINI_FLOORS[0];
      ctx.fillRect(x * s, y * s, s, s);
    }
    if (m.goal) { // zone d'extraction de l'escorte (point B)
      ctx.fillStyle = 'rgba(111,207,122,0.6)';
      for (const c of m.goal.cells) ctx.fillRect(c.x * s, c.y * s, s, s);
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

  // Point B sur la minimap : la zone bat en vert, avec sa lettre.
  drawGoalMini(t, goal) {
    const s = this.miniScale, pulse = 0.5 + 0.5 * Math.sin(this.game.time * 4);
    t.save();
    t.fillStyle = `rgba(111,207,122,${0.35 + 0.35 * pulse})`;
    for (const c of goal.cells) t.fillRect(c.x * s, c.y * s, s, s);
    t.font = 'bold 11px sans-serif'; t.textAlign = 'center'; t.textBaseline = 'middle';
    t.lineWidth = 3; t.strokeStyle = 'rgba(0,0,0,0.7)'; t.strokeText('B', goal.cx / TILE * s, goal.cy / TILE * s);
    t.fillStyle = '#d9ffe0'; t.fillText('B', goal.cx / TILE * s, goal.cy / TILE * s);
    t.restore();
  }

  toWorld(sx, sy) {
    const px = sx * this.dpr, py = sy * this.dpr;
    return { x: (px - this.tx) / this.zoom, y: (py - this.ty) / this.zoom };
  }

  // Point visé, dans le monde : sous le curseur, ou, lunette à l'œil, le point tenu (scopeAim). En stratégie, le curseur
  // posé sur la minimap vise le point de la carte qu'il y montre (on peut donner un ordre de là).
  aimWorld() {
    if (this.scopeAim) return { x: this.scopeAim.x, y: this.scopeAim.y };
    if (this.overMinimap()) {
      const r = this.miniRect, m = this.game.map;
      return { x: (this.mouse.sx * this.dpr - r.x) / r.w * m.w * TILE, y: (this.mouse.sy * this.dpr - r.y) / r.h * m.h * TILE };
    }
    return this.toWorld(this.mouse.sx, this.mouse.sy);
  }

  // Stratégie : le curseur est-il sur la minimap (dépliée) ?
  overMinimap() {
    const r = this.miniRect, g = this.game;
    if (!r || !g.strat || !g.minimap) return false;
    const x = this.mouse.sx * this.dpr, y = this.mouse.sy * this.dpr;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // Mouvement de la souris (dx, dy en px CSS ; x, y : position du curseur système). Souris verrouillée (locked), le
  // curseur dessiné se déplace d'autant sans quitter l'écran ; sinon il suit le curseur système. Lunette à l'œil, c'est
  // le point visé qui se déplace, et la vue le suit (updateCamera) : on ne bute plus sur le bord de l'écran.
  pointerMove(dx, dy, x, y, locked) {
    if (this.scopeAim) {
      const k = this.dpr / this.zoom;
      this.scopeAim.x += dx * k; this.scopeAim.y += dy * k;
    } else if (locked) {
      this.mouse.sx = clamp(this.mouse.sx + dx, 0, this.canvas.width / this.dpr - 1);
      this.mouse.sy = clamp(this.mouse.sy + dy, 0, this.canvas.height / this.dpr - 1);
    } else { this.mouse.sx = x; this.mouse.sy = y; }
  }

  // Stratégie : la vue est libre. Molette : zoom vers le curseur (le point dessous ne bouge pas) ; ZQSD, flèches et bords
  // de l'écran : elle glisse ; elle rejoint le point demandé par le jeu (strat.camTo : minimap, F, numéro tapé deux fois).
  stratCamera(dt) {
    const g = this.game, S = g.strat, k = g.input.keys, d = this.dpr, W = this.canvas.width, H = this.canvas.height;
    if (S.zoom) {
      const at = this.toWorld(this.mouse.sx, this.mouse.sy);
      this.zoom = clamp(this.zoom * Math.pow(STRAT_ZOOM_STEP, S.zoom), this.zoomMin, this.zoomMax);
      S.zoom = 0;
      this.cam.x = at.x - (this.mouse.sx * d - W / 2) / this.zoom;
      this.cam.y = at.y - (this.mouse.sy * d - H / 2) / this.zoom;
    }
    let vx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let vy = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    if (this.locked && !this.overMinimap()) {
      const e = STRAT_EDGE * d, x = this.mouse.sx * d, y = this.mouse.sy * d;
      if (x <= e) vx = -1; else if (x >= W - e - 1) vx = 1;
      if (y <= e) vy = -1; else if (y >= H - e - 1) vy = 1;
    }
    if (vx || vy) {
      S.camTo = null;
      const sp = STRAT_PAN * d / this.zoom * dt / Math.hypot(vx, vy);
      this.cam.x += vx * sp; this.cam.y += vy * sp;
    }
    const to = S.camTo;
    if (to) {
      const kk = to.now ? 1 : 1 - Math.pow(0.0005, dt);
      this.cam.x = lerp(this.cam.x, to.x, kk); this.cam.y = lerp(this.cam.y, to.y, kk);
      if (to.now || dist(this.cam.x, this.cam.y, to.x, to.y) < 2) S.camTo = null;
    }
    this.clampCam();
    this.tx = W / 2 - this.cam.x * this.zoom;
    this.ty = H / 2 - this.cam.y * this.zoom;
  }

  updateCamera(dt) {
    const g = this.game, p = g.player;
    if (!isFinite(this.cam.x) || !isFinite(this.cam.y)) { this.cam.x = p.x; this.cam.y = p.y; }
    if (g.strat) { this.stratCamera(dt); return; }
    const k = 1 - Math.pow(0.001, dt);
    if (g.scoped(p)) {
      // Lunette à l'œil : le point visé reste où il est, et la vue glisse vers lui (à mi-chemin du tireur, SCOPE.lead,
      // jusqu'à SCOPE.look de la demi-largeur de l'écran) ; le viseur se déplace à l'écran avec le décor, sans
      // jamais quitter son point. Il garde ainsi de la marge pour viser plus loin, même pris au bord de l'écran.
      const a = this.scopeAim || (this.scopeAim = this.toWorld(this.mouse.sx, this.mouse.sy));
      const hw = this.canvas.width / 2 / this.zoom, hh = this.canvas.height / 2 / this.zoom;
      const lx = p.x + clamp((a.x - p.x) * SCOPE.lead, -hw * SCOPE.look, hw * SCOPE.look);
      const ly = p.y + clamp((a.y - p.y) * SCOPE.lead, -hh * SCOPE.look, hh * SCOPE.look);
      this.cam.x = lerp(this.cam.x, lx, k); this.cam.y = lerp(this.cam.y, ly, k);
      const m = 2 * this.dpr / this.zoom; // le point visé ne sort pas de l'écran
      a.x = clamp(a.x, this.cam.x - hw + m, this.cam.x + hw - m); a.y = clamp(a.y, this.cam.y - hh + m, this.cam.y + hh - m);
    } else {
      this.scopeAim = null;
      // la vue regarde où l'on vise : de quoi voir venir un tireur jusqu'à sa portée de tir
      const m = this.toWorld(this.mouse.sx, this.mouse.sy);
      const r = Math.min(this.canvas.width, this.canvas.height) / 2 / this.zoom * LOOK_MAX;
      const lx = p.x + clamp((m.x - p.x) * LOOK_AHEAD, -r, r), ly = p.y + clamp((m.y - p.y) * LOOK_AHEAD, -r, r);
      this.cam.x = lerp(this.cam.x, lx, k); this.cam.y = lerp(this.cam.y, ly, k);
    }
    const sh = g.camShake;
    const ox = (sh ? rand(-sh, sh) * this.dpr : 0) + g.camKick.x * this.zoom;
    const oy = (sh ? rand(-sh, sh) * this.dpr : 0) + g.camKick.y * this.zoom;
    this.tx = this.canvas.width / 2 - this.cam.x * this.zoom + ox;
    this.ty = this.canvas.height / 2 - this.cam.y * this.zoom + oy;
    // le viseur dessiné suit le point tenu ; la lunette baissée, le curseur repart de là
    if (this.scopeAim) {
      this.mouse.sx = (this.scopeAim.x * this.zoom + this.tx) / this.dpr;
      this.mouse.sy = (this.scopeAim.y * this.zoom + this.ty) / this.dpr;
    }
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

    const v = this.viewRect(); // (seule la partie à l'écran des calques de la carte)
    // cônes de vision qui touchent l'écran : les seuls à découper le brouillard et les tracés (une armée entière en a neuf)
    this.shownPolys = g.visionPolys.filter(p => Renderer.polyMeets(p, v));
    ctx.drawImage(this.staticC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
    ctx.drawImage(this.decalC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
    this.drawCasings();
    this.drawBodies();
    this.drawDoors();
    this.drawCharges();
    if (g.strat) this.drawStratUnder();
    for (const h of g.hostages) {
      if (!this.hostageShown(h)) continue;
      if (h.standing) Sprites.hostageStanding(ctx, h); else Sprites.hostage(ctx, h);
      if (h.vip) { ctx.fillStyle = '#ffd54f'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('VIP', h.x, h.y - 17); }
    }
    for (const e of g.enemies) {
      if (!e.visible) continue;
      if (e.dying) Sprites.dying(ctx, e, this.enemyStyle(e), e.dying);
      else if (e.alive && e.surrender) Sprites.kneeling(ctx, e, this.enemyStyle(e));
      else if (e.alive) this.drawEnemy(e);
    }
    this.drawGrenades();
    ctx.save(); this.clipToVision(); this.drawBullets(); ctx.restore();
    // (pause tactique : tout est figé, les jambes aussi)
    const still = !!(g.strat && g.strat.frozen);
    for (const a of [...g.ops, ...g.enemies]) a.walk = (a.walk || 0) + (a.alive && a.moving && !still ? dt * (a.walkMode ? 8 : 13) : 0);
    for (const h of g.hostages) if (h.moving && !still) h.walk += dt * 10;
    if (g.orderMarker) this.drawOrderMarker(g.orderMarker);
    if (g.orderDrag) this.drawOrderDrag(g.orderDrag);
    // vue de haut : les noms ne se lisent plus, on ne les écrit que de près (le numéro du trinôme les remplace)
    const names = !g.strat || this.zoom / this.dpr >= 1.5;
    for (const mt of g.mates) {
      const st = { ...mt.style, ...gunStyle(mt.weapon), ...shieldStyle(mt), ...actStyle(mt) };
      if (mt.dying) Sprites.dying(ctx, mt, st, mt.dying);
      else if (mt.alive) {
        const k = this.kickOffset(mt);
        Sprites.character(ctx, mt.x + k.x, mt.y + k.y, mt.angle, st, mt.muzzleT, mt.walk, mt.moving);
        ctx.fillStyle = mt.accent; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        if (names) ctx.fillText(mt.name.toUpperCase(), mt.x, mt.y - 17);
        // rappel discret de la direction imposée, tant qu'il n'a pas de contact
        if (mt.coverAngle !== null && !mt.target && !mt.hunter) {
          const cs = Math.cos(mt.coverAngle), sn = Math.sin(mt.coverAngle);
          ctx.save();
          ctx.globalAlpha = 0.3; ctx.strokeStyle = mt.accent; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(mt.x + cs * 15, mt.y + sn * 15); ctx.lineTo(mt.x + cs * 1.7 * U, mt.y + sn * 1.7 * U); ctx.stroke();
          ctx.restore();
        }
        if (mt.stun > 0) { ctx.strokeStyle = 'rgba(255,240,120,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mt.x, mt.y, 15, 0, TAU); ctx.stroke(); }
      }
    }
    const pst = { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon), ...shieldStyle(g.player), ...actStyle(g.player), plates: !!(g.player.vest && g.player.vest.plate) };
    const p = g.player;
    if (p.dying) Sprites.dying(ctx, p, pst, p.dying);
    else if (p.alive) {
      const k = this.kickOffset(p);
      Sprites.character(ctx, p.x + k.x, p.y + k.y, p.angle, pst, p.muzzleT, p.walk, p.moving);
    }
    if (p.fiber) this.drawFiber(p, p.fiber);
    ctx.save(); this.clipToVision();
    this.drawLaser(g.laserBeam(p));
    for (const b of g.beams || []) if (b.from !== p) this.drawLaser(b); // ceux de l'IA (trinômes), là où on les voit
    this.drawEffects(); ctx.restore();
    this.drawLamps();
    if (g.dark) this.drawDark();
    this.drawOwnNoise();
    this.drawFog();
    if (g.dark) this.drawGlimpsed();
    this.drawFlashes();
    if (g.strat) this.drawStratOrders();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (g.strat) this.drawStratScreen();
    else {
      this.drawVignette();
      this.drawBlind();
      this.drawHeard();
      this.drawCrosshair();
    }
    if (g.minimap) this.drawMinimap();
    if (g.strat) this.drawStratCursor();
    if (!still) for (const a of [...g.ops, ...g.enemies]) if (a.muzzleT > 0) a.muzzleT -= dt;
  }

  // ---- Stratégie ----
  // Sous les personnages : un anneau à la couleur de son trinôme sous chacun de vos hommes (plus vif s'il est choisi), un
  // anneau rouge sous chaque adversaire en vue, et ce que le curseur désigne. Épaisseurs en pixels d'écran.
  drawStratUnder() {
    const g = this.game, S = g.strat, ctx = this.ctx, px = this.dpr / this.zoom, h = S.hover;
    ctx.save();
    g.war.slots.ops.forEach((grp, k) => {
      if (!grp) return;
      const sel = S.sel.has(k);
      for (const m of grp.members) {
        if (!m.alive || m.group !== grp) continue;
        if (sel) {
          ctx.globalAlpha = 0.18; ctx.fillStyle = grp.color;
          ctx.beginPath(); ctx.arc(m.x, m.y, m.radius + 5, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = sel ? 1 : 0.55; ctx.strokeStyle = grp.color; ctx.lineWidth = (sel ? 2.2 : 1.3) * px;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.radius + 4, 0, TAU); ctx.stroke();
      }
    });
    ctx.lineWidth = 1.5 * px;
    for (const e of g.enemies) {
      if (!e.alive || !e.visible) continue;
      const hot = h && h.kind === 'foe' && h.foe === e && S.sel.size;
      ctx.globalAlpha = hot ? 1 : 0.6; ctx.strokeStyle = '#ef5350'; ctx.lineWidth = (hot ? 2.5 : 1.5) * px;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 4, 0, TAU); ctx.stroke();
    }
    if (h && h.kind === 'own') {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * px;
      ctx.beginPath(); ctx.arc(h.unit.x, h.unit.y, h.unit.radius + 7, 0, TAU); ctx.stroke();
    }
    if (h && h.kind === 'door' && S.sel.size) {
      // la porte visée : un cadre ambre (colonne, ou passage pour le groupe armé)
      const d = h.door, L = d.len * TILE / 2 + 3;
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2 * px;
      ctx.strokeRect(d.cx - (d.horizontal ? L : 10), d.cy - (d.horizontal ? 10 : L), d.horizontal ? 2 * L : 20, d.horizontal ? 20 : 2 * L);
    }
    ctx.restore();
  }

  // Les ordres en cours, par-dessus le brouillard : du chef de file à son but, puis aux étapes suivantes, à la couleur du
  // trinôme (vifs pour ceux qu'on a choisis) ; un point tenu, avec la direction à tenir ; l'adversaire attaqué, en rouge ;
  // la porte d'une colonne. Et l'ordre en train d'être tracé (clic droit maintenu).
  drawStratOrders() {
    const g = this.game, S = g.strat, ctx = this.ctx, px = this.dpr / this.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    g.war.slots.ops.forEach((grp, k) => {
      const o = grp && grp.order, lead = o && g.leaderOf(grp);
      if (!lead) return;
      const sel = S.sel.has(k), col = o.type === 'attack' ? '#ef5350' : grp.color;
      const pts = o.type === 'stack' ? [o.st ? { x: o.door.cx, y: o.door.cy } : o.front] : [o, ...grp.queue];
      ctx.globalAlpha = sel ? 0.85 : 0.3;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6 * px; ctx.setLineDash([6 * px, 5 * px]);
      if (o.type !== 'hold') {
        ctx.beginPath(); ctx.moveTo(lead.x, lead.y);
        for (const q of pts) ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      for (const q of pts.slice(0, -1)) { ctx.beginPath(); ctx.arc(q.x, q.y, 3 * px, 0, TAU); ctx.fill(); }
      const end = pts[pts.length - 1];
      if (o.type === 'attack') {
        // réticule sur la cible
        const r = 9 * px;
        ctx.lineWidth = 1.8 * px;
        ctx.beginPath(); ctx.arc(end.x, end.y, r, 0, TAU); ctx.stroke();
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(end.x + dx * r * 0.5, end.y + dy * r * 0.5); ctx.lineTo(end.x + dx * r * 1.5, end.y + dy * r * 1.5); }
        ctx.stroke();
      } else if (o.type === 'stack') {
        const d = o.door, L = d.len * TILE / 2 + 3;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(d.cx - (d.horizontal ? L : 9), d.cy - (d.horizontal ? 9 : L), d.horizontal ? 2 * L : 18, d.horizontal ? 18 : 2 * L);
      } else if (sel || o.type !== 'hold') {
        const last = grp.queue.length ? grp.queue[grp.queue.length - 1] : o;
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath(); ctx.arc(end.x, end.y, 6 * px + 3, 0, TAU); ctx.stroke();
        if (last.angle !== undefined && last.angle !== null) this.drawCoverArrow(end.x, end.y, last.angle, col, sel ? 0.75 : 0.3);
      }
    });
    // ordre en cours de tracé : son point et, tiré, la direction à tenir
    if (S.aim && g.input.mouse.rdown) {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#7fd18a'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath(); ctx.arc(S.aim.x, S.aim.y, 9 * px + 3, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      if (S.aim.angle !== null) this.drawCoverArrow(S.aim.x, S.aim.y, S.aim.angle, '#7fd18a', 0.9);
    }
    ctx.restore();
  }

  // À l'écran : le numéro de chaque trinôme au-dessus de son chef de file, la santé de vos hommes choisis, le rectangle de
  // sélection, et un liseré bleu pendant la pause tactique.
  drawStratScreen() {
    const g = this.game, S = g.strat, ctx = this.ctx, d = this.dpr;
    const scr = (x, y) => ({ x: x * this.zoom + this.tx, y: y * this.zoom + this.ty });
    ctx.save();
    g.war.slots.ops.forEach((grp, k) => {
      const lead = grp && g.leaderOf(grp);
      if (!lead) return;
      const sel = S.sel.has(k);
      for (const m of grp.members) {
        if (!sel || !m.alive || m.group !== grp) continue;
        const q = scr(m.x, m.y), w = 18 * d, y = q.y + (m.radius + 7) * this.zoom;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(q.x - w / 2 - d, y - d, w + 2 * d, 4 * d);
        ctx.fillStyle = m.hp > 60 ? '#4caf50' : m.hp > 30 ? '#ffb300' : '#ef5350';
        ctx.fillRect(q.x - w / 2, y, w * m.hp / m.maxHp, 2 * d);
      }
      const q = scr(lead.x, lead.y), s = 13 * d, x = q.x - s / 2, y = q.y - (lead.radius + 8) * this.zoom - s;
      ctx.globalAlpha = sel ? 1 : 0.75;
      ctx.fillStyle = grp.color; ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.7)'; ctx.lineWidth = (sel ? 1.5 : 1) * d; ctx.strokeRect(x, y, s, s);
      ctx.fillStyle = '#0b0d10'; ctx.font = `bold ${Math.round(10 * d)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(k + 1), q.x, y + s / 2 + 0.5 * d);
      ctx.globalAlpha = 1;
    });
    const b = S.box;
    if (b && (Math.abs(b.x1 - b.x0) > 0 || Math.abs(b.y1 - b.y0) > 0)) {
      const p = scr(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), q = scr(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      ctx.fillStyle = 'rgba(127,209,138,0.1)'; ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
      ctx.strokeStyle = 'rgba(127,209,138,0.85)'; ctx.lineWidth = d; ctx.strokeRect(p.x + 0.5, p.y + 0.5, q.x - p.x, q.y - p.y);
    }
    if (S.frozen) {
      ctx.strokeStyle = 'rgba(100,181,246,0.55)'; ctx.lineWidth = 6 * d;
      ctx.strokeRect(3 * d, 3 * d, this.canvas.width - 6 * d, this.canvas.height - 6 * d);
    }
    ctx.restore();
  }

  // Le curseur du commandant : une flèche ; un réticule rouge sur un adversaire (attaquer), un cadre ambre sur une porte
  // fermée (colonne ou passage), dès qu'un trinôme est choisi.
  drawStratCursor() {
    const g = this.game, S = g.strat, ctx = this.ctx, d = this.dpr, h = S.hover, sel = S.sel.size > 0;
    const x = this.mouse.sx * d, y = this.mouse.sy * d;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (sel && h && h.kind === 'foe') {
      const r = 9 * d;
      for (const [w, c] of [[4.5, 'rgba(0,0,0,0.6)'], [2.2, '#ef5350']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w * d;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * r * 0.45, y + dy * r * 0.45); ctx.lineTo(x + dx * r * 1.6, y + dy * r * 1.6); }
        ctx.stroke();
      }
    } else {
      const col = sel && h && h.kind === 'door' ? '#ffb347' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + 17 * d); ctx.lineTo(x + 4.5 * d, y + 13 * d); ctx.lineTo(x + 8 * d, y + 20 * d);
      ctx.lineTo(x + 11 * d, y + 18.5 * d); ctx.lineTo(x + 7.5 * d, y + 11.8 * d); ctx.lineTo(x + 12.5 * d, y + 11.8 * d);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.4 * d; ctx.stroke();
      if (col !== '#ffffff') { // porte : un petit battant à côté de la flèche
        ctx.fillStyle = col; ctx.fillRect(x + 14 * d, y + 4 * d, 3 * d, 12 * d);
        ctx.strokeRect(x + 14 * d, y + 4 * d, 3 * d, 12 * d);
      }
    }
    ctx.restore();
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

  // Charge de brèche posée : un boudin d'explosif collé au battant, une diode qui clignote. Celle de l'intervention
  // (siège) ne se voit que dans le champ de vision.
  drawCharges() {
    const ctx = this.ctx, g = this.game;
    for (const c of g.charges) {
      if (c.team && c.team !== g.player.team && !g.seesPoint(c.x, c.y)) continue;
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
    if (!g.player.alive && !g.player.dying && !g.player.commander) Sprites.body(this.ctx, g.player, { ...(g.player.style || STYLE_PLAYER), ...gunStyle(g.player.weapon), ...shieldStyle(g.player), plates: !!(g.player.vest && g.player.vest.plate) });
    for (const mt of g.mates) if (!mt.alive && !mt.dying) Sprites.body(this.ctx, mt, { ...mt.style, ...gunStyle(mt.weapon), ...shieldStyle(mt) });
    for (const h of g.hostages) if (!h.alive && h.bodySeen) Sprites.body(this.ctx, h, h.style || STYLE_HOSTAGE);
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
    // il vous a vu et va prévenir tout le monde : « ! » rouge, l'anneau se remplit jusqu'à l'alerte générale
    const g = this.game;
    if (e.spotT !== null && !g.alarm && g.alarms && !g.siege) {
      const ctx = this.ctx, k = clamp(e.spotT / ALARM_TIME, 0, 1), y = e.y - 21;
      ctx.save();
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(e.x, y, 7, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ef5350';
      ctx.beginPath(); ctx.arc(e.x, y, 7, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ef5350'; ctx.fillText('!', e.x, y + 0.5);
      ctx.restore();
    } else if (!e.target && !e.hunter && (e.state === 'investigate' || e.suspicion >= 0.5)) {
    // suspect alerté par un bruit : « ? » quand il va voir ou qu'il cherche, plus pâle quand il guette
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
  // Le polygone p (un cône de vision) a-t-il un point dans le rectangle v ? (par sa boîte englobante)
  static polyMeets(p, v) {
    let x0 = p.x, x1 = p.x, y0 = p.y, y1 = p.y;
    for (const q of p.pts) {
      if (q.x < x0) x0 = q.x; else if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y; else if (q.y > y1) y1 = q.y;
    }
    return x1 >= v.x && y1 >= v.y && x0 <= v.x + v.w && y0 <= v.y + v.h;
  }

  clipToVision() {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const p of this.shownPolys || this.game.visionPolys) {
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

  // Une balle traverse une pièce en une image : on en voit la trace, de là où elle était à là où elle est (ou à ce qui
  // l'a arrêtée), plus vive vers la pointe, qui s'efface en TRACER_LIFE s.
  drawBullets() {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const f of this.game.tracers) {
      const a = 1 - f.t / TRACER_LIFE;
      const grad = ctx.createLinearGradient(f.x0, f.y0, f.x1, f.y1);
      grad.addColorStop(0, 'rgba(255,220,140,0)');
      grad.addColorStop(0.7, `rgba(255,230,170,${(0.35 * a).toFixed(3)})`);
      grad.addColorStop(1, `rgba(255,244,210,${(0.95 * a).toFixed(3)})`);
      ctx.strokeStyle = grad; ctx.lineWidth = f.heavy ? 1.9 : 1.4;
      ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
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

  // Partie du monde à l'écran (pixels du monde, bornée à la carte) : le brouillard ne se recompose que là, ce qui garde
  // les grandes cartes (champs de bataille) aussi légères que les petites.
  viewRect() {
    const z = this.zoom, W = this.fogC.width, H = this.fogC.height;
    const x0 = clamp(Math.floor(-this.tx / z) - 4, 0, W), y0 = clamp(Math.floor(-this.ty / z) - 4, 0, H);
    const x1 = clamp(Math.ceil((this.canvas.width - this.tx) / z) + 4, x0 + 1, W), y1 = clamp(Math.ceil((this.canvas.height - this.ty) / z) + 4, y0 + 1, H);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  drawFog() {
    const g = this.game, m = g.map, f = this.fogC.getContext('2d'), v = this.viewRect();
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.save();
    f.beginPath(); f.rect(v.x, v.y, v.w, v.h); f.clip();
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = 'rgba(4,5,7,0.9)';
    f.fillRect(v.x, v.y, v.w, v.h);
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
    f.drawImage(this.exploredC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
    f.fillStyle = 'rgba(0,0,0,1)';
    for (const p of this.shownPolys || g.visionPolys) {
      f.beginPath(); f.moveTo(p.x, p.y);
      for (const q of p.pts) f.lineTo(q.x, q.y);
      f.closePath(); f.fill();
    }
    f.restore();
    this.ctx.drawImage(this.fogC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
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
    // escorte : la zone d'extraction bat en vert, explorée ou non (on sait où l'on va)
    if (g.escort && m.goal) this.drawGoalMini(t, m.goal);
    // vous escortez un otage : les sorties (portes extérieures et fenêtres) battent en vert
    if (g.hostages.some(h => !h.vip && h.escort === g.player && h.alive && !h.evacuated)) {
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 5);
      t.strokeStyle = `rgba(110,230,140,${0.55 + 0.4 * pulse})`; t.lineWidth = 1.6;
      for (const b of m.breaches) { t.beginPath(); t.arc(b.cx / TILE * s, b.cy / TILE * s, 4 + pulse * 2.5, 0, TAU); t.stroke(); }
    }
    // otage escorté : vert s'il vous suit, orange si l'intervention l'emmène (siège) ; le VIP en or
    for (const h of g.hostages) {
      if (!this.hostageShown(h)) continue;
      dot(h.x, h.y, h.vip ? 2.8 : 2.2, h.vip ? '#ffd54f' : !h.escort ? '#e8eef5' : h.escort.team === 'ops' ? '#9be7a6' : '#ffb347');
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
    // stratégie : vos trinômes choisis, cerclés de blanc
    if (g.strat) {
      t.strokeStyle = '#fff'; t.lineWidth = 1;
      g.war.slots.ops.forEach((grp, k) => {
        if (!grp || !g.strat.sel.has(k)) return;
        for (const mt of grp.members) if (mt.alive && mt.group === grp) { t.beginPath(); t.arc(mt.x / TILE * s, mt.y / TILE * s, 3.5, 0, TAU); t.stroke(); }
      });
    }
    // cadre à l'écran, en haut à droite
    const scale = clamp(this.canvas.width * 0.22 / this.miniTmpC.width, 0.4, 1.6);
    const w = this.miniTmpC.width * scale, h = this.miniTmpC.height * scale;
    // sous la barre du haut du HUD, pour ne pas croiser le chrono
    const pad = 10 * this.dpr, x0 = this.canvas.width - w - pad, y0 = 40 * this.dpr;
    this.miniRect = { x: x0, y: y0, w, h }; // (stratégie : un clic dessus y emmène la vue)
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(8,10,13,0.72)';
    ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
    ctx.strokeStyle = 'rgba(160,175,190,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 3.5, y0 - 3.5, w + 7, h + 7);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniTmpC, x0, y0, w, h);
    if (g.strat) {
      // la partie de la carte à l'écran
      const v = this.viewRect(), k = w / (m.w * TILE);
      ctx.globalAlpha = 0.8; ctx.strokeStyle = '#fff'; ctx.lineWidth = this.dpr;
      ctx.strokeRect(x0 + v.x * k, y0 + v.y * k, v.w * k, v.h * k);
    }
    ctx.restore();
  }

  drawCrosshair() {
    const g = this.game, p = g.player, ctx = this.ctx;
    const x = this.mouse.sx * this.dpr, y = this.mouse.sy * this.dpr;
    const w = p.weapon;
    // Le viseur montre l'erreur réelle à la distance du curseur : tan(dispersion) * distance (plus la gerbe d'une
    // chevrotine).
    const spread = g.spreadOf(p) + (w.pattern || 0);
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
    if (g.scoped(p)) {
      // lunette à l'œil : un cercle fin autour du réticule
      const r = gap + len + 6 * this.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3.5 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(130,215,235,0.9)'; ctx.lineWidth = 1.6 * this.dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    }
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
