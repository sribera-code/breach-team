'use strict';
// Logique temps réel (classe Game) : le cœur de la simulation. Ce fichier tient le chargement des missions et
// des modes, la boucle (update, step), la vision, la fin de mission et sa note ; le reste de Game est réparti par
// thème dans js/game-*.js (tir, bruit, portes, joueur, menus contextuels, coéquipiers, suspects, agents autonomes,
// otages et escorte, siège, trinômes et guerre totale, stratégie), qui y versent leurs méthodes par mixGame.

// Délai entre la mort du joueur et la reprise dans un coéquipier (on voit tomber son personnage).
const RELAY_DELAY = 1.2;
// Coups reçus : l'arc qui montre d'où ils viennent reste HURT_LIFE s (Renderer.drawHurt) ; une ligne du fil des morts
// (trinômes, guerre totale) reste FEED_LIFE s (UI.updateFeed).
const HURT_LIFE = 1.4, FEED_LIFE = 7;

// Laser : portée du faisceau, intervalle entre deux coups d'œil d'un suspect, inquiétude ajoutée quand il le voit.
const LASER_RANGE = 22 * U, LASER_LOOK = 0.2, LASER_ALARM = 0.4;

// Courant coupé : portée du regard sans lumière. Lampe : demi-ouverture et portée du faisceau, retard
// infligé à celui qui la prend en face d'assez près. Un coup de feu sans silencieux éclaire le tireur SHOT_GLOW s.
const DARK_SIGHT = 4 * U, LAMP_HALF = 22 * DEG, LAMP_RANGE = 12 * U, LAMP_DAZZLE = 0.6, LAMP_DAZZLE_RANGE = 6 * U, SHOT_GLOW = 0.4;

