'use strict';
// Logique temps réel : joueur, ennemis, balles, portes, grenades, vision.
// Mode siège : effectif de chaque vague d'assaut, dans l'ordre d'entrée.
const SIEGE_WAVES = [3, 3, 3];
// Délai entre la mort du joueur et la reprise dans un coéquipier (on voit tomber son personnage).
const RELAY_DELAY = 1.2;
// Tir de l'IA en rafales : écart relatif de la pause d'une rafale à l'autre (voir Game.endBurst).
const BURST_JITTER = 0.25;
// Portée du ramassage d'une arme au sol, depuis le corps qui la porte.
const PICKUP_RANGE = 1.3 * U;
// Dégâts d'un seul coup au-delà desquels un otage meurt sans passer par la blessure.
// Durée de mèche, décomptée dès la fin du geste d'armement (et non du lancer).
const FUSE = { flash: 1.7, frag: 2 };
// Lancer : la grenade vole GRENADE_FLIGHT s (au-dessus du mobilier), puis roule en freinant.
const GRENADE_FLIGHT = 0.35, GRENADE_FRICTION = 4;
// Mode siège : durée pendant laquelle la minimap signale la pièce où une vague vient d'entrer.
const ARRIVAL_ALERT = 8;
// Chevrotine dans la serrure : nombre de plombs qu'il faut mettre dans une porte pour la faire sauter.
const BREACH_PELLETS = 5;
const HOSTAGE_GRAVE = 45;
// Otage escorté : distance à laquelle il suit son escorte (plus un écart par otage déjà dans la file),
// vitesse de marche, et portée de la prise en charge.
const HOSTAGE_GAP = 1.15 * U, HOSTAGE_GAP_STEP = 0.8 * U, HOSTAGE_SPEED = 112, HOSTAGE_REACH = 1.6 * U;
// Il se jette à genoux ce temps-là quand on tire à moins de HOSTAGE_DUCK_RANGE de lui.
const HOSTAGE_DUCK = 1.2, HOSTAGE_DUCK_RANGE = 7 * U;
// Bruit (voir Game.noise) : surcoût de propagation, en px de « distance acoustique », pour traverser un
// mur, une porte qu'on ne peut pas franchir ou une vitre. Le son contourne sinon les angles par les embrasures.
const SOUND_WALL = 3 * U, SOUND_DOOR = 1.5 * U, SOUND_GLASS = 0.75 * U;
// Natures de bruit : poids dans l'attention d'un suspect, bruits « importants » (on va voir dès qu'on les
// entend assez fort), durée et couleur de leur repère à l'écran.
const NOISE_KINDS = {
  shot:   { w: 1,    important: true, life: 1.5, col: '255,96,64' },   // coup de feu
  boom:   { w: 1.3,  important: true, life: 2,   col: '255,255,255' }, // explosion, flash
  breach: { w: 1.1,  important: true, life: 1.6, col: '255,255,255' }, // serrure arrachée
  voice:  { w: 1,    important: true, life: 1.6, col: '255,167,38' },  // cri d'alerte
  body:   { w: 0.8,  life: 1.3, col: '240,140,140' },                  // corps qui tombe
  impact: { w: 0.6,  life: 0.9, col: '255,204,128' },                  // balle dans un mur ou une porte
  door:   { w: 0.55, life: 1.3, col: '255,213,79' },                   // porte manœuvrée
  bounce: { w: 0.45, life: 0.9, col: '200,210,215' },                  // grenade qui rebondit
  step:   { w: 0.4,  life: 0.8, col: '200,210,215' },                  // pas de course
};
// Ce qu'un suspect retient d'un bruit de son propre camp : un coup de feu, un cri, un corps qui tombe.
const ALLY_ALARM = new Set(['shot', 'voice', 'body']);
// Seuils d'attention (intensité perçue × poids) : se tourner vers le bruit ; aller voir un bruit important ;
// aller voir à force de bruits répétés (inquiétude cumulée, qui s'estompe de SUSPICION_DECAY par seconde).
const HEAR_TURN = 0.08, HEAR_GO = 0.3, SUSPICION_GO = 1, SUSPICION_DECAY = 0.15;
// Au plus RESPONDERS suspects vont voir un même bruit : les autres se tournent et restent sur leurs gardes,
// sauf s'ils sont très inquiets (SUSPICION_ALL).
const RESPONDERS = 2, SUSPICION_ALL = 1.6;
// Voisins d'une case pour la propagation du son : [dx, dy, longueur].
const SOUND_NB = [[1, 0, TILE], [-1, 0, TILE], [0, 1, TILE], [0, -1, TILE],
  [1, 1, TILE * Math.SQRT2], [-1, 1, TILE * Math.SQRT2], [1, -1, TILE * Math.SQRT2], [-1, -1, TILE * Math.SQRT2]];
// Pas de course : distance entre deux bruits de pas, et portée selon qui court.
const STEP_EVERY = 30, STEP_NOISE = { run: 2.5 * U, mate: 2.2 * U, operator: 2.4 * U, suspect: 2 * U };
// Grenade à fragmentation (camp du groupe armé en siège) : rayon létal et dégâts au centre.
const FRAG_RADIUS = 3.5 * U;
const FRAG_DAMAGE = 200;
// L'IA (suspects, opérateurs, trinômes, coéquipiers) n'ouvre le feu qu'à AI_FIRE_RANGE au plus, même si elle voit et
// porte plus loin : plus loin, elle se rapproche. L'écran n'en montre guère davantage dans la direction visée (voir
// VIEW_HALF dans js/render.js) : on n'est pas pris pour cible par un tireur qu'on ne peut pas voir à l'écran.
const AI_FIRE_RANGE = 9 * U;
// Laser : portée du faisceau, intervalle entre deux coups d'œil d'un suspect, inquiétude ajoutée quand il le voit.
const LASER_RANGE = 22 * U, LASER_LOOK = 0.2, LASER_ALARM = 0.4;
// Tir dans une porte (suspects) : durée pendant laquelle il arrose une porte derrière laquelle il sait quelqu'un,
// écart latéral de ses rafales autour du point visé, et distance à laquelle une balle sortie d'une porte le fait riposter.
const BLIND_FIRE = 2.5, BLIND_SWEEP = 0.6 * U, BLIND_NEAR = 1.2 * U;
// Sommation (assaut) : portée de la voix, délai entre deux cris ; un suspect rendu mais laissé sans
// surveillance SURRENDER_LAPSE s reprend son arme ; menotter prend CUFF_TIME s.
const SHOUT_RANGE = 7 * U, SHOUT_COOLDOWN = 1.5, SURRENDER_LAPSE = 7, CUFF_TIME = 1.6;
// Courant coupé : portée du regard sans lumière. Lampe : demi-ouverture et portée du faisceau, retard
// infligé à celui qui la prend en face d'assez près. Un coup de feu sans silencieux éclaire le tireur SHOT_GLOW s.
const DARK_SIGHT = 4 * U, LAMP_HALF = 22 * DEG, LAMP_RANGE = 12 * U, LAMP_DAZZLE = 0.6, LAMP_DAZZLE_RANGE = 6 * U, SHOT_GLOW = 0.4;
// Portes fermées à clé (assaut) : part des portes verrouillées, durée du crochetage.
const LOCK_CHANCE = 0.3, LOCKPICK_TIME = 4;
// Charge de brèche : nombre par mission, durée de la pose, portée du souffle derrière la porte, et de votre côté.
const CHARGES = 2, CHARGE_PLACE = 1.4, CHARGE_RADIUS = 2.5 * U, CHARGE_NEAR = 1.4 * U;
// Entrée coordonnée : délai entre l'ouverture de la porte et l'entrée de l'équipe (sans flash en préparation).
const ENTRY_DELAY = 0.5;
// Entrée à la flash (second clic droit sur la porte de la colonne) : le coéquipier posté du côté d'où une flash passe
// par l'entrebâillement (selon le sens du battant, voir Game.flashAimFrom) entrouvre la porte à FLASH_CRACK, glisse
// dans la pièce une flash dégoupillée depuis MATE_COOK s, et l'ouvre en grand à l'éclair.
const FLASH_CRACK = DOOR_PASS, MATE_COOK = 0.5;
// Entrée coordonnée de l'intervention (siège) : devant une porte fermée sur son chemin, un opérateur qui a au moins un
// équipier libre à AI_STACK_RANGE de la porte, de son côté, forme de temps en temps une colonne, comme l'équipe du joueur
// au clic droit : une fois sur AI_STACK_CHANCE, AI_STACK_THREAT quand le dernier contact est derrière la porte, au plus
// une colonne toutes les AI_STACK_GAP s (une même porte n'est retentée qu'au double). L'entrée se fait porte ouverte, à
// la flash (au moins AI_FLASH_MIN opérateurs, et une flash dans l'équipe) ou à la charge (chaque vague en porte
// WAVE_CHARGES). Une colonne qui n'a rien entamé au bout de AI_STACK_TIMEOUT s se défait. Entré, chacun tient son angle
// AI_CLEAR s.
const AI_STACK_RANGE = 5 * U, AI_STACK_CHANCE = 0.5, AI_STACK_THREAT = 0.85, AI_STACK_GAP = 8, AI_FLASH_MIN = 3;
const AI_STACK_TIMEOUT = 15, WAVE_CHARGES = 1, AI_CLEAR = 1.5;
// Rondes (assaut) : PATROLS suspects font le tour de deux ou trois points au lieu de tenir leur poste, au pas
// (PATROL_SPEED de leur vitesse), avec une pause de PATROL_PAUSE s à chaque point ; une étape fait entre
// PATROL_LEG[0] et PATROL_LEG[1] de chemin.
const PATROLS = 2, PATROL_SPEED = 0.55, PATROL_PAUSE = [2, 5], PATROL_LEG = [4 * U, 12 * U];
// Alerte générale (assaut) : un suspect encore debout ALARM_TIME s après avoir vu un opérateur (le temps sonné
// ne compte pas) prévient tout le bâtiment. Les autres réagissent alors plus vite (ALARM_REACT), et les
// RESPONDERS les plus proches vont voir. Une fois par mission.
const ALARM_TIME = 3, ALARM_REACT = 0.7;
// Trinômes : un contact signalé par un équipier reste une destination SQUAD_CONTACT s ; un trinôme qui avance attend
// celui des siens resté à plus de SQUAD_SPREAD derrière.
const SQUAD_CONTACT = 20, SQUAD_SPREAD = 4 * U;
// Trinômes : deux entrées « à l'écart » l'une de l'autre ne se voient pas, ou sont à plus de SQUAD_APART (au-delà de la
// vue d'un opérateur).
const SQUAD_APART = 16 * U;
// Trinômes : un homme du groupe armé n'est pas un suspect de l'assaut. Il vaut un opérateur (santé, réaction, champ
// de vision), sans ses flashs ni ses charges, mais avec deux grenades à fragmentation.
const SQUAD_MILITANT = { hp: 110, maxHp: 110, reaction: 0.35, turnRate: 7, fov: 110 * DEG, viewRange: 14 * U, flashbangs: 2 };
// Escorte : un terroriste qui voit le VIP le vise, quoi qu'il fasse (même en plein échange avec l'équipe, il
// pivote vers lui en VIP_SWITCH s au moins) ; personne n'est posté à moins de GOAL_MARGIN de la zone d'extraction.
const VIP_SWITCH = 0.2, GOAL_MARGIN = 2 * U;
// Guerre totale : durée de la bataille, délai avant qu'un trinôme anéanti ne revienne de sa base, et âge au-delà duquel
// un corps hors de vue est retiré (cinq minutes de combat en laissent des dizaines).
const WAR_TIME = 300, WAR_RESPAWN = 6, WAR_BODY_LIFE = 45;
// Guerre totale : un trinôme autonome avance dans son couloir par étapes de WAR_STEP (voir warSectors).
const WAR_STEP = 4 * U;

