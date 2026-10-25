'use strict';
// Game : le mode stratégie (le commandant et les ordres de ses trinômes).

// Stratégie : écart entre les points d'arrivée de trinômes envoyés ensemble au même endroit ; un chef de file arrivé à
// STRAT_ARRIVE de son point s'y arrête, et y retourne s'il en a été écarté de plus de STRAT_LEASH ; tolérance d'un clic
// sur un homme, en pixels d'écran.
const STRAT_SPACING = 2.6 * U, STRAT_ARRIVE = 0.3 * U, STRAT_LEASH = 0.9 * U, STRAT_PICK = 7;
// Grenades à fragmentation de chaque homme de vos trinômes d'intervention, en plus de ses flashs : elles ne partent que
// sur vos ordres (bouton, N, entrée à la grenade).
const STRAT_FRAGS = 1;
// Laissé à ratisser seul ou lancé à l'assaut, un groupe de votre armée ne lance de lui-même une grenade que sur un
// adversaire vu il y a moins de STRAT_NADE_FRESH s (pas sur un bruit ni un vieux contact), et un seul de ses hommes par
// STRAT_NADE_GAP s.
const STRAT_NADE_FRESH = 2, STRAT_NADE_GAP = 8;

mixGame(class {
  // ---- Stratégie ----
  // Vous commandez de haut les trois trinômes de votre armée (war.slots.ops), sans incarner personne : le clavier et la
  // souris donnent les ordres (updateCommander), chaque trinôme les exécute (orderStep). group.order vaut :
  //   null                                         il ratisse son couloir seul, comme en guerre totale ;
  //   { type: 'move', x, y, angle }                aller là, en file derrière son chef, puis tenir face à angle ;
  //   { type: 'hold', x, y, angle }                tenir : on tire sur ce qu'on voit, on ne poursuit personne ;
  //   { type: 'attack', foe, x, y }                aller au contact d'un adversaire, suivi tant que l'armée le voit ;
  //   { type: 'stack', door, side, front, tactic, st, wait }  en colonne sur une porte fermée ; en place, elle attend
  //                                                vos ordres (les boutons posés sur la porte, stratDoorMenus), puis entre.
  // group.queue : les déplacements à faire ensuite (Maj + clic droit) ; group.rush : au pas de course plutôt qu'au pas.

  // Un trinôme de votre armée qui a encore un homme debout.
  stratAlive(g) { return !!g && g.members.some(m => m.alive && m.group === g); }
  // L'effectif de votre armée au départ : celui des sortes de groupe choisies au briefing (loadout.army).
  armySize() { return this.loadout.army.reduce((t, a) => t + GROUP_TYPES[a.type].n, 0); }
  // Les trinômes choisis encore debout, dans l'ordre de leur numéro.
  stratSelected() { return [...this.strat.sel].sort().map(k => this.war.slots.ops[k]).filter(g => this.stratAlive(g)); }
  // « Alpha », « Alpha et Delta », « Alpha, Delta et Golf ».
  stratNames(gs) {
    const n = gs.map(g => g.label);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0] || '';
  }
  stratNone() { this.say('Aucun groupe choisi — clic gauche sur l’un de vos hommes, ou 1, 2, 3 (A : tous)', 2.2); }

  // Clavier et souris du commandant, à chaque image, pause tactique comprise (dt : le temps réel).
  updateCommander(dt) {
    const S = this.strat, inp = this.input, pr = inp.pressed, k = inp.keys, m = inp.mouse;
    const ppx = m.ppx || 1, shift = !!(k.ShiftLeft || k.ShiftRight);
    S.clock = (S.clock || 0) + (dt || 0);
    S.hover = m.ui ? null : this.stratHover(m.x, m.y, ppx); // (le curseur sur la barre latérale ne désigne rien)
    // le menu de la zone (double clic droit) : la molette choisit, E ou un clic sur la ligne valide, tout autre clic le ferme
    if (S.zone && this.stratZoneInput(S.zone)) return;
    // les boutons posés sur les portes où une colonne attend vos ordres prennent d'abord le clic qui leur revient
    // (input.mouse.item : { door, id }, la ligne sous le curseur, voir Renderer.menuItemAt)
    S.menus = this.stratDoorMenus();
    if (pr.Mouse0 && m.item) {
      const mn = S.menus.find(q => q.door === m.item.door), it = mn && mn.items.find(q => q.id === m.item.id);
      if (it) { this.menuPick(it); S.menus = this.stratDoorMenus(); } // (le choix fait, les boutons changent)
      delete pr.Mouse0;
    }
    // grenade à lancer (bouton de la barre latérale) : le clic suivant dit où ; le clic droit renonce
    if (S.nadeAim) {
      if (pr.Mouse2) { S.nadeAim = null; delete pr.Mouse2; this.say('Lancer annulé', 1); }
      else if (pr.Mouse0 && !m.mini) {
        if (this.stratGrenade(this.stratSelected(), m.x, m.y, S.nadeAim)) S.nadeAim = null;
        delete pr.Mouse0;
      }
    }
    if (pr.Space) this.stratFreeze();
    for (let i = 0; i < 3; i++) if (pr['Digit' + (i + 1)] || pr['Numpad' + (i + 1)]) this.stratKey(i, shift);
    if (pr.KeyQ) this.stratAll(); // (A sur un clavier AZERTY)
    if (pr.KeyF) this.stratFocus();
    if (pr.WheelUp) S.zoom++;
    if (pr.WheelDown) S.zoom--;
    // clic gauche : sur la minimap, la vue y va (et la suit tant qu'on maintient) ; ailleurs, on choisit (un clic sur un
    // homme, ou un rectangle glissé)
    if (pr.Mouse0 && m.mini) S.miniDrag = true;
    if (S.miniDrag) {
      if (m.down || pr.Mouse0) S.camTo = { x: m.x, y: m.y, now: true };
      if (!m.down) S.miniDrag = false;
    } else {
      if (pr.Mouse0) S.box = { x0: m.x, y0: m.y, x1: m.x, y1: m.y };
      if (S.box) {
        S.box.x1 = m.x; S.box.y1 = m.y;
        if (pr.Mouse0Up || !m.down) { this.stratPick(S.box, shift, ppx); S.box = null; }
      }
    }
    // clic droit : l'ordre part à la relâche ; maintenu et tiré, il fixe la direction à tenir à l'arrivée. Un second clic
    // au même endroit avant DOUBLE_RIGHT ouvre le menu de la zone (stratZoneMenu) : l'ordre d'un clic simple attend donc
    // ce délai (S.click), sauf une direction tirée, qui part tout de suite
    const rc = S.click, near = Math.max(DOUBLE_RIGHT_GAP, 12 * ppx);
    if (pr.Mouse2 && rc && S.clock - rc.t <= DOUBLE_RIGHT && dist(rc.x, rc.y, m.x, m.y) <= near) {
      S.click = null; S.aim = null;
      this.stratOpenZone(rc.x, rc.y, rc.hover);
      return;
    }
    if (pr.Mouse2) { S.aim = { x: m.x, y: m.y, angle: null, hover: S.hover }; S.click = { t: S.clock, x: m.x, y: m.y, hover: S.hover, a: null }; }
    if (S.aim && m.rdown) {
      const d = dist(S.aim.x, S.aim.y, m.x, m.y);
      S.aim.angle = d >= 0.7 * U ? Math.atan2(m.y - S.aim.y, m.x - S.aim.x) : null;
    }
    if (S.aim && (pr.Mouse2Up || !m.rdown)) {
      const a = S.aim;
      S.aim = null;
      if (a.angle !== null || !S.click) this.stratRightClick(a, shift);
      else Object.assign(S.click, { a, shift });
    }
    if (S.click && S.clock - S.click.t > DOUBLE_RIGHT) { const c = S.click; S.click = null; if (c.a) this.stratRightClick(c.a, c.shift); }
    if (pr.KeyH) this.stratHold();
    if (pr.KeyR) this.stratSweep();
    if (pr.KeyC) this.stratRush();
    if (pr.KeyG) this.stratGrenadeKey(m.x, m.y, this.camp === 'armed' ? 'frag' : 'flash');
    if (pr.KeyN) this.stratGrenadeKey(m.x, m.y, 'frag');
    if (pr.KeyB) this.stratChargeKey();
  }

  // ---- Barre latérale ----
  // Les ordres aux trinômes choisis et ceux de toute l'armée, tels que la barre latérale les montre (UI.updateStrategy) :
  // { id, label, key, icon, count, off (raison, si impossible), on (en cours), sec (la section) }.
  stratCommands() {
    const S = this.strat, gs = this.stratSelected(), none = gs.length ? null : 'aucun groupe choisi', police = this.camp === 'police';
    const men = gs.flatMap(g => g.members.filter(m => m.alive && m.group === g));
    const n = kind => men.reduce((t, m) => t + (m.nades[kind] || 0), 0);
    const all = [0, 1, 2].filter(i => this.stratAlive(this.war.slots.ops[i]));
    return [
      { sec: 'orders', id: 'hold', label: 'Tenir', key: 'H', off: none },
      { sec: 'orders', id: 'sweep', label: 'Ratisser', key: 'R', off: none || (gs.every(g => !g.order) ? 'ils ratissent déjà' : null) },
      { sec: 'orders', id: 'rush', label: 'Pas de course', key: 'C', off: none, on: gs.length > 0 && gs.every(g => g.rush) },
      { sec: 'orders', id: 'focus', label: 'Centrer la vue', key: 'F', off: none },
      { sec: 'orders', id: 'flash', label: 'Grenade aveuglante', key: 'G', icon: 'flash', count: police ? n('flash') : null,
        off: !police ? 'aucune dans ce camp' : none || (n('flash') ? null : 'plus de flash'), on: S.nadeAim === 'flash' },
      { sec: 'orders', id: 'frag', label: 'Grenade explosive', key: police ? 'N' : 'G', icon: 'frag', count: n('frag'),
        off: none || (n('frag') ? null : 'plus de grenade'), on: S.nadeAim === 'frag' },
      { sec: 'army', id: 'all', label: 'Toute l’armée', key: 'A', off: !all.length ? 'personne de debout' : all.every(i => S.sel.has(i)) ? 'déjà choisie' : null },
      { sec: 'army', id: 'pause', label: S.frozen ? 'Reprendre' : 'Pause', key: 'Espace', on: S.frozen },
      { sec: 'army', id: 'minimap', label: 'Minimap', key: 'M', on: this.minimap },
    ];
  }

  // Un bouton de la barre latérale (id : celui de stratCommands, ou sel0..sel2 pour un trinôme : le choisir, Maj : en
  // plus). Un bouton grisé dit pourquoi.
  stratCommand(id) {
    const S = this.strat, k = this.input.keys;
    if (!S || this.over) return;
    if (/^sel\d$/.test(id)) { this.stratKey(+id.slice(3), !!(k.ShiftLeft || k.ShiftRight)); return; }
    const c = this.stratCommands().find(o => o.id === id);
    if (!c) return;
    if (c.off) { this.say(`${c.label} : ${c.off}`, 1.4); return; }
    Sound.tick(0.05);
    if (id === 'hold') this.stratHold();
    else if (id === 'sweep') this.stratSweep();
    else if (id === 'rush') this.stratRush();
    else if (id === 'focus') this.stratFocus();
    else if (id === 'all') this.stratAll();
    else if (id === 'pause') this.stratFreeze();
    else if (id === 'minimap') this.toggleMinimap();
    else if (id === 'flash' || id === 'frag') {
      S.nadeAim = S.nadeAim === id ? null : id;
      if (S.nadeAim) this.say(`${c.label} : cliquez où la lancer (clic droit : annuler)`, 2);
    }
  }

  // Les boutons posés sur chaque porte où l'un de vos trinômes choisis, en colonne, attend vos ordres : entrer, poser
  // une charge, entrer à la flash, à la grenade ; la charge posée, ce qui suit sa mise à feu (voir stackMenu). Un
  // groupe qu'on n'a pas choisi n'en montre pas (sa carte, dans la barre latérale, dit qu'il attend).
  stratDoorMenus() {
    const out = [];
    for (const [k, g] of this.war.slots.ops.entries()) {
      if (!this.strat.sel.has(k)) continue;
      const st = this.stratAlive(g) && g.order && g.order.type === 'stack' ? g.order.st : null;
      if (!st || !this.hunt.stacks.includes(st) || !this.stackWaits(st)) continue;
      const mn = { kind: 'stack', door: st.door, st, group: g, title: '', items: [] };
      this.menuItems(mn);
      out.push(mn);
    }
    return out;
  }

  // Espace : pause tactique, ou reprise.
  stratFreeze() {
    const S = this.strat;
    S.frozen = !S.frozen;
    this.say(S.frozen ? 'Pause tactique — donnez vos ordres, Espace pour reprendre' : 'Reprise', 1.6);
  }

  // A (AZERTY ; Q en QWERTY) : toute l'armée.
  stratAll() {
    const S = this.strat;
    S.sel = new Set([0, 1, 2].filter(i => this.stratAlive(this.war.slots.ops[i])));
    this.say(S.sel.size ? 'Toute l’armée' : 'Personne de debout : les renforts arrivent', 1.2);
  }

  // Ce qu'il y a sous le curseur : un adversaire en vue, l'un de vos hommes, ou une porte fermée.
  stratHover(x, y, ppx) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || !e.visible) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < e.radius + STRAT_PICK * ppx && d < bd) { bd = d; best = e; }
    }
    if (best) return { kind: 'foe', foe: best };
    const own = this.stratUnitAt(x, y, ppx);
    if (own) return { kind: 'own', unit: own };
    const d = this.doorAtPoint(x, y);
    return d && !d.broken && !this.map.doorPassable(d) ? { kind: 'door', door: d } : null;
  }

  // L'homme de votre armée, debout, le plus proche du point (à STRAT_PICK pixels d'écran près).
  stratUnitAt(x, y, ppx) {
    let best = null, bd = Infinity;
    for (const g of this.war.slots.ops) {
      if (!g) continue;
      for (const m of g.members) {
        if (!m.alive || m.group !== g) continue;
        const d = dist(x, y, m.x, m.y);
        if (d < m.radius + STRAT_PICK * ppx && d < bd) { bd = d; best = m; }
      }
    }
    return best;
  }

  // 1, 2, 3 : ce trinôme seul (Maj : l'ajouter, ou le retirer) ; deux fois de suite, la vue va sur lui.
  stratKey(i, shift) {
    const S = this.strat;
    if (!this.stratAlive(this.war.slots.ops[i])) { this.say(`Groupe ${i + 1} anéanti${this.war.defense ? '' : ' — il revient de la base'}`, 1.4); return; }
    if (shift) { if (S.sel.has(i)) S.sel.delete(i); else S.sel.add(i); }
    else {
      const again = S.sel.size === 1 && S.sel.has(i) && S.clock - S.keyAt[i] < 0.4;
      S.sel = new Set([i]);
      if (again) this.stratFocus();
    }
    S.keyAt[i] = S.clock;
    Sound.tick(0.05);
  }

  // Fin d'un clic gauche : un clic sur un homme choisit son trinôme (Maj : l'ajoute ou le retire), dans le vide il ne
  // choisit plus rien ; un rectangle choisit tous les trinômes dont un homme s'y trouve (Maj : en plus).
  stratPick(b, shift, ppx) {
    const S = this.strat, small = Math.abs(b.x1 - b.x0) < 6 * ppx && Math.abs(b.y1 - b.y0) < 6 * ppx;
    const ks = [];
    if (small) {
      const u = this.stratUnitAt(b.x1, b.y1, ppx);
      if (u) ks.push(u.group.slot);
    } else {
      const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
      this.war.slots.ops.forEach((g, k) => {
        if (g && g.members.some(m => m.alive && m.group === g && m.x >= x0 - m.radius && m.x <= x1 + m.radius && m.y >= y0 - m.radius && m.y <= y1 + m.radius)) ks.push(k);
      });
    }
    if (!shift) S.sel = new Set(ks);
    else if (small) for (const k of ks) { if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k); }
    else for (const k of ks) S.sel.add(k);
    if (ks.length) Sound.tick(0.05);
  }

  // Clic droit relâché : sur un adversaire en vue, l'attaquer ; sur une porte fermée, s'y mettre en colonne (en place,
  // le trinôme attend vos ordres : les boutons de la porte) ; ailleurs, y aller (Maj : après le déplacement en cours).
  stratRightClick(a, shift) {
    const gs = this.stratSelected();
    if (!gs.length) { this.stratNone(); return; }
    const h = a.hover;
    if (h && h.kind === 'foe' && h.foe.alive) this.stratAttack(gs, h.foe);
    else if (h && h.kind === 'door' && !shift) this.stratDoor(gs, h.door, 'choose');
    else this.stratMove(gs, a.x, a.y, a.angle, shift);
    Sound.tick(0.08);
  }

  // ---- Menu de la zone (double clic droit) ----
  // Ce que les groupes choisis peuvent faire au point cliqué : y lancer une flash ou une grenade (celui qui a une
  // trajectoire libre), l'attaquer s'il y a un adversaire en vue, s'y mettre en colonne sur une porte fermée, y aller.
  // Comme le menu de E à pied : la molette choisit, E valide ; un clic sur une ligne la valide aussi.
  stratOpenZone(x, y, hover) {
    const gs = this.stratSelected();
    if (!gs.length) { this.stratNone(); return null; }
    const mn = this.strat.zone = { kind: 'zone', at: { x, y }, hover, sel: null, title: '', items: [] };
    this.stratZoneMenu(mn);
    const first = mn.items.find(it => it.id !== 'cancel' && !it.off) || mn.items.find(it => it.id !== 'cancel');
    mn.sel = first ? first.id : 'cancel';
    Sound.tick(0.05);
    return mn;
  }

  stratZoneMenu(mn) {
    const gs = this.stratSelected(), at = mn.at, h = mn.hover, police = this.camp === 'police', items = [];
    const add = (id, label, key, off, run) => items.push({ id, label, key: key || '', off: off || null, run });
    mn.title = this.stratNames(gs) || 'Ici';
    add('cancel', 'Annuler', '', null, () => {});
    for (const kind of police ? ['flash', 'frag'] : ['frag']) {
      const t = gs.length ? this.stratThrower(gs, at.x, at.y, kind) : { why: 'aucun groupe choisi' };
      add('g' + kind, `${kind === 'frag' ? 'Grenade explosive' : 'Grenade aveuglante'} ici`, kind === 'frag' && police ? 'N' : 'G', t.why,
        () => this.stratGrenade(this.stratSelected(), at.x, at.y, kind));
    }
    if (h && h.kind === 'foe' && h.foe.alive) add('attack', 'Attaquer', 'clic droit', null, () => this.stratAttack(this.stratSelected(), h.foe));
    if (h && h.kind === 'door') add('stack', 'En colonne sur la porte', 'clic droit', null, () => this.stratDoor(this.stratSelected(), h.door, 'choose'));
    add('move', 'Y aller', h ? '' : 'clic droit', null, () => this.stratMove(this.stratSelected(), at.x, at.y, null, false));
    add('rush', 'Y aller au pas de course', '', null, () => { const sent = this.stratMove(this.stratSelected(), at.x, at.y, null, false); for (const g of sent) g.rush = true; });
    mn.items = items;
    return items;
  }

  // À chaque image, le menu de la zone ouvert : true quand il a pris la main (l'entrée n'en fait rien d'autre).
  stratZoneInput(mn) {
    const S = this.strat, pr = this.input.pressed, m = this.input.mouse;
    if (!this.stratSelected().length) { S.zone = null; return false; }
    this.stratZoneMenu(mn); // (ce qui est possible change : un lanceur bouge, une grenade part)
    const dir = (pr.WheelDown ? 1 : 0) - (pr.WheelUp ? 1 : 0);
    let i = Math.max(0, mn.items.findIndex(it => it.id === mn.sel));
    if (dir) for (let j = i + dir; j >= 0 && j < mn.items.length; j += dir) if (!mn.items[j].off) { i = j; Sound.tick(0.04); break; }
    mn.sel = mn.items[i].id;
    const clicked = pr.Mouse0 && m.item && m.item.zone ? mn.items.find(it => it.id === m.item.id) : null;
    const pick = clicked || (pr.KeyE ? mn.items[i] : null);
    if (pick) {
      if (pick.off) { this.say(`${pick.label} : ${pick.off}`, 1.4); }
      else { S.zone = null; pick.run(); }
    } else if (pr.Mouse0 || pr.Mouse2 || pr.Escape) S.zone = null; // (un autre clic ferme le menu, sans rien faire d'autre)
    else if (!dir) return false;
    for (const code of ['WheelUp', 'WheelDown', 'KeyE', 'Mouse0', 'Mouse2']) delete pr[code];
    return true;
  }

  // Déplacement : chaque trinôme va près du point, côte à côte s'ils sont plusieurs (STRAT_SPACING), chacun gardant son
  // côté de la marche pour ne pas croiser les autres ; arrivé, il tient, face à angle (sinon dans le sens de sa marche).
  // queue : à la suite de son déplacement en cours. Renvoie les trinômes envoyés.
  stratMove(gs, x, y, angle, queue, quiet) {
    const anchors = gs.map(g => this.anchorOf(g));
    const cx = anchors.reduce((s, q) => s + q.x, 0) / gs.length, cy = anchors.reduce((s, q) => s + q.y, 0) / gs.length;
    const dir = Math.atan2(y - cy, x - cx), px = -Math.sin(dir), py = Math.cos(dir);
    const row = gs.map((g, i) => ({ g, lat: (anchors[i].x - cx) * px + (anchors[i].y - cy) * py })).sort((p, q) => p.lat - q.lat);
    const sent = [];
    row.forEach(({ g }, i) => {
      const off = (i - (gs.length - 1) / 2) * STRAT_SPACING;
      const spot = this.freeSpotNear(x + px * off, y + py * off) || this.freeSpotNear(x, y);
      if (!spot) return;
      const after = queue && g.order && g.order.type === 'move';
      const from = after ? g.queue[g.queue.length - 1] || g.order : this.anchorOf(g);
      const o = { type: 'move', x: spot.x, y: spot.y, angle: angle !== null && angle !== undefined ? angle : Math.atan2(spot.y - from.y, spot.x - from.x) };
      if (after) g.queue.push(o);
      else { this.releaseGroup(g); g.order = o; g.queue = []; }
      sent.push(g);
    });
    if (quiet) return sent;
    if (!sent.length) this.say('Point inaccessible', 1.2);
    else this.say(`${this.stratNames(sent)} : ${queue ? 'puis par là' : 'en route'}`, 1.4);
    return sent;
  }

  // Case libre la plus proche de (x, y), à R petites cases au plus, où un homme tient sans toucher de mur ni de meuble.
  freeSpotNear(x, y, R = 6) {
    const m = this.map, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    let best = null, bd = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!m.inBounds(tx, ty) || m.tile(tx, ty) !== 0 || m.blocksMove(tx, ty) || m.door(tx, ty)) continue;
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      if (!m.circleFree(px, py, 12, false)) continue;
      const d = dist(px, py, x, y);
      if (d < bd) { bd = d; best = { x: px, y: py }; }
    }
    return best;
  }

  // H : chacun des trinômes choisis (gs : ceux-là) tient là où il est, face à où regarde son chef.
  stratHold(gs = this.stratSelected()) {
    if (!gs.length) { this.stratNone(); return; }
    for (const g of gs) {
      const l = this.leaderOf(g);
      this.releaseGroup(g);
      g.order = { type: 'hold', x: l.x, y: l.y, angle: l.angle };
      g.queue = [];
    }
    this.say(`${this.stratNames(gs)} : on tient ici`, 1.4);
  }

  // R : plus d'ordre, le trinôme ratisse son couloir seul (et va d'abord à son dernier contact, s'il en a un).
  stratSweep(gs = this.stratSelected()) {
    if (!gs.length) { this.stratNone(); return; }
    for (const g of gs) { this.releaseGroup(g); Object.assign(g, { order: null, queue: [], sweepTo: null, pickAt: 0 }); }
    this.say(`${this.stratNames(gs)} : ${this.war.defense ? 'ratissez le terrain' : 'ratissez votre couloir'}`, 1.4);
  }

  // C : au pas de course (plus vite, mais les pas s'entendent), ou de nouveau au pas.
  stratRush(gs = this.stratSelected()) {
    if (!gs.length) { this.stratNone(); return; }
    const on = !gs.every(g => g.rush);
    for (const g of gs) g.rush = on;
    this.say(`${this.stratNames(gs)} : ${on ? 'au pas de course' : 'au pas, sans bruit'}`, 1.4);
  }

  // Clic droit sur un adversaire en vue : les trinômes choisis vont à son contact et le poursuivent.
  stratAttack(gs, foe) {
    for (const g of gs) {
      this.releaseGroup(g);
      g.order = { type: 'attack', foe, x: foe.x, y: foe.y };
      g.queue = [];
      this.know(this.leaderOf(g), foe.x, foe.y, foe);
    }
    this.say(`${this.stratNames(gs)} : à l’assaut !`, 1.4);
  }

  // Une porte fermée : le trinôme choisi le plus proche s'y met en colonne (tactic : 'choose', il attend vos ordres une
  // fois en place ; 'flash', 'frag', 'charge' : il entre ainsi, la charge posée il attend de savoir ce qui suit ; 'auto' :
  // comme l'IA), ou, faute de place devant elle, la franchit en l'ouvrant ; les autres viennent derrière lui, de ce côté.
  stratDoor(gs, d, tactic) {
    const near = this.stratByDistance(gs, d.cx, d.cy);
    const { g, at } = near[0];
    const side = Math.sign(d.horizontal ? at.y - d.cy : at.x - d.cx) || 1, inn = this.doorInside(d, side);
    const front = this.doorFront(d, side);
    this.releaseGroup(g);
    g.queue = [];
    if (!front) {
      g.order = { type: 'move', x: inn.x, y: inn.y, angle: inn.angle };
      this.say(`${g.label} : on passe la porte`, 1.4);
    } else {
      g.order = { type: 'stack', door: d, side, front, tactic, st: null, wait: 0 };
      const how = { flash: ', entrée à la flash', frag: ', entrée à la grenade', charge: ', charge sur la porte' }[tactic] || '';
      this.say(`${g.label} : en colonne sur la porte${how}`, 1.8);
    }
    if (near.length > 1 && front) this.stratMove(near.slice(1).map(o => o.g), front.x - Math.cos(inn.angle) * 2 * U, front.y - Math.sin(inn.angle) * 2 * U, inn.angle, false, true);
  }

  // Les trinômes, du plus proche au plus loin du point (à leur homme le plus central, anchorOf), avec cet ancrage.
  stratByDistance(gs, x, y) {
    return gs.map(g => ({ g, at: this.anchorOf(g) })).sort((p, q) => dist(p.at.x, p.at.y, x, y) - dist(q.at.x, q.at.y, x, y));
  }

  // Où entrer de l'autre côté de la porte d (side : le côté d'où l'on vient), tourné vers la pièce ; et où se tenir
  // devant elle, de son côté (null s'il n'y a pas la place).
  doorInside(d, side) {
    const ix = d.horizontal ? 0 : -side, iy = d.horizontal ? -side : 0;
    const x = d.cx + ix * 1.8 * U, y = d.cy + iy * 1.8 * U, q = this.freeSpotNear(x, y, 4) || { x, y };
    return { x: q.x, y: q.y, angle: Math.atan2(iy, ix) };
  }
  doorFront(d, side) {
    const ix = d.horizontal ? 0 : -side, iy = d.horizontal ? -side : 0;
    return this.freeSpotNear(d.cx - ix * 1.4 * U, d.cy - iy * 1.4 * U, 4);
  }

  // G (une flash ; le groupe armé : une grenade), N (une grenade à fragmentation) : sur une porte fermée, on y entre
  // ainsi ; ailleurs, elle part vers le curseur.
  stratGrenadeKey(x, y, kind) {
    const gs = this.stratSelected(), h = this.strat.hover;
    if (!gs.length) { this.stratNone(); return; }
    if (h && h.kind === 'door') this.stratDoor(gs, h.door, kind);
    else this.stratGrenade(gs, x, y, kind);
  }

  // La grenade (kind : 'flash' ou 'frag') part de celui des hommes choisis qui en a une et une trajectoire libre jusqu'au
  // point (sept cases au plus), le plus près ; une grenade à fragmentation ne part pas sur les vôtres. true : elle part.
  stratGrenade(gs, x, y, kind = this.camp === 'armed' ? 'frag' : 'flash') {
    const best = this.stratThrower(gs, x, y, kind).m || null, frag = kind === 'frag';
    if (!best) {
      const any = gs.some(g => g.members.some(m => m.alive && m.group === g && m.nades[kind] > 0));
      this.say(any ? 'Personne n’a de trajectoire libre jusque-là (sept cases au plus)' : frag ? 'Plus de grenade explosive dans ces groupes' : 'Plus de flash dans ces groupes', 2);
      return false;
    }
    if (frag && this.ops.some(o => o.alive && dist(o.x, o.y, x, y) < FRAG_RADIUS + 0.5 * U)) { this.say('Trop près des vôtres pour une grenade à fragmentation', 2); return false; }
    best.nades[kind]--;
    best.flashCd = Math.max(best.flashCd || 0, 6); // (il ne relance pas de lui-même dans la foulée)
    best.path = [];
    this.startAction(best, 'grenade', 0.5, () => this.spawnFlash(best, x, y, undefined, undefined, kind));
    this.voice(best, kind);
    this.say(`${best.name} : ${frag ? 'grenade' : 'flash'} !`, 1.2);
    return true;
  }

  // Celui des hommes choisis qui lancera là une grenade de cette sorte ({ m }), ou pourquoi personne ({ why }).
  stratThrower(gs, x, y, kind) {
    let best = null, bd = Infinity, any = false;
    for (const g of gs) for (const m of g.members) {
      if (!m.alive || m.group !== g || !(m.nades[kind] > 0)) continue;
      any = true;
      if (m.act || m.stun > 0 || m.entry) continue;
      const d = dist(m.x, m.y, x, y);
      if (d < 1.5 * U || d > 7 * U || d >= bd || !this.clearThrow(m.x, m.y, x, y)) continue;
      bd = d; best = m;
    }
    if (!best) return { why: !any ? (kind === 'frag' ? 'plus de grenade explosive' : 'plus de flash') : 'personne n’a de trajectoire libre (sept cases au plus)' };
    if (kind === 'frag' && this.ops.some(o => o.alive && dist(o.x, o.y, x, y) < FRAG_RADIUS + 0.5 * U)) return { m: best, why: 'trop près des vôtres' };
    return { m: best };
  }

  // B : sur une porte fermée, l'intervention y pose une charge (puis attend de savoir comment entrer).
  stratChargeKey() {
    if (this.camp !== 'police') { this.say('Pas de charge de brèche dans ce camp', 1.4); return; }
    const gs = this.stratSelected(), h = this.strat.hover;
    if (!gs.length) { this.stratNone(); return; }
    if (!h || h.kind !== 'door') { this.say('B : visez une porte fermée', 1.4); return; }
    this.stratDoor(gs, h.door, 'charge');
  }

  // F (ou deux fois le même numéro) : la vue va sur les trinômes choisis (gs : sur ceux-là).
  stratFocus(gs = this.stratSelected()) {
    const ms = gs.flatMap(g => g.members.filter(m => m.alive && m.group === g));
    if (!ms.length) { this.stratNone(); return; }
    this.strat.camTo = { x: ms.reduce((s, m) => s + m.x, 0) / ms.length, y: ms.reduce((s, m) => s + m.y, 0) / ms.length };
  }

  // Un nouvel ordre : le trinôme lâche ce qu'il faisait (sa colonne se défait, son angle de pièce, sa fouille).
  releaseGroup(g) {
    for (const e of g.members) {
      if (e.entry) this.dropStack(e.entry);
      Object.assign(e, { clear: null, path: [], repathT: 0, formAt: null, holdT: 0, waitDoor: null });
    }
    g.search = null;
    g.waitT = 0;
  }

  // Un trinôme sous vos ordres : le chef de file mène où l'ordre l'envoie, les deux autres le suivent en file
  // (followStep) ; arrêté, le trinôme tient, en ligne, face à la direction donnée. Arrivé au bout d'un déplacement, il
  // passe au suivant (queue) ou tient.
  orderStep(g, e, dt) {
    if (g.order.type === 'stack' && this.stackOrderStep(g, g.order, e, dt)) return;
    if (g.order.type === 'attack') this.trackFoe(g, g.order);
    const o = g.order, lead = this.leaderOf(g);
    if (lead !== e) { this.followStep(e, lead, dt); return; }
    if (o.type === 'hold') { this.holdStep(g, e, o, dt); return; }
    // arrivé : sur le point, ou tout près au bout du chemin tracé vers lui (quelqu'un s'y tient déjà)
    const d = dist(e.x, e.y, o.x, o.y), to = e.path.to;
    if (d < STRAT_ARRIVE || (d < 1.2 * U && !e.path.length && to && to.x === o.x && to.y === o.y)) {
      const at = d < STRAT_ARRIVE ? o : e; // (la place prise : il tient où il s'est arrêté)
      g.order = g.queue.length ? g.queue.shift() : { type: 'hold', x: at.x, y: at.y, angle: o.angle === undefined ? e.angle : o.angle };
      return;
    }
    this.leadTo(g, e, o, dt, o.type === 'attack');
  }

  // Ordre d'attaque : on suit l'adversaire tant que quelqu'un de l'armée le voit ; abattu, on tient là où l'on est.
  trackFoe(g, o) {
    const f = o.foe;
    if (f.alive) { if (f.visible) { o.x = f.x; o.y = f.y; } return; }
    const l = this.leaderOf(g);
    g.order = g.queue.length ? g.queue.shift() : { type: 'hold', x: l.x, y: l.y, angle: l.angle };
    this.say(`${g.label} : cible abattue`, 1.4);
  }

  // Le chef tient le point (il y revient si on l'en a écarté), et regarde dans la direction donnée.
  holdStep(g, e, o, dt) {
    if (dist(e.x, e.y, o.x, o.y) > STRAT_LEASH) { this.leadTo(g, e, o, dt, false); return; }
    e.path = []; e.moving = false;
    e.moveDir = o.angle;
    // (le regard balaie un peu de part et d'autre ; un tireur à lunette, lui, garde l'axe donné, l'œil posé)
    const sway = e.weapon && e.weapon.scope ? 0 : 0.3;
    if (!e.target && e.alertAngle === null) turnToward(e, o.angle + Math.sin(this.time * 0.6) * sway, e.turnRate * 0.5, dt);
  }

  // Le chef d'un trinôme sous vos ordres va vers goal : au pas, en marquant les portes et en attendant les siens, ou au
  // pas de course (rush, l'ordre du trinôme, ou l'adversaire vu à l'instant). Point injoignable : le trinôme tient où il est.
  leadTo(g, e, goal, dt, rush) {
    const to = e.path.to;
    if (!e.path.length || e.repathT <= 0 || !to || dist(to.x, to.y, goal.x, goal.y) > 0.5 * U) {
      e.path = this.pathTo(e, goal.x, goal.y);
      // (tout près, sans chemin tracé : droit dessus, si rien n'est entre)
      if (!e.path.length && dist(e.x, e.y, goal.x, goal.y) <= 1.2 * U && this.map.segmentFree(e.x, e.y, goal.x, goal.y, e.radius - 1)) e.path = [{ x: goal.x, y: goal.y }];
      e.path.to = { x: goal.x, y: goal.y };
      e.repathT = 1.2;
      if (!e.path.length) {
        g.order = { type: 'hold', x: e.x, y: e.y, angle: e.angle };
        g.queue = [];
        this.say(`${g.label} : point injoignable, on tient ici`, 2);
        return;
      }
    }
    if (this.waitsForGroup(e, dt)) { e.moving = false; return; }
    const c = g.contact, hot = c && c.seen && this.time - c.t < 2;
    if (!rush && !g.rush && !hot) { e.pace = SQUAD_PACE; this.doorPause(e, g); }
    this.moveAlong(e, dt);
  }

  // Ordre de colonne (intervention) : le chef gagne le devant de la porte, de son côté, puis le trinôme s'y met en
  // colonne et entre comme ses colonnes autonomes (formStack, updateAiStack), de la manière demandée s'il en a encore le
  // moyen. Entré, il tient la pièce ; la colonne défaite (porte qui résiste), il passe la porte comme elle vient. true :
  // l'homme e est servi.
  stackOrderStep(g, o, e, dt) {
    const d = o.door, inn = () => this.doorInside(d, o.side);
    if (o.st) {
      if (this.hunt.stacks.includes(o.st)) {
        if (e.entry !== o.st) { e.path = []; e.moving = false; } // (resté hors de la colonne : il attend)
        return true;
      }
      const q = inn(), open = d.broken || this.map.doorPassable(d);
      g.order = open && g.queue.length ? g.queue.shift() : { type: open ? 'hold' : 'move', x: q.x, y: q.y, angle: q.angle };
      return false;
    }
    if (d.broken || this.map.doorPassable(d)) { // ouverte entre-temps : on entre tout de suite
      const q = inn();
      g.order = { type: 'move', x: q.x, y: q.y, angle: q.angle };
      return false;
    }
    if (this.leaderOf(g) !== e) return false;
    if (dist(e.x, e.y, o.front.x, o.front.y) > 1.2 * U) { this.leadTo(g, e, o.front, dt, false); return true; }
    // devant la porte : la colonne se forme avec ceux qui sont là (on attend un peu ceux qui traînent)
    e.path = []; e.moving = false;
    const alive = g.members.filter(m => m.alive && m.group === g);
    const team = alive.filter(m => !m.entry && !(m.stun > 0) && dist(m.x, m.y, d.cx, d.cy) < AI_STACK_RANGE);
    if (team.length < alive.length && (o.wait += dt) < SQUAD_WAIT) return true;
    if (team.length >= 2 && this.formStack(d, o.side, team, this.stackTactic(g, o.tactic, team, d), true)) {
      o.st = team[0].entry;
      if (o.tactic === 'auto') o.st.then = 'plain'; // (entrée de l'IA : la charge saute dès qu'on s'est écarté)
      return true;
    }
    const q = inn();
    g.order = { type: 'move', x: q.x, y: q.y, angle: q.angle };
    return false;
  }

  // Manière d'entrer demandée (want) si le trinôme en a encore le moyen, sinon il attend vos ordres en place ; 'choose' :
  // il les attend ; 'auto' : celle que choisirait l'IA, la menace tenue pour derrière la porte.
  stackTactic(g, want, team, d) {
    if (want === 'flash' || want === 'frag') {
      if (team.some(o => o.nades[want] > 0)) return want;
      this.say(`${g.label} : plus de ${want === 'frag' ? 'grenade' : 'flash'} — à vous de voir comment entrer`, 2);
      return 'wait';
    }
    if (want === 'charge') {
      if (team.some(o => o.charges > 0)) return 'charge';
      this.say(`${g.label} : plus de charge — à vous de voir comment entrer`, 2);
      return 'wait';
    }
    return want === 'auto' ? this.pickEntry(team, d, true) : 'wait';
  }
});