class Game {
  constructor() {
    this.levelIndex = 0;
    this.listeners = {};
    this.minimap = true;
    this.input = { keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, rdown: false } };
    this.orderDrag = null; // ordre de déplacement en cours de tracé (clic droit maintenu)
    this.menu = null;      // menu contextuel ouvert par E (voir openMenu)
    this.fireLock = false; // clic qui a retiré la fibre : pas de tir avant de l'avoir relâché (voir updateFiber)
    this.visionPolys = [];
    this.heard = [];
    this.hurt = [];
    this.feed = [];
    this.ownNoise = null;
    this.camShake = 0;
    this.camKick = { x: 0, y: 0 };
    this.paused = false;
    this.over = null;
    this.mode = Game.loadSavedMode();
    this.levelMemo = new Map(); // mission en cours dans chaque liste de cartes, quand on change de mode
    this.loadout = Game.loadSavedLoadout(this.mode);
    this.entryRandom = Game.loadSavedEntry(); // par défaut, le point d'entrée est tiré au sort
    this.lockDoors = true;   // assaut : certaines portes sont fermées à clé (les tests l'écartent)
    this.saveRecords = true; // meilleure note par mission, gardée dans le navigateur
    this.patrols = true;     // assaut : quelques suspects font des rondes (les tests l'écartent)
    this.alarms = true;      // assaut : un suspect qui survit après vous avoir vu donne l'alerte générale (idem)
  }

  static loadSavedEntry() {
    try { return localStorage.getItem('breach.entry') !== 'fixed'; } catch (e) { return true; }
  }

  // Point d'entrée choisi au briefing : une ouverture précise, ou le tirage au sort à chaque partie.
  setEntry(i) {
    this.entryRandom = i === null;
    if (i !== null) this.entryIndex = i;
    try { localStorage.setItem('breach.entry', this.entryRandom ? 'random' : 'fixed'); } catch (e) { /* stockage indisponible */ }
    this.loadLevel(this.levelIndex);
  }

  static loadSavedMode() {
    try { const m = localStorage.getItem('breach.mode'); if (MODES[m]) return m; } catch (e) { /* stockage indisponible */ }
    return 'assault';
  }

  // Cartes du mode en cours : l'assaut, le siège et les trinômes jouent les mêmes, l'escorte a les siennes.
  get levels() { return (MODES[this.mode] || MODES.assault).levels; }

  // Camp du joueur : 'police' (l'intervention : flashs, charges, fibre) ou 'armed' (le groupe armé : grenades à
  // fragmentation, ni charge ni fibre).
  get camp() { return (MODES[this.mode] || MODES.assault).camp; }

  // Bascule de mode : on recharge la mission dans l'autre rôle. Chaque mode a sa liste de cartes : on garde la même
  // carte si l'autre mode la joue aussi (l'assaut et le siège se partagent les bâtiments à otages), sinon on revient à
  // celle où l'on en était dans cette liste.
  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return;
    const list = this.levels;
    this.mode = mode;
    try { localStorage.setItem('breach.mode', mode); } catch (e) { /* stockage indisponible */ }
    this.loadout = Game.loadSavedLoadout(mode);
    if (this.levels !== list) {
      this.levelMemo.set(list, this.levelIndex);
      const same = this.levels.indexOf(this.def);
      this.levelIndex = same >= 0 ? same : this.levelMemo.get(this.levels) || 0;
    }
    this.loadLevel(this.levelIndex);
  }

  // Équipement choisi au briefing, mémorisé dans le navigateur quand c'est possible.
  static loadSavedLoadout(mode) {
    const m = MODES[mode] || MODES.assault;
    try {
      const l = JSON.parse(localStorage.getItem('breach.loadout.' + mode));
      if (l && m.primaries.includes(l.primary) && m.sidearms.includes(l.sidearm)) return Game.normLoadout(l, m);
    } catch (e) { /* stockage indisponible */ }
    return Game.normLoadout(m.loadout, m);
  }

  // Équipement complet et valide pour le mode. Un équipement enregistré avant les accessoires par arme
  // portait un seul drapeau sup, pour toute l'équipe : il devient un silencieux sur chacune des deux armes.
  // Le matériel des trinômes (SQUAD_KIT) ne reste pas monté ailleurs.
  static normLoadout(l, m) {
    const acc = {};
    for (const k in l.acc || {}) acc[k] = { ...l.acc[k] };
    if (l.sup) for (const k of [l.primary, l.sidearm]) acc[k] = { ...acc[k], sup: true };
    for (const k in acc) for (const n of SQUAD_KIT[k] || []) if (!accFits(k, n, m)) delete acc[k][n];
    return {
      primary: l.primary, sidearm: l.sidearm, acc,
      shield: (m.shields || []).includes(l.shield) ? l.shield : null,
      teamSup: !!(l.teamSup || l.sup),
      cutPower: !!l.cutPower && !!m.power,
      // un équipement enregistré avant les gilets reçoit le premier du mode (le souple)
      vest: (m.vests || []).includes(l.vest) ? l.vest : (m.vests || [])[0] || null,
      // et, avant le choix des grenades, les trois flashs d'alors
      nades: NADE_KITS[l.nades] ? l.nades : 'flash',
      // (stratégie ; avant le choix, trois trinômes standard)
      army: DEFAULT_ARMY.map((d, k) => {
        const a = (l.army || [])[k] || d;
        return { type: GROUP_TYPES[a.type] ? a.type : d.type, sup: !!a.sup };
      }),
    };
  }

  setLoadout(l) {
    const teamBefore = !!this.loadout.teamSup, cutBefore = !!this.loadout.cutPower, nadesBefore = this.loadout.nades, armyBefore = JSON.stringify(this.loadout.army);
    this.loadout = { ...this.loadout, ...l };
    try { localStorage.setItem('breach.loadout.' + this.mode, JSON.stringify(this.loadout)); } catch (e) { /* stockage indisponible */ }
    // les silencieux (ou les lampes, courant coupé) des coéquipiers changent leur arme : on la leur redistribue ; en
    // stratégie, vos groupes changent de sorte ou de mode : on les reforme
    const changed = !!this.loadout.teamSup !== teamBefore || !!this.loadout.cutPower !== cutBefore || JSON.stringify(this.loadout.army) !== armyBefore;
    if (changed && this.mode !== 'siege') { this.loadLevel(this.levelIndex); return; }
    this.player.equip(this.loadout);
    if (this.loadout.nades !== nadesBefore) this.armGrenades(this.player);
    this.emit('weapon');
  }

  // Stratégie : la sorte du groupe k (type, voir GROUP_TYPES) ou son mode (sup : silencieux), choisis au briefing.
  setArmy(k, o) {
    const army = this.loadout.army.map((a, i) => (i === k ? { ...a, ...o } : a));
    this.setLoadout({ army });
  }

  // Accessoire (sup | laser | light) monté ou retiré sur une arme : le choix est retenu arme par arme.
  setAccessory(key, name, on) {
    const acc = { ...this.loadout.acc, [key]: { ...accOf(this.loadout, key), [name]: !!on } };
    this.setLoadout({ acc });
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach(fn => fn(data)); }

  loadLevel(i) {
    const def = this.levels[i];
    this.levelIndex = i;
    this.def = def;
    this.map = new GameMap(def);
    const c = t => ({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
    const entry = this.map.spawns[0] || { x: 1, y: 1 };
    const siege = this.mode === 'siege';
    // En escorte, l'équipe part du point A avec le VIP : elle ne passe par aucune ouverture.
    const escort = this.mode === 'escort';
    // Trinômes : personne n'attend dans le bâtiment, les quatre trinômes y entrent (voir startSquads). Guerre totale :
    // les deux armées partent de leurs bases (voir startWar).
    const squads = !!(MODES[this.mode] || {}).squads, armed = this.camp === 'armed', war = !!(MODES[this.mode] || {}).war;
    // Stratégie : la guerre totale, mais vous n'êtes sur le terrain qu'en commandant (voir startWar et updateCommander)
    const strategy = !!(MODES[this.mode] || {}).strategy;
    // Stratégie : assaut : en face, pas d'armée mais un groupe armé retranché, posté sur tout le terrain (buildPosts, defenseQuiet)
    const defense = !!(MODES[this.mode] || {}).defense;
    this.defense = defense;
    this.war = null;
    this.strat = strategy ? {
      sel: new Set(),  // trinômes choisis (leur rang dans war.slots.ops : ils restent choisis à leur retour de la base)
      box: null,       // rectangle de sélection en cours (clic gauche glissé), en coordonnées du monde
      aim: null,       // ordre en cours de tracé (clic droit maintenu : direction à tenir)
      hover: null,     // sous le curseur : { kind: 'foe' | 'door' | 'own', ... } (voir stratHover)
      frozen: false,   // pause tactique : le temps s'arrête, les ordres se donnent
      zoom: 0,         // crans de molette à appliquer à la vue (Renderer.stratCamera)
      camTo: null,     // la vue doit aller là (minimap, double appui sur un numéro, F)
      miniDrag: false, // clic gauche maintenu sur la minimap : la vue suit
      keyAt: [-9, -9, -9], // dernier appui sur 1, 2, 3 (deux de suite : la vue y va)
    } : null;
    // agents à la manœuvre autonome (intervention du siège, trinômes) : leurs colonnes sur les portes
    // (stackT : instant de la dernière colonne de chaque camp ; tried : camp:porte → instant où elle a été envisagée)
    this.hunt = siege || squads ? { stacks: [], stackT: {}, tried: new Map() } : null;
    const vipAt = escort ? this.map.vipStart || entry : null;
    // En assaut, l'équipe entre par une ouverture sur l'extérieur (tirée au sort, ou choisie au briefing) ; en guerre
    // totale, votre armée part de l'une des deux bases (de même).
    const breaches = this.map.breaches, picks = war ? this.map.bases : breaches;
    this.entryIndex = !picks.length ? 0
      : this.entryRandom ? Math.floor(Math.random() * picks.length)
      : clamp(this.entryIndex || 0, 0, picks.length - 1);
    const entryBreach = !siege && !escort && !war && breaches.length ? breaches[this.entryIndex] : null;
    const home = war ? picks[this.entryIndex] || null : null;
    // Personne n'attend là où l'équipe commence : la pièce d'entrée de l'assaut, ou en escorte celle du
    // point A (et les abords du point B), ou les abords de votre base (stratégie : assaut).
    const quiet = entryBreach ? this.map.roomOf(entryBreach.inside.x, entryBreach.inside.y)
      : escort ? this.escortQuiet(vipAt) : defense && home ? this.defenseQuiet(home) : null;
    // Postes tirés au sort à chaque partie : la disposition des terroristes (le chef compris) et
    // des otages ne se mémorise pas d'une partie à l'autre. (stratégie : assaut : DEFENSE_RATIO hommes pour chacun des
    // neuf de vos trois trinômes, sur tout le terrain, dehors compris)
    const nFoes = defense ? DEFENSE_RATIO * 9 : squads ? 0 : this.map.enemySpawns.length || 1;
    const nHost = squads ? 0 : this.map.hostageSpawns.length;
    const free = this.buildPosts(quiet, nFoes + nHost, defense);
    const foePosts = free.splice(0, nFoes);
    const hostPosts = free.splice(0, nHost);
    const s = siege ? { x: Math.floor(foePosts[0].x / TILE), y: Math.floor(foePosts[0].y / TILE) }
      : entryBreach ? this.entryStart(entryBreach)
      : escort ? this.escortStart(vipAt)
      : home ? this.baseStart(home)
      : entry;
    this.player = new Player(c(s).x, c(s).y, this.loadout);
    this.player.style = armed ? { ...STYLE_BOSS } : { ...STYLE_PLAYER };
    this.armGrenades(this.player);
    const goal = escort && this.map.goal;
    this.player.angle = siege ? rand(0, TAU)
      : goal ? Math.atan2(goal.cy - this.player.y, goal.cx - this.player.x)
      : home ? home.angle
      : Math.atan2(this.map.h * TILE / 2 - this.player.y, this.map.w * TILE / 2 - this.player.x);
    const weps = def.enemyWeapons || (defense ? DEFENSE_WEAPONS : ['ak']);
    this.enemies = siege || (squads && !defense) ? [] : foePosts.map(q => new Enemy(q.x, q.y, null, weps[Math.floor(Math.random() * weps.length)]));
    // (stratégie : assaut : ils tiennent leur poste comme des suspects, mais en valent un peu plus, voir DEFENSE_STATS)
    if (defense) for (const e of this.enemies) Object.assign(e, DEFENSE_STATS);
    this.hostages = hostPosts.map(q => new Hostage(q.x, q.y));
    // le VIP, au point A, parmi les civils (balles, éclats, embrasures, discipline de tir) : il suit le joueur
    // dès le départ (voir plus bas)
    this.vip = escort ? new Vip(c(vipAt).x, c(vipAt).y) : null;
    if (this.vip) { this.vip.angle = this.player.angle; this.hostages.push(this.vip); }
    this.player.moveDir = this.player.angle;
    // en trinômes, vos deux coéquipiers ; côté groupe armé, deux complices
    const baseDefs = siege ? SIEGE_MATE_DEFS.slice(0, Math.max(1, Math.min(SIEGE_MATE_DEFS.length, foePosts.length - 1)))
      : armed ? SIEGE_MATE_DEFS.slice(0, 2) : TEAMMATE_DEFS;
    // courant coupé : chacun a une lampe sur son arme (toutes celles du lot ont un rail)
    this.dark = !!(MODES[this.mode] || {}).power && !!this.loadout.cutPower;
    const mateDefs = this.crewDefs(baseDefs);
    if (siege) {
      // Chaque complice à son poste, tiré au sort lui aussi, en position tenue.
      this.mates = mateDefs.map((d, i) => {
        const q = foePosts[i + 1] || foePosts[0];
        const m = new Teammate(q.x, q.y, d);
        m.angle = rand(0, TAU);
        m.order = 'hold';
        m.holdAngle = m.angle;
        return m;
      });
      this.startSiege(entry, c(entry));
    } else {
      // En assaut et en escorte, l'équipe se forme autour du joueur : cases libres les plus proches du départ.
      const near = [];
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const tx = s.x + dx, ty = s.y + dy;
        if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
        if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, 12, true)) continue;
        near.push({ x: tx, y: ty, d: Math.hypot(dx, dy) });
      }
      near.sort((a, b) => a.d - b.d);
      const taken = [{ x: this.player.x, y: this.player.y }];
      if (this.vip) taken.push({ x: this.vip.x, y: this.vip.y });
      // (en stratégie, pas de trinôme autour de vous : les trois de votre armée sortent de la base, voir startWar)
      this.mates = strategy ? [] : mateDefs.map(d => {
        const t = near.find(f => taken.every(o => dist((f.x + 0.5) * TILE, (f.y + 0.5) * TILE, o.x, o.y) >= 26)) || s;
        taken.push({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
        const m = new Teammate((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, d);
        m.angle = this.player.angle;
        return m;
      });
      if (quiet && !squads) this.clearZone(quiet);
      this.siege = null;
      this.player.charges = armed ? 0 : CHARGES;
      if (war) {
        this.startWar();
        if (defense && this.patrols) this.buildPatrols(quiet, DEFENSE_PATROLS);
      } else if (squads) this.startSquads(entryBreach);
      else {
        // Des portes fermées à clé : il faut crocheter, faire sauter la serrure ou poser une charge.
        if (this.lockDoors) for (const d of this.map.doors) d.locked = Math.random() < LOCK_CHANCE;
        // le courant tombe d'un coup : ils s'inquiètent, sans savoir encore d'où viendra la menace
        if (this.dark) for (const e of this.enemies) e.suspicion = 0.8;
        if (this.patrols) this.buildPatrols(quiet);
      }
    }
    if (!squads) this.squads = null;
    this.bullets = [];
    this.tracers = []; // ce que chaque balle a parcouru à la dernière image, tracé un instant (TRACER_LIFE)
    this.beam = null; // faisceau du laser du joueur, recalculé à chaque pas (voir spotLaser)
    this.beams = [];  // tous les faisceaux allumés : le sien, et ceux des armes de l'IA qui portent un laser
    this.grenades = [];
    this.effects = [];
    this.casings = [];
    this.decals = []; // file d'attente consommée par le rendu
    this.hiddenDecals = []; // sang, impacts... tombés hors de vue : révélés quand on voit l'endroit
    this.time = 0;
    this.over = null;
    this.loseReason = '';
    this.paused = false;
    this.stats = { kills: 0, shots: 0, hits: 0, flashes: 0, losses: 0, arrests: 0, badKills: 0, friendly: 0, vipHits: 0 };
    // escorte : la zone d'extraction (le point B), et si le VIP l'a atteinte
    this.escort = escort ? { goal: this.map.goal, safe: false } : null;
    if (this.vip) this.takeCharge(this.vip, this.player);
    this.charges = [];   // charges de brèche posées, en attente de mise à feu
    this.stack = null;   // équipe en colonne de part et d'autre d'une porte (entrée coordonnée)
    this.shoutT = -9;    // dernière sommation
    this.calloutT = -9;  // dernier « Contact ! » de l'équipe (un seul à la fois, voir mateCombat)
    this.alarm = null;   // alerte générale donnée par un suspect : { by, x, y, t } (voir raiseAlarm)
    this.score = null;   // note de fin de mission (voir scoreReport)
    this.record = null;  // meilleure note précédente pour cette mission, et si elle vient d'être battue
    this.squadSize = 1 + this.mates.length; // vous compris : c'est le groupe entier qui compte ses pertes
    this.orderMarker = null;
    this.orderDrag = null;
    this.orderTo = null;      // le coéquipier à qui va seul l'ordre en cours (menu d'actions, voir withOrderTo)
    this.rightClick = null;   // le premier clic droit, qui attend de savoir s'il est double (voir DOUBLE_RIGHT)
    this.vipGuardPick = null; // escorte : le coéquipier que vous avez chargé du VIP (voir vipGuard)
    this.menu = null;
    this.relayT = 0;
    this.pickHint = null;
    this.hostHint = null;
    this.cues = {}; // annonces d'objectif déjà faites (otages tous dehors, suspects à menotter)
    this.heard = [];      // bruits entendus hors de vue : direction et intensité (repères autour du joueur)
    this.hurt = [];       // coups reçus par le joueur : d'où ils viennent (voir hurtFrom)
    this.feed = [];       // fil des morts : qui a abattu qui (trinômes, guerre totale, voir feedKill)
    this.ownNoise = null; // halo du dernier bruit du joueur
    if (this.player) this.player.cooking = null;
    this.message = { text: '', t: 0 };
    if (strategy) this.say('Vos groupes attendent vos ordres — clic gauche (ou 1, 2, 3) pour en choisir un, clic droit pour l’envoyer', 6);
    this.computeVision();
    this.emit('level');
  }

  // Postes possibles pour les terroristes et les otages : les emplacements écrits sur la carte,
  // plus un quadrillage de cases libres, le tout mélangé. La disposition change donc à chaque partie,
  // sans jamais tomber là où l'équipe commence (room, voir loadLevel) ni coller deux personnes l'une à l'autre.
  // open (stratégie : assaut) : tout le terrain se tient, dehors compris, mais plutôt sous un toit (DEFENSE_OUTSIDE).
  buildPosts(room, needed, open) {
    const m = this.map;
    const cand = [];
    for (const sp of [...m.enemySpawns, ...m.hostageSpawns]) cand.push({ x: sp.x, y: sp.y });
    // le quadrillage reste sous toit : sur une carte en plein air, le jardin n'a de postes que ceux que la carte y place
    for (let ty = 2; ty < m.h - 2; ty += 3) for (let tx = 2; tx < m.w - 2; tx += 3) if (open || !OUTDOOR_FLOORS.has(m.floor(tx, ty))) cand.push({ x: tx, y: ty });
    for (let i = cand.length - 1; i > 0; i--) { // mélange de Fisher-Yates
      const j = Math.floor(Math.random() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    if (open) {
      // dehors, mieux vaut un mur, une haie ou des sacs de sable à deux petites cases que le terrain nu
      const cover = t => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (m.blocksMove(t.x + dx, t.y + dy)) return true; return false; };
      const w = t => (!OUTDOOR_FLOORS.has(m.floor(t.x, t.y)) ? 1 : DEFENSE_OUTSIDE[cover(t) ? 0 : 1]);
      const key = new Map(cand.map(t => [t, Math.random() * w(t)]));
      cand.sort((a, b) => key.get(a) - key.get(b));
    }
    const out = [];
    const keep = (min) => {
      for (const t of cand) {
        if (out.length >= needed) return;
        const x = (t.x + 0.5) * TILE, y = (t.y + 0.5) * TILE;
        if (room && room.has(t.y * m.w + t.x)) continue;
        if (m.blocksMove(t.x, t.y) || m.door(t.x, t.y) || m.tile(t.x, t.y) !== 0) continue;
        if (!m.circleFree(x, y, 12, true)) continue;
        if (out.some(o => dist(o.x, o.y, x, y) < min)) continue;
        out.push({ x, y });
      }
    };
    keep(2 * U);            // bien répartis...
    if (out.length < needed) keep(1.2 * U); // ...quitte à se serrer sur une petite carte
    return out;
  }

  // Case de départ en assaut : un peu en retrait de l'ouverture, pour ne pas coller l'équipe au mur
  // (un coéquipier coincé entre le joueur et la façade ne pourrait plus passer).
  entryStart(b) {
    let best = { x: Math.floor(b.inside.x / TILE), y: Math.floor(b.inside.y / TILE) };
    const room = this.map.roomOf(b.inside.x, b.inside.y);
    for (let k = 1; k <= 4; k++) {
      const tx = best.x + Math.round(Math.cos(b.angle)), ty = best.y + Math.round(Math.sin(b.angle));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!room.has(ty * this.map.w + tx) || !this.map.circleFree(x, y, 14, true)) break;
      best = { x: tx, y: ty };
      if (k >= 2) break; // deux cases fines (une case de carte) suffisent
    }
    return best;
  }

  // Personne n'attend là où l'équipe commence (room : pièce d'entrée de l'assaut, ou point A de l'escorte) :
  // un suspect ou un otage placé là par la carte est reporté sur la case libre la plus proche hors de cette
  // zone (donc derrière une porte). Le VIP, lui, y est chez lui.
  clearZone(room) {
    if (!room.size) return;
    const all = [...this.enemies, ...this.hostages];
    const key = a => Math.floor(a.y / TILE) * this.map.w + Math.floor(a.x / TILE);
    for (const a of all) {
      if (a.vip || !room.has(key(a))) continue;
      let best = null, bestD = Infinity;
      for (let ty = 0; ty < this.map.h; ty++) for (let tx = 0; tx < this.map.w; tx++) {
        const i = ty * this.map.w + tx;
        if (room.has(i) || this.map.tiles[i] !== 0 || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        if (!this.map.circleFree(x, y, 12, true)) continue;
        if (all.some(o => o !== a && dist(o.x, o.y, x, y) < 26)) continue;
        const d = dist(a.x, a.y, x, y);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
      if (best) { a.x = best.x; a.y = best.y; if (a.home) a.home = { x: best.x, y: best.y }; }
    }
  }

  // Fiches de vos coéquipiers (defs) avec leur arme, tirée au sort dans le lot du camp : avec des silencieux pour l'équipe
  // (assaut), une arme qui en accepte un (pas de fusil à pompe) ; courant coupé, une lampe ; en trinômes et en guerre
  // totale, côté groupe armé, une arme d'épaule (on va au combat, pas tenir un poste) et les accessoires de son rôle
  // (ROLE_KITS : le deuxième et le dernier d'une file).
  crewDefs(defs) {
    const squads = !!(MODES[this.mode] || {}).squads, armed = this.camp === 'armed', sup = !armed && !!this.loadout.teamSup;
    const pool = armed ? (squads ? SIEGE_MATE_POOL.filter(k => WEAPONS[k].cat !== 'hg') : SIEGE_MATE_POOL)
      : sup ? MATE_POOL.filter(k => SUPPRESSORS[k]) : MATE_POOL;
    const dealt = dealWeapons(pool, defs.length);
    const kits = squads && armed ? defs.map((d, i) => ROLE_KITS[Math.min(ROLE_KITS.length - 1, i + 1)]) : null;
    return defs.map((d, i) => ({ ...d, weapon: dealt[i], acc: kits ? kits[i] : { sup, light: this.dark } }));
  }

  get ops() { return [this.player, ...(this.mates || [])]; }
  // Vos coéquipiers debout, ceux qui prennent vos ordres : pas le trinôme autonome de votre camp (mode trinômes).
  get crew() { return this.mates.filter(m => m.alive && !m.hunter); }

  restart() { this.loadLevel(this.levelIndex); }
  say(text, t) { this.message = { text, t: t || 2.5 }; }
  setPaused(v) { if (this.over) return; this.paused = v; if (v) this.menu = null; this.emit('pause'); }

  // Minimap : visible par défaut, M (ou son bouton, en stratégie) la replie.
  toggleMinimap() {
    this.minimap = !this.minimap;
    this.say(this.minimap ? 'Minimap affichée' : 'Minimap repliée', 1.2);
  }

  // ---- Boucle ----
  update(dt) {
    // (la touche répond même mort ou en pause)
    if (this.input.pressed.KeyM && !this.menu) this.toggleMinimap(); // (menu de E ouvert, M ne fait que le fermer)
    // stratégie : vos ordres passent même en pause tactique (le temps, lui, s'arrête)
    if (this.strat && !this.over && !this.paused) this.updateCommander(dt);
    const frozen = !!(this.strat && this.strat.frozen);
    if (!this.over && !this.paused && !frozen) this.step(dt);
    if (!this.paused && !frozen) this.updateDying(dt);
    this.computeVision();
    this.camShake = Math.max(0, this.camShake - dt * 10);
    const kd = Math.pow(0.002, dt);
    this.camKick.x *= kd; this.camKick.y *= kd;
    for (const a of [...this.ops, ...this.enemies]) if (a.kick > 0) a.kick = Math.max(0, a.kick - dt * 9);
    this.input.pressed = {};
  }

  // Dispersion courante (demi-angle) : arme + déplacement (réduit en marche) + tirs récents (recul)
  // + distance de visée au-delà de la portée efficace. L'erreur linéaire à la cible vaut tan(spread) * distance.
  // Laser allumé : le déplacement disperse moins (LASER_MOVE). Bouclier : arme de poing tenue d'une main,
  // dispersion multipliée par shield.aim, gêne réduite de moitié par un laser. Lunette en service (à l'arrêt) :
  // dispersion de base réduite (spread de sa lunette, scopeOf), portée efficace allongée (reach).
  spreadOf(agent, aimDist) {
    const w = agent.weapon, laser = this.laserLit(agent), scope = this.scoped(agent) && scopeOf(w);
    const move = agent.moving ? w.moveSpread * (agent.walkMode ? 0.25 : 1) * (laser ? LASER_MOVE : 1) : 0;
    // mains occupées (porte, grenade) : l'arme n'est plus épaulée, le viseur s'ouvre en grand
    let s = w.spread * (scope ? scope.spread : 1) + move + agent.bloom + (agent.handBloom || 0) + (agent.act ? 7 * DEG : 0);
    const d = aimDist === undefined ? agent.aimDist || 0 : aimDist;
    const eff = (w.effRange || 0) * (scope ? scope.reach : 1);
    if (eff && d > eff) s += (w.rangeSpread || 0) * Math.min(1.5, (d - eff) / eff);
    if (agent.shield) s *= 1 + (agent.shield.aim - 1) * (laser ? 0.5 : 1);
    return s * (agent.spreadMul || 1);
  }

  // Laser de l'arme en main allumé (il s'éteint de lui-même quand l'arme quitte la visée : geste,
  // rechargement, fibre, grenade dégoupillée).
  laserLit(a) {
    return !!(a.alive && a.laserOn && a.weapon && a.weapon.laser && !a.act && !(a.reloadT > 0) && !a.fiber && !a.cooking);
  }

  // Lunette en service : l'arme en main en porte une, l'agent est immobile depuis son settle et l'arme est épaulée
  // (ni geste, ni rechargement, ni fibre, ni grenade dégoupillée, ni sonné).
  scoped(a) {
    return !!(a.alive && a.weapon && a.weapon.scope && !a.moving && a.stillT >= scopeOf(a.weapon).settle
      && !a.act && !(a.reloadT > 0) && !a.fiber && !a.cooking && !(a.stun > 0));
  }

  // Portée de vue d'un agent dans la direction ang : la lunette en service porte plus loin dans l'axe de l'arme.
  viewOf(a, ang) {
    const o = scopeOf(a.weapon);
    return this.scoped(a) && Math.abs(angleDiff(a.angle, ang)) <= o.half ? a.viewRange * o.sight : a.viewRange;
  }

  // Lampe de l'arme en main allumée (même règle que le laser, sauf le rechargement : elle reste pointée).
  lampLit(a) {
    return !!(a.alive && a.lampOn && a.weapon && a.weapon.light && !a.act && !a.fiber && !a.cooking);
  }

  // Un point pris dans le faisceau d'une lampe allumée (à portée, dans le cône, sans obstacle).
  inLamp(x, y) {
    for (const a of this.ops) {
      if (!this.lampLit(a)) continue;
      const d = dist(a.x, a.y, x, y);
      if (d > LAMP_RANGE || (d > 6 && Math.abs(angleDiff(a.angle, Math.atan2(y - a.y, x - a.x))) > LAMP_HALF)) continue;
      if (this.map.hasLOS(a.x, a.y, x, y)) return true;
    }
    return false;
  }

  // Courant coupé : on ne voit plus qu'à DARK_SIGHT, sauf qui est éclairé (pris dans un faisceau), qui porte
  // une lampe allumée, ou qui vient de tirer sans silencieux (la flamme de bouche).
  sightOf(agent, o) {
    const r = this.viewOf(agent, Math.atan2(o.y - agent.y, o.x - agent.x));
    if (!this.dark) return r;
    if (this.lampLit(o) || o.glowT > 0 || this.inLamp(o.x, o.y)) return r;
    return Math.min(r, DARK_SIGHT);
  }

  // Éblouissement : celui qui reçoit une lampe en face, d'assez près, met plus de temps à viser.
  dazzles(src, e) {
    if (!this.lampLit(src)) return false;
    const d = dist(src.x, src.y, e.x, e.y);
    if (d > LAMP_DAZZLE_RANGE || Math.abs(angleDiff(src.angle, Math.atan2(e.y - src.y, e.x - src.x))) > LAMP_HALF) return false;
    return Math.abs(angleDiff(e.angle, Math.atan2(src.y - e.y, src.x - e.x))) < e.fov / 2 && this.map.hasLOS(src.x, src.y, e.x, e.y);
  }

  // Faisceau du laser : de la bouche du canon jusqu'au premier obstacle qui arrête le regard, ou jusqu'à
  // la première personne qu'il rencontre (le mobilier, plus bas, ne l'arrête pas). null s'il est éteint
  // ou si le canon touche le mur.
  laserBeam(a) {
    if (!this.laserLit(a)) return null;
    const ml = muzzleDist(a.weapon.gunLen), r = this.map.castRay(a.x, a.y, a.angle, LASER_RANGE, false);
    if (r.dist <= ml) return null;
    const cs = Math.cos(a.angle), sn = Math.sin(a.angle);
    // le point s'arrête juste avant la surface touchée : on ne le voit que du côté du tireur
    let end = r.hit ? r.dist - 1.5 : r.dist, on = null;
    for (const o of [...this.ops, ...this.enemies, ...this.hostages]) {
      if (o === a || !o.alive || o.evacuated) continue;
      const rx = o.x - a.x, ry = o.y - a.y, t = rx * cs + ry * sn, perp = Math.abs(rx * sn - ry * cs);
      if (perp > o.radius) continue;
      const tt = t - Math.sqrt(o.radius * o.radius - perp * perp);
      if (tt > ml && tt < end) { end = tt; on = o; }
    }
    return { x0: a.x + cs * ml, y0: a.y + sn * ml, x1: a.x + cs * end, y1: a.y + sn * end, hit: r.hit, on, from: a };
  }

  // Un faisceau se voit : celui qui aperçoit le point ou le trait dans son champ se tourne vers sa source
  // et s'inquiète ; s'il le voit encore, il vient voir (un opérateur, lui, converge droit dessus). On ne
  // regarde qu'une fois toutes les LASER_LOOK s, en quelques points pris le long de chaque faisceau de l'autre camp.
  spotLaser(e, dt) {
    const beams = this.beams.filter(b => b.from.team !== e.team);
    e.laserT = (e.laserT || 0) - dt;
    if (!beams.length || e.laserT > 0) return;
    e.laserT = LASER_LOOK;
    const sees = b => {
      const L = dist(b.x0, b.y0, b.x1, b.y1), n = Math.max(1, Math.ceil(L / U));
      for (let i = n; i >= 0; i--) if (this.seesSpot(e, lerp(b.x0, b.x1, i / n), lerp(b.y0, b.y1, i / n))) return true;
      return false;
    };
    const b = beams.find(sees);
    if (!b) return;
    const src = b.from, toward = Math.atan2(src.y - e.y, src.x - e.x);
    e.alertAngle = toward;
    e.suspicion = Math.min(2, (e.suspicion || 0) + LASER_ALARM);
    if (e.hunter) { this.know(e, src.x, src.y, src); return; }
    if (e.state !== 'investigate') e.homeAngle = toward;
    if (e.suspicion >= SUSPICION_GO && e.state !== 'investigate') this.investigate(e, src.x, src.y, 0.6);
  }

  // Un point dans le champ de vision d'un agent, à portée et sans obstacle.
  seesSpot(a, x, y) {
    const ang = Math.atan2(y - a.y, x - a.x);
    if (dist(a.x, a.y, x, y) > this.viewOf(a, ang)) return false;
    if (Math.abs(angleDiff(a.angle, ang)) > a.fov / 2) return false;
    return this.map.hasLOS(a.x, a.y, x, y);
  }

  // Animation de mort : l'agent glisse un peu dans la direction du tir puis s'effondre.
  updateDying(dt) {
    for (const a of [...this.ops, ...this.enemies]) {
      const d = a.dying;
      if (!d) continue;
      d.t += dt;
      const k = clamp(d.t / d.dur, 0, 1);
      if (k < 0.5) {
        const sp = 40 * (1 - k * 2);
        const nx = a.x + Math.cos(d.dir) * sp * dt, ny = a.y + Math.sin(d.dir) * sp * dt;
        if (this.map.circleFree(nx, ny, a.radius - 3, false)) { a.x = nx; a.y = ny; }
      }
      if (k >= 1) {
        a.dying = null;
        this.addDecal({ type: 'pool', x: a.x, y: a.y, rot: a.bodyAngle });
      }
    }
  }

  step(dt) {
    this.time += dt;
    for (const d of this.map.doors) {
      if (d.opening) {
        // animation dans les deux sens (ouverture ou fermeture)
        const dir = Math.sign(d.target - d.progress);
        d.progress += dir * dt / d.duration;
        if ((dir >= 0 && d.progress >= d.target) || (dir < 0 && d.progress <= d.target)) {
          d.progress = d.target;
          d.opening = false;
          d.open = d.target >= 1;
          d.ajar = !d.open && d.target > 0;
        }
      }
    }
    if (this.siege) this.updateSiege(dt);
    if (this.war) this.updateWar();
    if (this.squads) this.radioStep(); // (les trinômes se transmettent ce qu'ils voient)
    if (this.hunt) for (const st of this.hunt.stacks.slice()) this.updateAiStack(st, dt);
    this.updateActions(dt);
    this.updateCooking(this.player, dt);
    this.updatePlayer(dt);
    this.beams = [...this.ops, ...this.enemies].map(a => this.laserBeam(a)).filter(Boolean);
    this.beam = this.beams.find(b => b.from === this.player) || null;
    this.updateCharges(dt);
    this.updateStack(dt);
    // les agents autonomes (intervention du siège, trinômes) progressent seuls, dans un camp comme dans l'autre
    for (const m of this.mates) (m.hunter ? this.updateAssault(m, dt) : this.updateMate(m, dt));
    for (const e of this.enemies) (e.hunter ? this.updateAssault(e, dt) : this.updateEnemy(e, dt));
    this.updateHostages(dt);
    if (this.escort) this.updateEscort();
    this.separate();
    this.separateHostages();
    this.updateBullets(dt);
    this.updateGrenades(dt);
    for (const c of this.casings) {
      c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.9; c.vy *= 0.9; c.rot += c.spin * dt;
      if (c.t >= c.life) this.addDecal({ type: 'casing', x: c.x, y: c.y, rot: c.rot });
    }
    this.casings = this.casings.filter(c => c.t < c.life);
    for (const f of this.effects) f.t += dt;
    this.effects = this.effects.filter(f => f.t < f.life);
    for (const f of this.tracers) f.t += dt;
    this.tracers = this.tracers.filter(f => f.t < TRACER_LIFE);
    for (const a of [...this.ops, ...this.enemies]) {
      if (a.glowT > 0) a.glowT -= dt;
      a.stillT = a.moving ? 0 : (a.stillT || 0) + dt; // temps à l'arrêt : la lunette demande de poser l'œil
    }
    for (const h of this.heard) h.t += dt;
    this.heard = this.heard.filter(h => h.t < NOISE_KINDS[h.kind].life);
    for (const h of this.hurt) h.t += dt;
    this.hurt = this.hurt.filter(h => h.t < HURT_LIFE);
    if (this.message.t > 0) this.message.t -= dt;
    // Joueur tombé : après un court instant, on reprend la partie dans un coéquipier encore debout (en guerre totale,
    // de votre trinôme seulement : sinon on attend les renforts ; en stratégie, jamais : vous commandez de loin).
    if (!this.player.alive && !this.player.commander && (this.war ? this.crew.length : this.mates.some(m => m.alive))) {
      this.relayT += dt;
      if (this.relayT >= RELAY_DELAY) this.takeOver();
    }
    this.checkEnd();
  }

  checkEnd() {
    if (this.over) return;
    if (this.siege) {
      if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = 'Vous êtes tous tombés : le bâtiment est repris.'; }
      // Perdre un otage coûte cher, mais la partie ne s'arrête que quand il n'en reste plus
      // aucun de vivant entre vos mains (tous morts, ou morts et évacués par l'intervention).
      else if (this.hostages.length && this.hostages.every(h => !h.alive)) { this.over = 'lose'; this.loseReason = "Tous les otages sont morts : vous n'avez plus rien à négocier, l'assaut passe en force."; }
      else if (this.hostages.length && this.hostages.every(h => h.evacuated || !h.alive)) {
        this.over = 'lose';
        this.loseReason = this.hostages.every(h => h.evacuated)
          ? "Tous les otages ont été évacués par l'intervention : vous ne négociez plus rien."
          : "Plus aucun otage vivant entre vos mains : vous ne négociez plus rien.";
      }
      else if (this.siege.wave >= this.siege.waves.length && !this.enemies.some(e => e.alive)) this.over = 'win';
    } else if (this.defense) {
      // Stratégie : assaut : ni renforts ni limite de temps ; gagné quand plus personne du groupe armé ne tient le terrain,
      // perdu quand vos trois trinômes sont anéantis.
      if (!this.mates.some(m => m.alive)) { this.over = 'lose'; this.loseReason = 'Vos trois groupes sont anéantis : le groupe armé tient toujours le terrain.'; }
      else if (!this.enemies.some(Game.active)) this.over = 'win';
    } else if (this.war) {
      // Guerre totale : personne n'est jamais à court d'hommes ; au bout du temps, l'armée qui a abattu le plus
      // d'adversaires l'emporte, et à égalité, personne.
      if (this.time >= WAR_TIME) {
        const k = this.war.kills;
        this.over = k.ops > k.enemy ? 'win' : k.ops < k.enemy ? 'lose' : 'draw';
        if (this.over === 'lose') this.loseReason = `L'armée d'en face l'emporte, ${k.enemy} adversaires abattus contre ${k.ops}.`;
      }
    } else if (this.squads) {
      // Trinômes : le premier camp entièrement hors de combat a perdu.
      if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = 'Vos deux trinômes sont hors de combat.'; }
      else if (!this.enemies.some(e => e.alive)) this.over = 'win';
    } else if (this.escort) {
      // Escorte : gagné dès que le VIP atteint le point B, quels que soient les terroristes encore debout.
      if (!this.vip.alive) { this.over = 'lose'; this.loseReason = 'Le VIP a été tué.'; }
      else if (this.hostages.some(h => !h.alive)) { this.over = 'lose'; this.loseReason = 'Un otage a été tué.'; }
      else if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = "Toute l'équipe est hors de combat : le VIP reste seul aux mains du commando."; }
      else if (this.escort.safe) this.over = 'win';
    } else if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = "Toute l'équipe est hors de combat."; }
    else if (this.hostages.some(h => !h.alive)) { this.over = 'lose'; this.loseReason = 'Un otage a été tué.'; }
    // tous les suspects neutralisés (abattus ou menottés) : c'est gagné, que les otages soient déjà dehors ou non
    else if (this.enemies.every(e => !e.alive || e.cuffed)) this.over = 'win';
    else this.objectiveCues();
    if (this.over) {
      this.score = this.scoreReport(this.over);
      if (this.saveRecords) this.saveRecord(this.score);
      this.emit('over', this.over);
    }
  }

  // Suspect encore à neutraliser : debout, ou rendu mais pas encore menotté.
  static active(e) { return e.alive && !e.cuffed; }

  // Assaut : faire sortir les otages n'est pas exigé, mais les met à l'abri ; on annonce une fois qu'ils le sont tous.
  // Un suspect rendu compte tant qu'il n'est pas menotté : on le rappelle quand il ne reste que ceux-là.
  objectiveCues() {
    const inside = this.hostages.filter(h => h.alive && !h.evacuated).length;
    const left = this.enemies.filter(Game.active);
    if (!this.cues.out && this.hostages.length && !inside && left.length) {
      this.cues.out = true;
      this.say('Tous les otages sont dehors — reste à neutraliser les suspects', 3.5);
    }
    if (!this.cues.cuff && left.length && left.every(e => e.surrender)) {
      this.cues.cuff = true;
      this.say(left.length > 1 ? 'Il reste des suspects rendus — menottez-les (H) pour terminer' : 'Il reste un suspect rendu — menottez-le (H) pour terminer', 3.5);
    }
  }

  // ---- Note de fin de mission ----
  // Lignes { label, detail, pts } et total sur 100. En assaut, on gagne surtout à garder les otages en vie et
  // à arrêter plutôt qu'abattre ; abattre un suspect rendu coûte cher. En siège, à tenir avec ses otages. En
  // escorte, à amener le VIP indemne, sans perte et sans alerte générale : nul besoin de tout nettoyer.
  scoreReport(result) {
    const win = result === 'win', draw = result === 'draw', H = this.hostages.length, size = this.squadSize || 1;
    const lost = this.ops.filter(o => !o.alive).length, s = this.stats, lines = [];
    const add = (label, detail, pts) => lines.push({ label, detail: String(detail), pts: Math.round(pts) });
    const share = (n, of, pts) => (of ? pts * n / of : pts);
    if (this.siege) {
      const held = this.hostages.filter(h => h.alive && !h.evacuated).length, n = this.enemies.length;
      add('Assaut', win ? 'repoussé' : 'réussi', win ? 40 : 0);
      add('Otages entre vos mains', `${held} / ${H}`, share(held, H, 30));
      add('Groupe debout', `${size - lost} / ${size}`, share(size - lost, size, 20));
      add('Opérateurs neutralisés', `${s.kills} / ${n}`, share(s.kills, n, 10));
    } else if (this.defense) {
      // Stratégie : assaut : le terrain repris, les hommes gardés debout, le groupe armé neutralisé, et sans alerte générale
      const n = this.war.defense.total, down = n - this.enemies.filter(Game.active).length;
      const army = this.mates.length, up = this.mates.filter(m => m.alive).length;
      add('Mission', win ? 'terrain repris' : 'échouée', win ? 40 : 0);
      add('Hommes debout', `${up} / ${army}`, share(up, army, 30));
      add('Groupe armé neutralisé', `${down} / ${n}`, share(down, n, 20));
      add('Discrétion', this.alarm ? 'alerte générale' : 'aucune alerte', this.alarm ? 0 : 10);
    } else if (this.strat) {
      // Stratégie : la bataille, la part de votre armée dans le décompte, les groupes que vous avez laissé anéantir et
      // les hommes perdus (autant que votre armée en compte au départ ne laissent rien)
      const W = this.war, ours = W.kills.ops, theirs = W.kills.enemy;
      add('Bataille', win ? 'remportée' : draw ? 'égalité' : 'perdue', win ? 40 : draw ? 20 : 0);
      add('Score des armées', `${ours} – ${theirs}`, ours + theirs ? 30 * ours / (ours + theirs) : 15);
      add('Groupes anéantis', W.lost || 'aucun', Math.max(0, 20 - 5 * W.lost));
      add('Hommes perdus', theirs, 10 * Math.max(0, 1 - theirs / this.armySize()));
    } else if (this.war) {
      // Guerre totale : la bataille, la part de l'armée dans le décompte, vos propres éliminations, et votre trinôme tenu
      const W = this.war, ours = W.kills.ops, theirs = W.kills.enemy, n = W.reinforce;
      add('Bataille', win ? 'remportée' : draw ? 'égalité' : 'perdue', win ? 40 : draw ? 20 : 0);
      add('Score des armées', `${ours} – ${theirs}`, ours + theirs ? 30 * ours / (ours + theirs) : 15);
      add('Vos éliminations', W.mine, Math.min(20, 4 * W.mine));
      add('Votre trinôme', n ? `anéanti ${n} fois` : 'jamais anéanti', Math.max(0, 10 - 5 * n));
      if (s.friendly) add('Balles dans votre camp', s.friendly, -3 * s.friendly);
    } else if (this.squads) {
      const n = this.enemies.length;
      add('Engagement', win ? 'remporté' : 'perdu', win ? 40 : 0);
      add('Votre camp debout', `${size - lost} / ${size}`, share(size - lost, size, 40));
      add('Adversaires neutralisés', `${s.kills} / ${n}`, share(s.kills, n, 20));
      if (s.friendly) add('Balles dans votre camp', s.friendly, -3 * s.friendly);
    } else if (this.escort) {
      const v = this.vip;
      add('Mission', win ? 'VIP exfiltré' : 'échouée', win ? 35 : 0);
      add('Santé du VIP', v.alive ? `${Math.round(100 * v.hp / v.maxHp)} %` : 'tué', v.alive ? 35 * v.hp / v.maxHp : 0);
      add('Équipe indemne', `${size - lost} / ${size}`, share(size - lost, size, 20));
      add('Discrétion', this.alarm ? 'alerte générale' : 'aucune alerte', this.alarm ? 0 : 10);
      if (s.vipHits) add("VIP touché par l'équipe", s.vipHits, -10 * s.vipHits);
      if (s.badKills) add('Suspects abattus après reddition', s.badKills, -15 * s.badKills);
      if (s.friendly) add("Balles dans l'équipe", s.friendly, -3 * s.friendly);
    } else {
      const alive = this.hostages.filter(h => h.alive).length, hurt = this.hostages.filter(h => h.alive && h.wounded).length;
      const out = this.hostages.filter(h => h.evacuated).length, n = this.enemies.length;
      add('Mission', win ? 'accomplie' : 'échouée', win ? 25 : 0);
      add('Otages en vie', `${alive} / ${H}`, share(alive, H, 30));
      if (hurt) add('Otages blessés', hurt, -4 * hurt);
      add('Otages évacués', `${out} / ${H}`, share(out, H, 10));
      add('Suspects arrêtés', `${s.arrests} / ${n}`, share(s.arrests, n, 20));
      add('Équipe indemne', `${size - lost} / ${size}`, share(size - lost, size, 15));
      if (s.badKills) add('Suspects abattus après reddition', s.badKills, -15 * s.badKills);
      if (s.friendly) add("Balles dans l'équipe", s.friendly, -3 * s.friendly);
      if (this.alarm) add('Alerte générale donnée', 'par un suspect', -5);
    }
    let total = clamp(lines.reduce((t, l) => t + l.pts, 0), 0, 100);
    // une égalité (guerre totale) plafonne à C
    if (!win) total = Math.min(total, draw ? 69 : 49);
    const grade = !win ? (draw && total >= 55 ? 'C' : 'D') : total >= 95 ? 'S' : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
    return { lines, total, grade };
  }

  // Meilleure note par mission et par mode, gardée dans le navigateur.
  saveRecord(sc) {
    const key = `breach.best.${this.mode}.${this.levelIndex}`;
    let prev = null;
    try { const v = parseInt(localStorage.getItem(key), 10); if (Number.isFinite(v)) prev = v; } catch (e) { /* stockage indisponible */ }
    const beaten = prev === null || sc.total > prev;
    if (beaten) { try { localStorage.setItem(key, String(sc.total)); } catch (e) { /* idem */ } }
    this.record = { prev, beaten };
  }

  tryMove(agent, mx, my) {
    const r = agent.radius - 1;
    if (this.map.circleFree(agent.x + mx, agent.y, r, true)) agent.x += mx;
    if (this.map.circleFree(agent.x, agent.y + my, r, true)) agent.y += my;
  }

  nearestDoor(agent, R) {
    let best = null, bd = R;
    for (const d of this.map.doors) {
      const dd = dist(agent.x, agent.y, d.cx, d.cy);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  pathTo(agent, wx, wy, opts) {
    return this.map.routeTo(agent.x, agent.y, Math.floor(wx / TILE), Math.floor(wy / TILE), agent.radius, opts) || [];
  }

  canSee(agent, other) {
    const d = dist(agent.x, agent.y, other.x, other.y), a = Math.atan2(other.y - agent.y, other.x - agent.x);
    if (d > this.viewOf(agent, a) || (this.dark && d > DARK_SIGHT && d > this.sightOf(agent, other))) return false;
    if (Math.abs(angleDiff(agent.angle, a)) > agent.fov / 2) return false;
    return this.map.hasLOS(agent.x, agent.y, other.x, other.y);
  }

  // Cible visible la plus proche parmi des candidats ; le VIP, dès qu'il est en vue, passe avant tout le monde. Un agent
  // autonome (entraîné) ne vide pas son chargeur dans un bouclier qui arrête ses balles : il vise d'abord ceux qu'il
  // couvre (un bouclier tourné vers lui compte comme SHIELD_SHUN plus loin).
  acquireFor(agent, cands) {
    const vip = cands.find(c => c.vip);
    if (vip && vip.alive && this.canSee(agent, vip)) return vip;
    let best = null, bd = Infinity;
    for (const c of cands) {
      if (!c.alive || c.surrender) continue; // on ne tire pas sur un suspect rendu
      const d = dist(agent.x, agent.y, c.x, c.y) + (agent.hunter && this.shieldStops(c, agent) ? SHIELD_SHUN : 0);
      if (d < bd && this.canSee(agent, c)) { bd = d; best = c; }
    }
    return best;
  }

  // Le bouclier de c, tourné vers le tireur a, arrête-t-il ses balles (voir Game.shieldHit) ?
  shieldStops(c, a) {
    const sh = c.shield;
    return !!(sh && a.weapon && a.weapon.pen <= sh.stops && Math.abs(angleDiff(c.angle, Math.atan2(a.y - c.y, a.x - c.x))) <= sh.arc);
  }

  // Les siens (le camp de a, vous compris côté ops) et ceux d'en face (le VIP compris, pour le commando de l'escorte).
  teamOf(a) { return a.team === 'ops' ? this.ops : this.enemies; }
  foesOf(a) { return a.team === 'ops' ? this.enemies : this.vip ? [...this.ops, this.vip] : this.ops; }

  separate() {
    const all = [...this.ops, ...this.enemies].filter(a => a.alive);
    const p = this.player;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.radius + b.radius;
      if (d < min) {
        // exactement superposés : on les écarte dans une direction arbitraire mais stable
        const k = i * 2.39996 + j;
        const nx = d > 0.001 ? dx / d : Math.cos(k), ny = d > 0.001 ? dy / d : Math.sin(k);
        // Les coéquipiers cèdent le passage : ils ne poussent jamais le joueur.
        const aMate = a !== p && a.team === 'ops', bMate = b !== p && b.team === 'ops';
        const onlyB = a === p && bMate, onlyA = b === p && aMate;
        const pushA = onlyA ? min - d : onlyB ? 0 : (min - d) / 2;
        const pushB = onlyB ? min - d : onlyA ? 0 : (min - d) / 2;
        const solidA = a.team === 'ops', solidB = b.team === 'ops';
        if (pushA && this.map.circleFree(a.x - nx * pushA, a.y - ny * pushA, a.radius - 1, solidA)) { a.x -= nx * pushA; a.y -= ny * pushA; }
        if (pushB && this.map.circleFree(b.x + nx * pushB, b.y + ny * pushB, b.radius - 1, solidB)) { b.x += nx * pushB; b.y += ny * pushB; }
      }
    }
  }

  // Si un agent est coincé dans un obstacle, on le ramène à la position libre la plus proche.
  unstick(agent) {
    const r = agent.radius - 1;
    if (this.map.circleFree(agent.x, agent.y, r, true)) return;
    for (let ring = 2; ring <= 28; ring += 2) {
      for (let k = 0; k < 16; k++) {
        const a = TAU * k / 16;
        const x = agent.x + Math.cos(a) * ring, y = agent.y + Math.sin(a) * ring;
        if (this.map.circleFree(x, y, r, true)) { agent.x = x; agent.y = y; return; }
      }
    }
  }

  // ---- Vision ----
  computeVision() {
    const p = this.player;
    const polys = [];
    if (p.alive) {
      this.map.markExplored(p.tx, p.ty);
      const cone = [];
      const n = Math.ceil(p.fov / (1 * DEG));
      // la lunette en service porte plus loin, dans l'axe seulement (pas dans le noir)
      for (let i = 0; i <= n; i++) {
        const a = p.angle - p.fov / 2 + p.fov * i / n;
        cone.push(this.map.castRay(p.x, p.y, a, this.dark ? DARK_SIGHT : this.viewOf(p, a), true));
      }
      polys.push({ x: p.x, y: p.y, pts: cone });
      this.lampPoly(p, polys);
      const near = [];
      const NR = 2.6 * U, nn = 72;
      for (let i = 0; i <= nn; i++) near.push(this.map.castRay(p.x, p.y, TAU * i / nn, NR, true));
      polys.push({ x: p.x, y: p.y, pts: near });
      this.nearRange = NR;
      // fibre glissée sous la porte : un large cône depuis l'autre côté du battant
      const f = p.fiber;
      if (f) {
        const fc = [];
        const fn = Math.ceil(f.fov / (1.5 * DEG));
        for (let i = 0; i <= fn; i++) fc.push(this.map.castRay(f.x, f.y, f.angle - f.fov / 2 + f.fov * i / fn, f.range, true));
        polys.push({ x: f.x, y: f.y, pts: fc });
      }
    }
    for (const m of this.mates || []) {
      if (!m.alive) continue;
      this.map.markExplored(m.tx, m.ty);
      const cone = [];
      const n = Math.ceil(m.fov / (1.5 * DEG));
      for (let i = 0; i <= n; i++) {
        const a = m.angle - m.fov / 2 + m.fov * i / n;
        cone.push(this.map.castRay(m.x, m.y, a, this.dark ? DARK_SIGHT : this.viewOf(m, a), true));
      }
      polys.push({ x: m.x, y: m.y, pts: cone });
      this.lampPoly(m, polys);
    }
    this.visionPolys = polys;
    const mates = (this.mates || []).filter(m => m.alive);
    const f = p.fiber;
    const fiberSees = o => f && dist(f.x, f.y, o.x, o.y) < f.range
      && Math.abs(angleDiff(f.angle, Math.atan2(o.y - f.y, o.x - f.x))) < f.fov / 2
      && this.map.hasLOS(f.x, f.y, o.x, o.y);
    const sees = o => (p.alive && (this.canSee(p, o) || (dist(p.x, p.y, o.x, o.y) < this.nearRange && this.map.hasLOS(p.x, p.y, o.x, o.y)) || fiberSees(o)))
      || mates.some(m => this.canSee(m, o));
    for (const e of this.enemies) e.visible = (e.alive || !!e.dying) && sees(e);
    for (const h of this.hostages) h.visible = !h.evacuated && sees(h);
    // un corps tombé hors de vue ne se dessine qu'une fois vu
    for (const o of [...this.enemies, ...this.hostages]) {
      if (!o.alive && !o.bodySeen && (o.visible || this.seesPoint(o.x, o.y))) o.bodySeen = true;
    }
    if (this.hiddenDecals.length) {
      const still = [];
      for (const d of this.hiddenDecals) (this.seesPoint(d.x, d.y) ? this.decals : still).push(d);
      this.hiddenDecals = still;
    }
  }

  // Cône éclairé par la lampe d'un agent : il ne compte que courant coupé (sinon on voit déjà plus loin).
  lampPoly(a, polys) {
    if (!this.dark || !this.lampLit(a)) return;
    const pts = [], n = Math.ceil(2 * LAMP_HALF / (1 * DEG));
    for (let i = 0; i <= n; i++) pts.push(this.map.castRay(a.x, a.y, a.angle - LAMP_HALF + 2 * LAMP_HALF * i / n, LAMP_RANGE, true));
    polys.push({ x: a.x, y: a.y, pts, lamp: true });
  }

  // Un décalque n'apparaît que si le groupe voit l'endroit (sinon il attend qu'on y regarde).
  addDecal(d) {
    (this.seesPoint(d.x, d.y) ? this.decals : this.hiddenDecals).push(d);
  }

  // Le point est-il dans un polygone de vision ? On le rapproche de 4 px de l'observateur,
  // pour qu'un impact collé au mur tombe du bon côté du bord du polygone.
  seesPoint(x, y) {
    for (const poly of this.visionPolys) {
      const d = dist(x, y, poly.x, poly.y);
      const k = d > 4 ? 4 / d : 0;
      const px = x + (poly.x - x) * k, py = y + (poly.y - y) * k;
      const v = [poly, ...poly.pts]; // le polygone part de l'œil de l'observateur
      let inside = false;
      for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const a = v[i], b = v[j];
        if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
}

// Les méthodes de Game sont réparties par thème dans js/game-*.js : chacun les déclare dans une classe anonyme
// (mixGame(class { ... })), dont les méthodes, accesseurs et méthodes statiques sont versés dans Game. Un nom déjà
// pris est une erreur : deux fichiers ne définissent pas la même méthode.
function mixGame(part) {
  const put = (to, from, skip) => {
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(from))) {
      if (skip.includes(k)) continue;
      if (Object.prototype.hasOwnProperty.call(to, k)) throw new Error('Game.' + k + ' est défini deux fois');
      Object.defineProperty(to, k, d);
    }
  };
  put(Game.prototype, part.prototype, ['constructor']);
  put(Game, part, ['length', 'name', 'prototype']);
}
