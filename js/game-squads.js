'use strict';
// Game : les modes trinômes et guerre totale (et la stratégie : assaut, qui en reprend les armées).

// Trinômes : deux entrées « à l'écart » l'une de l'autre ne se voient pas, ou sont à plus de SQUAD_APART (au-delà de la
// vue d'un opérateur).
const SQUAD_APART = 16 * U;
// Trinômes : un homme du groupe armé n'est pas un suspect de l'assaut. Il vaut un opérateur (santé, réaction, champ
// de vision), sans ses flashs ni ses charges, mais avec deux grenades à fragmentation.
const SQUAD_MILITANT = { hp: 110, maxHp: 110, reaction: 0.35, turnRate: 7, fov: 110 * DEG, viewRange: 14 * U, flashbangs: 2 };

// Guerre totale : durée de la bataille, délai avant qu'un trinôme anéanti ne revienne de sa base, et âge au-delà duquel
// un corps hors de vue est retiré (cinq minutes de combat en laissent des dizaines).
const WAR_TIME = 300, WAR_RESPAWN = 6, WAR_BODY_LIFE = 45;
// Guerre totale : un trinôme autonome avance dans son couloir par étapes de WAR_STEP (voir warSectors).
const WAR_STEP = 4 * U;

// Stratégie : assaut : le groupe armé tient le terrain, DEFENSE_RATIO fois plus nombreux que vos neuf hommes, posté comme
// les suspects de l'assaut, personne à moins de DEFENSE_CLEAR du centre de votre base. Un poste dehors est tiré
// DEFENSE_OUTSIDE[0] fois moins volontiers qu'un poste sous un toit s'il est à l'abri d'un mur ou d'un meuble,
// DEFENSE_OUTSIDE[1] fois en terrain nu ; DEFENSE_PATROLS d'entre eux font des rondes.
// Armés comme les suspects de l'assaut (DEFENSE_WEAPONS), ses hommes sont plus solides et plus vifs qu'eux (70 points de vie,
// 0,5 s de réaction ; DEFENSE_STATS), sans valoir ceux des trinômes (SQUAD_MILITANT, et leurs AK de précision : en parties
// simulées, vos trinômes livrés à eux-mêmes n'en abattent alors qu'un tiers).
const DEFENSE_RATIO = 3, DEFENSE_CLEAR = 16 * U, DEFENSE_OUTSIDE = [2, 6], DEFENSE_PATROLS = 6;
const DEFENSE_STATS = { hp: 100, maxHp: 100, reaction: 0.4 };
const DEFENSE_WEAPONS = ['ak', 'ak74E', 'ak', 'ak', 'pistol', 'uziE', 'sgE'];