class Game {
  constructor() {
    this.levelIndex = 0;
    this.listeners = {};
    this.minimap = true;
    this.input = { keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, rdown: false } };
    this.orderDrag = null; // ordre de déplacement en cours de tracé (clic droit maintenu)
    this.visionPolys = [];
    this.heard = [];
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
    };
  }

  setLoadout(l) {
    const teamBefore = !!this.loadout.teamSup, cutBefore = !!this.loadout.cutPower, nadesBefore = this.loadout.nades;
    this.loadout = { ...this.loadout, ...l };
    try { localStorage.setItem('breach.loadout.' + this.mode, JSON.stringify(this.loadout)); } catch (e) { /* stockage indisponible */ }
    // les silencieux (ou les lampes, courant coupé) des coéquipiers changent leur arme : on la leur redistribue
    const changed = !!this.loadout.teamSup !== teamBefore || !!this.loadout.cutPower !== cutBefore;
    if (changed && this.mode !== 'siege') { this.loadLevel(this.levelIndex); return; }
    this.player.equip(this.loadout);
    if (this.loadout.nades !== nadesBefore) this.armGrenades(this.player);
    this.emit('weapon');
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
    this.war = null;
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
    // point A (et les abords du point B).
    const quiet = entryBreach ? this.map.roomOf(entryBreach.inside.x, entryBreach.inside.y)
      : escort ? this.escortQuiet(vipAt) : null;
    // Postes tirés au sort à chaque partie : la disposition des terroristes (le chef compris) et
    // des otages ne se mémorise pas d'une partie à l'autre.
    const nFoes = squads ? 0 : this.map.enemySpawns.length || 1;
    const nHost = squads ? 0 : this.map.hostageSpawns.length;
    const free = this.buildPosts(quiet, nFoes + nHost);
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
    const weps = def.enemyWeapons || ['ak'];
    this.enemies = siege || squads ? [] : foePosts.map(q => new Enemy(q.x, q.y, null, weps[Math.floor(Math.random() * weps.length)]));
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
      this.mates = mateDefs.map(d => {
        const t = near.find(f => taken.every(o => dist((f.x + 0.5) * TILE, (f.y + 0.5) * TILE, o.x, o.y) >= 26)) || s;
        taken.push({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
        const m = new Teammate((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, d);
        m.angle = this.player.angle;
        return m;
      });
      if (quiet && !squads) this.clearZone(quiet);
      this.siege = null;
      this.player.charges = armed ? 0 : CHARGES;
      if (war) this.startWar();
      else if (squads) this.startSquads(entryBreach);
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
    this.alarm = null;   // alerte générale donnée par un suspect : { by, x, y, t } (voir raiseAlarm)
    this.score = null;   // note de fin de mission (voir scoreReport)
    this.record = null;  // meilleure note précédente pour cette mission, et si elle vient d'être battue
    this.squadSize = 1 + this.mates.length; // vous compris : c'est le groupe entier qui compte ses pertes
    this.orderMarker = null;
    this.orderDrag = null;
    this.relayT = 0;
    this.pickHint = null;
    this.hostHint = null;
    this.cues = {}; // annonces d'objectif déjà faites (otages tous dehors, suspects à menotter)
    this.heard = [];      // bruits entendus hors de vue : direction et intensité (repères autour du joueur)
    this.ownNoise = null; // halo du dernier bruit du joueur
    if (this.player) this.player.cooking = null;
    this.message = { text: '', t: 0 };
    this.computeVision();
    this.emit('level');
  }

  // Rondes : PATROLS suspects tirés au sort reçoivent un circuit de deux ou trois points, leur poste compris.
  // Chaque étape fait entre PATROL_LEG[0] et PATROL_LEG[1] de chemin (des portes à franchir au besoin : ils ont
  // les clés), et aucune ne passe par la zone où l'équipe commence (room : pièce d'entrée de l'assaut, ou
  // point A de l'escorte et abords du point B ; voir loadLevel).
  buildPatrols(room) {
    const m = this.map;
    const inRoom = q => !!room && room.has(Math.floor(q.y / TILE) * m.w + Math.floor(q.x / TILE));
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const cand = [];
    for (let ty = 2; ty < m.h - 2; ty += 2) for (let tx = 2; tx < m.w - 2; tx += 2) {
      if (m.blocksMove(tx, ty) || m.door(tx, ty) || m.tile(tx, ty) !== 0) continue;
      const q = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (!inRoom(q) && m.circleFree(q.x, q.y, 12, true)) cand.push(q);
    }
    // longueur du chemin de a à b, ou null s'il n'y en a pas, s'il sort des bornes ou traverse la pièce d'entrée
    const leg = (a, b, r) => {
      const path = m.routeTo(a.x, a.y, Math.floor(b.x / TILE), Math.floor(b.y / TILE), r);
      if (!path || !path.length || path.some(inRoom)) return null;
      let L = 0, px = a.x, py = a.y;
      for (const q of path) { L += dist(px, py, q.x, q.y); px = q.x; py = q.y; }
      return L >= PATROL_LEG[0] && L <= PATROL_LEG[1] ? L : null;
    };
    let made = 0;
    for (const e of shuffle(this.enemies.slice())) {
      if (made >= PATROLS) break;
      const pts = [{ x: e.home.x, y: e.home.y }];
      for (const c of shuffle(cand)) {
        if (pts.length >= 3) break;
        const last = pts[pts.length - 1];
        if (pts.some(q => dist(q.x, q.y, c.x, c.y) < 3 * U) || dist(last.x, last.y, c.x, c.y) > PATROL_LEG[1]) continue;
        if (leg(last, c, e.radius) === null) continue;
        // le troisième point doit aussi ramener au poste
        if (pts.length === 2 && leg(c, pts[0], e.radius) === null) continue;
        pts.push(c);
      }
      if (pts.length < 2) continue;
      e.patrol = { pts, i: 0, wait: rand(0, 3), going: false };
      made++;
    }
  }

  // Ronde d'un suspect au calme : il marche jusqu'au point suivant, s'y arrête et regarde autour de lui, puis
  // repart. Son poste (home) suit la ronde : après être allé voir un bruit, il reprend où il en était.
  patrolStep(e, dt) {
    const P = e.patrol;
    if (e.path.length || e.waitDoor || e.holdT > 0) { this.moveAlong(e, dt); return; }
    if (P.going) { // arrivé : une pause, l'œil dans le sens de la marche
      P.going = false;
      P.wait = rand(PATROL_PAUSE[0], PATROL_PAUSE[1]);
      e.homeAngle = e.angle;
      e.idleT = rand(0.8, 1.6);
    }
    if (P.wait > 0) {
      P.wait -= dt;
      e.idleT -= dt;
      if (e.idleT <= 0) { e.idleT = rand(1, 2.2); e.lookAt = e.homeAngle + rand(-1.2, 1.2); }
      if (e.lookAt !== null && e.alertAngle === null && turnToward(e, e.lookAt, 2, dt)) e.lookAt = null;
      return;
    }
    P.i = (P.i + 1) % P.pts.length;
    const q = P.pts[P.i];
    e.home = { x: q.x, y: q.y };
    e.path = this.pathTo(e, q.x, q.y);
    e.lookAt = null;
    if (e.path.length) P.going = true;
    else P.wait = 2; // injoignable pour l'instant (quelqu'un dans le passage) : il essaiera le suivant
  }

  // Alerte générale : le suspect crie (on l'entend), et tout le bâtiment se met sur ses gardes. Chacun se tourne
  // vers l'endroit signalé et réagira plus vite ; les plus proches y vont.
  raiseAlarm(e) {
    const at = e.lastKnown || { x: e.x, y: e.y };
    this.alarm = { by: e, x: at.x, y: at.y, t: this.time };
    e.shoutT = this.time;
    this.noise(e.x, e.y, 8 * U, e, 'voice');
    Sound.alarm();
    this.say("Un suspect a donné l'alerte : tout le bâtiment est sur ses gardes", 3.5);
    const free = [];
    for (const o of this.enemies) {
      if (o === e || !Game.active(o) || o.surrender) continue;
      o.alerted = true;
      o.reaction *= ALARM_REACT;
      o.suspicion = Math.max(o.suspicion, SUSPICION_GO * 0.9);
      if (o.target || o.blind || o.state === 'engage') continue;
      const toward = Math.atan2(at.y - o.y, at.x - o.x);
      o.alertAngle = toward;
      if (o.state !== 'investigate') { o.homeAngle = toward; free.push(o); }
    }
    free.sort((a, b) => dist(a.x, a.y, at.x, at.y) - dist(b.x, b.y, at.x, at.y));
    for (const o of free.slice(0, RESPONDERS)) this.investigate(o, at.x, at.y, 0.7);
  }

  // Postes possibles pour les terroristes et les otages : les emplacements écrits sur la carte,
  // plus un quadrillage de cases libres, le tout mélangé. La disposition change donc à chaque partie,
  // sans jamais tomber là où l'équipe commence (room, voir loadLevel) ni coller deux personnes l'une à l'autre.
  buildPosts(room, needed) {
    const m = this.map;
    const cand = [];
    for (const sp of [...m.enemySpawns, ...m.hostageSpawns]) cand.push({ x: sp.x, y: sp.y });
    // le quadrillage reste sous toit : sur une carte en plein air, le jardin n'a de postes que ceux que la carte y place
    for (let ty = 2; ty < m.h - 2; ty += 3) for (let tx = 2; tx < m.w - 2; tx += 3) if (!OUTDOOR_FLOORS.has(m.floor(tx, ty))) cand.push({ x: tx, y: ty });
    for (let i = cand.length - 1; i > 0; i--) { // mélange de Fisher-Yates
      const j = Math.floor(Math.random() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
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

  // Escorte : personne n'est posté dans la pièce du point A, ni aux abords de la zone d'extraction.
  escortQuiet(a) {
    const m = this.map, zone = m.roomOf((a.x + 0.5) * TILE, (a.y + 0.5) * TILE), r = Math.ceil(GOAL_MARGIN / TILE);
    for (const g of m.goal ? m.goal.cells : []) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (m.inBounds(g.x + dx, g.y + dy)) zone.add((g.y + dy) * m.w + g.x + dx);
      }
    }
    return zone;
  }

  // Case de départ du joueur en escorte : une case de carte devant le VIP, vers le point B (il le suit).
  escortStart(a) {
    const m = this.map, ax = (a.x + 0.5) * TILE, ay = (a.y + 0.5) * TILE, room = m.roomOf(ax, ay);
    const ang = m.goal ? Math.atan2(m.goal.cy - ay, m.goal.cx - ax) : 0;
    const wx = ax + Math.cos(ang) * U, wy = ay + Math.sin(ang) * U;
    let best = a, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = a.x + dx, ty = a.y + dy, x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!room.has(ty * m.w + tx) || !m.circleFree(x, y, 14, true) || dist(x, y, ax, ay) < 26) continue;
      const d = dist(x, y, wx, wy);
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
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
  // totale, côté groupe armé, une arme d'épaule (on va au combat, pas tenir un poste) et un lot d'accessoires
  // (MILITANT_KITS).
  crewDefs(defs) {
    const squads = !!(MODES[this.mode] || {}).squads, armed = this.camp === 'armed', sup = !armed && !!this.loadout.teamSup;
    const pool = armed ? (squads ? SIEGE_MATE_POOL.filter(k => WEAPONS[k].cat !== 'hg') : SIEGE_MATE_POOL)
      : sup ? MATE_POOL.filter(k => SUPPRESSORS[k]) : MATE_POOL;
    const dealt = dealWeapons(pool, defs.length);
    const kits = squads && armed ? dealWeapons(MILITANT_KITS, defs.length) : null;
    return defs.map((d, i) => ({ ...d, weapon: dealt[i], acc: kits ? kits[i] : { sup, light: this.dark } }));
  }

  get ops() { return [this.player, ...(this.mates || [])]; }
  // Vos coéquipiers debout, ceux qui prennent vos ordres : pas le trinôme autonome de votre camp (mode trinômes).
  get crew() { return this.mates.filter(m => m.alive && !m.hunter); }

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
    const a = this.spawnSquad(foeA, 'enemy', theirs).members;
    this.enemies = [...a, ...this.spawnSquad(foeB, 'enemy', theirs, foeB === foeA ? a : []).members];
  }

  // Un trinôme autonome derrière l'ouverture b : trois opérateurs (flashs, une charge, colonnes) ou trois hommes du
  // groupe armé (deux grenades à fragmentation chacun, et des accessoires sur leur arme), qui balaient leurs propres
  // secteurs depuis leur entrée et partagent ce qu'ils apprennent (group.contact). Celui de votre camp porte un nom,
  // comme vos coéquipiers.
  // opts.pts : leurs places, déjà choisies (une base de la guerre totale) ; opts.names : les noms de ceux de votre camp.
  spawnSquad(b, team, camp, taken, opts = {}) {
    const police = camp === 'police', pts = opts.pts || this.breachFile(b, 3, taken);
    const weps = dealWeapons(police ? OPERATOR_POOL : MILITANT_POOL, 3), kits = police ? null : dealWeapons(MILITANT_KITS, 3);
    const group = { team, camp, breach: b, contact: null, members: [], sectors: this.buildSectors(null, b.inside) };
    pts.forEach((q, k) => {
      const a = police ? new Operator(q.x, q.y, b.angle, weps[k]) : new Enemy(q.x, q.y, b.angle, weps[k]);
      if (police) a.charges = k < WAVE_CHARGES ? 1 : 0;
      // le groupe armé des trinômes : des hommes aguerris, pas les suspects de l'assaut (plus solides et plus vifs)
      else {
        Object.assign(a, { hunter: true, nade: 'frag', flashbangs: 1, flashCd: rand(4, 10), charges: 0, entry: null, clear: null, ...SQUAD_MILITANT });
        a.slot = { def: fittedDef(weps[k], kits[k]), mag: Infinity, reserve: 0 };
        a.burstLeft = a.weapon.burst;
      }
      a.team = team;
      a.group = group;
      if (team === 'ops') {
        const d = (opts.names || SQUAD_DEFS[camp])[k];
        Object.assign(a, { name: d.name, accent: d.accent, coverAngle: null });
        if (!police) a.style = { ...STYLE_MILITANT, body: d.jacket, shoulder: d.jacket, sleeve: d.jacket, pants: d.pants };
      }
      group.members.push(a);
    });
    this.squads.groups.push(group);
    return group;
  }

  // ---- Guerre totale ----
  // Deux armées de trois trinômes. La vôtre part de la base choisie (ou tirée au sort) : votre trinôme, à vos ordres, au
  // centre, et deux trinômes autonomes sur les flancs ; l'autre armée, de l'autre base. Chaque trinôme autonome a son
  // couloir (warSectors). Un trinôme anéanti revient de sa base WAR_RESPAWN s plus tard (updateWar) ; au bout de
  // WAR_TIME s, l'armée qui a abattu le plus d'adversaires l'emporte (checkEnd). Le champ de bataille est connu d'avance.
  startWar() {
    const bs = this.map.bases, mine = this.camp, theirs = mine === 'police' ? 'armed' : 'police';
    const home = bs[this.entryIndex] || bs[0], away = bs.find(b => b !== home) || home;
    this.squads = { groups: [] };
    this.war = {
      bases: { ops: home, enemy: away },
      camps: { ops: mine, enemy: theirs },
      // les trois trinômes de chaque armée, tels qu'ils sont en ce moment (le premier des vôtres : le vôtre)
      slots: { ops: [{ team: 'ops', camp: mine, crew: true, members: [this.player, ...this.mates] }, null, null], enemy: [null, null, null] },
      respawn: { ops: [null, null, null], enemy: [null, null, null] }, // instant du retour d'un trinôme anéanti
      kills: { ops: 0, enemy: 0 }, // adversaires abattus par chaque armée
      mine: 0,                     // dont par vous
      reinforce: 0,                // retours de votre trinôme
      pruneT: 0,
    };
    for (const k of [1, 2]) this.warSquad('ops', k);
    for (const k of [0, 1, 2]) this.warSquad('enemy', k);
    const m = this.map;
    for (let i = 0; i < m.explored.length; i++) if (m.tiles[i] !== 2) m.explored[i] = 1;
  }

  // Couloir d'un trinôme : 0 et 2 les flancs, 1 le centre (le vôtre). Ceux des deux armées se font face.
  static warLane(team, k) { return team === 'ops' ? (k === 1 ? 0 : k === 2 ? 2 : 1) : k; }

  // Le trinôme k de l'armée team sort de sa base : trois hommes du camp de cette armée, du côté de son couloir.
  warSquad(team, k) {
    const W = this.war, base = W.bases[team], foe = W.bases[team === 'ops' ? 'enemy' : 'ops'], lane = Game.warLane(team, k);
    const taken = [...this.ops, ...this.enemies].filter(a => a.alive).map(a => ({ x: a.x, y: a.y }));
    const gate = { inside: { x: base.cx, y: base.cy }, angle: base.angle };
    const g = this.spawnSquad(gate, team, W.camps[team], taken, { pts: this.baseFile(base, 3, taken, lane), names: WAR_DEFS[W.camps[team]][k - 1] });
    g.sectors = this.warSectors(base, foe, lane);
    g.pingpong = true; // au bout du couloir, il le reprend dans l'autre sens
    g.slot = k;
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
        if (this.time >= at) (team === 'ops' && k === 0 ? this.warCrew() : this.warSquad(team, k));
        return;
      }
      if (g.members.some(a => a.alive)) return;
      W.respawn[team][k] = this.time + WAR_RESPAWN;
      this.say(team === 'enemy' ? 'Un trinôme adverse est anéanti'
        : k === 0 ? `Votre trinôme est anéanti — renforts dans ${WAR_RESPAWN} s`
        : `Le trinôme de ${g.members[0].name} est anéanti — renforts dans ${WAR_RESPAWN} s`, 2.5);
    });
    if (this.time - W.pruneT >= 5) { W.pruneT = this.time; this.pruneBodies(); }
  }

  // Guerre totale : un corps tombé depuis plus de WAR_BODY_LIFE s, que personne de votre camp ne voit, est retiré.
  pruneBodies() {
    const keep = a => a.alive || a.dying || a === this.player || this.time - (a.diedAt || 0) < WAR_BODY_LIFE || this.seesPoint(a.x, a.y);
    if (!this.mates.every(keep)) this.mates = this.mates.filter(keep);
    if (!this.enemies.every(keep)) this.enemies = this.enemies.filter(keep);
  }

  // ---- Mode siège ----
  // L'équipe d'intervention entre par l'entrée de la carte après un temps de préparation, puis
  // nettoie le bâtiment secteur par secteur. On gagne en repoussant toutes les vagues.
  startSiege(entryTile, entryPos) {
    const breaches = this.map.breaches.length
      ? this.map.breaches
      : [{ kind: 'door', cx: entryPos.x, cy: entryPos.y, inside: entryPos, angle: 0, door: null }];
    this.siege = {
      entry: entryPos,
      breaches,
      prep: 10,        // temps de préparation avant l'assaut
      waves: SIEGE_WAVES.slice(), // effectif de chaque vague ; on gagne quand la dernière est repoussée
      wave: 0,         // vagues déjà entrées
      nextWave: 0,     // compte à rebours de la vague suivante
      gap: 6,          // répit une fois la vague en cours éliminée
      maxGap: 30,      // au-delà, la vague suivante entre même si la précédente tient encore
      lastBreach: -1,
      arrival: null,   // dernière vague entrée : ouverture, pièce et instant (signalés sur la minimap)
      sectors: this.buildSectors(entryPos),
    };
    // Vous connaissez les lieux : le plan est acquis dès le départ (mais on ne voit toujours
    // que ce qui est dans son champ de vision).
    const m = this.map;
    for (let i = 0; i < m.explored.length; i++) if (m.tiles[i] !== 2) m.explored[i] = 1;
  }

  // Points de passage à nettoyer, du plus proche de l'entrée au plus lointain (from : d'un point précis, sinon de la
  // plus proche des ouvertures).
  buildSectors(entry, from) {
    const m = this.map, out = [];
    for (let ty = 2; ty < m.h - 2; ty += 5) for (let tx = 2; tx < m.w - 2; tx += 5) {
      if (m.blocksMove(tx, ty) || m.tile(tx, ty) !== 0) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!m.circleFree(x, y, 12, false)) continue;
      out.push({ x, y, done: false });
    }
    const near = p => (from ? dist(p.x, p.y, from.x, from.y) : Math.min(...(this.map.breaches.length ? this.map.breaches : [{ cx: entry.x, cy: entry.y }])
      .map(b => dist(p.x, p.y, b.cx, b.cy))));
    out.sort((a, b) => near(a) - near(b));
    return out;
  }

  // n places derrière l'ouverture b, en file vers l'intérieur puis de côté si la place manque : jamais deux au même
  // point, ni sur quelqu'un de taken.
  breachFile(b, n, taken) {
    const placed = [], others = taken || [];
    const free = (cx, cy) => this.map.circleFree(cx, cy, 11, false) && ![...placed, ...others].some(q => dist(q.x, q.y, cx, cy) < 20);
    let room = null;
    for (let k = 0; k < n; k++) {
      let spot = null;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      search: for (let r = 0; r <= 8; r++) for (const side of [0, 1, -1, 2, -2]) {
        const cx = b.inside.x + ca * r * 16 - sa * side * 16, cy = b.inside.y + sa * r * 16 + ca * side * 16;
        if (free(cx, cy)) { spot = { x: cx, y: cy }; break search; }
      }
      if (!spot) {
        // la file déborde (deux trinômes par la même ouverture) : la case libre la plus proche dans la pièce d'arrivée
        room = room || this.map.roomOf(b.inside.x, b.inside.y);
        let bd = Infinity;
        for (const i of room) {
          const cx = (i % this.map.w + 0.5) * TILE, cy = (Math.floor(i / this.map.w) + 0.5) * TILE, d = dist(cx, cy, b.inside.x, b.inside.y);
          if (d < bd && free(cx, cy)) { bd = d; spot = { x: cx, y: cy }; }
        }
      }
      placed.push(spot || { x: b.inside.x, y: b.inside.y });
    }
    return placed;
  }

  // Une vague entre par une ouverture, différente de la précédente quand c'est possible :
  // on ne doit jamais être sûr du côté par lequel ils arrivent.
  spawnAssault(n) {
    const s = this.siege, weps = dealWeapons(OPERATOR_POOL, n), bs = s.breaches;
    const i = bs.length > 1
      ? (s.lastBreach + 1 + Math.floor(Math.random() * (bs.length - 1))) % bs.length
      : 0;
    s.lastBreach = i;
    const b = bs[i];
    const placed = this.breachFile(b, n);
    for (let k = 0; k < n; k++) {
      const { x, y } = placed[k];
      const op = new Operator(x, y, b.angle, weps[k]);
      op.charges = k < WAVE_CHARGES ? 1 : 0;
      // entrer prend du temps : on enjambe la fenêtre ou on pousse la porte, arme basse
      if (b.door && k === 0) this.doorAction(op, b.door, 1);
      else this.startAction(op, b.kind === 'window' ? 'window' : 'door', b.kind === 'window' ? 1.3 : 0.6, null);
      this.enemies.push(op);
    }
    s.wave++;
    // la pièce où elle arrive clignote sur la minimap pendant ARRIVAL_ALERT secondes
    s.arrival = { breach: b, room: this.map.roomOf(b.inside.x, b.inside.y), at: this.time };
    return b;
  }

  updateSiege(dt) {
    const s = this.siege;
    if (s.prep > 0) {
      s.prep -= dt;
      if (s.prep <= 0) {
        const b = this.spawnAssault(s.waves[0]);
        s.nextWave = s.maxGap;
        this.say(`L'assaut commence — ${this.map.breachLabel(b)} (vague 1 / ${s.waves.length})`, 3);
        Sound.door();
      }
      return;
    }
    if (s.wave < s.waves.length) {
      // Pas d'attente inutile : la vague suivante suit de peu l'élimination de la précédente.
      if (!this.enemies.some(e => e.alive) && s.nextWave > s.gap) {
        s.nextWave = s.gap;
        this.say(`Vague repoussée — la suivante arrive (${s.wave + 1} / ${s.waves.length})`, 2.5);
      }
      s.nextWave -= dt;
      if (s.nextWave <= 0) {
        const b = this.spawnAssault(s.waves[s.wave]);
        s.nextWave = s.maxGap;
        this.say(`Vague ${s.wave} / ${s.waves.length} — ${this.map.breachLabel(b)}`, 2.5);
        Sound.door();
      }
    }
    this.updateHostageRescue();
  }

  // L'intervention ne vient pas seulement vous chercher : elle repère les otages, et le premier
  // opérateur libre qui en rejoint un l'emmène vers la sortie la plus proche (voir updateAssault).
  // Un otage évacué est perdu pour vous, et sans otage il n'y a plus rien à négocier.
  updateHostageRescue() {
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.found) continue;
      if (this.enemies.some(e => e.alive && this.canSee(e, h))) h.found = true;
    }
  }

  // Le camp qui sauve les otages : l'équipe du joueur en assaut, l'intervention de l'IA en siège.
  get rescueTeam() { return this.siege ? 'enemy' : 'ops'; }

  restart() { this.loadLevel(this.levelIndex); }
  say(text, t) { this.message = { text, t: t || 2.5 }; }
  setPaused(v) { if (this.over) return; this.paused = v; this.emit('pause'); }

  // ---- Boucle ----
  update(dt) {
    // Minimap : visible par défaut, M la replie (la touche répond même mort ou en pause).
    if (this.input.pressed.KeyM) {
      this.minimap = !this.minimap;
      this.say(this.minimap ? 'Minimap affichée' : 'Minimap repliée', 1.2);
    }
    if (!this.over && !this.paused) this.step(dt);
    if (!this.paused) this.updateDying(dt);
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
  // dispersion de base réduite (SCOPE.spread), portée efficace allongée (SCOPE.reach).
  spreadOf(agent, aimDist) {
    const w = agent.weapon, laser = this.laserLit(agent), scope = this.scoped(agent);
    const move = agent.moving ? w.moveSpread * (agent.walkMode ? 0.25 : 1) * (laser ? LASER_MOVE : 1) : 0;
    // mains occupées (porte, grenade) : l'arme n'est plus épaulée, le viseur s'ouvre en grand
    let s = w.spread * (scope ? SCOPE.spread : 1) + move + agent.bloom + (agent.handBloom || 0) + (agent.act ? 7 * DEG : 0);
    const d = aimDist === undefined ? agent.aimDist || 0 : aimDist;
    const eff = (w.effRange || 0) * (scope ? SCOPE.reach : 1);
    if (eff && d > eff) s += (w.rangeSpread || 0) * Math.min(1.5, (d - eff) / eff);
    if (agent.shield) s *= 1 + (agent.shield.aim - 1) * (laser ? 0.5 : 1);
    return s * (agent.spreadMul || 1);
  }

  // Laser de l'arme en main allumé (il s'éteint de lui-même quand l'arme quitte la visée : geste,
  // rechargement, fibre, grenade dégoupillée).
  laserLit(a) {
    return !!(a.alive && a.laserOn && a.weapon && a.weapon.laser && !a.act && !(a.reloadT > 0) && !a.fiber && !a.cooking);
  }

  // Lunette en service : l'arme en main en porte une, l'agent est immobile depuis SCOPE.settle et l'arme est épaulée
  // (ni geste, ni rechargement, ni fibre, ni grenade dégoupillée, ni sonné).
  scoped(a) {
    return !!(a.alive && a.weapon && a.weapon.scope && !a.moving && a.stillT >= SCOPE.settle
      && !a.act && !(a.reloadT > 0) && !a.fiber && !a.cooking && !(a.stun > 0));
  }

  // Portée de vue d'un agent dans la direction ang : la lunette en service porte plus loin dans l'axe de l'arme.
  viewOf(a, ang) {
    return this.scoped(a) && Math.abs(angleDiff(a.angle, ang)) <= SCOPE.half ? a.viewRange * SCOPE.sight : a.viewRange;
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
    if (e.hunter) { this.know(e, src.x, src.y); return; }
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
    for (const a of [...this.ops, ...this.enemies]) {
      if (a.glowT > 0) a.glowT -= dt;
      a.stillT = a.moving ? 0 : (a.stillT || 0) + dt; // temps à l'arrêt : la lunette demande de poser l'œil
    }
    for (const h of this.heard) h.t += dt;
    this.heard = this.heard.filter(h => h.t < NOISE_KINDS[h.kind].life);
    if (this.message.t > 0) this.message.t -= dt;
    // Joueur tombé : après un court instant, on reprend la partie dans un coéquipier encore debout (en guerre totale,
    // de votre trinôme seulement : sinon on attend les renforts).
    if (!this.player.alive && (this.war ? this.crew.length : this.mates.some(m => m.alive))) {
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

  // ---- Joueur ----
  updatePlayer(dt) {
    const p = this.player, k = this.input.keys, m = this.input.mouse, pr = this.input.pressed;
    if (!p.alive) return;
    if (p.flashT > 0) p.flashT -= dt;
    if (p.stun > 0) p.stun -= dt;
    p.angle = Math.atan2(m.y - p.y, m.x - p.x);
    p.aimDist = dist(p.x, p.y, m.x, m.y);

    let dx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    let dy = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (pr.KeyQ || pr.ShiftLeft || pr.ShiftRight) {
      p.walkMode = !p.walkMode;
      this.say(p.walkMode ? 'Mode marche : précis et discret' : 'Mode course', 1.2);
    }
    p.moving = false;
    this.unstick(p);
    if (dx || dy) {
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      // toutes les armes portées pèsent, pas seulement celle qu'on a en main
      const spd = (p.walkMode ? p.walkSpeed : p.runSpeed) * loadMobility(p.weaponLoad) * (p.shield ? p.shield.mobility : 1) * (p.vest ? p.vest.mobility : 1)
        * (p.reloadT > 0 ? 0.8 : 1) * (p.act ? 0.55 : 1);
      const bx = p.x, by = p.y;
      this.tryMove(p, dx * spd * dt, dy * spd * dt);
      p.moving = true;
      p.moveDir = Math.atan2(dy, dx);
      this.footstep(p, dist(bx, by, p.x, p.y), p.walkMode ? 0 : STEP_NOISE.run);
      // Bloqué contre une porte fermée : rappel des commandes (pas d'ouverture automatique).
      if (Math.abs(p.x - bx) + Math.abs(p.y - by) < 0.01) {
        const ax = p.x + dx * (p.radius + 6), ay = p.y + dy * (p.radius + 6);
        const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
        if (door && !door.open && this.message.t <= 0) this.say(door.locked && door.lockKnown ? 'Porte verrouillée — E : crocheter · B : charge' : 'E : ouvrir · molette haut : entrouvrir', 1.2);
      }
    }

    this.updateFiber(p, dt);
    if (pr.KeyE || pr.WheelUp || pr.WheelDown) {
      const d = this.nearestDoor(p, 1.8 * U);
      if (!d) this.say('Aucune porte à portée', 1);
      else {
        // E : ouvre en grand ou ferme d'un coup ; la molette avance d'un cran (DOOR_STEPS).
        // doorAction se charge des refus (porte en mouvement, déjà fermée, embrasure occupée).
        const target = pr.KeyE ? (d.open ? 0 : 1) : this.doorStep(d, pr.WheelUp ? 1 : -1);
        this.doorAction(p, d, target);
      }
    }
    if (pr.KeyR || pr.Mouse1) this.startReload(p);
    if (pr.Digit1) this.switchWeapon(p, 0);
    if (pr.Digit2) this.switchWeapon(p, 1);
    if (pr.AltLeft || pr.AltRight) this.switchWeapon(p, (p.cur + 1) % p.slots.length);
    if (pr.Space || pr.KeyG) this.throwFlash(p);
    if (pr.KeyN) this.cycleNade(p);
    if (pr.KeyL) {
      if (!p.slots.some(s => s.def.laser)) this.say('Aucun laser sur vos armes', 1.2);
      else { p.laserOn = !p.laserOn; this.say(p.laserOn ? 'Laser allumé' : 'Laser éteint', 1.2); }
    }
    // X : la lampe, et celles des coéquipiers avec (ils ne la gardent pas allumée quand vous éteignez la vôtre)
    if (pr.KeyX) {
      const team = this.mates.some(m => m.alive && m.weapon && m.weapon.light);
      if (!p.slots.some(s => s.def.light) && !team) this.say('Aucune lampe sur vos armes', 1.2);
      else {
        p.lampOn = !p.lampOn;
        for (const m of this.mates) m.lampOn = p.lampOn;
        this.say(p.lampOn ? (team ? 'Lampes allumées' : 'Lampe allumée') : (team ? 'Lampes éteintes' : 'Lampe éteinte'), 1.2);
      }
    }
    if (pr.KeyC) this.shout(p);
    if (pr.KeyB) this.chargeKey(p);
    if (pr.KeyV) this.pickUp(p);
    else {
      // rappel discret en passant près d'une arme au sol (une fois par corps)
      const drop = this.nearestDrop(p);
      if (!drop) this.pickHint = null;
      else if (drop !== this.pickHint && this.message.t <= 0) {
        this.say(`V : ramasser ${this.pickupSlot(drop.slot).def.name}`, 1.5);
        this.pickHint = drop;
      }
    }
    if (pr.KeyH) this.interact(p);
    else if (p.team === this.rescueTeam) {
      // même rappel en passant près d'un otage qui attend, ou d'un suspect rendu (une fois chacun)
      const e = this.nearestSurrendered(p, HOSTAGE_REACH);
      const h = e ? null : this.nearestHostage(p, HOSTAGE_REACH);
      const who = e || (h && !h.escort ? h : null);
      if (!who) this.hostHint = null;
      else if (who !== this.hostHint && this.message.t <= 0) { this.say(e ? 'H : menotter le suspect' : who.vip ? 'H : le VIP vous suit' : "H : emmener l'otage", 1.5); this.hostHint = who; }
    }
    // Clic droit : ordre de déplacement. Maintenu puis tiré, il fixe en plus une direction
    // à couvrir, confiée au coéquipier placé de ce côté. En siège, personne ne commande : pas d'ordres.
    if ((pr.Mouse2 || pr.KeyT) && !this.canCommand()) { /* refus annoncé par canCommand */ }
    else if (pr.Mouse2) this.orderDrag = { x: m.x, y: m.y, angle: null, onSelf: dist(m.x, m.y, p.x, p.y) <= p.radius + 6 };
    if (this.orderDrag && this.input.mouse.rdown) {
      const d = dist(this.orderDrag.x, this.orderDrag.y, m.x, m.y);
      this.orderDrag.angle = d >= 0.7 * U ? Math.atan2(m.y - this.orderDrag.y, m.x - this.orderDrag.x) : null;
    }
    if (pr.Mouse2Up && this.orderDrag) {
      const o = this.orderDrag;
      this.orderDrag = null;
      // clic droit sur soi : l'équipe reprend le suivi ; sur une porte fermée : en colonne de part et d'autre,
      // prête à entrer ; ailleurs : ordre de déplacement
      const door = o.onSelf ? null : this.doorAtPoint(o.x, o.y);
      if (o.onSelf) this.orderFollow();
      else if (door && this.stack && this.stack.door === door && !door.broken && door.progress < 1) this.orderFlashEntry();
      else if (door && !door.broken && !this.map.doorPassable(door)) this.orderStack(door);
      else this.orderMove(o.x, o.y, o.angle);
    }
    if (pr.KeyT && this.canCommand(true)) this.toggleHold();

    const s = p.slot, w = s.def;
    p.fireT -= dt;
    p.switchT -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 7 * DEG);
    // Chargement cartouche par cartouche : un tir interrompt le rechargement s'il reste une cartouche.
    if (p.reloadT > 0 && w.reloadType === 'shell' && pr.Mouse0 && s.mag > 0) p.reloadT = 0;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        if (w.reloadType === 'shell') {
          s.mag++; s.reserve--;
          Sound.tick(0.2);
          if (s.mag < w.mag && s.reserve > 0) p.reloadT = p.reloadDur = w.reload;
        } else {
          const take = Math.min(w.mag - s.mag, s.reserve);
          s.mag += take; s.reserve -= take;
        }
      }
    } else if (p.switchT <= 0 && p.stun <= 0 && !p.act && !p.fiber && !p.cooking) {
      const want = w.auto ? m.down : pr.Mouse0;
      if (want && p.fireT <= 0) {
        if (s.mag <= 0) { if (pr.Mouse0) { if (s.reserve > 0) this.startReload(p); else this.say('Plus de munitions', 1.5); } }
        else this.fireWeapon(p);
      }
    }
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

  // Rechargement d'un coéquipier : un chargeur d'un coup, ou le temps de remplir le magasin
  // cartouche par cartouche pour un fusil à pompe.
  mateReload(m) {
    const w = m.weapon;
    const n = w.reloadType === 'shell' ? Math.max(1, w.mag - m.slot.mag) : 1;
    m.reloadT = m.reloadDur = w.reload * n;
  }

  startReload(p) {
    const s = p.slot, w = s.def;
    if (p.reloadT > 0 || p.act || p.fiber || p.cooking || s.mag >= w.mag || s.reserve <= 0) return;
    p.reloadT = p.reloadDur = w.reload;
    if (w.reloadType === 'shell') Sound.tick(0.2); else Sound.reload();
  }

  switchWeapon(p, i) {
    if (i === p.cur || i >= p.slots.length || p.act) return;
    p.cur = i; p.reloadT = 0; p.switchT = 0.45; p.bloom = 0;
    this.emit('weapon');
  }

  // Grenades du joueur selon le camp : le groupe armé a deux grenades à fragmentation ; l'intervention, le lot choisi au
  // briefing (NADE_KITS). kept : les flashs d'un coéquipier qui reprend la main (il garde les siennes). En main, les
  // flashs d'abord.
  armGrenades(p, kept) {
    const kit = NADE_KITS[this.loadout.nades] || NADE_KITS.flash;
    p.nades = this.camp === 'armed' ? { flash: 0, frag: 2 }
      : kept !== undefined ? { flash: kept, frag: 0 }
      : { flash: kit.flash, frag: kit.frag };
    p.nade = p.nades.flash > 0 || !p.nades.frag ? 'flash' : 'frag';
  }

  // N : l'autre sorte de grenade en main, s'il en reste (lot mixte). Pas pendant qu'on en dégoupille une.
  cycleNade(p) {
    if (p.cooking || (p.act && p.act.type === 'grenade')) return;
    const other = Object.keys(p.nades).find(k => k !== p.nade && p.nades[k] > 0);
    if (!other) { this.say("Pas d'autre grenade", 1.2); return; }
    p.nade = other;
    this.say(other === 'frag' ? 'Grenade à fragmentation en main' : 'Flash en main', 1.2);
    this.emit('weapon');
  }

  // ---- Relais et armes au sol ----
  // Le joueur est tombé : on reprend la main dans le coéquipier debout le plus proche. On garde le
  // même objet (les ennemis qui le visaient le visent toujours) en lui donnant le prototype du joueur.
  takeOver() {
    const old = this.player;
    // d'abord un coéquipier de votre trinôme ; en trinômes, quand il n'en reste plus, un homme de l'autre (en guerre
    // totale, non : votre trinôme reviendra de la base)
    const crew = this.crew, pool = crew.length || this.war ? crew : this.mates.filter(x => x.alive);
    const m = pool.sort((a, b) => dist(a.x, a.y, old.x, old.y) - dist(b.x, b.y, old.x, old.y))[0];
    if (!m) return;
    if (m.hunter) {
      // il quitte la manœuvre autonome (et la colonne où il était) pour vos commandes
      if (m.group) m.group.members = m.group.members.filter(o => o !== m);
      Object.assign(m, { hunter: false, drilled: false, group: null, entry: null, clear: null, escorting: null, blind: null });
    }
    const main = this.pickupSlot(m.slot), kept = m.flashbangs || 0;
    delete m.slot; // les propriétés propres du coéquipier masqueraient les accesseurs du joueur
    delete m.flashbangs;
    Object.setPrototypeOf(m, Player.prototype);
    m.slots = main.def.kind === 'pistol' ? [main] : [main, makeSlot(this.loadout.sidearm, accOf(this.loadout, this.loadout.sidearm))];
    m.cur = 0;
    Object.assign(m, {
      runSpeed: 118, walkSpeed: 62, walkMode: old.walkMode, fov: 120 * DEG, viewRange: 15 * U, spreadMul: 1, shield: null, laserOn: true,
      reloadT: 0, switchT: 0.3, fiber: null, flashT: 0, act: null, path: [], moving: false, charges: old.charges || 0,
      target: null, lookAt: null, alertAngle: null, order: null, coverAngle: null, blockedLine: false,
    });
    m.moveDir = m.angle;
    this.armGrenades(m, kept); // il garde les flashs qui lui restent
    // l'ancien joueur reste au sol, dans la liste de l'équipe (« À terre »)
    old.accent = '#9aa4ae';
    this.mates = [...this.mates.filter(x => x !== m), old];
    this.player = m;
    this.relayT = 0;
    this.orderDrag = null;
    if (this.orderMarker && this.orderMarker.mate === m) this.orderMarker = null;
    // le VIP qui suivait l'ancien joueur suit celui qui reprend la main
    const v = this.vip, follows = v && v.alive && !v.escort && v.lostEscort === old;
    if (follows) { this.takeCharge(v, m); v.lostEscort = null; }
    this.say(follows ? `${m.name} prend le relais — le VIP le suit` : `${m.name} prend le relais`, 3);
    this.emit('weapon');
  }

  // Arme ramassée : les armes de l'IA (chargeur infini) redeviennent leur modèle réel, avec des
  // munitions finies et les accessoires montés dessus ; une arme déjà portée par un joueur garde son chargeur
  // et sa réserve.
  pickupSlot(s) {
    const def = WEAPONS[s.def.pickup] ? fittedDef(s.def.pickup, s.def.acc) : s.def;
    const mag = Number.isFinite(s.mag) ? Math.min(s.mag, def.mag) : def.mag;
    const reserve = def === s.def && Number.isFinite(s.reserve) ? s.reserve : def.reserve;
    return { def, mag, reserve };
  }

  // Corps le plus proche portant encore une arme, à portée de ramassage. Bouclier au bras, on n'a
  // qu'une main libre : seule une arme de poing se prend.
  nearestDrop(p) {
    let best = null, bd = PICKUP_RANGE;
    for (const a of [...this.enemies, ...this.mates]) {
      if (a.alive || a.dying || !a.slot || a === p) continue;
      if (p.shield && this.pickupSlot(a.slot).def.kind !== 'pistol') continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd && this.map.hasLOS(p.x, p.y, a.x, a.y)) { bd = d; best = a; }
    }
    return best;
  }

  // V : ramasser l'arme d'un corps. Elle remplace celle de même catégorie (arme de poing ou arme
  // principale), qui reste au sol à sa place : c'est un échange.
  pickUp(p) {
    if (p.act || p.fiber) return;
    const body = this.nearestDrop(p);
    if (!body) { this.say(p.shield ? 'Aucune arme de poing à ramasser (bouclier au bras)' : 'Aucune arme à ramasser', 1.2); return; }
    this.startAction(p, 'pickup', 0.5, () => {
      if (!body.slot || !p.alive) return;
      const got = this.pickupSlot(body.slot);
      const side = got.def.kind === 'pistol';
      let i = side ? p.slots.length - 1 : 0;
      const sameKind = s => (s.def.kind === 'pistol') === side;
      let given = null;
      if (sameKind(p.slots[i])) given = p.slots[i];
      else if (p.slots.length === 1) i = side ? 1 : 0; // un seul emplacement : on ajoute sans rien lâcher
      if (given) p.slots[i] = got;
      else p.slots.splice(i, 0, got);
      if (body.slots) body.slots[body.cur] = given; else body.slot = given;
      p.cur = i; p.reloadT = 0; p.switchT = 0.3; p.bloom = 0;
      this.pickHint = null;
      this.say(given ? `${got.def.name} ramassé — ${given.def.name} laissé au sol` : `${got.def.name} ramassé`, 2);
      Sound.reload();
      this.emit('weapon');
    });
  }

  // ---- Otages ----
  // Un otage n'est sauvé qu'une fois sorti du bâtiment. Pris en charge, il se relève et suit son
  // escorte en file ; amené devant une ouverture sur l'extérieur (porte extérieure assez ouverte
  // pour passer, ou fenêtre à enjamber), il sort : il est évacué. Seul le camp de l'intervention
  // emmène des otages : le joueur en assaut (H), les opérateurs de l'IA en siège (updateAssault).

  // H : l'otage à portée se relève et vous suit ; H à nouveau, il attend sur place, à genoux.
  toggleEscort(p) {
    if (p.team !== this.rescueTeam) { this.say("Vos otages restent à genoux : seule l'intervention les emmène", 1.6); return; }
    if (p.act) return;
    const h = this.nearestHostage(p, HOSTAGE_REACH);
    if (!h) { this.say('Aucun otage à portée', 1); return; }
    if (h.escort === p) { this.releaseHostage(h); this.say(h.vip ? 'Le VIP attend ici, à couvert' : "L'otage attend ici, à genoux", 1.4); return; }
    if (h.escort) return;
    // une main pour l'aider à se relever : un bref geste, arme basse
    this.startAction(p, 'hostage', 0.5, () => {
      if (!h.alive || h.evacuated || h.escort || !p.alive || dist(p.x, p.y, h.x, h.y) > 2 * U) return;
      this.takeCharge(h, p);
      this.hostHint = h;
      this.say(h.vip ? 'Le VIP vous suit — conduisez-le au point B' : "L'otage vous suit — conduisez-le à une sortie", 2.2);
    });
  }

  // Otage vivant, encore dans le bâtiment et pas déjà en train de sortir, le plus proche à vue.
  nearestHostage(a, R) {
    let best = null, bd = R;
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.exiting) continue;
      const d = dist(a.x, a.y, h.x, h.y);
      if (d < bd && this.map.hasLOS(a.x, a.y, h.x, h.y)) { bd = d; best = h; }
    }
    return best;
  }

  // ---- Sommation et arrestation (assaut) ----
  // C : « Police ! À terre ! ». Chaque suspect que vous voyez à portée de voix peut se rendre : il lâche son
  // arme et se met à genoux, les mains sur la tête. Ses chances montent s'il est aveuglé, blessé, pris de
  // dos ou tenu en joue par plusieurs d'entre vous ; elles baissent s'il est en plein échange de tirs ou si un
  // complice est à côté de lui. Le cri s'entend comme tout cri : les autres viennent voir.
  shout(p) {
    if (this.squads) { this.say('Pas de sommation : ils sont venus se battre', 1.6); return; }
    if (this.siege) { this.say("Personne ne se rend de ce côté-ci : c'est vous qu'on somme", 1.6); return; }
    if (!p.alive || this.time - this.shoutT < SHOUT_COOLDOWN) return;
    this.shoutT = this.time;
    Sound.shout();
    let asked = 0, gave = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e.hunter) continue;
      if (dist(p.x, p.y, e.x, e.y) > SHOUT_RANGE || !this.playerSees(e)) continue;
      asked++;
      if (Math.random() < this.surrenderChance(e)) { this.surrenderTo(e); gave++; }
    }
    this.noise(p.x, p.y, SHOUT_RANGE, p, 'voice');
    this.say(gave > 1 ? `${gave} suspects se rendent — H : menotter` : gave ? 'Le suspect se rend — H : menotter'
      : asked ? 'Police ! — il refuse de se rendre' : 'Police ! — personne en vue', 1.8);
  }

  // Le joueur voit-il cet agent (dans son champ, ou tout près) ?
  playerSees(o) {
    const p = this.player;
    return p.alive && (this.canSee(p, o) || (dist(p.x, p.y, o.x, o.y) < (this.nearRange || 2.6 * U) && this.map.hasLOS(p.x, p.y, o.x, o.y)));
  }

  surrenderChance(e) {
    const p = this.player;
    let c = 0.15;
    if (e.stun > 0) c += 0.45;                                   // aveuglé, sonné
    if (e.hp < e.maxHp) c += e.hp < e.maxHp * 0.5 ? 0.35 : 0.2;  // blessé
    const facing = e.stun <= 0 && this.canSee(e, p);
    if (!facing) c += 0.25;                                      // pris de dos ou à l'aveugle
    else if (e.target) c -= 0.2;                                 // en plein échange de tirs
    c += 0.1 * this.ops.filter(o => o !== p && o.alive && this.canSee(o, e)).length; // tenu en joue par l'équipe
    c -= 0.2 * this.enemies.filter(o => o !== e && o.alive && !o.surrender
      && dist(o.x, o.y, e.x, e.y) < 4 * U && this.map.hasLOS(o.x, o.y, e.x, e.y)).length; // un complice à côté
    return clamp(c, 0.05, 0.95);
  }

  surrenderTo(e) {
    e.surrender = { t: 0, lapse: 0 };
    Object.assign(e, { target: null, blind: null, path: [], act: null, waitDoor: null, alertAngle: null, lookAt: null,
      moving: false, engaged: false, stun: 0, reloadT: 0, state: 'idle' });
  }

  // Un suspect rendu reste à genoux tant qu'on le surveille. Laissé seul trop longtemps (personne de l'équipe
  // ne le voit), il ramasse son arme et reprend le combat. Menotté, il ne bouge plus.
  updateSurrendered(e, dt) {
    const s = e.surrender;
    s.t += dt;
    e.moving = false;
    if (e.cuffed) return;
    const watched = this.ops.some(o => o.alive && (this.canSee(o, e) || (dist(o.x, o.y, e.x, e.y) < 2.5 * U && this.map.hasLOS(o.x, o.y, e.x, e.y))));
    s.lapse = watched ? 0 : s.lapse + dt;
    if (s.lapse < SURRENDER_LAPSE) return;
    e.surrender = null;
    const near = this.ops.filter(o => o.alive).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    Object.assign(e, { state: 'engage', lostT: 0, suspicion: 2, reactT: e.reaction, lastKnown: near ? { x: near.x, y: near.y } : null });
    this.startAction(e, 'pickup', 0.8, null);
    if (this.playerSees(e)) this.say('Un suspect laissé sans surveillance reprend son arme !', 2.2);
  }

  // Suspect rendu, pas encore menotté, le plus proche à vue.
  nearestSurrendered(a, R) {
    let best = null, bd = R;
    for (const e of this.enemies) {
      if (!e.alive || !e.surrender || e.cuffed) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d < bd && this.map.hasLOS(a.x, a.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  }

  // H : menotter le suspect rendu à portée, sinon s'occuper de l'otage (voir toggleEscort).
  interact(p) {
    const e = p.team === this.rescueTeam ? this.nearestSurrendered(p, HOSTAGE_REACH) : null;
    const h = e ? this.nearestHostage(p, HOSTAGE_REACH) : null;
    if (e && (!h || dist(p.x, p.y, e.x, e.y) <= dist(p.x, p.y, h.x, h.y))) this.cuff(p, e);
    else this.toggleEscort(p);
  }

  cuff(p, e) {
    if (p.act) return;
    this.startAction(p, 'cuff', CUFF_TIME, () => {
      if (!e.alive || !e.surrender || e.cuffed || !p.alive || dist(p.x, p.y, e.x, e.y) > 2 * U) return;
      e.cuffed = true;
      this.stats.arrests++;
      this.hostHint = e;
      Sound.tick(0.15);
      this.say(`Suspect menotté (${this.enemies.filter(o => o.cuffed).length} arrêté${this.stats.arrests > 1 ? 's' : ''})`, 1.8);
    });
  }

  takeCharge(h, escort) {
    h.escort = escort;
    h.escortSince = this.time;
    h.path = []; h.repathT = 0; h.blockedT = 0; h.duckT = 0;
    this.unstick(h); // debout, il prend un peu plus de place qu'à genoux
  }

  // L'otage n'a plus d'escorte : il se remet à genoux là où il est.
  releaseHostage(h) {
    const e = h.escort;
    h.escort = null;
    h.path = []; h.moving = false;
    if (e && e.escorting === h) { e.escorting = null; e.exit = null; }
  }

  updateHostages(dt) {
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated) continue;
      if (h.exiting) { this.stepExit(h, dt); continue; }
      h.moving = false;
      if (h.duckT > 0) h.duckT -= dt;
      const e = h.escort;
      if (!e) continue;
      if (!e.alive) {
        this.releaseHostage(h);
        if (h.vip) h.lostEscort = e; // il se met à couvert, et suivra celui qui reprend la main
        if (this.siege) this.say("Son escorte est tombée : l'otage reste à terre", 2.5);
        continue;
      }
      if (h.duckT > 0) continue; // à genoux le temps que ça tire
      // le VIP ne sort pas par la première ouverture venue : seule la zone d'extraction compte (updateEscort)
      const b = e.team === this.rescueTeam && !h.vip ? this.exitFor(h) : null;
      if (b) this.startExit(h, b);
      else this.followEscort(h, e, dt);
    }
  }

  // Suivre l'escorte à distance, chacun à son rang dans la file : le plus proche d'elle en tête, ce qui
  // évite qu'un otage resté derrière ne bute sur celui qui le précède dans un passage étroit. Un otage
  // n'ouvre pas les portes : s'il n'a pas de chemin, il attend qu'on lui en ouvre une.
  followEscort(h, e, dt) {
    const d = dist(h.x, h.y, e.x, e.y);
    const rank = this.hostages.filter(o => o !== h && o.escort === e && o.alive && !o.evacuated && !o.exiting
      && (dist(o.x, o.y, e.x, e.y) < d || (dist(o.x, o.y, e.x, e.y) === d && o.escortSince < h.escortSince))).length;
    const gap = HOSTAGE_GAP + rank * HOSTAGE_GAP_STEP;
    if (d <= gap && this.map.hasLOS(h.x, h.y, e.x, e.y)) {
      h.path = []; h.blockedT = 0;
      turnToward(h, Math.atan2(e.y - h.y, e.x - h.x), 6, dt);
      return;
    }
    h.repathT -= dt;
    if (!h.path.length || h.repathT <= 0) {
      h.path = this.map.routeTo(h.x, h.y, e.tx, e.ty, h.radius, { passableDoors: true }) || [];
      h.repathT = 0.5;
    }
    if (!h.path.length) {
      h.blockedT += dt;
      if (e === this.player && h.blockedT > 1.5 && !h.blockedSaid) {
        h.blockedSaid = true;
        this.say(h.vip ? 'Le VIP ne peut pas vous suivre : ouvrez-lui la porte' : "Un otage ne peut pas vous suivre : ouvrez-lui la porte", 2.2);
      }
      return;
    }
    h.blockedT = 0; h.blockedSaid = false;
    this.unstick(h);
    // il presse le pas quand il est distancé et ralentit en arrivant dans la file
    const speed = clamp((d - gap) * 3 + 45, 45, HOSTAGE_SPEED) * (h.wounded ? 0.8 : 1);
    this.stepAlong(h, speed * dt, dt);
  }

  // Avance le long de h.path, avec les collisions (portes non franchissables comprises).
  stepAlong(h, step, dt) {
    while (step > 0.01 && h.path.length) {
      const wp = h.path[0];
      const dx = wp.x - h.x, dy = wp.y - h.y, d = Math.hypot(dx, dy);
      if (d < 1) { h.path.shift(); continue; }
      const s = Math.min(step, d);
      const bx = h.x, by = h.y;
      this.tryMove(h, dx / d * s, dy / d * s);
      const moved = dist(bx, by, h.x, h.y);
      turnToward(h, Math.atan2(dy, dx), 8, dt);
      if (moved > 0.05) h.moving = true;
      if (moved < s * 0.5) {
        // accroché : son cercle frôle l'angle d'un meuble ou d'un mur. Un écart de côté de quelques pixels qui
        // libère le pas suivant suffit souvent ; sinon, nouveau trajet bientôt.
        const ux = dx / d, uy = dy / d, r = h.radius - 1;
        for (const off of [1, -1, 2, -2, 3, -3]) {
          const x = h.x - uy * off, y = h.y + ux * off;
          if (this.map.circleFree(x, y, r, true) && this.map.circleFree(x + ux * s, y + uy * s, r, true)) { h.x = x; h.y = y; break; }
        }
        h.repathT = Math.min(h.repathT, 0.1);
        return;
      }
      step -= s;
      if (s >= d - 0.01) h.path.shift();
    }
  }

  // Ouverture par laquelle cet otage peut sortir maintenant : il est sur le seuil, ou son escorte
  // s'y tient et il la voit d'où il est. Une porte extérieure doit être assez ouverte pour passer ;
  // une fenêtre, elle, s'enjambe.
  exitFor(h) {
    const e = h.escort;
    for (const b of this.map.breaches) {
      if (b.door && !this.map.doorPassable(b.door)) continue;
      if (!this.map.hasLOS(h.x, h.y, b.inside.x, b.inside.y)) continue;
      if (dist(h.x, h.y, b.inside.x, b.inside.y) <= 0.9 * U) return b;
      if (dist(e.x, e.y, b.cx, b.cy) <= 1.5 * U && dist(h.x, h.y, b.cx, b.cy) <= 4.5 * U
          && this.map.hasLOS(e.x, e.y, b.inside.x, b.inside.y)) return b;
    }
    return null;
  }

  // Sortie : l'otage gagne le seuil, franchit l'ouverture (en enjambant l'appui d'une fenêtre) et
  // disparaît de l'autre côté de la façade. Il reste une cible jusqu'au bout.
  startExit(h, b) {
    const out = { x: b.cx - Math.cos(b.angle) * 14, y: b.cy - Math.sin(b.angle) * 14 };
    const sill = { x: b.cx, y: b.cy, climb: b.kind === 'window' ? 1.1 : 0 };
    const pts = dist(h.x, h.y, b.cx, b.cy) < dist(b.inside.x, b.inside.y, b.cx, b.cy)
      ? [sill, out] : [{ x: b.inside.x, y: b.inside.y }, sill, out];
    h.exiting = { b, pts, climb: 0, alpha: 1 };
    h.path = [];
    h.duckT = 0;
  }

  stepExit(h, dt) {
    const ex = h.exiting;
    h.moving = ex.climb <= 0;
    if (ex.climb > 0) { ex.climb = Math.max(0, ex.climb - dt); return; }
    let step = HOSTAGE_SPEED * 0.8 * dt;
    while (step > 0 && ex.pts.length) {
      const a = ex.pts[0];
      const d = dist(h.x, h.y, a.x, a.y);
      if (d > 0.01) h.angle = Math.atan2(a.y - h.y, a.x - h.x);
      if (d > step) { h.x += (a.x - h.x) / d * step; h.y += (a.y - h.y) / d * step; step = 0; }
      else {
        h.x = a.x; h.y = a.y; step -= d;
        ex.pts.shift();
        if (a.climb) { ex.climb = a.climb; break; }
      }
    }
    // il s'efface en franchissant la façade
    const last = ex.pts.length === 1 ? ex.pts[0] : null;
    ex.alpha = last && ex.climb <= 0 ? clamp(dist(h.x, h.y, last.x, last.y) / 14, 0, 1) : ex.pts.length ? 1 : 0;
    if (!ex.pts.length) this.evacuate(h);
  }

  evacuate(h) {
    this.releaseHostage(h);
    h.evacuated = true;
    h.exiting = null;
    h.visible = false;
    Sound.tick(0.15);
    if (this.siege) {
      const left = this.hostages.filter(o => o.alive && !o.evacuated).length;
      this.say(left ? `L'intervention a évacué un otage — il vous en reste ${left}` : "L'intervention a évacué votre dernier otage", 3);
    } else {
      this.say(`Otage évacué (${this.hostages.filter(o => o.evacuated).length} / ${this.hostages.length})`, 2.5);
    }
  }

  // ---- Escorte ----
  // Le VIP entré dans la zone d'extraction (le point B) est en sécurité : la mission est accomplie (voir checkEnd).
  updateEscort() {
    const v = this.vip;
    if (!v.alive || this.escort.safe || !this.map.inGoal(v.x, v.y)) return;
    this.escort.safe = true;
    Sound.tick(0.15);
    this.say('Le VIP est en sécurité au point B', 3);
  }

  // Un otage debout cède toujours le passage : il s'écarte de quiconque il chevauche (deux otages
  // debout se partagent l'écart). Il enjambe en revanche un otage à genoux, qui sinon pourrait lui
  // barrer une porte.
  separateHostages() {
    const others = [...this.ops, ...this.enemies, ...this.hostages];
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.exiting || !h.standing) continue;
      for (const o of others) {
        if (o === h || !o.alive || o.evacuated || o.exiting || (o.team === 'civ' && !o.standing)) continue;
        const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy), min = h.radius + o.radius - 4;
        if (d >= min) continue;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        const push = (min - d) * (o.team === 'civ' && o.standing ? 0.5 : 1);
        if (this.map.circleFree(h.x + nx * push, h.y + ny * push, h.radius - 1, true)) { h.x += nx * push; h.y += ny * push; }
      }
    }
  }

  // Sortie la plus proche à pied (longueur du trajet jusqu'à son seuil), pour une escorte de l'IA.
  nearestExit(a) {
    let best = null, bl = Infinity;
    for (const b of this.map.breaches) {
      const r = this.map.routeTo(a.x, a.y, Math.floor(b.inside.x / TILE), Math.floor(b.inside.y / TILE), a.radius);
      if (!r) continue;
      let len = 0, px = a.x, py = a.y;
      for (const q of r) { len += dist(px, py, q.x, q.y); px = q.x; py = q.y; }
      if (len < bl) { bl = len; best = b; }
    }
    return best;
  }

  // Dégoupiller et armer le bras prend un instant. La mèche part à la fin de ce geste, pas au
  // lancer : tant qu'on garde la touche, la grenade brûle dans la main (on « compte » avant de
  // la jeter, quitte à la garder une seconde de trop).
  throwFlash(p) {
    if (p.flashbangs <= 0 || p.stun > 0 || p.act || p.cooking) return;
    p.flashbangs--;
    this.stats.flashes++;
    Sound.tick(0.12); // goupille
    const kind = p.nade || 'flash';
    this.startAction(p, 'grenade', 0.45, () => {
      p.cooking = { t: 0, kind, fuse: FUSE[kind === 'frag' ? 'frag' : 'flash'] };
      Sound.tick(0.1); // la cuillère part : la mèche brûle
    });
  }

  // La dernière de sa sorte partie, l'autre sorte (lot mixte) passe en main.
  nextNade(p) {
    if (!p.nades || p.nades[p.nade] > 0) return;
    const other = Object.keys(p.nades).find(k => p.nades[k] > 0);
    if (other) p.nade = other;
  }

  // Grenade dégoupillée en main : elle part au relâchement de la touche, et éclate sur place
  // si on la garde jusqu'au bout.
  updateCooking(p, dt) {
    const c = p.cooking;
    if (!c) return;
    c.t += dt;
    if (c.t >= c.fuse) {
      p.cooking = null;
      this.nextNade(p);
      if (c.kind === 'frag') this.detonateFrag({ x: p.x, y: p.y, thrower: p, team: p.team, kind: 'frag' });
      else this.detonateFlash(p.x, p.y, null); // à bout portant, même son camp est aveuglé
      this.say('Elle vous a explosé dans la main', 3); // après l'explosion : ce message-là prime
      return;
    }
    const k = this.input.keys;
    if (!p.alive || !(k.Space || k.KeyG)) {
      p.cooking = null;
      const m = this.input.mouse;
      this.spawnFlash(p, p.alive ? m.x : p.x, p.alive ? m.y : p.y, c.t, null, c.kind);
      this.nextNade(p);
    }
  }

  // Jet d'une grenade depuis un agent vers un point : la distance règle la force du lancer. kind : sa sorte, celle que
  // l'agent a en main sinon.
  spawnFlash(p, mx, my, cooked, via, kind) {
    const m = { x: mx, y: my };
    // Portée = distance au curseur (plafonnée). Vol en l'air puis roulement avec frottement :
    // distance ≈ v0 * (flight + 1/friction), d'où v0.
    const d = clamp(dist(p.x, p.y, m.x, m.y), 0.5 * U, 7 * U);
    const ang = Math.atan2(m.y - p.y, m.x - p.x);
    const flight = GRENADE_FLIGHT, friction = GRENADE_FRICTION;
    const v0 = d / (flight + 1 / friction);
    let gx = p.x + Math.cos(ang) * 14, gy = p.y + Math.sin(ang) * 14;
    // la main ne passe pas à travers un mur : si un obstacle sépare le lanceur du point de départ, elle part de lui
    if (this.grenadeBlocked(gx, gy, true) || this.map.castRay(p.x, p.y, ang, 14, false).hit) { gx = p.x; gy = p.y; }
    kind = kind || p.nade || 'flash';
    // temps déjà brûlé dans la main : la mèche a commencé à la fin du geste d'armement
    const burnt = cooked || 0;
    const g = { x: gx, y: gy, vx: Math.cos(ang) * v0, vy: Math.sin(ang) * v0, t: 0, flight, friction, fuse: FUSE[kind === 'frag' ? 'frag' : 'flash'], cooked: burnt, h: 0, spin: rand(0, TAU), bounces: 0, post: null,
      kind, team: p.team, thrower: p };
    // Collé à une porte entrouverte et visant l'embrasure : la grenade est glissée par l'entrebâillement
    // (le battant est ignoré le temps de franchir la porte).
    const door = via || this.nearestDoor(p, 1.8 * U); // via : la porte visée, quand le lanceur la connaît
    if (door && door.progress >= 0.4 && !door.open) {
      const cross = this.aimCrossesDoor(p.x, p.y, ang, door);
      if (cross) {
        g.post = door;
        g.postSide = Math.sign(cross.side);
        if (this.grenadeBlocked(g.x, g.y, true) || dist(p.x, p.y, g.x, g.y) < 1) { g.x = p.x; g.y = p.y; }
      }
    }
    this.grenades.push(g);
    this.emit('weapon');
  }

  // La visée depuis (x,y) traverse-t-elle l'embrasure de la porte ? Renvoie le côté du tireur, sinon null.
  aimCrossesDoor(x, y, ang, d) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const half = (d.len * TILE) / 2;
    // repère de la porte : "along" le long de l'embrasure, "across" perpendiculaire
    const side = d.horizontal ? y - d.cy : x - d.cx;
    const vAcross = d.horizontal ? sn : cs;
    if (Math.abs(vAcross) < 0.2 || Math.sign(vAcross) === Math.sign(side) || side === 0) return null;
    const t = -side / vAcross;
    const along = d.horizontal ? x + cs * t - d.cx : y + sn * t - d.cy;
    return Math.abs(along) <= half - 3 ? { side } : null;
  }

  // Obstacles pour une grenade : murs, fenêtres, portes non ouvertes en grand, et le mobilier sauf
  // quand elle passe par-dessus (overProps : en vol, ou retombée sur un meuble dont elle roule).
  grenadeBlocked(x, y, overProps) {
    const m = this.map, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (m.isWall(tx, ty) || m.window(tx, ty)) return true;
    if (!overProps && m.prop(tx, ty)) return true;
    // seule une porte complètement fermée bloque l'embrasure ; sinon on teste le battant (doorLeafHit)
    const d = m.door(tx, ty);
    return d ? d.progress <= 0 : false;
  }

  // Grenade posée sur un meuble (retombée sur une table, un lit...).
  grenadeOnProp(g) { return !!this.map.prop(Math.floor(g.x / TILE), Math.floor(g.y / TILE)); }

  // Battant d'une porte : segment partant de la charnière (même géométrie que le rendu).
  doorLeaf(d) { return this.map.leafSeg(d); }

  // Rebond d'une grenade sur le battant des portes entrouvertes ou ouvertes.
  doorLeafHit(g, R) {
    for (const d of this.map.doors) {
      if (d.progress <= 0) continue;
      if (Math.abs(g.x - d.cx) > 60 || Math.abs(g.y - d.cy) > 60) continue;
      if (g.post === d) {
        // grenade glissée par l'entrebâillement : battant ignoré jusqu'à ce qu'elle ait franchi la porte
        const side = d.horizontal ? g.y - d.cy : g.x - d.cx;
        if (Math.sign(side) !== g.postSide && Math.abs(side) > 12) g.post = null;
        continue;
      }
      const s = this.doorLeaf(d);
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
      const t = clamp(((g.x - s.x0) * ex + (g.y - s.y0) * ey) / (ex * ex + ey * ey), 0, 1);
      const px = s.x0 + ex * t, py = s.y0 + ey * t;
      let nx = g.x - px, ny = g.y - py;
      const dd = Math.hypot(nx, ny);
      const minD = R + 2.5; // demi-épaisseur du battant
      if (dd >= minD) continue;
      if (dd < 0.001) { nx = -ey; ny = ex; } // pile sur le battant : normale arbitraire
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      // repousse hors du battant
      g.x = px + nx * minD; g.y = py + ny * minD;
      const vn = g.vx * nx + g.vy * ny;
      if (vn < 0) {
        const speed = Math.hypot(g.vx, g.vy);
        const tx = g.vx - vn * nx, ty = g.vy - vn * ny;
        g.vx = tx * 0.8 - vn * nx * 0.45;
        g.vy = ty * 0.8 - vn * ny * 0.45;
        g.bounces++;
        if (speed > 40) { Sound.tick(Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, g.thrower, 'bounce'); }
      }
    }
  }

  // ---- Gestes à deux mains (porte, grenade) ----
  // Manipuler une porte ou lancer une grenade occupe les mains : l'agent ne tire pas pendant
  // le geste, et sa visée reste perturbée un court instant après (handBloom).
  startAction(agent, type, dur, done) {
    if (agent.act || !agent.alive) return false;
    agent.act = { type, t: 0, dur, done };
    agent.reloadT = 0; // on lâche le chargeur : les mains servent à autre chose
    return true;
  }

  updateActions(dt) {
    for (const a of [...this.ops, ...this.enemies]) {
      if (a.handBloom > 0) a.handBloom = Math.max(0, a.handBloom - dt * 10 * DEG);
      if (!a.act) continue;
      if (!a.alive) { a.act = null; continue; } // une grenade dégoupillée part quand même : seul la mort interrompt
      a.act.t += dt;
      if (a.act.t < a.act.dur) continue;
      const done = a.act.done;
      a.act = null;
      a.handBloom = 6 * DEG;
      if (done) done();
    }
  }

  // ---- Fibre optique sous la porte ----
  // Maintenir F glisse une fibre sous le battant : on voit la pièce voisine sans ouvrir, mais
  // on est immobile et incapable de tirer tant qu'on regarde.
  updateFiber(p, dt) {
    const k = this.input.keys, pr = this.input.pressed;
    if (p.fiber) {
      const f = p.fiber;
      if (!k.KeyF || !p.alive || p.stun > 0 || p.moving || f.door.opening || f.door.open
          || dist(p.x, p.y, f.door.cx, f.door.cy) > 2 * U) {
        p.fiber = null;
        Sound.tick(0.07);
      }
      return;
    }
    if (!pr.KeyF || p.act || !p.alive) return;
    if (this.camp === 'armed') { this.say('Pas de fibre optique dans ce camp', 1.2); return; }
    const d = this.nearestDoor(p, 1.6 * U);
    if (!d) { this.say('Aucune porte à portée', 1); return; }
    if (d.open) { this.say('La porte est déjà ouverte', 1); return; }
    const spot = this.fiberSpot(p, d);
    if (!spot) { this.say('Impossible de glisser la fibre ici', 1.2); return; }
    Sound.tick(0.1);
    this.startAction(p, 'fiber', 0.7, () => { if (this.input.keys.KeyF && p.alive) p.fiber = spot; });
  }

  // Point d'observation : juste de l'autre côté du battant, au milieu de l'embrasure.
  fiberSpot(p, d) {
    const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
    const s = Math.sign((d.horizontal ? d.cy - p.y : d.cx - p.x)) || 1;
    const x = d.cx + nx * s * (TILE / 2 + 7), y = d.cy + ny * s * (TILE / 2 + 7);
    if (this.map.blocksMove(Math.floor(x / TILE), Math.floor(y / TILE))) return null;
    return { door: d, x, y, angle: Math.atan2(y - p.y, x - p.x), fov: 150 * DEG, range: 6 * U };
  }

  // ---- Portes ----
  // Cran d'ouverture suivant (dir > 0) ou précédent, ou null s'il n'y en a plus.
  doorStep(d, dir) {
    const eps = 0.01;
    if (dir > 0) { const up = DOOR_STEPS.find(s => s > d.progress + eps); return up === undefined ? null : up; }
    const down = DOOR_STEPS.filter(s => s < d.progress - eps);
    return down.length ? down[down.length - 1] : null;
  }

  // Ouvrir, entrouvrir ou fermer demande d'abord de manœuvrer la poignée : c'est ce geste qui prend
  // du temps, la porte ne bouge qu'ensuite. Entrouvrir en silence est le plus lent.
  doorAction(agent, door, target) {
    const say = t => { if (agent === this.player) this.say(t, 1.2); };
    // Retours explicites : sans eux, appuyer sur la touche semble simplement ne rien faire.
    if (target === null || target === undefined) {
      say(door.progress >= 1 ? 'La porte est déjà grande ouverte' : 'La porte est déjà fermée');
      return false;
    }
    if (agent.act) return false;
    if (door.opening) { say('La porte est déjà en mouvement'); return false; }
    if (target === door.progress) return false;
    const opening = target > door.progress;
    if (!opening && door.broken) { say('La serrure est arrachée : la porte ne ferme plus'); return false; }
    if (!opening) {
      // on vérifie avant le geste, pour ne pas manœuvrer la poignée pour rien
      const blocker = this.doorBlocker(door);
      if (blocker) { say(this.doorBlockedMsg(agent, blocker)); return false; }
    }
    // Porte fermée à clé : les suspects ont la clé (un tour de plus) ; l'équipe crochète la serrure, lentement
    // et presque sans bruit. Le joueur s'arrête une fois la porte déverrouillée (à lui de choisir comment
    // l'ouvrir) ; un coéquipier en route l'ouvre dans la foulée.
    if (door.locked && opening && agent.team === 'ops') {
      door.lockKnown = true;
      say('Porte verrouillée : crochetage… (B : charge, ou fusil à pompe dans la serrure)');
      Sound.tick(0.06);
      this.noise(door.cx, door.cy, 1.2 * U, agent, 'door');
      return this.startAction(agent, 'lockpick', LOCKPICK_TIME, () => {
        if (!door.locked || dist(agent.x, agent.y, door.cx, door.cy) > 2.2 * U) return;
        door.locked = false;
        Sound.tick(0.1);
        if (agent === this.player) this.say('Serrure crochetée : la porte est déverrouillée', 1.6);
        else this.openDoor(agent, door, target);
      });
    }
    // Poignée à manœuvrer, puis course du battant : entrouvrir demande moins d'effort qu'ouvrir en grand.
    let dur = 0.25 + 0.3 * Math.abs(target - door.progress);
    if (agent.team === 'enemy') { dur *= 1.3; if (door.locked && opening) { dur += 0.4; door.locked = false; } }
    Sound.tick(0.08); // poignée
    return this.startAction(agent, 'door', dur, () => {
      if (dist(agent.x, agent.y, door.cx, door.cy) > 2.2 * U) return; // on s'est éloigné entre-temps
      if (opening) this.openDoor(agent, door, target);
      else this.closeDoor(agent, door, target);
    });
  }


  // target : 1 = ouverte en grand, 0.3 = entrouverte (laisse passer le regard, pas le passage).
  openDoor(agent, door, target) {
    target = target === undefined ? 1 : target;
    if (target <= door.progress) return;
    door.target = target;
    door.opening = true;
    door.duration = agent.team === 'ops' ? 0.3 : 0.45;
    const quiet = target < 1;
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 5) * U, agent, 'door');
    if (!quiet) Sound.door();
  }

  // Une porte encaisse la chevrotine jusqu'à ce que la serrure lâche : elle s'ouvre alors d'un coup
  // et ne se referme plus (le pêne est arraché).
  breachDoor(door, shooter) {
    if (door.broken) return;
    if (this.time - (door.hitT || -9) > 3) door.hits = 0; // impacts trop espacés : le bois tient
    door.hitT = this.time;
    door.hits = (door.hits || 0) + 1;
    if (door.hits < BREACH_PELLETS) return;
    door.broken = true;
    door.locked = false;
    door.opening = true;
    door.target = 1;
    door.duration = 0.25;
    door.ajar = false;
    Sound.door();
    this.noise(door.cx, door.cy, 10 * U, shooter, 'breach');
    if (shooter === this.player) this.say('Serrure arrachée : la porte ne ferme plus', 2);
  }

  // ---- Charge de brèche (assaut) ----
  // B devant une porte fermée : on pose une charge sur le battant, de son côté. B à nouveau, où qu'on soit : mise
  // à feu. La porte vole en éclats, la serrure avec ; derrière, tout ce qui se tient près de l'embrasure est
  // sonné, et blessé tout contre. De votre côté, mieux vaut s'être écarté. Une seule charge posée à la fois.
  chargeKey(p) {
    if (this.camp === 'armed') { this.say('Pas de charge de brèche dans ce camp', 1.2); return; }
    if (!p.alive) return;
    const placed = this.charges.find(c => c.team === p.team);
    if (placed) { this.detonateCharge(placed); return; }
    if (p.act || p.fiber || p.cooking) return;
    if (p.charges <= 0) { this.say('Plus de charge de brèche', 1.2); return; }
    const d = this.nearestDoor(p, 1.6 * U);
    if (!d) { this.say('Aucune porte à portée', 1); return; }
    if (d.progress > 0 || d.broken) { this.say('Une charge se pose sur une porte fermée', 1.2); return; }
    const side = Math.sign(d.horizontal ? p.y - d.cy : p.x - d.cx) || 1;
    Sound.tick(0.08);
    this.startAction(p, 'charge', CHARGE_PLACE, () => {
      if (!p.alive || d.progress > 0 || d.broken || dist(p.x, p.y, d.cx, d.cy) > 2.2 * U) return;
      this.placeCharge(p, d, side);
      this.say('Charge posée — écartez-vous, B : mise à feu', 2.2);
      this.emit('weapon');
    });
  }

  // La charge collée au battant, du côté side : celui qui la pose en a une de moins (le joueur, ou un opérateur
  // de l'intervention, voir updateChargeEntry).
  placeCharge(a, d, side) {
    a.charges--;
    const off = TILE / 2 + 2;
    const c = { door: d, side, x: d.cx + (d.horizontal ? 0 : side * off), y: d.cy + (d.horizontal ? side * off : 0), t: 0, by: a, team: a.team };
    this.charges.push(c);
    this.noise(d.cx, d.cy, 1 * U, a, 'door');
    Sound.tick(0.12);
    return c;
  }

  // Une charge tient tant que la porte reste fermée : si quelqu'un l'ouvre, elle tombe.
  updateCharges(dt) {
    for (const c of this.charges) c.t += dt;
    const fallen = this.charges.filter(c => c.door.progress > 0 && !c.door.broken);
    if (!fallen.length) return;
    this.charges = this.charges.filter(c => !fallen.includes(c));
    if (fallen.some(c => c.team === this.player.team)) this.say("La porte s'est ouverte : la charge est tombée", 2);
  }

  // Le souffle part de toute l'embrasure, du côté de a (la charge ouvre la porte en grand, et ses éclats ne
  // s'arrêtent pas au battant) : on atteint donc aussi qui se tient contre le mur, de part et d'autre du cadre,
  // ou derrière le battant rabattu.
  blastReaches(d, a) {
    const s = Math.sign(d.horizontal ? a.y - d.cy : a.x - d.cx) || 1, half = (d.len * TILE) / 2, off = TILE / 2 + 1;
    for (const k of [-1, 0, 1]) {
      const lat = k * (half - 4);
      const x = d.cx + (d.horizontal ? lat : s * off), y = d.cy + (d.horizontal ? s * off : lat);
      if (this.map.hasLOS(x, y, a.x, a.y, d)) return true;
    }
    return false;
  }

  detonateCharge(c) {
    this.charges = this.charges.filter(o => o !== c);
    const d = c.door, by = c.by || this.player;
    Object.assign(d, { broken: true, locked: false, opening: false, progress: 1, target: 1, open: true, ajar: false });
    this.effects.push({ type: 'frag', x: c.x, y: c.y, t: 0, life: 0.6, small: true });
    for (let i = 0; i < 4; i++) {
      const a = (d.horizontal ? -c.side * Math.PI / 2 : (c.side > 0 ? Math.PI : 0)) + rand(-0.7, 0.7);
      this.effects.push({ type: 'splinter', x: d.cx, y: d.cy, angle: a, t: 0, life: 0.35 });
    }
    this.addDecal({ type: 'scorch', x: c.x, y: c.y });
    Sound.frag();
    const across = a => (d.horizontal ? a.y - d.cy : a.x - d.cx);
    const p = this.player, wasStunned = p.stun > 0;
    for (const a of [...this.enemies, ...this.ops, ...this.hostages]) {
      if (!a.alive || a.evacuated) continue;
      const dd = dist(d.cx, d.cy, a.x, a.y);
      if (dd > CHARGE_RADIUS || !this.blastReaches(d, a)) continue;
      const ang = Math.atan2(a.y - d.cy, a.x - d.cx);
      if (Math.sign(across(a)) !== c.side) {
        // derrière la porte : le souffle sonne tout le monde, blesse qui se tenait contre le battant
        if (dd < 1.2 * U) this.damage(a, 55 * (1 - dd / (1.2 * U)) + 5, by, ang);
        if (!a.alive || a.team === 'civ') continue;
        a.stun = Math.max(a.stun || 0, 1.5 + 2.5 * (1 - dd / CHARGE_RADIUS));
        a.target = null; a.path = []; a.blind = null;
        if (a === p) a.flashT = Math.max(a.flashT, 1);
      } else if (dd < CHARGE_NEAR) {
        // du côté de la charge, tout près : on encaisse aussi
        this.damage(a, 35 * (1 - dd / CHARGE_NEAR) + 5, by, ang);
        if (a.alive && a.team !== 'civ') a.stun = Math.max(a.stun || 0, 0.8);
      }
    }
    this.camShake = Math.max(this.camShake, 9);
    this.noise(d.cx, d.cy, 16 * U, by, 'boom');
    if (c.team === p.team) this.say('Brèche !', 1.2);
    else if (p.alive && p.stun > 0 && !wasStunned) this.say('Charge de brèche : vous êtes sonné', 1.6);
  }

  // Qui se trouve dans l'embrasure (et empêche donc de refermer) : agent, 'grenade', ou null.
  // On ne compte que ce qui est vraiment dans le cadre, pas ce qui passe devant.
  doorBlocker(door) {
    const half = (door.len * TILE) / 2, hw = TILE / 2;
    const inFrame = (x, y, r) => {
      const dx = Math.abs(x - door.cx), dy = Math.abs(y - door.cy);
      const along = door.horizontal ? dx : dy, across = door.horizontal ? dy : dx;
      return along < half + r * 0.4 && across < hw + r * 0.4;
    };
    for (const a of [...this.ops, ...this.enemies]) if (a.alive && inFrame(a.x, a.y, a.radius)) return a;
    for (const h of this.hostages) if (h.alive && !h.evacuated && inFrame(h.x, h.y, h.radius)) return h;
    for (const g of this.grenades) if (inFrame(g.x, g.y, 4)) return 'grenade';
    return null;
  }

  doorBlockedMsg(agent, blocker) {
    return blocker === agent ? "Dégagez l'embrasure pour fermer"
      : blocker === 'grenade' ? 'Une grenade est dans l\'embrasure'
      : blocker.team === 'civ' ? "Un otage est dans l'embrasure"
      : "Quelqu'un est dans l'embrasure";
  }

  // Fermeture (target 0 = fermée, crans intermédiaires possibles). Impossible si l'embrasure est occupée.
  closeDoor(agent, door, target) {
    if (target >= door.progress || door.broken) return;
    const blocker = this.doorBlocker(door);
    if (blocker) { if (agent === this.player) this.say(this.doorBlockedMsg(agent, blocker), 1.2); return; }
    door.target = target;
    door.opening = true;
    door.duration = 0.3;
    // la porte bloque le passage dès le début de la fermeture ; la vue passe jusqu'à la fin
    door.open = false;
    door.ajar = true;
    const quiet = door.progress < 1;
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 3.5) * U, agent, 'door');
    Sound.door();
  }

  // ---- Tir ----
  fireWeapon(shooter) {
    const s = shooter.slot, w = s.def;
    const n = w.pellets || 1;
    const spread = this.spreadOf(shooter), range = w.range * (this.scoped(shooter) ? SCOPE.reach : 1);
    const ml = muzzleDist(w.gunLen);
    // Collé à un mur ou à une porte, le canon dépasse de l'autre côté : la balle part alors du tireur
    // (et bute sur l'obstacle, ou le traverse avec le malus d'une porte) au lieu de naître derrière.
    const muzzle = this.map.castRay(shooter.x, shooter.y, shooter.angle, ml, false);
    const blocked = muzzle.hit;
    // la chevrotine fait sauter une serrure ; tirée au jugé dans une porte (blindFire), elle vise quelqu'un, pas la serrure
    const breach = w.kind === 'shotgun' && !shooter.blind ? 1 : 0;
    const mx = blocked ? muzzle.x - Math.cos(shooter.angle) * 2 : shooter.x + Math.cos(shooter.angle) * ml;
    const my = blocked ? muzzle.y - Math.sin(shooter.angle) * 2 : shooter.y + Math.sin(shooter.angle) * ml;
    for (let i = 0; i < n; i++) {
      const a = shooter.angle + rand(-spread, spread);
      const clear = !blocked && !this.map.castRay(shooter.x, shooter.y, a, ml, false).hit;
      const bx = clear ? shooter.x + Math.cos(a) * ml : shooter.x, by = clear ? shooter.y + Math.sin(a) * ml : shooter.y;
      this.bullets.push({ x: bx, y: by, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, team: shooter.team, damage: w.damage, life: range / w.speed, shooter, ox: shooter.x, oy: shooter.y, trail: w.heavy ? 10 : 18, pierce: w.pierce === undefined ? 0.4 : w.pierce, pierced: 0, breach, pen: w.pen || 1 });
    }
    shooter.bloom = Math.min(shooter.bloom + w.bloom, w.bloomMax || 8 * DEG);
    shooter.kick = 1;
    s.mag--;
    shooter.fireT = Math.max(shooter.fireT, -0.02) + 1 / w.rof; // report du reste : cadence réelle malgré le pas de 1/60 s
    shooter.muzzleT = 0.06;
    if (!w.suppressed) shooter.glowT = SHOT_GLOW; // la flamme de bouche éclaire le tireur (courant coupé)
    if (shooter === this.player) {
      const r = w.recoil || 4;
      this.camKick.x -= Math.cos(shooter.angle) * r; this.camKick.y -= Math.sin(shooter.angle) * r;
    }
    this.effects.push({ type: 'muzzle', x: mx, y: my, angle: shooter.angle, t: 0, life: 0.06, big: w.heavy });
    const ca = shooter.angle + Math.PI / 2 + rand(-0.4, 0.4);
    this.casings.push({ x: shooter.x + Math.cos(shooter.angle) * 8, y: shooter.y + Math.sin(shooter.angle) * 8, vx: Math.cos(ca) * rand(70, 130), vy: Math.sin(ca) * rand(70, 130), rot: rand(0, TAU), spin: rand(-12, 12), t: 0, life: 0.45 });
    if (shooter === this.player) { this.stats.shots++; this.camShake = Math.max(this.camShake, w.heavy ? 4 : 1.5); }
    this.noise(shooter.x, shooter.y, w.noise * U, shooter, 'shot');
    // un otage debout se jette à genoux quand on tire près de lui, le temps que ça cesse
    for (const h of this.hostages) if (h.escort && !h.exiting && dist(h.x, h.y, shooter.x, shooter.y) < HOSTAGE_DUCK_RANGE) h.duckT = HOSTAGE_DUCK;
    Sound.shot(shooter.team === 'ops' ? 0.3 : 0.2, w);
  }

  updateBullets(dt) {
    const keep = [];
    const civs = this.hostages.filter(h => !h.evacuated); // un otage sorti est hors d'atteinte
    for (const b of this.bullets) {
      const len = Math.hypot(b.vx, b.vy) * dt;
      const ang = Math.atan2(b.vy, b.vx), cs = Math.cos(ang), sn = Math.sin(ang);
      const r = this.map.castRay(b.x, b.y, ang, len, false);
      let hitT = r.hit ? r.dist : len;
      let victim = null, onShield = false;
      // Tir ami possible : les balles de l'équipe touchent aussi les coéquipiers (sauf le tireur). En trinômes, celles
      // d'en face aussi : les deux camps se valent.
      const cands = b.team === 'ops'
        ? [...this.enemies, ...civs, ...this.ops.filter(o => o !== b.shooter)]
        : [...this.ops, ...civs, ...(this.squads ? this.enemies.filter(o => o !== b.shooter) : [])];
      for (const c of cands) {
        if (!c.alive) continue;
        const rx = c.x - b.x, ry = c.y - b.y;
        const t = rx * cs + ry * sn;
        const perp = Math.abs(rx * sn - ry * cs);
        // Bouclier : un arc devant le porteur, à SHIELD_REACH de son centre. Une balle qui y entre de face
        // s'y arrête avant d'atteindre le corps ; de côté ou de dos, elle passe à côté et touche le corps.
        if (c.shield && t >= -SHIELD_REACH && t <= hitT + SHIELD_REACH && perp <= SHIELD_REACH) {
          const ts = Math.max(0, t - Math.sqrt(SHIELD_REACH * SHIELD_REACH - perp * perp));
          const ia = Math.atan2(b.y + sn * ts - c.y, b.x + cs * ts - c.x);
          if (ts <= hitT && Math.abs(angleDiff(c.angle, ia)) <= c.shield.arc) { hitT = ts; victim = c; onShield = true; continue; }
        }
        if (t < -c.radius || t > hitT + c.radius) continue;
        if (perp > c.radius) continue;
        const tt = Math.max(0, t - Math.sqrt(c.radius * c.radius - perp * perp));
        if (tt <= hitT) { hitT = tt; victim = c; onShield = false; }
      }
      if (b.pierced) this.doorShotAlarm(b, cs, sn, hitT);
      if (victim && onShield) { this.shieldHit(victim, b, b.x + cs * hitT, b.y + sn * hitT, ang); continue; }
      if (victim) {
        this.damage(victim, this.vestHit(victim, b, ang, b.damage), b.shooter, ang);
        if (b.shooter === this.player && victim.team === 'enemy') this.stats.hits++;
        continue;
      }
      if (r.hit) {
        // Une porte n'est pas un mur : la balle la traverse en perdant de l'énergie (et un peu sa ligne).
        if (r.door && b.pierced < 2) {
          if (b.breach && b.pierced === 0) this.breachDoor(r.door, b.shooter);
          b.pierced++;
          b.damage *= b.pierce;
          const na = ang + rand(-1.6, 1.6) * DEG;
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          b.x = r.x + Math.cos(na) * 3; b.y = r.y + Math.sin(na) * 3; // ressort de l'autre côté
          b.life -= dt;
          this.effects.push({ type: 'splinter', x: r.x, y: r.y, angle: ang, t: 0, life: 0.25 });
          Sound.pierce();
          this.noise(r.x, r.y, 3 * U, b.shooter, 'impact'); // l'impact s'entend de l'autre côté
          if (b.life > 0 && b.damage >= 2) keep.push(b);
          continue;
        }
        this.addDecal({ type: 'hole', x: r.x - cs * 1.5, y: r.y - sn * 1.5 });
        this.effects.push({ type: 'spark', x: r.x, y: r.y, t: 0, life: 0.15 });
        // l'impact claque : même tiré au silencieux, un coup manqué s'entend près du mur
        this.noise(r.x - cs * 2, r.y - sn * 2, 2.5 * U, b.shooter, 'impact');
        continue;
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life > 0) keep.push(b);
    }
    this.bullets = keep;
  }

  // Balle sur un bouclier : arrêtée (étincelle, choc dans le bras, impact qui claque) si le bouclier est
  // de niveau suffisant, sinon elle le traverse et le porteur encaisse une partie des dégâts.
  shieldHit(c, b, x, y, ang) {
    const sh = c.shield;
    this.effects.push({ type: 'spark', x, y, t: 0, life: 0.18 });
    Sound.ping();
    this.noise(x, y, 2.5 * U, b.shooter, 'impact');
    if (b.pen > sh.stops) {
      this.damage(c, this.vestHit(c, b, ang, b.damage * sh.through), b.shooter, ang);
      if (b.shooter === this.player && c.team === 'enemy') this.stats.hits++;
      return;
    }
    c.kick = Math.max(c.kick, 0.6);
    c.handBloom = Math.max(c.handBloom || 0, 2 * DEG); // le choc dérange la visée
    if (c === this.player) this.camShake = Math.max(this.camShake, 2.5);
    if (c !== this.player && !c.target && b.shooter) c.alertAngle = Math.atan2(b.shooter.y - c.y, b.shooter.x - c.x);
  }

  // Balle sur un porteur de gilet (ang : sens de sa course) : dégâts encaissés. De face ou de dos, dans l'arc
  // des plaques, elles arrêtent jusqu'à vest.plate ; partout, le gilet souple arrête jusqu'à vest.soft. Une
  // balle arrêtée ne laisse que le choc ; une balle qui perce frappe de tous ses dégâts.
  vestHit(c, b, ang, dmg) {
    const v = c.vest;
    if (!v || !c.alive) return dmg;
    const plate = v.plate && (Math.abs(angleDiff(c.angle, ang + Math.PI)) <= v.arc || Math.abs(angleDiff(c.angle, ang)) <= v.arc);
    if (plate && b.pen <= v.plate) { this.vestStop(c); return dmg * v.plateBlunt; }
    if (b.pen <= v.soft) { this.vestStop(c); return dmg * v.blunt; }
    return dmg;
  }

  vestStop(c) {
    c.handBloom = Math.max(c.handBloom || 0, 1.5 * DEG); // le choc dérange la visée
  }

  damage(target, dmg, shooter, ang) {
    if (!target.alive) return;
    this.effects.push({ type: 'hit', x: target.x, y: target.y, t: 0, life: 0.25 });
    for (let i = 0; i < 3; i++) {
      const d = rand(4, 22);
      this.addDecal({ type: 'blood', x: target.x + Math.cos(ang + rand(-0.6, 0.6)) * d, y: target.y + Math.sin(ang + rand(-0.6, 0.6)) * d, r: rand(2, 5) });
    }
    if (target.vip) {
      // Le VIP encaisse comme un homme (son gilet a déjà pris sa part, voir vestHit) ; à moitié de ses
      // forces, il boite et suit moins vite. Une balle de l'équipe compte lourd dans la note de fin.
      target.hp -= dmg;
      if (shooter && shooter.team === 'ops') this.stats.vipHits++;
      target.wounded = target.hp <= target.maxHp / 2;
      if (target.hp > 0) { this.say(target.wounded ? 'Le VIP est grièvement touché !' : 'Le VIP est touché !', 2); return; }
      target.hp = 0;
      target.alive = false;
      this.addDecal({ type: 'pool', x: target.x, y: target.y, rot: target.angle });
      this.noise(target.x, target.y, 2 * U, target, 'body');
      return;
    }
    if (target.team === 'civ') {
      // Un otage survit à une première blessure légère ; une deuxième, ou une blessure grave
      // (HOSTAGE_GRAVE et plus : balle lourde à bout portant, éclat de grenade), le tue.
      if (!target.wounded && dmg < HOSTAGE_GRAVE) {
        target.wounded = true;
        this.say('Un otage est blessé', 2);
        return;
      }
      target.alive = false;
      this.addDecal({ type: 'pool', x: target.x, y: target.y, rot: target.angle });
      this.noise(target.x, target.y, 2 * U, target, 'body');
      if (this.siege) {
        const left = this.hostages.filter(h => h.alive && !h.evacuated).length;
        if (left) this.say(`Un otage est tombé — il vous en reste ${left}`, 3);
      }
      return;
    }
    target.hp -= dmg;
    // balle (ou éclat) de l'équipe dans l'un des siens : comptée dans la note de fin (en guerre totale, seulement les
    // vôtres : votre armée compte des dizaines de tireurs que vous ne commandez pas)
    if (target.team === 'ops' && shooter && shooter.team === 'ops' && shooter !== target && !this.siege && (!this.war || shooter === this.player)) this.stats.friendly++;
    if (target !== this.player && !target.target && shooter && !target.surrender) target.alertAngle = Math.atan2(shooter.y - target.y, shooter.x - target.x);
    if (target === this.player) this.camShake = Math.max(this.camShake, 5);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.path = [];
      target.target = null;
      target.moving = false;
      target.bodyAngle = ang + rand(-0.6, 0.6);
      target.dying = { t: 0, dur: 0.7, dir: ang, spin: Math.random() < 0.5 ? -1 : 1 };
      target.diedAt = this.time;
      // un corps qui tombe s'entend un peu : un suspect abattu sans bruit peut encore alerter ses voisins
      this.noise(target.x, target.y, 2 * U, target, 'body');
      // guerre totale : chaque mort compte pour l'armée d'en face, quoi qui l'ait tué
      if (this.war) {
        this.war.kills[target.team === 'ops' ? 'enemy' : 'ops']++;
        if (shooter === this.player && target.team === 'enemy') this.war.mine++;
      }
      if (target.team === 'enemy') {
        this.stats.kills++;
        if (target.surrender) this.stats.badKills++; // abattu à genoux, les mains sur la tête
      }
      // (en guerre totale, seuls ceux de votre trinôme sont annoncés : les autres tombent par dizaines)
      else if (target !== this.player) { this.stats.losses++; if (!(this.war && target.hunter)) this.say(`${target.name} est à terre !`, 2.5); }
      else if (this.war ? this.crew.length : this.mates.some(m => m.alive)) { this.stats.losses++; this.say('Vous êtes à terre — un coéquipier reprend la main', RELAY_DELAY + 0.3); }
      else if (this.war) this.stats.losses++;
    }
  }

  // ---- Grenades ----
  updateGrenades(dt) {
    const R = 3.5; // rayon de la grenade
    for (const g of this.grenades) {
      g.t += dt;
      const speed = Math.hypot(g.vx, g.vy);
      // sous-pas pour ne jamais traverser un mur
      const steps = Math.max(1, Math.ceil(speed * dt / 4));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        // En vol, elle passe au-dessus du mobilier (plantes, tables, caisses...) ; au sol elle rebondit
        // dessus, sauf si elle est retombée sur un meuble : elle en roule jusqu'à tomber.
        const over = g.t - dt + s * sdt < g.flight || this.grenadeOnProp(g);
        const nx = g.x + g.vx * sdt;
        if (g.vx !== 0 && this.grenadeBlocked(nx + Math.sign(g.vx) * R, g.y, over)) this.bounceGrenade(g, 'x');
        else g.x = nx;
        const ny = g.y + g.vy * sdt;
        if (g.vy !== 0 && this.grenadeBlocked(g.x, ny + Math.sign(g.vy) * R, over)) this.bounceGrenade(g, 'y');
        else g.y = ny;
        this.doorLeafHit(g, R);
      }
      g.spin += speed * dt * 0.05;
      if (g.t < g.flight) g.h = Math.sin(g.t / g.flight * Math.PI) * 12;           // en l'air
      else if (g.t < g.flight + 0.18) g.h = Math.sin((g.t - g.flight) / 0.18 * Math.PI) * 3; // petit rebond à l'atterrissage
      else g.h = 0;
      if (g.t >= g.flight && this.grenadeOnProp(g)) g.h = Math.max(g.h, 5); // sur le plateau du meuble
      if (g.t >= g.flight) { const f = Math.exp(-g.friction * dt); g.vx *= f; g.vy *= f; }   // roulement
      if (speed < 4) { g.vx = 0; g.vy = 0; }
      if (g.t + g.cooked >= g.fuse) { if (g.kind === 'frag') this.detonateFrag(g); else this.detonateFlash(g.x, g.y, g); }
    }
    this.grenades = this.grenades.filter(g => g.t + g.cooked < g.fuse);
  }

  bounceGrenade(g, axis) {
    const speed = Math.hypot(g.vx, g.vy);
    if (axis === 'x') { g.vx = -g.vx * 0.45; g.vy *= 0.8; } else { g.vy = -g.vy * 0.45; g.vx *= 0.8; }
    g.bounces++;
    if (speed > 40) { Sound.tick(Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, g.thrower, 'bounce'); }
  }

  detonateFlash(x, y, g) {
    this.effects.push({ type: 'flash', x, y, t: 0, life: 0.7 });
    Sound.flash();
    const R = 6.5 * U;
    // Ceux du camp du lanceur savent qu'elle part : ils détournent les yeux et ne sont gênés
    // que si elle éclate presque à leurs pieds.
    const warned = a => g && a.team === g.team;
    const reach = a => (warned(a) ? 1.2 * U : R);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < reach(e) && this.map.hasLOS(x, y, e.x, e.y)) {
        e.stun = Math.max(e.stun, 2.5 + 3.5 * (1 - d / R));
        e.target = null;
        e.path = [];
      }
    }
    const p = this.player;
    const dp = dist(x, y, p.x, p.y);
    if (p.alive && dp < reach(p) && this.map.hasLOS(x, y, p.x, p.y)) {
      const facing = Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < p.fov / 2;
      p.flashT = Math.max(p.flashT, (facing ? 2.2 : 0.8) * (1 - dp / R) + 0.3);
    }
    for (const m of this.mates) {
      if (!m.alive) continue;
      const dm = dist(x, y, m.x, m.y);
      if (dm < reach(m) && this.map.hasLOS(x, y, m.x, m.y)) { m.stun = Math.max(m.stun, 1.5 * (1 - dm / R) + 0.3); m.target = null; }
    }
    this.camShake = Math.max(this.camShake, 6);
    this.noise(x, y, 14 * U, g ? g.thrower : null, 'boom');
  }

  // Grenade à fragmentation : dégâts décroissants jusqu'à FRAG_RADIUS, pour tous ceux qu'aucun mur ni
  // porte fermée ne protège — lanceur, alliés et otages compris.
  detonateFrag(g) {
    const { x, y } = g;
    this.effects.push({ type: 'frag', x, y, t: 0, life: 0.9 });
    this.addDecal({ type: 'scorch', x, y });
    Sound.frag();
    for (const a of [...this.enemies, ...this.ops, ...this.hostages]) {
      if (!a.alive || a.evacuated) continue;
      const d = dist(x, y, a.x, a.y);
      if (d >= FRAG_RADIUS || !this.map.hasLOS(x, y, a.x, a.y)) continue;
      const k = 1 - d / FRAG_RADIUS;
      this.damage(a, FRAG_DAMAGE * k * k + 8, g.thrower, Math.atan2(a.y - y, a.x - x));
      if (a.alive && a.team !== 'civ') { a.stun = Math.max(a.stun || 0, 0.8 * k); a.target = null; }
    }
    this.camShake = Math.max(this.camShake, 11);
    this.noise(x, y, 18 * U, g.thrower, 'boom');
  }

  // ---- Ennemis ----
  // ---- Bruit ----
  // Un bruit part de (x, y) avec une portée R en plein air (px) et une nature (NOISE_KINDS). Il se
  // propage case par case (soundField) : chacun l'entend avec une intensité de 1 (sur place) à 0 (hors
  // de portée), plus faible derrière un mur ou une porte fermée.
  noise(x, y, R, source, kind) {
    kind = kind || 'shot';
    if (!(R > 0) || !this.map) return;
    const K = NOISE_KINDS[kind] || NOISE_KINDS.shot;
    const f = this.soundField(x, y, R), w = this.map.w;
    const level = a => {
      const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
      if (!this.map.inBounds(tx, ty)) return 0;
      const d = f[ty * w + tx];
      return d < R ? 1 - d / R : 0;
    };
    // coéquipiers (ou complices) : ils tournent la tête vers un bruit de l'autre camp, sans quitter leur poste ;
    // le trinôme autonome de votre camp, lui, converge sur ce qu'il entend, comme celui d'en face
    for (const m of this.mates || []) {
      if (!m.alive || m === source || m.target || m.stun > 0) continue;
      const ally = !!source && source.team === m.team;
      if (m.hunter) {
        const I = level(m);
        if (I > 0 && !(ally && !ALLY_ALARM.has(kind))) this.hearNoise(m, x, y, I, K, ally);
        continue;
      }
      if (ally) continue;
      if (m.coverAngle === null && level(m) * K.w >= HEAR_TURN) m.alertAngle = Math.atan2(y - m.y, x - m.x);
    }
    // suspects (ou opérateurs) : ils se tournent, s'inquiètent, et les plus proches vont voir
    const goers = [];
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e === source || e.stun > 0 || e.target) continue;
      const I = level(e);
      if (I <= 0) continue;
      const ally = !!source && source.team === e.team;
      if (ally && !ALLY_ALARM.has(kind)) continue;
      if (this.hearNoise(e, x, y, I, K, ally)) goers.push({ e, I });
    }
    if (goers.length) {
      // au plus RESPONDERS à la fois sur un même bruit : les plus proches à l'oreille d'abord
      const busy = this.enemies.filter(o => o.alive && o.state === 'investigate' && o.lastKnown && dist(o.lastKnown.x, o.lastKnown.y, x, y) < 3 * U).length;
      let slots = Math.max(0, RESPONDERS - busy);
      goers.sort((a, b) => b.I - a.I);
      for (const { e, I } of goers) {
        if (slots > 0) { slots--; this.investigate(e, x, y, I); }
        else if (e.suspicion >= SUSPICION_ALL) this.investigate(e, x, y, I);
      }
    }
    // le joueur : direction et force de ce qu'il entend sans le voir (ses propres pas et ceux de l'équipe exceptés)
    const p = this.player;
    if (p && p.alive && source !== p && !(kind === 'step' && source && source.team === p.team)) {
      const I = level(p);
      if (I >= 0.05 && !this.seesPoint(x, y)) this.addHeard(Math.atan2(y - p.y, x - p.x), I, kind);
    }
    // son propre bruit : jusqu'où il porte (halo affiché un instant)
    if (source === p && R >= 1.5 * U && kind !== 'step' && kind !== 'bounce') this.markOwnNoise(f, R);
  }

  // Distance acoustique depuis (x, y) jusqu'à R : Dijkstra sur la grille fine. Une case de sol coûte sa
  // longueur ; un mur, une porte infranchissable ou une vitre ajoutent SOUND_WALL / SOUND_DOOR / SOUND_GLASS ;
  // le vide extérieur ne transmet rien. Le tableau renvoyé est partagé : à lire tout de suite.
  soundField(x, y, R) {
    const m = this.map, w = m.w, N = w * m.h;
    if (!this._sf || this._sf.length !== N) { this._sf = new Float32Array(N).fill(Infinity); this._sfDone = new Uint8Array(N); this._sfTouched = []; }
    const d = this._sf, done = this._sfDone;
    for (const i of this._sfTouched) { d[i] = Infinity; done[i] = 0; }
    const touched = this._sfTouched = [];
    const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
    if (!m.inBounds(sx, sy)) return d;
    const extra = i => {
      const t = m.tiles[i];
      if (t === 2) return Infinity;
      if (t === 1) return SOUND_WALL;
      const door = m.doorAt.get(i);
      if (door) return m.doorPassable(door) ? 0 : SOUND_DOOR;
      return m.windowAt.has(i) ? SOUND_GLASS : 0;
    };
    const start = sy * w + sx;
    d[start] = 0; touched.push(start);
    const heap = new MinHeap();
    heap.push(0, start);
    while (heap.size) {
      const i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      const ix = i % w, iy = (i - ix) / w, di = d[i];
      for (let k = 0; k < 8; k++) {
        const dx = SOUND_NB[k][0], dy = SOUND_NB[k][1];
        const nx = ix + dx, ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
        const n = ny * w + nx;
        if (done[n]) continue;
        // en diagonale, pas à travers l'angle de deux murs
        if (dx && dy && m.tiles[iy * w + nx] === 1 && m.tiles[ny * w + ix] === 1) continue;
        const nd = di + SOUND_NB[k][2] + extra(n);
        if (nd < R && nd < d[n]) {
          if (d[n] === Infinity) touched.push(n);
          d[n] = nd;
          heap.push(nd, n);
        }
      }
    }
    return d;
  }

  // Un suspect (ou un opérateur) entend un bruit d'intensité I : il s'inquiète, se tourne vers lui, et
  // dit s'il voudrait aller voir (noise choisit ensuite qui y va vraiment).
  hearNoise(e, x, y, I, K, ally) {
    const s = I * K.w;
    // une rafale compte moins que des bruits distincts : c'est la répétition qui inquiète
    const gain = this.time - e.heardT < 0.4 ? 0.35 : 1;
    e.heardT = this.time;
    e.suspicion = Math.min(2, (e.suspicion || 0) + s * gain);
    if (s < HEAR_TURN) return false;
    const toward = Math.atan2(y - e.y, x - e.x);
    if (e.hunter) {
      // l'intervention (ou un trinôme) converge sur ce qu'elle entend du camp d'en face (un impact ou une grenade
      // qui rebondit ne disent pas où est le tireur)
      if (!ally && K !== NOISE_KINDS.impact && K !== NOISE_KINDS.bounce && (K.important || s >= HEAR_GO)) this.know(e, x, y);
      if (e.noiseT <= 0) { e.noiseT = 1; e.alertAngle = toward; }
      return false;
    }
    if (e.state === 'investigate' && e.noiseT > 0) return false; // il vient de partir voir
    e.alertAngle = toward;
    if (e.state !== 'investigate') e.homeAngle = toward; // il garde désormais un œil de ce côté
    return (K.important && s >= HEAR_GO) || e.suspicion >= SUSPICION_GO;
  }

  // Aller voir : vers l'endroit du bruit, localisé d'autant moins bien qu'il était faible.
  investigate(e, x, y, I) {
    const err = (1 - I) * 1.5 * U, a = rand(0, TAU), r = rand(0, err);
    let gx = x + Math.cos(a) * r, gy = y + Math.sin(a) * r;
    let path = this.pathTo(e, gx, gy);
    if (!path.length) { gx = x; gy = y; path = this.pathTo(e, x, y); }
    e.state = 'investigate';
    e.lastKnown = { x: gx, y: gy };
    e.searchT = 0;
    e.path = path;
    e.noiseT = 1.5;
    e.suspicion = Math.max(0, e.suspicion - 0.6); // il y va : l'inquiétude retombe un peu
  }

  // Repère d'un bruit entendu par le joueur (fusionné avec un repère proche de même nature).
  addHeard(a, I, kind) {
    for (const h of this.heard) {
      if (h.kind === kind && h.t < 0.35 && Math.abs(angleDiff(h.a, a)) < 16 * DEG) { h.i = Math.max(h.i, I); h.a = a; h.t = 0; return; }
    }
    this.heard.push({ a, i: I, kind, t: 0 });
    if (this.heard.length > 24) this.heard.shift();
  }

  // Halo du dernier bruit du joueur : les cases qu'il atteint et son intensité (au plus ~8 fois par seconde).
  markOwnNoise(f, R) {
    const n = this.ownNoise;
    if (n && this.time - n.at < 0.12 && n.R >= R) return;
    const cells = [];
    for (const i of this._sfTouched) if (f[i] < R) cells.push(i, 1 - f[i] / R);
    this.ownNoise = { cells, R, at: this.time, id: (n ? n.id : 0) + 1 };
  }

  // Pas de course : un bruit tous les STEP_EVERY px parcourus. Marcher ne s'entend pas.
  footstep(a, moved, R) {
    if (!R) { a.stepAcc = 0; return; }
    a.stepAcc = (a.stepAcc || 0) + moved;
    if (a.stepAcc < STEP_EVERY) return;
    a.stepAcc = 0;
    this.noise(a.x, a.y, R, a, 'step');
  }

  pathTo(agent, wx, wy) {
    return this.map.routeTo(agent.x, agent.y, Math.floor(wx / TILE), Math.floor(wy / TILE), agent.radius) || [];
  }

  canSee(agent, other) {
    const d = dist(agent.x, agent.y, other.x, other.y), a = Math.atan2(other.y - agent.y, other.x - agent.x);
    if (d > this.viewOf(agent, a) || (this.dark && d > DARK_SIGHT && d > this.sightOf(agent, other))) return false;
    if (Math.abs(angleDiff(agent.angle, a)) > agent.fov / 2) return false;
    return this.map.hasLOS(agent.x, agent.y, other.x, other.y);
  }

  // Cible visible la plus proche parmi des candidats ; le VIP, dès qu'il est en vue, passe avant tout le monde.
  acquireFor(agent, cands) {
    const vip = cands.find(c => c.vip);
    if (vip && vip.alive && this.canSee(agent, vip)) return vip;
    let best = null, bd = Infinity;
    for (const c of cands) {
      if (!c.alive || c.surrender) continue; // on ne tire pas sur un suspect rendu
      const d = dist(agent.x, agent.y, c.x, c.y);
      if (d < bd && this.canSee(agent, c)) { bd = d; best = c; }
    }
    return best;
  }

  enemyCombat(e, dt) {
    if (e.stun > 0) { e.stun -= dt; e.target = null; e.blind = null; e.moving = false; return; }
    let t = e.target;
    if (t && (!t.alive || dist(e.x, e.y, t.x, t.y) > this.viewOf(e, Math.atan2(t.y - e.y, t.x - e.x)) || !this.map.hasLOS(e.x, e.y, t.x, t.y))) {
      // vu disparaître derrière une porte : il sait où, et tire dedans
      if (t.alive) { e.target = null; this.startBlindFire(e, t.x, t.y); }
      t = null;
    }
    // en escorte, le VIP aperçu en plein échange : il lâche l'opérateur et pivote vers lui
    const v = this.vip;
    if (t && v && e.team === 'enemy' && t !== v && v.alive && this.canSee(e, v)) { t = v; e.reactT = Math.max(e.reactT, VIP_SWITCH); }
    if (!t) {
      // en escorte, le commando cherche aussi le VIP (et le vise d'abord) ; un trinôme autonome de votre camp
      // cherche ceux d'en face
      t = this.acquireFor(e, this.foesOf(e));
      if (t) {
        e.blind = null;
        e.reactT = e.reaction + (this.dazzles(t, e) ? LAMP_DAZZLE : 0);
        // un suspect qui vous repère crie l'alerte : ses voisins accourent ; et s'il tient, il prévient tout le monde
        // (l'intervention se tait ; le groupe armé des trinômes crie, sans alerte générale)
        if (!e.drilled && this.time - e.shoutT > 5) { e.shoutT = this.time; this.noise(e.x, e.y, 6 * U, e, 'voice'); }
        if (!e.hunter && e.spotT === null) e.spotT = 0;
      }
    }
    e.target = t;
    e.fireT -= dt; e.pauseT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 6 * DEG);
    if (!t) {
      if (e.blind && this.blindFire(e, dt)) return;
      if (e.alertAngle !== null && turnToward(e, e.alertAngle, e.turnRate, dt)) e.alertAngle = null;
      return;
    }
    e.alertAngle = null;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    const d = dist(e.x, e.y, t.x, t.y);
    const w = e.weapon;
    e.aimDist = d;
    e.engaged = d <= this.fireRange(e);
    if (e.engaged || !e.path.length) turnToward(e, a, e.turnRate, dt);
    e.reactT -= dt;
    // L'intervention ne tire jamais avec un otage (ou un équipier) dans l'axe : si ça dure, elle se
    // décale (voir updateAssault). Les trinômes du groupe armé ménagent au moins les leurs ; les suspects du
    // mode assaut, eux, n'ont pas ces scrupules.
    let clear = true;
    if (e.hunter) {
      clear = this.lineOfFireClear(e, t);
      e.blockedT = clear ? 0 : (e.blockedT || 0) + dt;
      e.blockedLine = e.blockedT > 0.35;
    }
    if (clear && e.engaged && e.reactT <= 0 && e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, a)) < 0.25) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) this.endBurst(e, w);
    }
  }

  // Distance d'où l'IA ouvre le feu : la portée de son arme, sans dépasser AI_FIRE_RANGE.
  fireRange(a) { return Math.min(a.weapon.range, AI_FIRE_RANGE); }

  // Fin d'une rafale de l'IA : le temps de ramener l'arme sur la cible avant la suivante. Personne ne tire au
  // métronome : la rafale suivante compte un coup de plus ou de moins (une arme qui tire coup par coup reste au
  // coup par coup), et la pause varie de ±BURST_JITTER.
  endBurst(a, w) {
    a.burstLeft = w.burst > 1 ? w.burst + Math.round(rand(-1, 1)) : w.burst;
    a.pauseT = w.pause * rand(1 - BURST_JITTER, 1 + BURST_JITTER);
  }

  // Tir dans une porte : un suspect qui sait quelqu'un derrière une porte (il l'y a vu disparaître, ou une
  // balle en est sortie vers lui) l'arrose BLIND_FIRE s à travers le battant, puis va voir. Seules des portes
  // doivent le séparer du point : un mur arrête tout. L'intervention ne tire pas ainsi à l'aveugle (des
  // otages peuvent se trouver derrière). Renvoie false s'il ne tire pas.
  startBlindFire(e, x, y) {
    if (e.hunter || !e.alive || e.target || dist(e.x, e.y, x, y) > e.weapon.range) return false;
    if (this.map.doorsOnLine(e.x, e.y, x, y) <= 0) return false;
    e.blind = { x, y, t: BLIND_FIRE, off: e.blind ? e.blind.off : 0 };
    e.state = 'engage'; e.lostT = 0; e.lastKnown = { x, y };
    e.path = []; e.alertAngle = null;
    return true;
  }

  // Une rafale après l'autre dans la porte, chacune un peu décalée (il ne voit pas ce qu'il vise). Il cesse
  // au bout du temps, ou si la porte s'ouvre (il verrait qu'il n'y a plus personne) ou qu'un mur s'interpose.
  blindFire(e, dt) {
    const b = e.blind;
    b.t -= dt;
    if (b.t <= 0 || this.map.doorsOnLine(e.x, e.y, b.x, b.y) <= 0) { e.blind = null; return false; }
    const d = dist(e.x, e.y, b.x, b.y), w = e.weapon;
    const a = Math.atan2(b.y - e.y, b.x - e.x) + Math.atan2(b.off, d);
    e.aimDist = d;
    turnToward(e, a, e.turnRate, dt);
    e.reactT -= dt;
    if (e.reactT <= 0 && e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, a)) < 0.25) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) { this.endBurst(e, w); b.off = rand(-BLIND_SWEEP, BLIND_SWEEP); }
    }
    return true;
  }

  // Une balle sortie d'une porte frôle ou touche un suspect : il sait qu'on tire de derrière et riposte dans
  // la porte, vers l'endroit d'où le coup est parti (à une demi-case près : il l'entend, il ne le voit pas).
  doorShotAlarm(b, cs, sn, len) {
    const ox = b.ox !== undefined ? b.ox : b.shooter && b.shooter.x, oy = b.oy !== undefined ? b.oy : b.shooter && b.shooter.y;
    if (ox == null) return;
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e.team === b.team || e.target || e.stun > 0) continue;
      const t = clamp((e.x - b.x) * cs + (e.y - b.y) * sn, 0, len);
      if (dist(b.x + cs * t, b.y + sn * t, e.x, e.y) > BLIND_NEAR) continue;
      const was = !!e.blind, a = rand(0, TAU), r = rand(0, 0.5 * U);
      if (!this.startBlindFire(e, ox + Math.cos(a) * r, oy + Math.sin(a) * r) && !this.startBlindFire(e, ox, oy)) continue;
      if (was) continue;
      e.reactT = e.reaction;
      if (this.time - e.shoutT > 5) { e.shoutT = this.time; this.noise(e.x, e.y, 6 * U, e, 'voice'); }
    }
  }

  moveAlong(agent, dt) {
    agent.moving = false;
    if (agent.act) return; // geste en cours (poignée de porte) : on ne bouge pas
    if (agent.waitDoor) {
      if (!this.map.doorPassable(agent.waitDoor)) return;
      agent.waitDoor = null;
    }
    if (agent.holdT > 0) { agent.holdT -= dt; return; }
    if (agent.alertAngle !== null) return;
    if (!agent.path.length) return;
    const wp = agent.path[0];
    // déjà dans l'embrasure : on ne vise plus le milieu de la porte (à deux de front, chacun d'un côté du milieu, on
    // s'y bloquerait l'un l'autre)
    if (agent.path.length > 1 && this.inDoorway(agent, wp)) { agent.path.shift(); return; }
    const dx = wp.x - agent.x, dy = wp.y - agent.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) { agent.path.shift(); return; }
    const ang = Math.atan2(dy, dx);
    if (!agent.engaged) turnToward(agent, ang, agent.turnRate, dt);
    const ax = agent.x + Math.cos(ang) * (agent.radius + 4), ay = agent.y + Math.sin(ang) * (agent.radius + 4);
    const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
    if (door && !this.map.doorPassable(door)) {
      if (!door.opening) this.doorAction(agent, door, 1);
      agent.waitDoor = door;
      return;
    }
    // un suspect en ronde marche, il ne court pas
    const step = Math.min(d, agent.speed * (agent.patrol && agent.state === 'idle' ? PATROL_SPEED : 1) * dt);
    agent.x += Math.cos(ang) * step;
    agent.y += Math.sin(ang) * step;
    agent.moving = true;
    if (step >= d - 0.01) agent.path.shift();
    this.footstep(agent, step, this.stepNoise(agent));
  }

  // Le point wp est le milieu d'une porte ouverte (les chemins y passent, voir GameMap.routeTo) et l'agent se tient
  // déjà dans son embrasure, assez loin des montants pour en sortir tout droit.
  inDoorway(a, wp) {
    const d = this.map.door(Math.floor(wp.x / TILE), Math.floor(wp.y / TILE));
    if (!d || wp.x !== d.cx || wp.y !== d.cy || !this.map.doorPassable(d)) return false;
    const along = Math.abs(d.horizontal ? a.x - d.cx : a.y - d.cy), across = Math.abs(d.horizontal ? a.y - d.cy : a.x - d.cx);
    return across <= TILE / 2 && along <= (d.len * TILE) / 2 - a.radius + 2;
  }

  // Portée des pas d'un agent de l'IA : un coéquipier qui marche ne fait pas de bruit, un suspect qui
  // va voir quelque chose presse le pas, celui qui regagne son poste marche.
  stepNoise(a) {
    if (a.hunter) return STEP_NOISE.operator;
    if (a.team === 'enemy') return a.state === 'investigate' || a.state === 'engage' ? STEP_NOISE.suspect : 0;
    return a.walkMode ? 0 : STEP_NOISE.mate;
  }

  // Les siens (le camp de a, vous compris côté ops) et ceux d'en face (le VIP compris, pour le commando de l'escorte).
  teamOf(a) { return a.team === 'ops' ? this.ops : this.enemies; }
  foesOf(a) { return a.team === 'ops' ? this.enemies : this.vip ? [...this.ops, this.vip] : this.ops; }

  // Un agent autonome apprend où est l'adversaire (vu, entendu, son laser) : son trinôme le sait aussitôt.
  know(e, x, y) {
    e.lastKnown = { x, y };
    if (e.group) e.group.contact = { x, y, t: this.time };
  }

  // Progression d'un agent autonome : l'équipe d'intervention du siège, ou un trinôme (d'un camp comme de l'autre).
  // Il avance vers le dernier contact (le sien, ou celui que son trinôme a signalé), sinon vers le prochain secteur
  // à nettoyer, et s'arrête pour tirer dès qu'il voit. Un trinôme reste groupé (waitsForGroup).
  updateAssault(e, dt) {
    if (!e.alive) return;
    e.noiseT -= dt;
    e.suspicion = Math.max(0, e.suspicion - SUSPICION_DECAY * dt);
    if (this.siege && this.siege.prep > 0) { e.moving = false; return; } // ils attendent devant la porte
    this.enemyCombat(e, dt);
    if (e.stun > 0) return;
    if (!e.target) this.spotLaser(e, dt);
    e.repathT -= dt;
    const h = e.escorting;
    if (h && (!h.alive || h.evacuated || h.escort !== e)) { e.escorting = null; e.exit = null; }
    // en colonne sur une porte : il tient son poste (voir updateAiStack)
    if (e.entry) { this.stackStep(e, dt); return; }
    if (e.target) {
      this.know(e, e.target.x, e.target.y);
      if (e.blockedLine) {
        // otage dans l'axe : on cherche un angle dégagé plutôt que de tirer à travers
        const spot = this.firingSpot(e, e.target);
        if (spot && (!e.path.length || e.repathT <= 0)) { e.path = this.pathTo(e, spot.x, spot.y); e.repathT = 0.5; }
        this.moveAlong(e, dt); // engagé, il se déplace sans lâcher la cible des yeux (enemyCombat)
        return;
      }
      if (e.engaged) { e.path = []; e.moving = false; return; }
      // en escorte, on ne court pas après une cible hors de portée : la sortie d'abord
      if (!e.escorting) {
        if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 0.8; }
        this.moveAlong(e, dt);
        return;
      }
    }
    e.engaged = false;
    if (e.escorting) { this.escortToExit(e, dt); return; }
    if (this.maybeFlash(e, dt)) return;
    if (this.takeHostage(e)) return;
    if (e.clear && this.clearStep(e, dt)) return;
    const g = e.group;
    let goal = e.lastKnown;
    if (goal && dist(e.x, e.y, goal.x, goal.y) < 1.2 * U) { e.lastKnown = null; goal = null; }
    // le contact signalé par le trinôme : on y va ensemble, et on l'oublie une fois sur place (ou trop ancien)
    if (!goal && g && g.contact) {
      if (this.time - g.contact.t > SQUAD_CONTACT || dist(e.x, e.y, g.contact.x, g.contact.y) < 1.2 * U) g.contact = null;
      else goal = g.contact;
    }
    if (!goal) goal = this.assaultGoal(e);
    if (!goal) { this.moveAlong(e, dt); return; }
    if (!e.path.length || e.repathT <= 0) {
      e.path = this.pathTo(e, goal.x, goal.y);
      e.repathT = 1.2;
      // point injoignable (au ras d'un mur, derrière un meuble) : on l'oublie et on reprend le ratissage (un secteur
      // injoignable compte comme fait)
      if (!e.path.length && dist(e.x, e.y, goal.x, goal.y) > 1.2 * U) {
        if (goal === e.lastKnown) e.lastKnown = null;
        if (g && goal === g.contact) g.contact = null;
        if (goal.done === false) goal.done = true;
      }
    }
    if (this.considerStack(e)) return;
    if (this.waitsForGroup(e)) { e.moving = false; return; }
    this.moveAlong(e, dt);
  }

  // Un trinôme reste groupé : celui qui a pris plus de SQUAD_SPREAD d'avance sur un équipier en route l'attend.
  waitsForGroup(e) {
    const g = e.group;
    if (!g) return false;
    const left = a => { let L = 0, x = a.x, y = a.y; for (const q of a.path) { L += dist(x, y, q.x, q.y); x = q.x; y = q.y; } return L; };
    const mine = left(e);
    return g.members.some(o => o !== e && o.alive && o.group === g && !o.target && !o.entry && o.moving && o.path.length
      && dist(o.x, o.y, e.x, e.y) > SQUAD_SPREAD && left(o) > mine + U);
  }

  // Entré à la suite d'une colonne : il rejoint son angle de la pièce et le tient AI_CLEAR s, arme vers le fond.
  // false quand c'est fini (ou que l'angle est injoignable) : il reprend sa progression.
  clearStep(e, dt) {
    const c = e.clear;
    c.left -= dt;
    if (c.left <= 0) { e.clear = null; return false; }
    if (dist(e.x, e.y, c.x, c.y) > 6) {
      if (!e.path.length || e.repathT <= 0) {
        e.path = this.pathTo(e, c.x, c.y);
        if (e.path.length) e.path[e.path.length - 1] = { x: c.x, y: c.y };
        e.repathT = 0.6;
      }
      if (!e.path.length) { e.clear = null; return false; }
      this.moveAlong(e, dt);
      return true;
    }
    e.path = []; e.moving = false;
    if (e.alertAngle === null) turnToward(e, c.look, e.turnRate, dt);
    if ((c.t -= dt) <= 0) e.clear = null;
    return true;
  }

  // Première porte sur le chemin d'un agent, à moins de range : null si elle laisse déjà passer (ou s'ouvre).
  doorOnPath(a, range) {
    let x = a.x, y = a.y, left = range;
    for (const wp of a.path) {
      const L = dist(x, y, wp.x, wp.y), n = Math.max(1, Math.ceil(L / 6));
      for (let i = 1; i <= n; i++) {
        if (L * i / n > left) return null;
        const d = this.map.door(Math.floor((x + (wp.x - x) * i / n) / TILE), Math.floor((y + (wp.y - y) * i / n) / TILE));
        if (d) return d.opening || this.map.doorPassable(d) ? null : d;
      }
      left -= L; x = wp.x; y = wp.y;
      if (left <= 0) return null;
    }
    return null;
  }

  // Une porte fermée à franchir : de temps en temps (stackOdds), l'opérateur et les équipiers libres qui sont avec lui
  // se mettent en colonne au lieu de l'ouvrir en passant. Une porte où une colonne se prépare, on attend à distance
  // qu'elle s'ouvre. true : il ne bouge pas cette fois-ci.
  considerStack(e) {
    const s = this.hunt;
    if (!s || e.act || e.waitDoor) return false;
    const d = this.doorOnPath(e, 2.5 * U);
    if (!d || this.map.breaches.some(b => b.door === d)) return false;
    if (s.stacks.some(st => st.door === d && st.team[0].team === e.team)) { e.moving = false; return true; }
    // seule l'intervention se met en colonne : le groupe armé passe les portes comme il vient
    if (!e.drilled) return false;
    const tried = e.team + ':' + this.map.doors.indexOf(d);
    if (this.time - (s.stackT[e.team] || -99) < AI_STACK_GAP || (s.tried.has(tried) && this.time - s.tried.get(tried) < 2 * AI_STACK_GAP)) return false;
    const side = Math.sign(d.horizontal ? e.y - d.cy : e.x - d.cx) || 1;
    const across = o => Math.sign(d.horizontal ? o.y - d.cy : o.x - d.cx);
    // les équipiers libres de son trinôme (au siège, toute la vague)
    const team = this.teamOf(e).filter(o => o === e || (o.hunter && o.drilled && o.group === e.group && o.alive && !o.entry && !o.escorting
      && !o.target && !(o.stun > 0) && !o.act && across(o) === side && dist(o.x, o.y, d.cx, d.cy) < AI_STACK_RANGE && this.map.hasLOS(o.x, o.y, e.x, e.y)));
    if (team.length < 2) return false;
    s.tried.set(tried, this.time);
    // la menace est-elle derrière cette porte ?
    const behind = team.some(o => o.lastKnown && across(o.lastKnown) === -side && dist(o.lastKnown.x, o.lastKnown.y, d.cx, d.cy) < 8 * U);
    if (Math.random() >= this.stackOdds(behind)) return false;
    return this.formStack(d, side, team, this.pickEntry(team, d, behind));
  }

  // Chance de se mettre en colonne devant une porte fermée.
  stackOdds(behind) { return behind ? AI_STACK_THREAT : AI_STACK_CHANCE; }

  // Manière d'entrer : à la charge s'il en reste une dans l'équipe (et qu'aucun otage repéré n'attend derrière la
  // porte), à la flash s'ils sont au moins AI_FLASH_MIN et qu'il leur en reste (d'autant plus volontiers qu'ils en
  // ont), sinon porte ouverte. Une menace connue derrière la porte rend la charge et la flash plus probables.
  pickEntry(team, d, behind) {
    const flashes = team.reduce((n, o) => n + Math.max(0, o.flashbangs || 0), 0);
    const hostage = this.hostages.some(h => h.alive && !h.evacuated && h.found && dist(h.x, h.y, d.cx, d.cy) < CHARGE_RADIUS + U);
    const w = {
      charge: d.progress <= 0 && !hostage && team.some(o => o.charges > 0) ? (behind ? 1.5 : 0.7) : 0,
      flash: team.length >= AI_FLASH_MIN && flashes > 0 ? (behind ? 1.5 : 0.8) * Math.min(1, flashes / team.length) : 0,
    };
    let r = Math.random() * (1 + w.charge + w.flash);
    for (const k of ['charge', 'flash']) if ((r -= w[k]) < 0) return k;
    return 'plain';
  }

  // Colonne de l'intervention sur la porte d : un poste par opérateur de part et d'autre du cadre, le plus proche de
  // chacun ; pour une entrée à la charge, tous hors de portée du souffle (CHARGE_NEAR), le poseur se tenant d'abord
  // devant la porte. false s'il n'y a pas la place.
  formStack(d, side, team, tactic) {
    const inFront = { x: d.cx + (d.horizontal ? 0 : side * (TILE / 2 + 14)), y: d.cy + (d.horizontal ? side * (TILE / 2 + 14) : 0) };
    let posts = tactic === 'charge' ? this.stackPosts(d, side, team.length, CHARGE_NEAR + 8) : null;
    const front = posts && posts.length >= team.length && this.stackSpot(d, side, inFront.x, inFront.y, 11, posts);
    if (tactic === 'charge' && !front) tactic = 'plain';
    if (tactic !== 'charge') posts = this.stackPosts(d, side, team.length, 0);
    if (posts.length < 2) return false;
    // chacun prend le poste le plus proche de lui, les plus proches d'abord
    const members = [], free = team.slice(), left = posts.slice();
    while (free.length && left.length) {
      let bi = 0, bj = 0, bd = Infinity;
      free.forEach((o, i) => left.forEach((q, j) => { const dd = dist(o.x, o.y, q.x, q.y); if (dd < bd) { bd = dd; bi = i; bj = j; } }));
      const o = free.splice(bi, 1)[0], q = left.splice(bj, 1)[0], look = Math.atan2(d.cy - q.y, d.cx - q.x);
      Object.assign(o, { orderPos: { x: q.x, y: q.y }, stackSide: q.k, stackRank: q.rank, holdAngle: look, path: [], repathT: 0, clear: null });
      members.push(o);
    }
    const st = { ai: true, door: d, side, team: members, tactic, t: 0, ready: false, wait: null, flash: null, flashTried: false, charge: null, tries: 0, committed: false };
    if (tactic === 'charge') {
      const placer = members.filter(o => o.charges > 0).sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
      if (placer) {
        st.charge = { by: placer, phase: 'place', post: placer.orderPos, obj: null, wait: 0 };
        Object.assign(placer, { orderPos: { x: front.x, y: front.y }, holdAngle: Math.atan2(d.cy - front.y, d.cx - front.x) });
      } else st.tactic = 'plain';
    }
    for (const o of members) o.entry = st;
    this.hunt.stacks.push(st);
    this.hunt.stackT[members[0].team] = this.time;
    return true;
  }

  // Un opérateur en colonne : il gagne son poste sans ouvrir de porte et s'y tient face au cadre ; s'il voit quelqu'un,
  // il tire d'où il est. Ouvrir, lancer la flash ou poser la charge se décide pour toute la colonne (updateAiStack).
  stackStep(e, dt) {
    if (e.target) { e.lastKnown = { x: e.target.x, y: e.target.y }; e.path = []; e.moving = false; return; }
    e.engaged = false;
    if (e.act) { e.moving = false; return; }
    const p = e.orderPos;
    if (dist(e.x, e.y, p.x, p.y) > 4) {
      if (!e.path.length || e.repathT <= 0) {
        const path = this.map.routeTo(e.x, e.y, Math.floor(p.x / TILE), Math.floor(p.y / TILE), e.radius, { noClosedDoors: true });
        // poste injoignable sans ouvrir de porte : il le tient d'où il est
        if (!path) { e.orderPos = { x: e.x, y: e.y }; e.path = []; return; }
        e.path = path.length ? path : [{ x: p.x, y: p.y }];
        e.path[e.path.length - 1] = { x: p.x, y: p.y };
        e.repathT = 0.5;
      }
      this.moveAlong(e, dt);
    } else {
      e.path = []; e.moving = false;
      if (e.alertAngle === null) turnToward(e, e.holdAngle, e.turnRate, dt);
    }
  }

  // Une colonne de l'intervention, du rassemblement à l'entrée : porte ouverte en grand par le plus proche, flash glissée
  // par l'entrebâillement (les temps de l'équipe du joueur, voir updateFlashEntry), ou charge (updateChargeEntry). Une
  // porte ouverte entre-temps par l'autre camp : on entre aussitôt. Ce qui échoue retombe sur l'entrée porte ouverte.
  updateAiStack(s, dt) {
    const d = s.door, team = s.team.filter(o => o.alive && o.entry === s);
    if (!team.length) { this.dropStack(s); return; }
    s.t += dt;
    if (!s.ready && team.every(o => o.target || dist(o.x, o.y, o.orderPos.x, o.orderPos.y) < 10)) s.ready = true;
    if (s.t > AI_STACK_TIMEOUT * (s.committed ? 2 : 1)) {
      if (d.broken || this.map.doorPassable(d)) this.endStack(s, team); else this.dropStack(s);
      return;
    }
    if (s.tactic === 'charge') { this.updateChargeEntry(s, team, dt); return; }
    if (s.tactic === 'flash') {
      if (s.flash) {
        if (s.flash.phase !== 'place') s.committed = true;
        this.updateFlashEntry(s, team);
        return;
      }
      if (s.flashTried) s.tactic = 'plain'; // le lancer a avorté
      else if (s.ready) {
        s.flashTried = true;
        const plan = this.planFlash(s, team);
        if (plan) s.flash = { m: plan.m, crack: plan.crack, phase: 'place', g: null, tries: 0 };
      }
      return;
    }
    if (!d.broken && !this.map.doorPassable(d)) {
      s.wait = null;
      if (!s.ready || d.opening || team.some(o => o.act)) return;
      const opener = team.filter(o => !o.target && o.stun <= 0 && dist(o.x, o.y, d.cx, d.cy) < 2 * U)
        .sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
      if (!opener) return;
      if (++s.tries > 4) { this.dropStack(s); return; }
      if (this.doorAction(opener, d, 1)) s.committed = true;
      return;
    }
    if (s.wait === null) s.wait = d.broken ? 0.15 : ENTRY_DELAY;
    if ((s.wait -= dt) <= 0) this.endStack(s, team);
  }

  // Entrée à la charge : le poseur va devant la porte et pose la charge (CHARGE_PLACE), puis regagne son poste hors de
  // portée ; elle saute dès qu'aucun opérateur ne reste à moins de CHARGE_NEAR de la porte (ou qu'on a trop attendu),
  // et l'on entre aussitôt sur ceux qu'elle a sonnés. Porte ouverte avant (la charge tombe), poseur abattu : on entre
  // porte ouverte.
  updateChargeEntry(s, team, dt) {
    const d = s.door, c = s.charge, p = c.by;
    const plain = () => {
      s.tactic = 'plain'; s.charge = null;
      if (p.alive && p.entry === s) Object.assign(p, { orderPos: c.post, holdAngle: Math.atan2(d.cy - c.post.y, d.cx - c.post.x), path: [], repathT: 0 });
    };
    if (c.phase === 'blown') { if ((s.wait -= dt) <= 0) this.endStack(s, team); return; }
    if (d.broken || d.progress > 0) { plain(); return; }
    if (c.phase === 'place') {
      if (!p.alive || p.entry !== s) { plain(); return; }
      if (!s.ready || p.act || p.target || d.opening || dist(p.x, p.y, p.orderPos.x, p.orderPos.y) > 8) return;
      s.committed = true;
      c.phase = 'placing';
      Sound.tick(0.08);
      this.startAction(p, 'charge', CHARGE_PLACE, () => {
        if (!p.alive || d.progress > 0 || d.broken || dist(p.x, p.y, d.cx, d.cy) > 2.2 * U) return;
        c.obj = this.placeCharge(p, d, s.side);
      });
      return;
    }
    if (c.phase === 'placing') {
      if (p.alive && p.act) return;
      if (!c.obj) { plain(); return; }
      c.phase = 'clear';
      if (p.alive && p.entry === s) Object.assign(p, { orderPos: c.post, holdAngle: Math.atan2(d.cy - c.post.y, d.cx - c.post.x), path: [], repathT: 0 });
      return;
    }
    // 'clear' : chacun s'écarte, puis mise à feu
    if (!this.charges.includes(c.obj)) { plain(); return; }
    c.wait += dt;
    const exposed = this.teamOf(p).some(o => o.alive && dist(o.x, o.y, d.cx, d.cy) < CHARGE_NEAR + 4);
    if (c.wait < 0.3 || (exposed && c.wait < 6)) return;
    this.detonateCharge(c.obj);
    c.phase = 'blown';
    s.wait = 0.15;
  }

  // Une colonne se défait : chacun reprend sa progression (et ouvrira la porte en passant).
  dropStack(s) {
    for (const o of s.team) if (o.entry === s) { o.entry = null; o.path = []; o.repathT = 0; }
    this.hunt.stacks = this.hunt.stacks.filter(q => q !== s);
  }

  // Un opérateur libre arrivé auprès d'un otage repéré le prend en charge : un instant, arme basse.
  takeHostage(e) {
    if (e.act) return false;
    const h = this.hostages.find(o => o.alive && !o.evacuated && o.found && !o.escort && !o.exiting
      && dist(e.x, e.y, o.x, o.y) < 1.2 * U && this.map.hasLOS(e.x, e.y, o.x, o.y));
    if (!h) return false;
    e.path = []; e.moving = false;
    this.startAction(e, 'hostage', 1, () => {
      if (!h.alive || h.evacuated || h.escort || dist(e.x, e.y, h.x, h.y) > 2 * U) return;
      this.takeCharge(h, e);
      e.escorting = h;
      e.exit = this.nearestExit(e);
      this.say("L'intervention emmène un otage !", 2.5);
    });
    return true;
  }

  // Escorte de l'IA : vers la sortie la plus proche, en attendant l'otage s'il traîne et en retournant
  // le chercher s'il ne suit plus (une porte refermée entre eux : elle la rouvre en passant).
  escortToExit(e, dt) {
    const h = e.escorting;
    if (!e.exit) e.exit = this.nearestExit(e);
    const b = e.exit;
    if (!b) { e.moving = false; return; }
    if (b.door && !this.map.doorPassable(b.door) && !b.door.opening && dist(e.x, e.y, b.cx, b.cy) < 1.8 * U) {
      this.doorAction(e, b.door, 1); // la porte de sortie : il l'ouvre pour l'otage
      return;
    }
    const lag = dist(e.x, e.y, h.x, h.y);
    let goal = b.inside;
    if (lag > 3 * U || h.blockedT > 1) goal = h;
    else if (lag > 2 * U) {
      e.path = []; e.moving = false;
      turnToward(e, Math.atan2(h.y - e.y, h.x - e.x), e.turnRate, dt);
      return;
    }
    if (!e.path.length || e.repathT <= 0 || e.escortGoal !== goal) {
      e.path = this.pathTo(e, goal.x, goal.y);
      e.repathT = 0.6;
      e.escortGoal = goal;
    }
    this.moveAlong(e, dt);
  }

  // Flash avant d'entrer : un opérateur qui sait où était la menace, sans la voir, dégoupille
  // plutôt que de franchir la porte à l'aveugle. Le groupe armé (trinômes) en fait autant avec ses grenades à
  // fragmentation, de plus loin, et jamais là où se tiennent les siens.
  maybeFlash(e, dt) {
    e.flashCd -= dt;
    if (e.act) return true;          // geste en cours (l'armement du bras)
    const frag = e.nade === 'frag', keep = frag ? FRAG_RADIUS + 0.5 * U : 2 * U;
    // (le groupe armé lance aussi là où son trinôme a signalé quelqu'un)
    const aim0 = e.lastKnown || (frag && e.group && e.group.contact);
    if (e.flashbangs <= 0 || e.flashCd > 0 || !aim0) return false;
    const d = dist(e.x, e.y, aim0.x, aim0.y);
    if (d < (frag ? FRAG_RADIUS + U : 2.5 * U) || d > (frag ? 7 : 6) * U) return false;
    // Une grenade lancée contre une porte fermée ou un mur revient aux pieds du lanceur : on
    // attend d'avoir la voie libre (la porte ouverte), et on ne la lance pas sur ses équipiers.
    const allyNear = [...this.teamOf(e), ...(frag ? this.hostages : [])]
      .some(o => o !== e && o.alive && !o.evacuated && dist(o.x, o.y, aim0.x, aim0.y) < keep);
    if (allyNear || !this.clearThrow(e.x, e.y, aim0.x, aim0.y)) { e.flashCd = 0.5; return false; }
    e.flashbangs--;
    e.flashCd = 14;
    e.path = [];
    const aim = { x: aim0.x, y: aim0.y };
    this.startAction(e, 'grenade', 0.5, () => this.spawnFlash(e, aim.x, aim.y));
    return true;
  }

  // Trajectoire de lancer libre jusqu'au point visé : ni mur, ni porte non ouverte, ni meuble sur la
  // partie où la grenade roule (elle survole ceux qui se trouvent sous sa trajectoire en vol).
  clearThrow(x0, y0, x1, y1) {
    if (!this.map.hasLOS(x0, y0, x1, y1)) return false;
    const d = dist(x0, y0, x1, y1), n = Math.ceil(d / 6);
    // elle part de la main (14 px devant, voir spawnFlash) et fait en vol cette part du trajet
    const air = 14 + d * GRENADE_FLIGHT / (GRENADE_FLIGHT + 1 / GRENADE_FRICTION);
    for (let i = 2; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if (this.grenadeBlocked(x, y, d * i / n < air)) return false;
      const dd = this.map.door(Math.floor(x / TILE), Math.floor(y / TILE));
      if (dd && !dd.open) return false;
    }
    return true;
  }

  // Prochain secteur à nettoyer ; quand tout est passé, on recommence le tour (en guerre totale, dans l'autre sens :
  // on remonte son couloir).
  assaultGoal(e) {
    // priorité aux otages repérés que personne n'emmène encore : c'est leur mission
    let best = null, bd = Infinity;
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.escort || h.exiting || !h.found) continue;
      const d = dist(e.x, e.y, h.x, h.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) return { x: best.x, y: best.y };
    // chaque trinôme a ses secteurs, du plus proche de son entrée au plus lointain ; l'intervention du siège les partage
    const secs = (e.group && e.group.sectors) || (this.siege && this.siege.sectors) || [];
    let all = true;
    for (const g of secs) {
      if (g.done) continue;
      all = false;
      if (dist(e.x, e.y, g.x, g.y) < 1.4 * U) { g.done = true; continue; }
      return g;
    }
    if (all) {
      for (const g of secs) g.done = false;
      if (e.group && e.group.pingpong) secs.reverse();
    }
    return null;
  }

  updateEnemy(e, dt) {
    if (!e.alive) return;
    if (e.surrender) { this.updateSurrendered(e, dt); return; }
    e.noiseT -= dt;
    e.suspicion = Math.max(0, e.suspicion - SUSPICION_DECAY * dt);
    this.enemyCombat(e, dt);
    // il vous a vu : s'il tient ALARM_TIME (sonné, le temps ne compte pas), tout le bâtiment est prévenu
    if (e.spotT !== null && !this.alarm && this.alarms && e.stun <= 0 && (e.spotT += dt) >= ALARM_TIME) this.raiseAlarm(e);
    if (e.stun > 0) return;
    if (!e.target) { this.spotBody(e); this.spotLaser(e, dt); }
    if (e.target) {
      e.state = 'engage';
      e.lastKnown = { x: e.target.x, y: e.target.y };
      e.lostT = 0;
      e.repathT -= dt;
      if (e.engaged) { e.path = []; e.moving = false; }
      else {
        if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 1; }
        this.moveAlong(e, dt);
      }
      return;
    }
    e.engaged = false;
    // il arrose une porte sans bouger ; ensuite seulement il ira voir (état engage, puis investigate)
    if (e.blind) { e.lostT = 0; e.moving = false; return; }
    switch (e.state) {
      case 'engage':
        e.lostT += dt;
        if (e.lostT > 1.2) {
          e.state = 'investigate';
          e.searchT = 0;
          e.path = e.lastKnown ? this.pathTo(e, e.lastKnown.x, e.lastKnown.y) : [];
        }
        break;
      case 'investigate':
        if (e.path.length || e.waitDoor || e.holdT > 0) this.moveAlong(e, dt);
        else {
          e.searchT += dt;
          if (e.alertAngle === null) e.angle += dt * 1.6;
          // rien trouvé : il regagne son poste, sur ses gardes du côté d'où venait le bruit
          if (e.searchT > 3.5) {
            e.state = 'return';
            e.path = dist(e.x, e.y, e.home.x, e.home.y) > U ? this.pathTo(e, e.home.x, e.home.y) : [];
          }
        }
        break;
      case 'return':
        if (e.path.length || e.waitDoor || e.holdT > 0) this.moveAlong(e, dt);
        else { e.state = 'idle'; e.idleT = rand(1, 3); }
        break;
      default:
        if (e.patrol) { this.patrolStep(e, dt); break; }
        e.idleT -= dt;
        if (e.idleT <= 0) { e.idleT = rand(2, 6); e.lookAt = e.homeAngle + rand(-0.9, 0.9); }
        if (e.lookAt !== null && e.alertAngle === null && turnToward(e, e.lookAt, 2, dt)) e.lookAt = null;
    }
  }

  // Un suspect qui découvre le corps d'un des siens crie l'alerte et va voir, même si rien ne s'est entendu.
  spotBody(e) {
    for (const o of this.enemies) {
      if (o === e || o.alive || o.dying || o.noticed) continue;
      if (!this.canSee(e, o)) continue;
      o.noticed = true;
      e.suspicion = 2;
      e.shoutT = this.time;
      this.noise(e.x, e.y, 6 * U, e, 'voice');
      this.investigate(e, o.x, o.y, 1);
      return;
    }
  }

  // ---- Coéquipiers ----
  // En siège, les complices ne reçoivent pas d'ordres : chacun tient son poste et se bat seul.
  canCommand(quiet) {
    if (!this.siege) return true;
    if (!quiet) this.say("Pas d'ordres : chacun tient son poste", 1.4);
    return false;
  }

  // coverAngle : direction imposée à l'un des coéquipiers une fois sur place (null = au choix de l'IA).
  orderMove(wx, wy, coverAngle) {
    if (!this.canCommand(true)) return;
    // case la plus proche du clic où un corps tient sans toucher de mur
    let tx = -1, ty = -1, bd = Infinity;
    const ctx0 = Math.floor(wx / TILE), cty0 = Math.floor(wy / TILE);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = ctx0 + dx, y = cty0 + dy;
      if (!this.map.inBounds(x, y) || this.map.blocksMove(x, y)) continue;
      if (!this.map.circleFree((x + 0.5) * TILE, (y + 0.5) * TILE, 12, false)) continue;
      const d = dist((x + 0.5) * TILE, (y + 0.5) * TILE, wx, wy);
      if (d < bd) { bd = d; tx = x; ty = y; }
    }
    if (tx < 0) { this.say('Point inaccessible', 1); return; }
    wx = (tx + 0.5) * TILE; wy = (ty + 0.5) * TILE;
    const alive = this.crew;
    if (!alive.length) return;
    const p = this.player;
    const dir = Math.atan2(wy - p.y, wx - p.x);
    const spots = alive.map((m, i) => {
      // légère dispersion perpendiculaire pour ne pas s'empiler
      const side = (i - (alive.length - 1) / 2) * 0.8 * U;
      let x = wx - Math.sin(dir) * side, y = wy + Math.cos(dir) * side;
      if (!this.map.circleFree(x, y, m.radius, false)) { x = (tx + 0.5) * TILE; y = (ty + 0.5) * TILE; }
      return { x, y };
    });
    // Le coéquipier chargé de la direction est celui qui se place déjà de ce côté :
    // il n'a pas à traverser la ligne de l'autre.
    let cover = null;
    if (coverAngle !== null && coverAngle !== undefined) {
      let best = -Infinity;
      alive.forEach((m, i) => {
        const side = spots[i];
        const away = dist(side.x, side.y, wx, wy) < 1 ? dir : Math.atan2(side.y - wy, side.x - wx);
        const s = Math.cos(angleDiff(coverAngle, away));
        if (s > best) { best = s; cover = m; }
      });
    }
    alive.forEach((m, i) => {
      m.order = 'move'; m.orderPos = spots[i]; m.repathT = 0; m.destTile = null; m.watchSpot = null;
      m.coverAngle = m === cover ? coverAngle : null;
      m.holdAngle = m === cover ? coverAngle : dir;
    });
    this.orderMarker = { x: wx, y: wy, t: 0, angle: coverAngle === undefined ? null : coverAngle, mate: cover };
    this.stack = null;
    this.say(cover ? `${cover.name} : couvrez cette direction` : 'Équipe : allez-y', 1.4);
  }

  // ---- Entrée coordonnée ----
  // Porte dont l'embrasure contient le point (clic droit), à une demi-case près.
  doorAtPoint(x, y) {
    for (const d of this.map.doors) {
      const half = (d.len * TILE) / 2, along = Math.abs(d.horizontal ? x - d.cx : y - d.cy), across = Math.abs(d.horizontal ? y - d.cy : x - d.cx);
      if (along <= half + 4 && across <= TILE) return d;
    }
    return null;
  }

  // Case libre la plus proche de (x, y), du côté side de la porte (signe de la coordonnée perpendiculaire), d'où
  // l'on voit le pied du battant ; à minD au moins du milieu de la porte (hors de portée d'une charge, par exemple).
  stackSpot(d, side, x, y, r, taken, minD) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    const foot = { x: d.cx + (d.horizontal ? 0 : side * (TILE / 2 + 3)), y: d.cy + (d.horizontal ? side * (TILE / 2 + 3) : 0) };
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      if (Math.sign(d.horizontal ? py - d.cy : px - d.cx) !== side) continue;
      if (minD && dist(px, py, d.cx, d.cy) < minD) continue;
      if (!this.map.circleFree(px, py, r + 1, true) || !this.map.hasLOS(px, py, foot.x, foot.y)) continue;
      if (taken.some(o => dist(o.x, o.y, px, py) < 22)) continue;
      const dd = dist(px, py, x, y);
      if (dd < bd) { bd = dd; best = { x: px, y: py }; }
    }
    return best;
  }

  // Postes d'une colonne de n sur la porte d, du côté side : alternativement de part et d'autre du cadre, le long du
  // mur, les suivants derrière les premiers (rank) ; à minD au moins du milieu de la porte. k : côté du cadre.
  stackPosts(d, side, n, minD) {
    const half = (d.len * TILE) / 2, off = TILE / 2 + 14, taken = [], out = [];
    for (let i = 0; i < n; i++) {
      const k = i % 2 ? 1 : -1, rank = Math.floor(i / 2);
      let lat = half + 12 + rank * 24;
      if (minD > off) lat = Math.max(lat, Math.sqrt(minD * minD - off * off) + 2);
      const x = d.cx + (d.horizontal ? k * lat : side * off), y = d.cy + (d.horizontal ? side * off : k * lat);
      const sp = this.stackSpot(d, side, x, y, 11, taken, minD);
      if (sp) { taken.push(sp); out.push({ ...sp, k, rank }); }
    }
    return out;
  }

  // Clic droit sur une porte fermée : les coéquipiers se placent en colonne de part et d'autre de l'embrasure,
  // de votre côté, et attendent. Dès que la porte s'ouvre (vous l'ouvrez, la charge la souffle, la chevrotine
  // fait sauter la serrure), ils entrent chacun vers son angle de la pièce ; une flash en préparation ou en
  // vol, ils attendent qu'elle éclate.
  orderStack(d) {
    if (!this.canCommand(true)) return;
    const alive = this.crew;
    if (!alive.length) return;
    const p = this.player;
    const side = Math.sign(d.horizontal ? p.y - d.cy : p.x - d.cx) || 1;
    const spots = this.stackPosts(d, side, 2, 0);
    if (!spots.length) { this.say('Pas la place de se mettre en colonne ici', 1.4); return; }
    // chacun prend le côté le plus proche de lui (le second prend l'autre)
    const order = alive.length > 1 && spots.length > 1
      && dist(alive[0].x, alive[0].y, spots[1].x, spots[1].y) + dist(alive[1].x, alive[1].y, spots[0].x, spots[0].y)
       < dist(alive[0].x, alive[0].y, spots[0].x, spots[0].y) + dist(alive[1].x, alive[1].y, spots[1].x, spots[1].y)
      ? [spots[1], spots[0]] : spots;
    // le poste d'où une flash passe par l'entrebâillement (il dépend du sens du battant) revient à qui en a encore une
    const good = order.findIndex(sp => this.flashAimFrom(sp.x, sp.y, d, side) || this.flashAimFrom(sp.x, sp.y, d, side, 1));
    if (good >= 0 && !(alive[good] && alive[good].flashbangs > 0)) {
      const holder = alive.findIndex((m, i) => i < order.length && m.flashbangs > 0);
      if (holder >= 0) [order[good], order[holder]] = [order[holder], order[good]];
    }
    alive.forEach((m, i) => {
      const sp = order[i % order.length];
      const look = Math.atan2(d.cy - sp.y, d.cx - sp.x);
      Object.assign(m, { order: 'stack', orderPos: { x: sp.x, y: sp.y }, stackSide: sp.k, repathT: 0, destTile: null, watchSpot: null, coverAngle: look, holdAngle: look });
    });
    this.stack = { door: d, side, ready: false, wait: null };
    this.orderMarker = { x: d.cx + (d.horizontal ? 0 : side * 8), y: d.cy + (d.horizontal ? side * 8 : 0), t: 0, angle: null, mate: null };
    this.say('Équipe : en colonne sur la porte — ouvrez-la, ils entrent (clic droit à nouveau : entrée à la flash)', 2.2);
  }

  updateStack(dt) {
    const s = this.stack;
    if (!s) return;
    const team = this.mates.filter(m => m.alive && m.order === 'stack');
    if (!team.length) { this.stack = null; return; }
    const d = s.door;
    if (!s.ready && team.every(m => dist(m.x, m.y, m.orderPos.x, m.orderPos.y) < 8)) {
      s.ready = true;
      this.say('Équipe en position — à votre signal : ouvrez la porte', 2);
    }
    if (s.flash) { this.updateFlashEntry(s, team); return; }
    if (!d.broken && !this.map.doorPassable(d)) { s.wait = null; return; }
    if (s.wait === null) s.wait = d.broken ? 0.15 : ENTRY_DELAY;
    // une flash dégoupillée ou en vol, ou votre grenade à fragmentation (on n'entre pas dessus) : on attend qu'elle éclate
    const p = this.player;
    const nade = (p.act && p.act.type === 'grenade') || p.cooking || this.grenades.some(g => g.team === 'ops' && (g.kind === 'flash' || g.thrower === p));
    if (nade) { s.wait = Math.max(s.wait, 0.15); return; }
    s.wait -= dt;
    if (s.wait > 0) return;
    this.endStack(s, team);
  }

  // Second clic droit sur la porte de la colonne : entrée à la flash. Celui qui tient le poste d'où une flash passe
  // par l'entrebâillement entrouvre, la glisse dans la pièce et, l'éclair passé, ouvre en grand : l'équipe entre sur
  // des suspects aveuglés. S'il n'a plus de flash et que l'autre en a, ils échangent leurs places d'abord. Quand
  // aucun poste n'a d'angle par l'entrebâillement (battant ouvert contre un mur), on ouvre en grand avant de lancer ;
  // et si même ainsi aucun n'en a, celui qui a une flash va se placer là d'où elle passe (flashSpot).
  orderFlashEntry() {
    const s = this.stack;
    if (!this.canCommand(true) || !s || s.flash) return;
    const team = this.mates.filter(m => m.alive && m.order === 'stack');
    if (!team.some(o => o.flashbangs > 0)) { this.say("Plus de flash dans l'équipe — ouvrez la porte, ils entrent", 2); return; }
    const plan = this.planFlash(s, team);
    if (!plan) { this.say("Pas d'angle pour lancer une flash par cette porte — ouvrez-la, ils entrent", 2); return; }
    const { m, crack } = plan;
    s.flash = { m, crack, phase: 'place', g: null, tries: 0 };
    this.say(plan.moved ? `${m.name} : je me place pour la flash, puis on entre`
      : crack < 1 ? `${m.name} : flash dans la pièce, puis on entre` : `${m.name} : on ouvre, flash, puis on entre`, 1.8);
  }

  // Qui lance la flash d'une colonne, et à quel cran de la porte : celui qui tient le poste d'où une flash passe par
  // l'entrebâillement (s'il n'en a plus, il échange sa place avec un équipier qui en a) ; sans poste qui ait l'angle,
  // celui qui en a une va se placer là d'où elle passe (moved). null si personne n'a d'angle.
  planFlash(s, team) {
    const d = s.door;
    const crackOf = o => [FLASH_CRACK, 1].find(c => this.flashAimFrom(o.orderPos.x, o.orderPos.y, d, s.side, c)) || 0;
    const posts = team.map(o => ({ o, crack: crackOf(o) })).filter(q => q.crack).sort((a, b) => a.crack - b.crack);
    if (!posts.length) {
      const o = team.find(q => q.flashbangs > 0), sp = o && this.flashSpot(d, s.side, o, team);
      if (!sp) return null;
      const look = Math.atan2(d.cy - sp.y, d.cx - sp.x);
      Object.assign(o, { orderPos: { x: sp.x, y: sp.y }, path: [], destTile: null, repathT: 0, coverAngle: look, holdAngle: look });
      return { m: o, crack: sp.crack, moved: true };
    }
    const crack = posts[0].crack;
    let m = (posts.find(q => q.crack === crack && q.o.flashbangs > 0) || {}).o;
    if (!m) {
      const post = posts[0].o, other = team.find(o => o !== post && o.flashbangs > 0);
      if (!other) return null;
      for (const k of ['orderPos', 'stackSide', 'stackRank', 'coverAngle', 'holdAngle']) [post[k], other[k]] = [other[k], post[k]];
      for (const o of [post, other]) Object.assign(o, { path: [], destTile: null, repathT: 0 });
      m = other;
    }
    return { m, crack, moved: false };
  }

  // Les temps de l'entrée à la flash : en place → porte entrouverte (crochetée d'abord si elle est verrouillée)
  // → flash glissée par l'entrebâillement → éclair → porte ouverte en grand → entrée. Si le lanceur tombe ou que
  // la porte s'ouvre autrement, on retombe sur l'entrée ordinaire. Sert aussi aux colonnes de l'intervention (s.ai),
  // qui ne disent rien.
  updateFlashEntry(s, team) {
    const f = s.flash, m = f.m, d = s.door, eps = 0.01;
    const say = (t, k) => { if (!s.ai) this.say(t, k); };
    if (!m.alive || !(s.ai ? m.entry === s : m.order === 'stack')) { s.flash = null; return; }
    if (f.phase !== 'open' && f.crack < 1 && (d.broken || d.progress >= 1 - eps)) { s.flash = null; return; }
    if (team.some(o => o.act) || m.stun > 0 || d.opening) return;
    // la porte, c'est le plus proche qui la manœuvre (le lanceur s'est parfois placé en retrait)
    const opener = team.filter(o => o.stun <= 0 && dist(o.x, o.y, d.cx, d.cy) < 2 * U)
      .sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
    const work = target => {
      if (!opener) return false;
      if (++f.tries > 4) { s.flash = null; say("La porte résiste — ouvrez-la, ils entrent", 2); return false; }
      return this.doorAction(opener, d, target);
    };
    switch (f.phase) {
      case 'place':
        if (dist(m.x, m.y, m.orderPos.x, m.orderPos.y) > 8) return;
        if (d.progress < f.crack - eps) { if (work(f.crack)) f.phase = 'crack'; return; }
        f.phase = 'throw';
        return;
      case 'crack':
        // crochetage puis ouverture : tant que la porte n'est pas au cran voulu, on recommence
        f.phase = d.progress < f.crack - eps ? 'place' : 'throw';
        return;
      case 'throw': {
        let aim = this.flashAimFrom(m.x, m.y, d, s.side, f.crack);
        // quelques pixels à côté du poste (bousculé en arrivant) : il s'y recale, l'angle a été pris de là
        if (!aim && this.map.circleFree(m.orderPos.x, m.orderPos.y, m.radius - 1, true)) {
          m.x = m.orderPos.x; m.y = m.orderPos.y;
          aim = this.flashAimFrom(m.x, m.y, d, s.side, f.crack);
        }
        if (!aim) { s.flash = null; say(`${m.name} : pas d'angle pour la flash — ouvrez, on entre`, 2); return; }
        m.flashbangs--;
        m.coverAngle = m.holdAngle = m.angle = Math.atan2(aim.y - m.y, aim.x - m.x);
        Sound.tick(0.12); // goupille
        this.startAction(m, 'grenade', 0.45, () => {
          if (!m.alive) return;
          this.spawnFlash(m, aim.x, aim.y, MATE_COOK, d);
          f.g = this.grenades[this.grenades.length - 1];
        });
        f.phase = 'boom';
        say(`${m.name} : flash !`, 1.2);
        return;
      }
      case 'boom':
        if (f.g && this.grenades.includes(f.g)) return;
        f.phase = 'open';
        f.tries = 0;
        if (d.progress < 1 - eps) work(1);
        return;
      case 'open':
        // (personne près de la porte pour finir de l'ouvrir : entrouverte, elle laisse passer, on entre ainsi)
        if (d.broken || d.progress >= 1 - eps || !opener) { this.endStack(s, team); return; }
        work(1);
    }
  }

  // Faute de poste qui convienne : une case de votre côté de la porte, libre (personne d'autre dessus, hors de la
  // course du battant), d'où une flash passe ; la plus proche de m, en préférant la porte seulement entrouverte.
  flashSpot(d, side, m, team) {
    // (une colonne de l'intervention ne tient compte que des siens : le joueur est en face)
    const cx = Math.floor(d.cx / TILE), cy = Math.floor(d.cy / TILE), others = (m.entry ? team : [this.player, ...team]).filter(o => o !== m);
    let best = null, bs = Infinity;
    for (const crack of [FLASH_CRACK, 1]) {
      const leaf = this.map.leafSeg({ ...d, progress: Math.max(d.progress, crack) });
      const lx = leaf.x1 - leaf.x0, ly = leaf.y1 - leaf.y0, ll = lx * lx + ly * ly;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const tx = cx + dx, ty = cy + dy, x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const across = (d.horizontal ? y - d.cy : x - d.cx) * side;
        if (across < 0.6 * U || across > 3 * U || !this.map.inBounds(tx, ty) || this.map.door(tx, ty)) continue;
        if (!this.map.circleFree(x, y, 12, true) || others.some(o => o.alive && dist(o.x, o.y, x, y) < 24)) continue;
        const t = clamp(((x - leaf.x0) * lx + (y - leaf.y0) * ly) / ll, 0, 1);
        if (dist(x, y, leaf.x0 + lx * t, leaf.y0 + ly * t) < 15) continue;
        const sc = dist(m.x, m.y, x, y);
        if (sc < bs && this.flashAimFrom(x, y, d, side, crack)) { bs = sc; best = { x, y, crack }; }
      }
      if (best) return best;
    }
    return null;
  }

  // Point de chute d'une flash lancée de (x0, y0), du côté side de la porte, celle-ci ouverte au cran crack : dans la
  // pièce, à deux ou trois cases, sur une trajectoire qui franchit l'embrasure sans frôler le chambranle, ne touche le
  // battant ni avant ni après, et qu'aucun mur ni meuble n'arrête ; null s'il n'y en a pas. Le battant s'ouvrant
  // toujours du même côté, ce n'est pas le même poste qui convient selon qu'il part vers la pièce (on lance alors du
  // côté des gonds, en biais vers le bord libre) ou vers l'équipe (on lance du bord libre).
  flashAimFrom(x0, y0, d, side, crack = FLASH_CRACK) {
    const inX = d.horizontal ? 0 : -side, inY = d.horizontal ? -side : 0, ax = d.horizontal ? 1 : 0, ay = d.horizontal ? 0 : 1;
    const half = (d.len * TILE) / 2;
    const leaf = this.map.leafSeg({ ...d, progress: Math.max(d.progress, crack) });
    const lx = leaf.x1 - leaf.x0, ly = leaf.y1 - leaf.y0, ll = lx * lx + ly * ly;
    const nearLeaf = (x, y) => {
      const t = clamp(((x - leaf.x0) * lx + (y - leaf.y0) * ly) / ll, 0, 1);
      return dist(x, y, leaf.x0 + lx * t, leaf.y0 + ly * t) < 9;
    };
    const depthOf = (x, y) => (x - d.cx) * inX + (y - d.cy) * inY; // > 0 dans la pièce
    // en vol, près de la porte : ni mur ni fenêtre sous la grenade (l'embrasure de cette porte compte ouverte)
    const solid = (x, y) => this.map.door(Math.floor(x / TILE), Math.floor(y / TILE)) !== d && this.grenadeBlocked(x, y, true);
    const snag = (x, y) => solid(x - 5, y - 5) || solid(x + 5, y - 5) || solid(x - 5, y + 5) || solid(x + 5, y + 5);
    const d0 = depthOf(x0, y0);
    if (d0 >= 0) return null;
    for (const depth of [3, 2.5, 3.5, 2, 4, 1.5, 5]) for (const lat of [0, -1, 1, -2, 2, -0.5, 0.5, -3, 3]) {
      const x = d.cx + inX * depth * U + ax * lat * U, y = d.cy + inY * depth * U + ay * lat * U;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty)) continue;
      const ang = Math.atan2(y - y0, x - x0);
      if (!this.aimCrossesDoor(x0, y0, ang, d)) continue;
      // passage de l'embrasure, à distance du chambranle
      const k = -d0 / (depthOf(x, y) - d0), along = d.horizontal ? x0 + (x - x0) * k - d.cx : y0 + (y - y0) * k - d.cy;
      if (Math.abs(along) > half - 8) continue;
      const sx = x0 + Math.cos(ang) * 14, sy = y0 + Math.sin(ang) * 14; // elle part de la main (voir spawnFlash)
      const len = dist(sx, sy, x, y), n = Math.ceil(len / 3);
      let ok = true, inside = null;
      for (let i = 0; i <= n && ok; i++) {
        const px = sx + (x - sx) * i / n, py = sy + (y - sy) * i / n, dp = depthOf(px, py);
        if (nearLeaf(px, py) || (dp < 12 && snag(px, py))) ok = false;
        else if (!inside && dp >= 12) inside = { x: px, y: py };
      }
      if (ok && inside && this.clearThrow(inside.x, inside.y, x, y)) return { x, y };
    }
    return null;
  }

  // Points d'arrivée d'une entrée : chacun vers l'angle de la pièce de son côté de l'embrasure (les suivants d'une
  // colonne plus longue, plus loin vers le milieu), tourné vers le fond.
  entrySpots(d, side, team) {
    const inX = d.horizontal ? 0 : -side, inY = d.horizontal ? -side : 0; // vers l'intérieur de la pièce
    const ax = d.horizontal ? 1 : 0, ay = d.horizontal ? 0 : 1;
    const taken = [];
    return team.map(m => {
      const rank = m.stackRank || 0, k = (m.stackSide || 1) * (rank ? 0.4 : 1), depth = 1.6 + rank * 0.8;
      const x = d.cx + inX * depth * U + ax * k * 1.5 * U, y = d.cy + inY * depth * U + ay * k * 1.5 * U;
      const sp = this.stackSpot(d, -side, x, y, m.radius, taken) || { x: d.cx + inX * 1.2 * U, y: d.cy + inY * 1.2 * U };
      taken.push(sp);
      const fx = d.cx + inX * 4 * U - ax * k * U, fy = d.cy + inY * 4 * U - ay * k * U;
      return { m, x: sp.x, y: sp.y, look: Math.atan2(fy - sp.y, fx - sp.x) };
    });
  }

  // Chacun franchit l'embrasure et file vers l'angle de la pièce de son côté, en surveillant le fond.
  launchEntry(d, side, team) {
    for (const sp of this.entrySpots(d, side, team)) {
      Object.assign(sp.m, { order: 'move', orderPos: { x: sp.x, y: sp.y }, repathT: 0, destTile: null, watchSpot: null, coverAngle: sp.look, holdAngle: sp.look, path: [] });
    }
    this.orderMarker = null;
    this.say('Entrée !', 1.2);
  }

  // Fin d'une colonne : l'équipe du joueur entre sur ordre de déplacement (launchEntry) ; l'intervention rejoint ses
  // angles et les tient un instant avant de reprendre sa progression (clearStep).
  endStack(s, team) {
    if (!s.ai) { this.stack = null; this.launchEntry(s.door, s.side, team); return; }
    for (const sp of this.entrySpots(s.door, s.side, team)) {
      Object.assign(sp.m, { entry: null, path: [], repathT: 0, clear: { x: sp.x, y: sp.y, look: sp.look, t: AI_CLEAR, left: AI_CLEAR + 4 } });
    }
    this.dropStack(s);
  }

  orderFollow() {
    if (!this.canCommand(true)) return;
    const alive = this.crew;
    if (!alive.length) return;
    for (const m of alive) { m.order = 'follow'; m.holdAngle = null; m.coverAngle = null; m.watchSpot = null; m.path = []; m.destTile = null; m.repathT = 0; }
    this.orderMarker = null;
    this.stack = null;
    this.say('Équipe : suivez-moi', 1.2);
  }

  toggleHold() {
    if (!this.canCommand(true)) return;
    const alive = this.crew;
    if (!alive.length) return;
    const hold = !alive.every(m => m.order === 'hold');
    for (const m of alive) {
      m.order = hold ? 'hold' : 'follow';
      m.holdAngle = hold ? m.angle : null;
      m.coverAngle = null;
      m.watchSpot = null;
      m.path = []; m.destTile = null; m.repathT = 0;
    }
    this.orderMarker = null;
    this.stack = null;
    this.say(hold ? 'Équipe : tenez la position' : 'Équipe : suivez-moi', 1.2);
  }

  // Un point est dans l'axe de tir du joueur (cône étroit devant lui).
  inAimCone(x, y, halfAngle) {
    const p = this.player;
    const d = dist(p.x, p.y, x, y);
    if (d < 6 || d > 7 * U) return false;
    return Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < (halfAngle || 20 * DEG);
  }

  // Place du coéquipier en formation derrière le joueur, hors de son axe de tir,
  // sinon la case libre la plus proche visible du joueur.
  formationPos(m) {
    const p = this.player, a = p.moveDir;
    const [fx, fy] = m.slotOffset;
    const wx = p.x + (Math.cos(a) * fx - Math.sin(a) * fy) * U, wy = p.y + (Math.sin(a) * fx + Math.cos(a) * fy) * U;
    const bad = m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - Math.floor(wx / TILE)) <= 1 && Math.abs(m.badDest.y - Math.floor(wy / TILE)) <= 1;
    if (!bad && this.map.circleFree(wx, wy, m.radius + 1, true) && this.map.hasLOS(p.x, p.y, wx, wy) && !this.inAimCone(wx, wy, 30 * DEG)) return { x: wx, y: wy };
    let best = null, bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = p.tx + dx, ty = p.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const dd = this.map.door(tx, ty);
      if (dd && !dd.open) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (dist(cx, cy, p.x, p.y) < U * 0.9) continue;
      if (!this.map.hasLOS(p.x, p.y, cx, cy)) continue;
      let score = dist(cx, cy, wx, wy);
      if (this.inAimCone(cx, cy, 35 * DEG)) score += 6 * U;
      if (m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - tx) <= 1 && Math.abs(m.badDest.y - ty) <= 1) score += 10 * U;
      if (this.mates.some(o => o !== m && o.alive && o.destTile && o.destTile.x === tx && o.destTile.y === ty)) score += 2 * U;
      if (score < bd) { bd = score; best = { x: cx, y: cy }; }
    }
    return best || { x: p.x, y: p.y };
  }

  // Case libre proche, hors de l'axe de tir du joueur (pas de côté quand on tient la position).
  sidestepPos(m) {
    const p = this.player;
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = m.tx + dx, ty = m.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (this.inAimCone(cx, cy, 35 * DEG) || dist(cx, cy, p.x, p.y) < U) continue;
      const d = dist(cx, cy, m.x, m.y);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
    return best;
  }

  // Nombre de tuiles inexplorées le long d'un rayon (jusqu'au premier obstacle visuel).
  unexploredAlong(x, y, angle, maxDist) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    let count = 0, last = -1;
    for (let d = TILE / 2; d <= maxDist; d += TILE / 2) {
      const tx = Math.floor((x + cs * d) / TILE), ty = Math.floor((y + sn * d) / TILE);
      const k = ty * this.map.w + tx;
      if (k === last) continue;
      last = k;
      if (this.map.blocksSight(tx, ty)) break;
      if (!this.map.explored[k]) count++;
    }
    return count;
  }

  // Un allié (joueur ou autre coéquipier) se trouve sur la ligne de visée de (x,y) vers (tx,ty).
  friendOnLine(m, x, y, tx, ty, margin) {
    margin = margin === undefined ? 7 : margin;
    const d = dist(x, y, tx, ty);
    if (d < 1) return false;
    const cs = (tx - x) / d, sn = (ty - y) / d;
    for (const f of this.ops) {
      if (f === m || !f.alive) continue;
      // un coéquipier en route vers une autre case est jugé sur sa destination
      let fx = f.x, fy = f.y;
      if (f !== this.player && f.watchSpot) { fx = f.watchSpot.x; fy = f.watchSpot.y; }
      const rx = fx - x, ry = fy - y;
      const t = rx * cs + ry * sn;
      if (t < 4 || t > d) continue;
      if (Math.abs(rx * sn - ry * cs) < f.radius + margin) return true;
    }
    return false;
  }

  // Points d'intérêt vus depuis (x,y) : portes et zones inexplorées, avec un point cible.
  watchCandidates(x, y) {
    const cands = [];
    for (const d of this.map.doors) {
      const cx = d.cx, cy = d.cy;
      const dd = dist(x, y, cx, cy);
      if (dd < U || dd > 9 * U) continue;
      // Une porte fermée bloque la vue dans sa propre case : il suffit que le rayon atteigne cette case.
      const ang = Math.atan2(cy - y, cx - x);
      const r = this.map.castRay(x, y, ang, dd, false);
      if (r.hit && this.map.door(r.tx, r.ty) !== d) continue;
      cands.push({ angle: ang, score: 2.8 - dd / (9 * U) + (d.open ? 0.4 : 0), kind: 'door', tx: cx, ty: cy, door: d });
    }
    for (let k = 0; k < 24; k++) {
      const a = TAU * k / 24;
      const n = this.unexploredAlong(x, y, a, 10 * U);
      if (n < 4) continue;
      const r = this.map.castRay(x, y, a, 10 * U, false);
      cands.push({ angle: a, score: Math.min(2.4, 0.175 * n), kind: 'unknown', tx: r.x, ty: r.y });
    }
    return cands;
  }

  // Direction à surveiller au repos : portes visibles, zones inexplorées, sinon son secteur.
  // Chaque coéquipier évite la direction déjà couverte par un autre et toute ligne masquée par un allié :
  // soit il change de point d'intérêt, soit (si le point masqué vaut nettement mieux) il se décale.
  pickWatch(m) {
    // Direction imposée par le joueur : elle prime sur le choix automatique du point d'intérêt.
    if (m.coverAngle !== null) { m.watchKind = 'consigne'; return m.coverAngle; }
    const base = m.order === 'follow' ? this.player.moveDir + m.sector : (m.holdAngle === null ? m.angle : m.holdAngle);
    const cands = this.watchCandidates(m.x, m.y);
    cands.push({ angle: base, score: 0.6, kind: 'sector', tx: m.x + Math.cos(base) * 5 * U, ty: m.y + Math.sin(base) * 5 * U });
    const others = this.mates.filter(o => o !== m && o.alive && o.watchAngle !== undefined && o.watchAngle !== null);
    const scoreOf = c => {
      let s = c.score;
      // ne regarde pas le joueur ni ce que le joueur couvre déjà
      if (Math.abs(angleDiff(this.player.angle, c.angle)) < 25 * DEG) s -= 1.5;
      if (Math.abs(angleDiff(base, c.angle)) < 60 * DEG) s += 0.4;
      for (const o of others) if (Math.abs(angleDiff(o.watchAngle, c.angle)) < 35 * DEG) s -= 2;
      if (m.watchAngle !== null && m.watchAngle !== undefined && Math.abs(angleDiff(m.watchAngle, c.angle)) < 15 * DEG) s += 0.3; // stabilité
      return s;
    };
    let bestFree = null, bf = -Infinity, bestBlocked = null, bb = -Infinity;
    for (const c of cands) {
      const s = scoreOf(c);
      if (this.friendOnLine(m, m.x, m.y, c.tx, c.ty)) { if (s > bb) { bb = s; bestBlocked = c; } }
      else if (s > bf) { bf = s; bestFree = c; }
    }
    // Point masqué nettement plus intéressant : chercher une case proche d'où la ligne est dégagée.
    m.relocT = (m.relocT || 0);
    if (bestBlocked && bestBlocked.kind !== 'sector' && bb > bf + 0.8 && m.relocT <= this.time) {
      m.relocT = this.time + 2;
      const spot = this.findWatchSpot(m, bestBlocked);
      if (spot && dist(spot.x, spot.y, m.x, m.y) < 10) {
        // déjà sur cette case et toujours masqué : case écartée pour un moment
        m.badSpots = (m.badSpots || []).filter(b => b.until > this.time);
        m.badSpots.push({ x: spot.x, y: spot.y, until: this.time + 8 });
        m.watchSpot = null;
      } else if (spot) {
        m.watchSpot = spot;
        m.watchKind = bestBlocked.kind + ' (déplacement)';
        return Math.atan2(bestBlocked.ty - spot.y, bestBlocked.tx - spot.x);
      }
    }
    const best = bestFree || { angle: base, kind: 'sector' };
    m.watchKind = best.kind;
    return best.angle;
  }

  // Case libre proche de la position de référence, d'où le point visé est visible sans allié dans l'axe.
  findWatchSpot(m, c) {
    const ref = m.order === 'follow' ? this.formationPos(m) : { x: m.x, y: m.y };
    const rtx = Math.floor(ref.x / TILE), rty = Math.floor(ref.y / TILE);
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = rtx + dx, ty = rty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (dist(x, y, this.player.x, this.player.y) < U) continue;
      if (this.inAimCone(x, y, 35 * DEG)) continue;
      if (this.mates.some(o => o !== m && o.alive && dist(x, y, o.watchSpot ? o.watchSpot.x : o.x, o.watchSpot ? o.watchSpot.y : o.y) < U)) continue;
      if ((m.badSpots || []).some(b => b.until > this.time && dist(b.x, b.y, x, y) < 4)) continue;
      // le point doit rester visible depuis la case
      const d = dist(x, y, c.tx, c.ty);
      const r = this.map.castRay(x, y, Math.atan2(c.ty - y, c.tx - x), d, false);
      if (c.door) { if (r.hit && this.map.door(r.tx, r.ty) !== c.door) continue; }
      else if (r.dist < d - U) continue;
      if (this.friendOnLine(m, x, y, c.tx, c.ty, 14)) continue; // marge large : la position finale peut varier
      if (m.order === 'follow' && !this.map.hasLOS(this.player.x, this.player.y, x, y)) continue;
      const score = dist(x, y, m.x, m.y) + dist(x, y, ref.x, ref.y) * 0.5;
      if (score < bd) { bd = score; best = { x, y }; }
    }
    return best;
  }

  // Aucun allié ni otage sur la ligne de tir (alliés : l'équipe du tireur, quel que soit son camp).
  // x, y : position de tir supposée (par défaut celle du tireur).
  // extra : marge supplémentaire, pour choisir un point de tir qui restera valable une fois sur place.
  lineOfFireClear(shooter, target, x, y, extra) {
    if (x === undefined) { x = shooter.x; y = shooter.y; }
    const d = dist(x, y, target.x, target.y);
    const cs = (target.x - x) / d, sn = (target.y - y) / d;
    const friends = shooter.team === 'ops' ? this.ops : this.enemies;
    // Les tireurs entraînés (équipe et intervention) tiennent compte de la dispersion de leur rafale
    // et des otages juste derrière la cible : une balle qui la manque continue sa course.
    const trained = shooter instanceof Operator || shooter instanceof Teammate || !!shooter.hunter;
    // seule l'intervention se refuse aussi un otage derrière la cible : c'est sa mission
    const strict = shooter instanceof Operator;
    // L'intervention garde toute la marge de sa gerbe ; l'équipe s'en tient à la moitié, sans quoi
    // elle ne tire plus jamais dans une pièce encombrée.
    const cone = trained ? Math.tan(this.spreadOf(shooter, d) * (strict ? 1 : 0.5) + (strict ? 2 : 1) * DEG) : 0;
    for (const f of [...friends, ...this.hostages]) {
      if (f === shooter || f === target || !f.alive || f.evacuated) continue;
      const rx = f.x - x, ry = f.y - y;
      const t = rx * cs + ry * sn;
      const behind = strict && f.team === 'civ' ? 2.5 * U : 0;
      if (t < 0 || t > d + behind) continue;
      if (Math.abs(rx * sn - ry * cs) < f.radius + 6 + cone * t + (extra || 0)) return false;
    }
    return true;
  }

  // Case proche d'où la cible est visible sans allié ni otage dans l'axe (recalculée par à-coups).
  firingSpot(m, t) {
    if (m.fireSpotT > this.time && m.fireSpot) return m.fireSpot;
    m.fireSpotT = this.time + 0.5;
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = m.tx + dx, ty = m.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!this.map.circleFree(x, y, m.radius + 1, true)) continue;
      // un coéquipier ne se place ni sur le joueur ni dans son axe de visée
      if (m.team === 'ops' && dist(x, y, this.player.x, this.player.y) < 0.8 * U) continue;
      if (m.team === 'ops' && this.inAimCone(x, y, 30 * DEG)) continue;
      if (dist(x, y, t.x, t.y) > this.fireRange(m)) continue;
      if (!this.map.hasLOS(x, y, t.x, t.y)) continue;
      if (!this.lineOfFireClear(m, t, x, y, 12)) continue; // de quoi rester dégagé une fois arrivé
      const score = dist(x, y, m.x, m.y);
      if (score < bd) { bd = score; best = { x, y }; }
    }
    m.fireSpot = best;
    return best;
  }

  mateCombat(m, dt) {
    let t = m.target;
    if (t && (!t.alive || t.surrender || dist(m.x, m.y, t.x, t.y) > this.viewOf(m, Math.atan2(t.y - m.y, t.x - m.x)) || !this.map.hasLOS(m.x, m.y, t.x, t.y))) t = null;
    if (!t) { t = this.acquireFor(m, this.enemies); if (t) m.reactT = m.reaction; }
    m.target = t;
    if (!t) {
      m.engaged = false;
      m.blockedT = 0; m.blockedLine = false; m.fireSpot = null;
      if (m.alertAngle !== null && turnToward(m, m.alertAngle, m.turnRate, dt)) m.alertAngle = null;
      return;
    }
    m.alertAngle = null;
    const a = Math.atan2(t.y - m.y, t.x - m.x);
    const d = dist(m.x, m.y, t.x, t.y);
    m.aimDist = d;
    m.engaged = d <= this.fireRange(m);
    // Discipline de tir : un allié ou un otage dans l'axe interdit le tir. Si ça dure, le coéquipier
    // ne doit pas rester planté : il redevient mobile (ordres, repli de côté) tout en gardant sa cible.
    const clear = this.lineOfFireClear(m, t);
    m.blockedT = clear ? 0 : m.blockedT + dt;
    m.blockedLine = m.blockedT > 0.35;
    turnToward(m, a, m.turnRate, dt);
    m.reactT -= dt;
    if (m.engaged && m.reactT <= 0 && m.pauseT <= 0 && m.fireT <= 0 && m.reloadT <= 0 && !m.act && Math.abs(angleDiff(m.angle, a)) < 0.15) {
      if (m.slot.mag <= 0) { this.mateReload(m); return; }
      if (!clear) return;
      this.fireWeapon(m);
      // rafales courtes, paires en semi-automatique, coup par coup à la pompe (selon l'arme, voir BURST_PAUSE)
      if (--m.burstLeft <= 0) this.endBurst(m, m.weapon);
    }
  }

  updateMate(m, dt) {
    if (!m.alive) return;
    // Détection de blocage (repoussé par un allié, coincé contre un angle) : nouveau trajet,
    // puis, si ça persiste, abandon temporaire de cette case.
    if (m.lastStep && m.moving) {
      if (dist(m.x, m.y, m.lastStep.x, m.lastStep.y) < 0.4) m.stuckT = (m.stuckT || 0) + dt;
      else { m.stuckT = 0; }
    }
    if ((m.stuckT || 0) > 0.6) {
      m.stuckT = 0;
      m.stuckCount = (m.stuckCount || 0) + 1;
      m.repathT = 0; m.path = [];
      if (m.destTile && m.stuckCount >= 2) {
        m.badDest = { x: m.destTile.x, y: m.destTile.y, until: this.time + 4 };
        m.watchSpot = null;
        m.stuckCount = 0;
      }
    }
    if (m.stuckCount && !m.moving) m.stuckCount = 0;
    m.fireT -= dt; m.pauseT -= dt; m.repathT -= dt;
    m.bloom = Math.max(0, m.bloom - dt * 7 * DEG);
    if (m.reloadT > 0) { m.reloadT -= dt; if (m.reloadT <= 0) m.slot.mag = m.weapon.mag; }
    if (m.stun > 0) { m.stun -= dt; m.target = null; m.moving = false; return; }
    this.mateCombat(m, dt);
    // recharge tranquille quand rien en vue
    if (!m.target && m.reloadT <= 0 && !m.act && m.slot.mag <= m.weapon.mag * 0.35) this.mateReload(m);

    let dest = null;
    if (m.watchSpot) {
      // position d'observation : abandonnée si le joueur s'éloigne ou vise dessus, ou pendant un ordre de déplacement
      const invalid = m.order === 'move' || m.order === 'stack' || m.target
        || (m.order === 'follow' && (this.player.moving || dist(m.watchSpot.x, m.watchSpot.y, this.player.x, this.player.y) > 3.5 * U))
        || this.inAimCone(m.watchSpot.x, m.watchSpot.y, 25 * DEG);
      if (invalid) m.watchSpot = null;
    }
    if (m.order === 'move' || m.order === 'stack') dest = m.orderPos;
    else if (m.blockedLine && m.target) dest = this.firingSpot(m, m.target);
    else if (m.watchSpot) dest = m.watchSpot;
    else if (m.order === 'follow') dest = this.formationPos(m);
    else if (m.order === 'hold' && this.inAimCone(m.x, m.y, 18 * DEG)) {
      // en position mais dans l'axe de tir du joueur : pas à pas de côté
      m.aimT = (m.aimT || 0) + dt;
      if (m.aimT > 0.4) dest = this.sidestepPos(m);
    } else m.aimT = 0;
    if (m.order === 'follow') {
      // déjà en place mais le joueur vise à travers lui : on laisse formationPos choisir une autre case
      m.aimT = this.inAimCone(m.x, m.y, 18 * DEG) ? (m.aimT || 0) + dt : 0;
    }
    // Au contact on s'arrête pour tirer, sauf sous un ordre de déplacement (il reste prioritaire)
    // et sauf si l'axe est bouché (il faut alors se décaler).
    if (m.engaged && !m.blockedLine && m.order !== 'move') { m.path = []; m.moving = false; }
    else if (dest) {
      const d = dist(m.x, m.y, dest.x, dest.y);
      const arrive = m.order === 'move' || m.order === 'stack' || dest === m.watchSpot || dest === m.fireSpot ? 4 : 12;
      if (d > arrive) {
        const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
        const changed = !m.destTile || m.destTile.x !== tile.x || m.destTile.y !== tile.y;
        if (changed || m.repathT <= 0 || !m.path.length) {
          const avoid = this.ops.filter(o => o !== m && o.alive).map(o => ({ x: o.x, y: o.y, r: (m.stuckCount ? 30 : 22) }));
          // en suivi ou en colonne, on n'ouvre pas de porte (la colonne attend justement devant la sienne)
          const path = this.map.routeTo(m.x, m.y, tile.x, tile.y, m.radius, { noClosedDoors: m.order === 'follow' || m.order === 'stack', avoid });
          m.path = path || [];
          if (m.path.length) m.path[m.path.length - 1] = { x: dest.x, y: dest.y };
          m.destTile = tile;
          m.repathT = 0.4;
        }
        m.speed = d > 3 * U ? 118 : 78;
        m.walkMode = d <= 3 * U;
        const bx = m.x, by = m.y;
        this.moveAlong(m, dt);
        m.lastStep = { x: bx, y: by };
      } else {
        m.path = []; m.moving = false;
        if (m.order === 'move') { m.order = 'hold'; this.orderMarker = null; }
      }
    } else { m.moving = false; }

    // posture au repos : surveille un point d'intérêt et fait des balayages de contrôle
    if (!m.target && !m.moving && m.alertAngle === null) {
      m.watchT = (m.watchT || 0) - dt;
      if (m.watchT <= 0) { m.watchT = rand(0.8, 1.3); m.watchAngle = this.pickWatch(m); }
      m.sweepT = (m.sweepT === undefined ? rand(2.5, 4.5) : m.sweepT) - dt;
      // pas de balayage quand la direction est imposée par le joueur
      if (m.sweepT <= 0 && !m.sweep && m.coverAngle === null) { m.sweep = { t: 0, dur: rand(1.4, 2), amp: rand(0.5, 0.85) * (Math.random() < 0.5 ? -1 : 1) }; m.sweepT = rand(3.5, 6.5); }
      let want = m.watchAngle === undefined || m.watchAngle === null ? m.angle : m.watchAngle;
      if (m.sweep) {
        m.sweep.t += dt;
        const off = Math.sin(m.sweep.t / m.sweep.dur * Math.PI) * m.sweep.amp;
        const sa = want + off;
        // le balayage ne passe pas sur un allié : il s'arrête avant
        if (this.friendOnLine(m, m.x, m.y, m.x + Math.cos(sa) * 6 * U, m.y + Math.sin(sa) * 6 * U)) m.sweep.t = Math.max(m.sweep.t, m.sweep.dur - m.sweep.t);
        else want = sa;
        if (m.sweep.t >= m.sweep.dur) m.sweep = null;
      }
      turnToward(m, want, 3.5, dt);
    } else if (m.moving) { m.watchT = 0; m.sweep = null; }
  }

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