mixGame(class {
  // Stratégie : assaut : personne n'est posté à moins de DEFENSE_CLEAR du centre de votre base (petites cases).
  defenseQuiet(base) {
    const m = this.map, zone = new Set();
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      if (dist((tx + 0.5) * TILE, (ty + 0.5) * TILE, base.cx, base.cy) < DEFENSE_CLEAR) zone.add(ty * m.w + tx);
    }
    return zone;
  }

  // ---- Mode trinômes ----
  // Deux trinômes par camp, l'intervention contre le groupe armé, le joueur dans le camp de son choix. Le vôtre (vous
  // et deux coéquipiers, à vos ordres) entre par l'ouverture choisie ; le second de votre camp, autonome, par la plus
  // proche de la vôtre (ou la même, faute d'ouvertures) ; les deux trinômes d'en face par les deux plus éloignées.
  // L'emporte le camp qui met l'autre entièrement hors de combat.
  startSquads(b0) {
    const bs = this.map.breaches, mine = this.camp, theirs = mine === 'police' ? 'armed' : 'police';
    this.squads = { groups: [] };
    if (!b0) return;
    // distance de marche depuis votre entrée (à vol d'oiseau si aucun chemin)
    const from = { x: Math.floor(b0.inside.x / TILE), y: Math.floor(b0.inside.y / TILE) };
    const far = b => {
      const r = this.map.routeTo(b.inside.x, b.inside.y, from.x, from.y, 11);
      if (!r) return dist(b.inside.x, b.inside.y, b0.inside.x, b0.inside.y);
      let L = 0, x = b.inside.x, y = b.inside.y;
      for (const q of r) { L += dist(x, y, q.x, q.y); x = q.x; y = q.y; }
      return L;
    };
    const others = bs.filter(b => b !== b0).map(b => ({ b, d: far(b) })).sort((a, c) => a.d - c.d).map(o => o.b);
    // deux entrées qui ne se voient pas (ou de trop loin, à travers un grand jardin) : personne ne doit tomber nez à
    // nez avec l'adversaire en entrant
    const apart = (a, c) => {
      const d = dist(a.inside.x, a.inside.y, c.inside.x, c.inside.y);
      return d > 4 * U && (d > SQUAD_APART || !this.map.hasLOS(a.inside.x, a.inside.y, c.inside.x, c.inside.y));
    };
    const away = others.slice().reverse(), foes = away.filter(b => apart(b, b0));
    const foeA = foes[0] || away[0] || b0, foeB = foes[1] || foeA;
    // le second trinôme de votre camp : l'entrée la plus proche de la vôtre, à l'écart de celles d'en face
    const ally = others.find(b => b !== foeA && b !== foeB && apart(b, foeA) && apart(b, foeB)) || b0;
    const taken = this.ops.map(o => ({ x: o.x, y: o.y }));
    this.mates.push(...this.spawnSquad(ally, 'ops', mine, taken).members);
    const a = this.spawnSquad(foeA, 'enemy', theirs), b = this.spawnSquad(foeB, 'enemy', theirs, foeB === foeA ? a.members : []);
    b.sectors = a.sectors; // les deux trinômes d'en face se partagent le bâtiment (voir pickSector)
    this.enemies = [...a.members, ...b.members];
  }

  // Un trinôme autonome derrière l'ouverture b : trois opérateurs (flashs, une charge, colonnes) ou trois hommes du
  // groupe armé (deux grenades à fragmentation chacun, et des accessoires sur leur arme), qui ratissent ensemble les
  // secteurs de leur liste (group.sweepTo, voir sweepGoal) et partagent ce qu'ils apprennent (group.contact). Celui de
  // votre camp porte un nom, comme vos coéquipiers.
  // opts.pts : leurs places, déjà choisies (une base de la guerre totale) ; opts.names : les noms de ceux de votre camp ;
  // opts.type : en stratégie, la sorte de groupe et son mode ({ type, sup }, voir GROUP_TYPES), qui en fixe l'effectif.
  spawnSquad(b, team, camp, taken, opts = {}) {
    // (derrière une ouverture, le premier, qui mène, est le plus avancé dans le bâtiment)
    const police = camp === 'police', n = opts.type ? GROUP_TYPES[opts.type.type].n : 3;
    const pts = opts.pts || this.breachFile(b, n, taken).reverse(), kit = this.squadKit(camp, n, opts.type);
    const group = { team, camp, breach: b, contact: null, search: null, sweepTo: null, members: [], sectors: this.buildSectors(null, b.inside), type: opts.type ? opts.type.type : null };
    // la charge de brèche du trinôme : au premier qui n'a pas de bouclier au bras
    const c0 = kit[0].shield ? 1 : 0;
    pts.forEach((q, k) => {
      const a = police ? new Operator(q.x, q.y, b.angle, kit[k].weapon) : new Enemy(q.x, q.y, b.angle, kit[k].weapon);
      if (police) a.charges = k >= c0 && k < c0 + WAVE_CHARGES ? 1 : 0;
      // le groupe armé des trinômes : des hommes aguerris, pas les suspects de l'assaut (plus solides et plus vifs)
      else Object.assign(a, { hunter: true, nade: 'frag', flashbangs: 1, flashCd: rand(4, 10), charges: 0, entry: null, clear: null, ...SQUAD_MILITANT });
      // chacun équipé selon son rang dans la file (ROLE_KITS : le chef de file au silencieux)
      a.slot = { def: fittedDef(kit[k].weapon, kit[k].acc), mag: Infinity, reserve: 0 };
      if (kit[k].shield) this.armShield(a, kit[k].shield);
      a.burstLeft = a.weapon.burst;
      a.team = team;
      a.group = group;
      a.moveDir = b.angle; // le sens de sa marche, d'abord vers l'intérieur (sa file s'y range, voir formationPos)
      if (team === 'ops') {
        const d = (opts.names || SQUAD_DEFS[camp])[k];
        Object.assign(a, { name: d.name, accent: d.accent, coverAngle: null });
        if (!police) a.style = { ...STYLE_MILITANT, body: d.jacket, shoulder: d.jacket, sleeve: d.jacket, pants: d.pants };
      } else {
        // en face aussi, chacun son nom (le fil des morts) : ceux de son trinôme (opts.slot en guerre totale, sinon son rang)
        const n = opts.slot !== undefined ? opts.slot : this.squads.groups.filter(o => o.team === 'enemy').length, names = FOE_NAMES[camp];
        a.name = names[(n * 3 + k) % names.length];
      }
      group.members.push(a);
    });
    this.squads.groups.push(group);
    return group;
  }

  // Ce que porte chacun d'un groupe que mène l'IA, du chef de file au dernier : [{ weapon, acc, shield }]. En stratégie, la
  // sorte de groupe choisie (type : { type, sup }) fixe tout (GROUP_TYPES). Sinon chacun tire son arme dans le lot de son
  // camp et prend les accessoires de son rang (ROLE_KITS) ; dans l'intervention, celui qui mène porte de temps en temps
  // un bouclier, avec un Glock (OPERATOR_SHIELD_CHANCE).
  squadKit(camp, n, type) {
    const police = camp === 'police', role = k => ROLE_KITS[Math.min(k, ROLE_KITS.length - 1)];
    if (type) {
      const T = GROUP_TYPES[type.type];
      return T.arms[camp].slice(0, n).map((weapon, k) => ({
        weapon, shield: police && k === 0 && T.shield || null,
        acc: { ...role(k), sup: !!type.sup, ...(k === T.scope ? { laser: false, scope: true } : {}) },
      }));
    }
    const kit = dealWeapons(police ? OPERATOR_POOL : MILITANT_POOL, n).map((weapon, k) => ({ weapon, acc: role(k), shield: null }));
    if (police && n > 1 && Math.random() < OPERATOR_SHIELD_CHANCE) {
      Object.assign(kit[0], { weapon: 'glockop', shield: OPERATOR_SHIELDS[Math.floor(Math.random() * OPERATOR_SHIELDS.length)] });
    }
    return kit;
  }

  // Un homme de l'IA prend un bouclier au bras (son arme de poing en main, voir squadKit) : il avance moins vite, ne voit
  // plus que par la lucarne, et vise moins bien d'une main (Game.spreadOf, comme le joueur).
  armShield(a, key) {
    const sh = SHIELDS[key];
    a.shield = sh;
    a.speed *= sh.mobility;
    a.fov = Math.min(a.fov, sh.fov);
  }

  // ---- Guerre totale ----
  // Deux armées de trois trinômes. La vôtre part de la base choisie (ou tirée au sort) : votre trinôme, à vos ordres, au
  // centre, et deux trinômes autonomes sur les flancs ; l'autre armée, de l'autre base. Chaque trinôme autonome a son
  // couloir (warSectors). Un trinôme anéanti revient de sa base WAR_RESPAWN s plus tard (updateWar) ; au bout de
  // WAR_TIME s, l'armée qui a abattu le plus d'adversaires l'emporte (checkEnd). Le champ de bataille est connu d'avance.
  // Stratégie : la même bataille, mais vous n'y incarnez personne. Les trois trinômes de votre armée sont autonomes et
  // prennent vos ordres (voir updateCommander) ; le joueur reste à la base, hors du terrain (commander, jamais debout).
  // Stratégie : assaut : vos trois trinômes, mais pas d'armée en face : le groupe armé est déjà posté (loadLevel) et tient
  // le terrain comme les suspects de l'assaut. Personne ne revient de sa base ; sans ordre, vos trinômes se partagent
  // le ratissage de tout le terrain (une seule liste de secteurs, voir pickSector) au lieu d'un couloir chacun.
  startWar() {
    const bs = this.map.bases, mine = this.camp, theirs = mine === 'police' ? 'armed' : 'police';
    const home = bs[this.entryIndex] || bs[0], away = bs.find(b => b !== home) || home;
    this.squads = { groups: [] };
    this.war = {
      bases: { ops: home, enemy: away },
      camps: { ops: mine, enemy: theirs },
      // les trois trinômes de chaque armée, tels qu'ils sont en ce moment (le premier des vôtres : le vôtre)
      slots: { ops: [this.strat ? null : { team: 'ops', camp: mine, crew: true, members: [this.player, ...this.mates] }, null, null], enemy: [null, null, null] },
      respawn: { ops: [null, null, null], enemy: [null, null, null] }, // instant du retour d'un trinôme anéanti
      kills: { ops: 0, enemy: 0 }, // adversaires abattus par chaque armée
      mine: 0,                     // dont par vous
      reinforce: 0,                // retours de votre trinôme
      lost: 0,                     // trinômes de votre armée anéantis
      pruneT: 0,
      // stratégie : assaut : l'effectif du groupe armé au départ (ses corps restent sur le terrain)
      defense: this.defense ? { total: this.enemies.length } : null,
    };
    if (this.strat) {
      const p = this.player;
      Object.assign(p, { alive: false, commander: true, x: home.cx, y: home.cy });
    }
    for (const k of this.strat ? [0, 1, 2] : [1, 2]) this.warSquad('ops', k);
    if (this.defense) {
      const secs = this.buildSectors(null, { x: home.cx, y: home.cy });
      for (const g of this.war.slots.ops) Object.assign(g, { sectors: secs, pingpong: false });
    } else for (const k of [0, 1, 2]) this.warSquad('enemy', k);
    const m = this.map;
    for (let i = 0; i < m.explored.length; i++) if (m.tiles[i] !== 2) m.explored[i] = 1;
  }

  // Couloir d'un trinôme : 0 et 2 les flancs, 1 le centre (le vôtre). Ceux des deux armées se font face.
  static warLane(team, k) { return team === 'ops' ? (k === 1 ? 0 : k === 2 ? 2 : 1) : k; }

  // Le trinôme k de l'armée team sort de sa base : trois hommes du camp de cette armée, du côté de son couloir. En
  // stratégie, ceux de votre armée portent la couleur de leur trinôme et attendent vos ordres à la base.
  warSquad(team, k) {
    const W = this.war, base = W.bases[team], foe = W.bases[team === 'ops' ? 'enemy' : 'ops'], lane = Game.warLane(team, k);
    const taken = [...this.ops, ...this.enemies].filter(a => a.alive).map(a => ({ x: a.x, y: a.y }));
    const gate = { inside: { x: base.cx, y: base.cy }, angle: base.angle };
    const mine = this.strat && team === 'ops', names = mine ? STRAT_DEFS[W.camps[team]][k] : WAR_DEFS[W.camps[team]][k - 1];
    // (en stratégie, chacun de vos groupes est de la sorte choisie au briefing)
    const type = mine ? this.loadout.army[k] : null, n = type ? GROUP_TYPES[type.type].n : 3;
    const g = this.spawnSquad(gate, team, W.camps[team], taken, { pts: this.baseFile(base, n, taken, lane), names, slot: k, type });
    g.sectors = this.warSectors(base, foe, lane);
    g.pingpong = true; // au bout du couloir, il le reprend dans l'autre sens
    g.slot = k;
    if (this.strat && team === 'ops') {
      const lead = g.members[0];
      Object.assign(g, { label: names[0].name, color: STRAT_COLORS[k], queue: [], rush: false, order: { type: 'hold', x: lead.x, y: lead.y, angle: base.angle } });
      for (const m of g.members) {
        m.accent = g.color;
        if (W.camps.ops === 'police') m.nades.frag = STRAT_FRAGS; // (elles ne partent que sur vos ordres)
      }
    }
    if (team === 'ops') this.mates = [...this.mates, ...g.members]; else this.enemies = [...this.enemies, ...g.members];
    W.slots[team][k] = g;
    W.respawn[team][k] = null;
    return g;
  }

  // Votre trinôme anéanti revient de la base : vous, avec l'équipement choisi au briefing, et deux nouveaux coéquipiers.
  // Le corps que vous incarniez reste où il est tombé, parmi ceux de l'équipe.
  warCrew() {
    const W = this.war, base = W.bases.ops, armed = this.camp === 'armed', old = this.player;
    const taken = [...this.ops, ...this.enemies].filter(a => a.alive).map(a => ({ x: a.x, y: a.y }));
    const pts = this.baseFile(base, 3, taken, 1);
    const p = new Player(pts[0].x, pts[0].y, this.loadout);
    p.style = armed ? { ...STYLE_BOSS } : { ...STYLE_PLAYER };
    this.armGrenades(p);
    p.charges = armed ? 0 : CHARGES;
    p.angle = p.moveDir = base.angle;
    p.cooking = null;
    const crew = this.crewDefs(armed ? SIEGE_MATE_DEFS.slice(0, 2) : TEAMMATE_DEFS).map((d, i) => {
      const m = new Teammate(pts[i + 1].x, pts[i + 1].y, d);
      m.angle = base.angle;
      return m;
    });
    old.accent = '#9aa4ae';
    this.mates = [...this.mates, old, ...crew];
    this.player = p;
    W.slots.ops[0] = { team: 'ops', camp: this.camp, crew: true, members: [p, ...crew] };
    W.respawn.ops[0] = null;
    W.reinforce++;
    Object.assign(this, { relayT: 0, stack: null, orderMarker: null, orderDrag: null });
    this.say('Renforts : vous repartez de la base avec un trinôme frais', 3);
    this.emit('weapon');
  }

  // Case de départ du joueur dans sa base (petites cases).
  baseStart(base) {
    const q = this.baseFile(base, 1, [], 1)[0];
    return { x: Math.floor(q.x / TILE), y: Math.floor(q.y / TILE) };
  }

  // n places libres dans une base, écartées les unes des autres et de taken, du côté du couloir lane (vu de la base 1
  // vers la base 2) et un peu vers l'avant. Une base saturée empile au centre : separate les écarte.
  baseFile(base, n, taken, lane = 1) {
    const m = this.map, [b0, b1] = m.bases.length > 1 ? m.bases : [base, base];
    const L = dist(b0.cx, b0.cy, b1.cx, b1.cy) || 1, vx = -(b1.cy - b0.cy) / L, vy = (b1.cx - b0.cx) / L;
    const tx = base.cx + vx * (lane - 1) * 2 * U + Math.cos(base.angle) * U, ty = base.cy + vy * (lane - 1) * 2 * U + Math.sin(base.angle) * U;
    const cells = base.cells.map(c => ({ x: (c.x + 0.5) * TILE, y: (c.y + 0.5) * TILE }))
      .filter(q => m.circleFree(q.x, q.y, 11, false))
      .sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty));
    const out = [], all = (taken || []).slice();
    for (const q of cells) {
      if (out.length >= n) break;
      if (all.some(o => dist(o.x, o.y, q.x, q.y) < 24)) continue;
      out.push(q); all.push(q);
    }
    while (out.length < n) out.push({ x: base.cx, y: base.cy });
    return out;
  }

  // Étapes du couloir lane, de sa base vers celle d'en face : le champ de bataille est coupé en trois bandes dans le
  // sens base 1 → base 2 ; dans la sienne, le trinôme marche d'étape en étape (une toutes les WAR_STEP de progression,
  // la plus proche du milieu de la bande), sans zigzaguer d'un bord à l'autre.
  warSectors(base, foe, lane) {
    const m = this.map, [b0, b1] = m.bases.length > 1 ? m.bases : [base, foe];
    const L = dist(b0.cx, b0.cy, b1.cx, b1.cy) || 1, vx = -(b1.cy - b0.cy) / L, vy = (b1.cx - b0.cx) / L;
    const lat = p => (p.x - b0.cx) * vx + (p.y - b0.cy) * vy;
    const F = dist(base.cx, base.cy, foe.cx, foe.cy) || 1;
    const along = p => ((p.x - base.cx) * (foe.cx - base.cx) + (p.y - base.cy) * (foe.cy - base.cy)) / F;
    const pts = this.buildSectors(null, { x: base.cx, y: base.cy });
    const cuts = pts.map(lat).sort((a, b) => a - b), c1 = cuts[Math.floor(cuts.length / 3)], c2 = cuts[Math.floor(2 * cuts.length / 3)];
    const band = p => (lat(p) < c1 ? 0 : lat(p) < c2 ? 1 : 2);
    const mine = pts.filter(p => band(p) === lane);
    const mid = mine.map(lat).sort((a, b) => a - b)[Math.floor(mine.length / 2)] || 0;
    const steps = new Map();
    for (const p of mine) {
      const k = Math.floor(along(p) / WAR_STEP), q = steps.get(k);
      if (!q || Math.abs(lat(p) - mid) < Math.abs(lat(q) - mid)) steps.set(k, p);
    }
    return [...steps.keys()].sort((a, b) => a - b).map(k => steps.get(k));
  }

  // Un trinôme dont plus personne n'est debout revient de sa base WAR_RESPAWN s plus tard. Les corps tombés depuis
  // longtemps, hors de vue, sont retirés de temps en temps.
  updateWar() {
    const W = this.war;
    for (const team of ['ops', 'enemy']) W.slots[team].forEach((g, k) => {
      if (!g) return;
      const at = W.respawn[team][k];
      if (at !== null) {
        if (this.time < at) return;
        if (team === 'ops' && k === 0 && !this.strat) this.warCrew();
        else {
          const n = this.warSquad(team, k);
          if (this.strat && team === 'ops') this.say(`Groupe ${n.label} : de retour à la base, il attend vos ordres`, 2.5);
        }
        return;
      }
      if (g.members.some(a => a.alive)) return;
      // (stratégie : assaut : pas de renforts, il ne revient jamais)
      W.respawn[team][k] = W.defense ? Infinity : this.time + WAR_RESPAWN;
      if (team === 'ops') W.lost++;
      // (en stratégie, il quitte les ordres en cours : une colonne qu'il formait se défait)
      if (this.strat && team === 'ops') this.releaseGroup(g);
      const left = 3 - W.lost;
      this.say(team === 'enemy' ? 'Un trinôme adverse est anéanti'
        : W.defense ? `Le groupe ${g.label} est anéanti${left > 0 ? ` — plus que ${left} groupe${left > 1 ? 's' : ''}` : ''}`
        : this.strat ? `Le groupe ${g.label} est anéanti — renforts dans ${WAR_RESPAWN} s`
        : k === 0 ? `Votre trinôme est anéanti — renforts dans ${WAR_RESPAWN} s`
        : `Le trinôme de ${g.members[0].name} est anéanti — renforts dans ${WAR_RESPAWN} s`, 2.5);
    });
    // (stratégie : assaut : les corps restent, ceux du groupe armé alertent les leurs, voir spotBody)
    if (!W.defense && this.time - W.pruneT >= 5) { W.pruneT = this.time; this.pruneBodies(); }
  }

  // Guerre totale : un corps tombé depuis plus de WAR_BODY_LIFE s, que personne de votre camp ne voit, est retiré.
  pruneBodies() {
    const keep = a => a.alive || a.dying || a === this.player || this.time - (a.diedAt || 0) < WAR_BODY_LIFE || this.seesPoint(a.x, a.y);
    if (!this.mates.every(keep)) this.mates = this.mates.filter(keep);
    if (!this.enemies.every(keep)) this.enemies = this.enemies.filter(keep);
  }
});
