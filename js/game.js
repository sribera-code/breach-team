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
// Une balle part à sa vitesse réelle (des centaines de mètres par seconde : une image suffit à traverser une pièce) et
// vole jusqu'au premier obstacle, BULLET_REACH au plus (la plus grande carte fait 66 m). Ce qu'elle parcourt pendant une
// image reste tracé TRACER_LIFE s (voir Renderer.drawBullets).
const BULLET_REACH = 80 * U, TRACER_LIFE = 0.08;
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
// Trinômes : un contact signalé par un équipier reste une destination SQUAD_CONTACT s.
const SQUAD_CONTACT = 20;
// Trinômes autonomes : un chef de file mène, les deux autres le suivent en file décalée comme vos coéquipiers vous
// suivent (SQUAD_FILE : leurs places en cases, vers l'avant et vers la droite de sa marche). Hors combat, le chef avance
// à SQUAD_PACE de sa vitesse, sans bruit de pas, marque SQUAD_DOOR_PAUSE s avant de franchir une porte et attend celui
// des siens resté à plus de SQUAD_SPREAD (SQUAD_WAIT s au plus : un équipier coincé ne fige pas le trinôme). Un équipier
// distancé de plus de SQUAD_CATCH de sa place court la reprendre. L'adversaire en vue, ceux qui ne le voient pas viennent
// à hauteur du chef (SQUAD_LINE, dans le repère de la direction de l'adversaire).
const SQUAD_FILE = [[-1.3, -0.6], [-2.4, 0.5]], SQUAD_LINE = [[-0.4, -1.1], [-0.4, 1.1]];
const SQUAD_PACE = 0.7, SQUAD_DOOR_PAUSE = 0.6, SQUAD_SPREAD = 4 * U, SQUAD_WAIT = 4, SQUAD_CATCH = 0.6 * U;
// Agents autonomes : un secteur à ratisser compte comme vu dès qu'un homme passe à SWEEP_SEEN, la vue dégagée ; le
// suivant est le plus proche à pied, de SWEEP_AHEAD plus volontiers devant que derrière. Un trinôme garde son contact
// CONTACT_HOLD s : un bruit ne le remplace que s'il est plus proche, et jamais une vue fraîche. Arrivé sur un contact sans
// rien y trouver, il fouille les alentours SQUAD_SEARCH s avant de reprendre le ratissage.
const SWEEP_SEEN = 3 * U, SWEEP_AHEAD = 1.5 * U, CONTACT_HOLD = 4, SQUAD_SEARCH = 2;
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
// Stratégie : écart entre les points d'arrivée de trinômes envoyés ensemble au même endroit ; un chef de file arrivé à
// STRAT_ARRIVE de son point s'y arrête, et y retourne s'il en a été écarté de plus de STRAT_LEASH ; tolérance d'un clic
// sur un homme, en pixels d'écran.
const STRAT_SPACING = 2.6 * U, STRAT_ARRIVE = 0.3 * U, STRAT_LEASH = 0.9 * U, STRAT_PICK = 7;
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

class Game {
  constructor() {
    this.levelIndex = 0;
    this.listeners = {};
    this.minimap = true;
    this.input = { keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, rdown: false } };
    this.orderDrag = null; // ordre de déplacement en cours de tracé (clic droit maintenu)
    this.menu = null;      // menu d'actions ouvert au clic molette (voir openMenu)
    this.fireLock = false; // clic gauche pris par le menu : pas de tir avant de l'avoir relâché (voir updateMenu)
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
    this.alarm = null;   // alerte générale donnée par un suspect : { by, x, y, t } (voir raiseAlarm)
    this.score = null;   // note de fin de mission (voir scoreReport)
    this.record = null;  // meilleure note précédente pour cette mission, et si elle vient d'être battue
    this.squadSize = 1 + this.mates.length; // vous compris : c'est le groupe entier qui compte ses pertes
    this.orderMarker = null;
    this.orderDrag = null;
    this.menu = null;
    this.relayT = 0;
    this.pickHint = null;
    this.hostHint = null;
    this.cues = {}; // annonces d'objectif déjà faites (otages tous dehors, suspects à menotter)
    this.heard = [];      // bruits entendus hors de vue : direction et intensité (repères autour du joueur)
    this.ownNoise = null; // halo du dernier bruit du joueur
    if (this.player) this.player.cooking = null;
    this.message = { text: '', t: 0 };
    if (strategy) this.say('Vos trinômes attendent vos ordres — clic gauche (ou 1, 2, 3) pour en choisir un, clic droit pour l’envoyer', 6);
    this.computeVision();
    this.emit('level');
  }

  // Rondes : PATROLS suspects tirés au sort reçoivent un circuit de deux ou trois points, leur poste compris.
  // Chaque étape fait entre PATROL_LEG[0] et PATROL_LEG[1] de chemin (des portes à franchir au besoin : ils ont
  // les clés), et aucune ne passe par la zone où l'équipe commence (room : pièce d'entrée de l'assaut, ou
  // point A de l'escorte et abords du point B ; voir loadLevel). n : combien (davantage sur un terrain tenu).
  buildPatrols(room, n = PATROLS) {
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
      if (made >= n) break;
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
    this.say(this.defense ? "Le groupe armé a donné l'alerte : tout le terrain est sur ses gardes" : "Un suspect a donné l'alerte : tout le bâtiment est sur ses gardes", 3.5);
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

  // Stratégie : assaut : personne n'est posté à moins de DEFENSE_CLEAR du centre de votre base (petites cases).
  defenseQuiet(base) {
    const m = this.map, zone = new Set();
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      if (dist((tx + 0.5) * TILE, (ty + 0.5) * TILE, base.cx, base.cy) < DEFENSE_CLEAR) zone.add(ty * m.w + tx);
    }
    return zone;
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
    const a = this.spawnSquad(foeA, 'enemy', theirs), b = this.spawnSquad(foeB, 'enemy', theirs, foeB === foeA ? a.members : []);
    b.sectors = a.sectors; // les deux trinômes d'en face se partagent le bâtiment (voir pickSector)
    this.enemies = [...a.members, ...b.members];
  }

  // Un trinôme autonome derrière l'ouverture b : trois opérateurs (flashs, une charge, colonnes) ou trois hommes du
  // groupe armé (deux grenades à fragmentation chacun, et des accessoires sur leur arme), qui ratissent ensemble les
  // secteurs de leur liste (group.sweepTo, voir sweepGoal) et partagent ce qu'ils apprennent (group.contact). Celui de
  // votre camp porte un nom, comme vos coéquipiers.
  // opts.pts : leurs places, déjà choisies (une base de la guerre totale) ; opts.names : les noms de ceux de votre camp.
  spawnSquad(b, team, camp, taken, opts = {}) {
    // (derrière une ouverture, le premier, qui mène, est le plus avancé dans le bâtiment)
    const police = camp === 'police', pts = opts.pts || this.breachFile(b, 3, taken).reverse();
    const weps = dealWeapons(police ? OPERATOR_POOL : MILITANT_POOL, 3), kits = police ? null : dealWeapons(MILITANT_KITS, 3);
    const group = { team, camp, breach: b, contact: null, search: null, sweepTo: null, members: [], sectors: this.buildSectors(null, b.inside) };
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
      a.moveDir = b.angle; // le sens de sa marche, d'abord vers l'intérieur (sa file s'y range, voir formationPos)
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
    const names = this.strat && team === 'ops' ? STRAT_DEFS[W.camps[team]][k] : WAR_DEFS[W.camps[team]][k - 1];
    const g = this.spawnSquad(gate, team, W.camps[team], taken, { pts: this.baseFile(base, 3, taken, lane), names });
    g.sectors = this.warSectors(base, foe, lane);
    g.pingpong = true; // au bout du couloir, il le reprend dans l'autre sens
    g.slot = k;
    if (this.strat && team === 'ops') {
      const lead = g.members[0];
      Object.assign(g, { label: names[0].name, color: STRAT_COLORS[k], queue: [], rush: false, order: { type: 'hold', x: lead.x, y: lead.y, angle: base.angle } });
      for (const m of g.members) m.accent = g.color;
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
          if (this.strat && team === 'ops') this.say(`Trinôme ${n.label} : de retour à la base, il attend vos ordres`, 2.5);
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
        : W.defense ? `Le trinôme ${g.label} est anéanti${left > 0 ? ` — plus que ${left} trinôme${left > 1 ? 's' : ''}` : ''}`
        : this.strat ? `Le trinôme ${g.label} est anéanti — renforts dans ${WAR_RESPAWN} s`
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

  // ---- Stratégie ----
  // Vous commandez de haut les trois trinômes de votre armée (war.slots.ops), sans incarner personne : le clavier et la
  // souris donnent les ordres (updateCommander), chaque trinôme les exécute (orderStep). group.order vaut :
  //   null                                         il ratisse son couloir seul, comme en guerre totale ;
  //   { type: 'move', x, y, angle }                aller là, en file derrière son chef, puis tenir face à angle ;
  //   { type: 'hold', x, y, angle }                tenir : on tire sur ce qu'on voit, on ne poursuit personne ;
  //   { type: 'attack', foe, x, y }                aller au contact d'un adversaire, suivi tant que l'armée le voit ;
  //   { type: 'stack', door, side, front, tactic, st, wait }  en colonne sur une porte fermée, puis entrer (intervention).
  // group.queue : les déplacements à faire ensuite (Maj + clic droit) ; group.rush : au pas de course plutôt qu'au pas.

  // Un trinôme de votre armée qui a encore un homme debout.
  stratAlive(g) { return !!g && g.members.some(m => m.alive && m.group === g); }
  // Les trinômes choisis encore debout, dans l'ordre de leur numéro.
  stratSelected() { return [...this.strat.sel].sort().map(k => this.war.slots.ops[k]).filter(g => this.stratAlive(g)); }
  // « Alpha », « Alpha et Delta », « Alpha, Delta et Golf ».
  stratNames(gs) {
    const n = gs.map(g => g.label);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0] || '';
  }
  stratNone() { this.say('Aucun trinôme choisi — clic gauche sur l’un de vos hommes, ou 1, 2, 3 (A : tous)', 2.2); }

  // Clavier et souris du commandant, à chaque image, pause tactique comprise (dt : le temps réel).
  updateCommander(dt) {
    const S = this.strat, inp = this.input, pr = inp.pressed, k = inp.keys, m = inp.mouse;
    const ppx = m.ppx || 1, shift = !!(k.ShiftLeft || k.ShiftRight);
    S.clock = (S.clock || 0) + (dt || 0);
    S.hover = this.stratHover(m.x, m.y, ppx);
    // (le menu d'actions prend d'abord les clics qui lui reviennent)
    this.updateMenu();
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
    // clic droit : l'ordre part à la relâche ; maintenu et tiré, il fixe la direction à tenir à l'arrivée
    if (pr.Mouse2) S.aim = { x: m.x, y: m.y, angle: null, hover: S.hover };
    if (S.aim && m.rdown) {
      const d = dist(S.aim.x, S.aim.y, m.x, m.y);
      S.aim.angle = d >= 0.7 * U ? Math.atan2(m.y - S.aim.y, m.x - S.aim.x) : null;
    }
    if (S.aim && (pr.Mouse2Up || !m.rdown)) { const a = S.aim; S.aim = null; this.stratRightClick(a, shift); }
    if (pr.KeyH) this.stratHold();
    if (pr.KeyR) this.stratSweep();
    if (pr.KeyC) this.stratRush();
    if (pr.KeyG) this.stratGrenadeKey(m.x, m.y);
    if (pr.KeyB) this.stratChargeKey();
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
    if (!this.stratAlive(this.war.slots.ops[i])) { this.say(`Trinôme ${i + 1} anéanti${this.war.defense ? '' : ' — il revient de la base'}`, 1.4); return; }
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

  // Clic droit relâché : sur un adversaire en vue, l'attaquer ; sur une porte fermée, s'y mettre en colonne
  // (intervention) ou la franchir (groupe armé) ; ailleurs, y aller (Maj : après le déplacement en cours).
  stratRightClick(a, shift) {
    const gs = this.stratSelected();
    if (!gs.length) { this.stratNone(); return; }
    const h = a.hover;
    if (h && h.kind === 'foe' && h.foe.alive) this.stratAttack(gs, h.foe);
    else if (h && h.kind === 'door' && !shift) this.stratDoor(gs, h.door, 'auto');
    else this.stratMove(gs, a.x, a.y, a.angle, shift);
    Sound.tick(0.08);
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

  // Une porte fermée : le trinôme choisi le plus proche s'y met en colonne puis entre (intervention ; tactic : 'auto',
  // 'flash' ou 'charge'), ou la franchit en l'ouvrant (le groupe armé n'entre pas en colonne) ; les autres viennent
  // derrière lui, de ce côté de la porte.
  stratDoor(gs, d, tactic) {
    const near = this.stratByDistance(gs, d.cx, d.cy);
    const { g, at } = near[0];
    const side = Math.sign(d.horizontal ? at.y - d.cy : at.x - d.cx) || 1, inn = this.doorInside(d, side);
    const front = this.doorFront(d, side);
    this.releaseGroup(g);
    g.queue = [];
    if (this.camp !== 'police' || !front) {
      g.order = { type: 'move', x: inn.x, y: inn.y, angle: inn.angle };
      this.say(`${g.label} : on passe la porte`, 1.4);
    } else {
      g.order = { type: 'stack', door: d, side, front, tactic, st: null, wait: 0 };
      this.say(`${g.label} : en colonne sur la porte${tactic === 'flash' ? ', entrée à la flash' : tactic === 'charge' ? ', entrée à la charge' : ''}`, 1.8);
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

  // G : sur une porte fermée, l'intervention y entre à la flash ; ailleurs, une grenade (flash ou fragmentation, selon le
  // camp) part vers le curseur.
  stratGrenadeKey(x, y) {
    const gs = this.stratSelected(), h = this.strat.hover;
    if (!gs.length) { this.stratNone(); return; }
    if (h && h.kind === 'door' && this.camp === 'police') this.stratDoor(gs, h.door, 'flash');
    else this.stratGrenade(gs, x, y);
  }

  // La grenade part de celui des hommes choisis qui a une trajectoire libre jusqu'au point (sept cases au plus), le
  // plus près ; une grenade à fragmentation ne part pas sur les vôtres.
  stratGrenade(gs, x, y) {
    let best = null, bd = Infinity;
    for (const g of gs) for (const m of g.members) {
      if (!m.alive || m.group !== g || m.flashbangs <= 0 || m.act || m.stun > 0 || m.entry) continue;
      const d = dist(m.x, m.y, x, y);
      if (d < 1.5 * U || d > 7 * U || d >= bd || !this.clearThrow(m.x, m.y, x, y)) continue;
      bd = d; best = m;
    }
    if (!best) {
      const any = gs.some(g => g.members.some(m => m.alive && m.group === g && m.flashbangs > 0));
      this.say(any ? 'Personne n’a de trajectoire libre jusque-là (sept cases au plus)' : 'Plus de grenade dans ces trinômes', 2);
      return;
    }
    const frag = best.nade === 'frag';
    if (frag && this.ops.some(o => o.alive && dist(o.x, o.y, x, y) < FRAG_RADIUS + 0.5 * U)) { this.say('Trop près des vôtres pour une grenade à fragmentation', 2); return; }
    best.flashbangs--;
    best.flashCd = Math.max(best.flashCd || 0, 6); // (il ne relance pas de lui-même dans la foulée)
    best.path = [];
    this.startAction(best, 'grenade', 0.5, () => this.spawnFlash(best, x, y));
    this.say(`${best.name} : ${frag ? 'grenade' : 'flash'} !`, 1.2);
  }

  // B : sur une porte fermée, l'intervention y entre à la charge.
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
    if (!e.target && e.alertAngle === null) turnToward(e, o.angle + Math.sin(this.time * 0.6) * 0.3, e.turnRate * 0.5, dt);
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
    if (team.length >= 2 && this.formStack(d, o.side, team, this.stackTactic(g, o.tactic, team, d))) {
      o.st = team[0].entry;
      return true;
    }
    const q = inn();
    g.order = { type: 'move', x: q.x, y: q.y, angle: q.angle };
    return false;
  }

  // Manière d'entrer demandée (want) si le trinôme en a encore le moyen ; 'auto' : celle que choisirait l'IA, la menace
  // tenue pour derrière la porte.
  stackTactic(g, want, team, d) {
    if (want === 'flash') {
      if (team.some(o => o.flashbangs > 0)) return 'flash';
      this.say(`${g.label} : plus de flash — on entre porte ouverte`, 2);
      return 'plain';
    }
    if (want === 'charge') {
      if (team.some(o => o.charges > 0)) return 'charge';
      this.say(`${g.label} : plus de charge — on entre porte ouverte`, 2);
      return 'plain';
    }
    return this.pickEntry(team, d, true);
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

  // L'arrivée des vagues et le compte à rebours s'affichent au centre de l'écran (UI.updateWave, d'après siege.arrival
  // et nextWave), pas en message.
  updateSiege(dt) {
    const s = this.siege;
    if (s.prep > 0) {
      s.prep -= dt;
      if (s.prep <= 0) {
        this.spawnAssault(s.waves[0]);
        s.nextWave = s.maxGap;
        Sound.door();
      }
      return;
    }
    if (s.wave < s.waves.length) {
      // Pas d'attente inutile : la vague suivante suit de peu l'élimination de la précédente.
      if (!this.enemies.some(e => e.alive) && s.nextWave > s.gap) s.nextWave = s.gap;
      s.nextWave -= dt;
      if (s.nextWave <= 0) {
        this.spawnAssault(s.waves[s.wave]);
        s.nextWave = s.maxGap;
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
  setPaused(v) { if (this.over) return; this.paused = v; if (v) this.menu = null; this.emit('pause'); }

  // Minimap : visible par défaut, M (ou le menu d'actions) la replie.
  toggleMinimap() {
    this.minimap = !this.minimap;
    this.say(this.minimap ? 'Minimap affichée' : 'Minimap repliée', 1.2);
  }

  // ---- Boucle ----
  update(dt) {
    // (la touche répond même mort ou en pause)
    if (this.input.pressed.KeyM) this.toggleMinimap();
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
  // (ni geste, ni rechargement, ni fibre, ni grenade dégoupillée, ni sonné, ni menu d'actions ouvert).
  scoped(a) {
    return !!(a.alive && a.weapon && a.weapon.scope && !a.moving && a.stillT >= SCOPE.settle
      && !a.act && !(a.reloadT > 0) && !a.fiber && !a.cooking && !(a.stun > 0) && !(a === this.player && this.menu));
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
      if (!this.mates.some(m => m.alive)) { this.over = 'lose'; this.loseReason = 'Vos trois trinômes sont anéantis : le groupe armé tient toujours le terrain.'; }
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
      // Stratégie : la bataille, la part de votre armée dans le décompte, les trinômes que vous avez laissé anéantir et
      // les hommes perdus (neuf, une armée entière, ne laissent rien)
      const W = this.war, ours = W.kills.ops, theirs = W.kills.enemy;
      add('Bataille', win ? 'remportée' : draw ? 'égalité' : 'perdue', win ? 40 : draw ? 20 : 0);
      add('Score des armées', `${ours} – ${theirs}`, ours + theirs ? 30 * ours / (ours + theirs) : 15);
      add('Trinômes anéantis', W.lost || 'aucun', Math.max(0, 20 - 5 * W.lost));
      add('Hommes perdus', theirs, 10 * Math.max(0, 1 - theirs / 9));
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
    // (mort, le menu se ferme ; le commandant de la stratégie, jamais vivant, a le sien : updateCommander)
    if (!p.alive) { if (!this.strat) this.menu = null; return; }
    if (p.flashT > 0) p.flashT -= dt;
    if (p.stun > 0) p.stun -= dt;
    // (le menu d'actions consomme les clics qui lui reviennent : avant tout le reste)
    this.updateMenu();
    if (this.menu) {
      // menu ouvert : on garde la visée d'avant, le curseur part vers le menu
      p.angle = this.menu.angle; p.aimDist = this.menu.aimDist;
    } else {
      p.angle = Math.atan2(m.y - p.y, m.x - p.x);
      p.aimDist = dist(p.x, p.y, m.x, m.y);
    }

    let dx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    let dy = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (pr.KeyQ || pr.ShiftLeft || pr.ShiftRight) this.toggleWalk(p);
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
    if (pr.KeyR) this.startReload(p);
    if (pr.Digit1) this.switchWeapon(p, 0);
    if (pr.Digit2) this.switchWeapon(p, 1);
    if (pr.AltLeft || pr.AltRight) this.switchWeapon(p, (p.cur + 1) % p.slots.length);
    if (pr.Space || pr.KeyG) this.throwFlash(p);
    if (pr.KeyN) this.cycleNade(p);
    if (pr.KeyL) this.toggleLaser(p);
    if (pr.KeyX) this.toggleLamp(p);
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
    } else if (p.switchT <= 0 && p.stun <= 0 && !p.act && !p.fiber && !p.cooking && !this.menu && !this.fireLock) {
      const want = w.auto ? m.down : pr.Mouse0;
      if (want && p.fireT <= 0) {
        if (s.mag <= 0) { if (pr.Mouse0) { if (s.reserve > 0) this.startReload(p); else this.say('Plus de munitions', 1.5); } }
        else this.fireWeapon(p);
      }
    }
  }

  toggleWalk(p) {
    p.walkMode = !p.walkMode;
    this.say(p.walkMode ? 'Mode marche : précis et discret' : 'Mode course', 1.2);
  }

  toggleLaser(p) {
    if (!p.slots.some(s => s.def.laser)) { this.say('Aucun laser sur vos armes', 1.2); return; }
    p.laserOn = !p.laserOn;
    this.say(p.laserOn ? 'Laser allumé' : 'Laser éteint', 1.2);
  }

  // La lampe, et celles des coéquipiers avec (ils ne la gardent pas allumée quand vous éteignez la vôtre).
  hasLamp(p) { return p.slots.some(s => s.def.light) || this.mates.some(m => m.alive && m.weapon && m.weapon.light); }
  toggleLamp(p) {
    const team = this.mates.some(m => m.alive && m.weapon && m.weapon.light);
    if (!this.hasLamp(p)) { this.say('Aucune lampe sur vos armes', 1.2); return; }
    p.lampOn = !p.lampOn;
    for (const m of this.mates) m.lampOn = p.lampOn;
    this.say(p.lampOn ? (team ? 'Lampes allumées' : 'Lampe allumée') : (team ? 'Lampes éteintes' : 'Lampe éteinte'), 1.2);
  }

  // ---- Menu d'actions (clic molette) ----
  // Un clic molette ouvre, à côté du curseur, la liste de ce qu'on peut faire de ce qu'il désigne : vous-même (arme,
  // allure, laser, lampe, grenade, ce qui est à portée de main, ordres d'équipe), une porte (l'ouvrir à chaque cran,
  // la crocheter, la fibre, la charge, la colonne et l'entrée à la flash), ou un point du sol (y envoyer l'équipe, y
  // lancer une grenade). Chaque ligne rappelle son raccourci ; ce qui est impossible pour l'instant reste grisé, avec
  // la raison. Le temps ne s'arrête pas : on garde la visée d'avant et on ne tire pas tant que le menu est ouvert.
  // Un clic (gauche ou molette) sur une ligne la choisit, ailleurs ferme le menu, comme le clic droit ; on peut aussi
  // maintenir la molette, glisser jusqu'à la ligne et relâcher. Le rendu place le menu et dit quelle ligne est sous le
  // curseur (input.mouse.item, voir Renderer.menuItemAt). En stratégie, voir openStratMenu.
  openMenu(x, y) {
    if (this.strat) return this.openStratMenu(x, y);
    const p = this.player, near = p.radius + 10 * (this.input.mouse.ppx || 0.5);
    const door = this.doorAtPoint(x, y);
    const kind = dist(x, y, p.x, p.y) <= near ? 'self' : door ? 'door' : 'zone';
    this.menu = { kind, x, y, door: kind === 'door' ? door : null, angle: p.angle, aimDist: p.aimDist, drag: true, title: '', items: [] };
    this.menuItems(this.menu);
    return this.menu;
  }

  updateMenu() {
    const m = this.input.mouse, pr = this.input.pressed;
    // le clic qui a choisi une ligne ne doit pas partir en rafale une fois le menu fermé : on attend qu'il soit relâché
    if (!m.down) this.fireLock = false;
    const mn = this.menu;
    if (!mn) {
      if (pr.Mouse1) { this.openMenu(m.x, m.y); if (pr.Mouse1Up) this.menu.drag = false; }
      return;
    }
    // (stratégie : le trinôme visé vient d'être anéanti)
    if (mn.kind === 'unit' && !this.stratAlive(mn.group)) { this.menu = null; return; }
    this.menuItems(mn); // (l'état change pendant qu'on choisit : porte qui bouge, chargeur rempli)
    const it = mn.items[m.item];
    if (pr.Mouse0 || pr.Mouse1 || (pr.Mouse1Up && mn.drag && it)) { if (it) this.menuPick(it); else this.menu = null; }
    else if (pr.Mouse2) this.menu = null;
    if (pr.Mouse1Up) mn.drag = false;
    if (pr.Mouse0) this.fireLock = true;
    for (const c of ['Mouse0', 'Mouse1', 'Mouse2', 'WheelUp', 'WheelDown']) delete pr[c];
  }

  // Ligne grisée : on dit pourquoi, et le menu reste ouvert pour un autre choix.
  menuPick(it) {
    if (it.off) { this.say(`${it.label} : ${it.off}`, 1.4); return; }
    this.menu = null;
    it.run();
  }

  // Remplit mn.title et mn.items : { id, label, key (le raccourci), off (raison si impossible), run, sep (trait avant) }.
  menuItems(mn) {
    const items = [];
    const add = (id, label, key, off, run, sep) => items.push({ id, label, key, off: off || null, run, sep: !!sep });
    if (this.strat) this.stratMenu(mn, add);
    else if (mn.kind === 'self') this.selfMenu(mn, add);
    else if (mn.kind === 'door') this.doorMenu(mn, add);
    else this.zoneMenu(mn, add);
    mn.items = items;
    return items;
  }

  selfMenu(mn, add) {
    const p = this.player, s = p.slot, w = s.def, busy = p.act || p.fiber || p.cooking ? 'mains occupées' : null;
    mn.title = 'Vous';
    add('reload', 'Recharger', 'R', s.mag >= w.mag ? 'chargeur plein' : s.reserve <= 0 ? 'plus de munitions' : p.reloadT > 0 ? 'en cours' : busy,
      () => this.startReload(p));
    if (p.slots.length > 1) {
      const i = (p.cur + 1) % p.slots.length;
      add('weapon', `Prendre ${p.slots[i].def.name}`, 'Alt', p.act ? 'mains occupées' : null, () => this.switchWeapon(p, i));
    }
    const other = this.camp === 'armed' ? null : Object.keys(p.nades || {}).find(n => n !== p.nade && p.nades[n] > 0);
    if (other) add('nade', other === 'frag' ? 'Prendre une grenade à fragmentation' : 'Prendre une flash', 'N', p.cooking ? 'grenade dégoupillée' : null, () => this.cycleNade(p));
    add('walk', p.walkMode ? 'Passer en course' : 'Passer en marche', 'A', null, () => this.toggleWalk(p));
    if (p.slots.some(o => o.def.laser)) add('laser', p.laserOn ? 'Éteindre le laser' : 'Allumer le laser', 'L', null, () => this.toggleLaser(p));
    if (this.hasLamp(p)) add('lamp', p.lampOn ? 'Éteindre la lampe' : 'Allumer la lampe', 'X', null, () => this.toggleLamp(p));
    if (!this.squads && !this.siege) add('shout', 'Sommation', 'C', this.time - this.shoutT < SHOUT_COOLDOWN ? 'un instant' : null, () => this.shout(p), true);
    // à portée de main : un suspect rendu ou un otage (le plus proche, comme interact), une arme au sol, la charge posée
    if (p.team === this.rescueTeam) {
      const e = this.nearestSurrendered(p, HOSTAGE_REACH), h = this.nearestHostage(p, HOSTAGE_REACH);
      if (e && (!h || dist(p.x, p.y, e.x, e.y) <= dist(p.x, p.y, h.x, h.y))) add('cuff', 'Menotter le suspect', 'H', p.act ? 'mains occupées' : null, () => this.cuff(p, e));
      else if (h && (!h.escort || h.escort === p)) {
        const who = h.vip ? 'VIP' : 'Otage';
        add('hostage', h.escort === p ? `${who} : attendez ici` : `${who} : suivez-moi`, 'H', p.act ? 'mains occupées' : null, () => this.toggleEscort(p));
      }
    }
    const drop = this.nearestDrop(p);
    if (drop) add('pickup', `Ramasser ${this.pickupSlot(drop.slot).def.name}`, 'V', p.act || p.fiber ? 'mains occupées' : null, () => this.pickUp(p));
    const placed = this.charges.find(c => c.team === p.team);
    if (placed) add('blast', 'Faire sauter la charge', 'B', null, () => this.detonateCharge(placed));
    if (this.canCommand(true) && this.crew.length) {
      add('follow', 'Équipe : suivez-moi', 'clic droit', this.crew.every(o => o.order === 'follow') ? 'ils vous suivent' : null, () => this.orderFollow(), true);
      add('hold', 'Équipe : tenez la position', 'T', this.crew.every(o => o.order === 'hold') ? 'ils la tiennent' : null, () => this.toggleHold());
    }
    add('minimap', this.minimap ? 'Replier la minimap' : 'Afficher la minimap', 'M', null, () => this.toggleMinimap(), true);
  }

  doorMenu(mn, add) {
    const p = this.player, d = mn.door, eps = 0.01, gap = dist(p.x, p.y, d.cx, d.cy);
    const busy = p.act || p.fiber || p.cooking ? 'mains occupées' : null;
    const hands = gap > 1.8 * U ? 'trop loin' : d.opening ? 'en mouvement' : busy;
    const lock = d.locked && d.lockKnown;
    mn.title = 'Porte ' + (d.broken ? 'enfoncée' : lock ? 'verrouillée' : d.progress >= 1 - eps ? 'ouverte'
      : d.progress >= DOOR_PASS - eps ? 'entrouverte' : d.progress > eps ? 'entrebâillée' : 'fermée');
    // chaque cran a sa ligne (E ouvre ou ferme d'un coup, la molette avance d'un cran) ; verrouillée, on crochète d'abord
    if (lock) add('pick', 'Crocheter la serrure', 'E', hands, () => this.doorAction(p, d, 1));
    else {
      for (const [id, label, at, key] of [['open', 'Ouvrir en grand', 1, 'E'], ['ajar', 'Entrouvrir', DOOR_STEPS[2], 'molette'],
        ['crack', 'Entrebâiller', DOOR_STEPS[1], 'molette'], ['close', 'Fermer', 0, 'E']]) {
        const off = Math.abs(d.progress - at) < eps ? 'déjà' : d.broken ? 'serrure arrachée' : hands;
        add(id, label, key, off, () => this.doorAction(p, d, at));
      }
    }
    if (this.camp !== 'armed') {
      const reach = gap > 1.6 * U ? 'trop loin' : busy;
      if (p.fiber && p.fiber.door === d) add('fiber', 'Retirer la fibre', 'F', null, () => this.endFiber(p), true);
      else add('fiber', 'Fibre optique sous la porte', 'F', d.open ? 'porte ouverte' : reach, () => this.startFiber(p, d, true), true);
      const placed = this.charges.find(c => c.team === p.team);
      if (placed && placed.door === d) add('blast', 'Faire sauter la charge', 'B', null, () => this.detonateCharge(placed));
      else add('charge', 'Poser une charge', 'B', placed ? 'une autre est posée' : p.charges <= 0 ? 'plus de charge'
        : d.progress > 0 || d.broken ? 'porte pas fermée' : reach, () => this.placeChargeOn(p, d));
    }
    if (this.canCommand(true) && this.crew.length) {
      // comme au clic droit : la colonne sur une porte fermée, l'entrée à la flash tant que sa porte n'est pas grande
      // ouverte (le menu forme la colonne d'abord, s'il le faut)
      const shut = !d.broken && !this.map.doorPassable(d), here = !!this.stack && this.stack.door === d;
      add('stack', 'Équipe : en colonne', 'clic droit', !shut ? 'porte ouverte' : here ? 'déjà en colonne' : null, () => this.orderStack(d), true);
      add('flash', 'Équipe : entrée à la flash', 'clic droit ×2', !(shut || (here && !d.broken && d.progress < 1)) ? 'porte ouverte'
        : !this.crew.some(o => o.flashbangs > 0) ? 'plus de flash' : here && this.stack.flash ? 'en cours' : null, () => {
        if (!here) this.orderStack(d);
        if (this.stack && this.stack.door === d) this.orderFlashEntry();
      });
    }
  }

  zoneMenu(mn, add) {
    const p = this.player, far = dist(p.x, p.y, mn.x, mn.y);
    mn.title = `Ici · ${Math.max(1, Math.round(far / U))} m`;
    if (this.canCommand(true) && this.crew.length) add('move', 'Équipe : allez ici', 'clic droit', null, () => this.orderMove(mn.x, mn.y));
    add('throw', p.nade === 'frag' ? 'Lancer une grenade ici' : 'Lancer une flash ici', 'Espace', p.flashbangs <= 0 ? 'plus de grenade'
      : p.stun > 0 ? 'sonné' : p.act || p.cooking ? 'mains occupées' : far > 7 * U ? 'trop loin' : null, () => this.throwFlash(p, { x: mn.x, y: mn.y }));
  }

  // Stratégie : le menu porte sur ce que le clic droit désignerait (stratHover) : un adversaire en vue, l'un de vos
  // trinômes ('unit'), une porte fermée, sinon le sol.
  openStratMenu(x, y) {
    const h = this.stratHover(x, y, this.input.mouse.ppx || 1);
    const kind = !h ? 'zone' : h.kind === 'own' ? 'unit' : h.kind;
    this.menu = { kind, x, y, door: (h && h.door) || null, foe: (h && h.foe) || null, group: h && h.unit ? h.unit.group : null,
      drag: true, title: '', items: [] };
    this.menuItems(this.menu);
    return this.menu;
  }

  // Sur l'un de vos trinômes, les ordres portent sur lui seul (le choisir, le faire tenir, ratisser, courir, le
  // centrer) ; ailleurs, sur les trinômes choisis, nommés en titre, comme au clic droit et au clavier. Le sol donne
  // aussi ce qui vaut pour toute la bataille : choisir l'armée, la pause tactique, la minimap.
  stratMenu(mn, add) {
    const S = this.strat, gs = this.stratSelected(), none = gs.length ? null : 'aucun trinôme choisi';
    const police = this.camp === 'police', who = gs.length ? ` · ${this.stratNames(gs)}` : '';
    const has = (list, f) => list.some(g => g.members.some(m => m.alive && m.group === g && m[f] > 0));
    if (mn.kind === 'unit') {
      const g = mn.group, k = g.slot, only = S.sel.size === 1 && S.sel.has(k);
      mn.title = `${g.label} · ${g.members.filter(m => m.alive && m.group === g).length} debout`;
      add('select', 'Choisir ce trinôme', String(k + 1), only ? 'déjà choisi' : null, () => { S.sel = new Set([k]); Sound.tick(0.05); });
      if (S.sel.size && !only) {
        add('add', S.sel.has(k) ? 'Le retirer du choix' : 'L’ajouter au choix', 'Maj + clic', null, () => {
          if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k);
          Sound.tick(0.05);
        });
      }
      add('hold', 'Tenir ici', 'H', null, () => this.stratHold([g]), true);
      add('sweep', this.war.defense ? 'Ratisser le terrain seul' : 'Ratisser son couloir seul', 'R', g.order ? null : 'il ratisse déjà', () => this.stratSweep([g]));
      add('rush', g.rush ? 'Au pas, sans bruit' : 'Au pas de course', 'C', null, () => this.stratRush([g]));
      add('focus', 'Centrer la vue sur lui', 'F', null, () => this.stratFocus([g]), true);
    } else if (mn.kind === 'foe') {
      const down = mn.foe.alive ? null : 'abattu';
      mn.title = 'Adversaire' + who;
      add('attack', 'L’attaquer', 'clic droit', down || none, () => this.stratAttack(gs, mn.foe));
      add('grenade', police ? 'Une flash sur lui' : 'Une grenade sur lui', 'G', down || none || (has(gs, 'flashbangs') ? null : 'plus de grenade'),
        () => this.stratGrenade(gs, mn.foe.x, mn.foe.y));
    } else if (mn.kind === 'door') {
      const d = mn.door, off = d.broken || this.map.doorPassable(d) ? 'porte ouverte' : none;
      mn.title = 'Porte fermée' + who;
      if (!police) add('cross', 'La franchir', 'clic droit', off, () => this.stratDoor(gs, d, 'auto'));
      else {
        // c'est le trinôme choisi le plus proche qui se met en colonne (stratDoor) : ses flashs et sa charge comptent
        const g = gs.length ? [this.stratByDistance(gs, d.cx, d.cy)[0].g] : [];
        add('stack', 'Colonne et entrée', 'clic droit', off, () => this.stratDoor(gs, d, 'auto'));
        add('flash', 'Entrée à la flash', 'G', off || (has(g, 'flashbangs') ? null : 'plus de flash'), () => this.stratDoor(gs, d, 'flash'));
        add('charge', 'Entrée à la charge', 'B', off || (has(g, 'charges') ? null : 'plus de charge'), () => this.stratDoor(gs, d, 'charge'));
      }
    } else {
      mn.title = 'Ici' + who;
      add('move', 'Y aller', 'clic droit', none, () => this.stratMove(gs, mn.x, mn.y, null, false));
      add('queue', 'Y aller ensuite', 'Maj + clic droit', none || (gs.some(g => g.order && g.order.type === 'move') ? null : 'aucun déplacement en cours'),
        () => this.stratMove(gs, mn.x, mn.y, null, true));
      add('grenade', police ? 'Une flash ici' : 'Une grenade ici', 'G', none || (has(gs, 'flashbangs') ? null : 'plus de grenade'), () => this.stratGrenade(gs, mn.x, mn.y));
      const all = [0, 1, 2].filter(i => this.stratAlive(this.war.slots.ops[i]));
      add('all', 'Choisir toute l’armée', 'A', all.length && all.every(i => S.sel.has(i)) ? 'déjà choisie' : null, () => this.stratAll(), true);
      add('pause', S.frozen ? 'Reprendre' : 'Pause tactique', 'Espace', null, () => this.stratFreeze());
      add('minimap', this.minimap ? 'Replier la minimap' : 'Afficher la minimap', 'M', null, () => this.toggleMinimap());
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
      Object.assign(m, { hunter: false, drilled: false, group: null, entry: null, clear: null, escorting: null, blind: null, pace: 1, watchDir: null });
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
    this.menu = null;
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
  // at : le point visé depuis le menu d'actions ; la grenade part alors dès la fin du geste, sans attendre de relâcher.
  throwFlash(p, at) {
    if (p.flashbangs <= 0 || p.stun > 0 || p.act || p.cooking) return;
    p.flashbangs--;
    this.stats.flashes++;
    Sound.tick(0.12); // goupille
    const kind = p.nade || 'flash';
    this.startAction(p, 'grenade', 0.45, () => {
      p.cooking = { t: 0, kind, fuse: FUSE[kind === 'frag' ? 'frag' : 'flash'], at: at || null };
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
    if (!p.alive || c.at || !(k.Space || k.KeyG)) {
      p.cooking = null;
      const m = c.at || this.input.mouse;
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
  // on est immobile et incapable de tirer tant qu'on regarde. Posée depuis le menu d'actions (sticky), elle reste
  // sans tenir la touche, jusqu'au premier pas, à un clic ou à F.
  updateFiber(p, dt) {
    const k = this.input.keys, pr = this.input.pressed;
    if (p.fiber) {
      const f = p.fiber;
      if (f.sticky && pr.Mouse0) this.fireLock = true; // (le clic qui la retire ne tire pas)
      if ((f.sticky ? pr.Mouse0 || pr.KeyF : !k.KeyF) || !p.alive || p.stun > 0 || p.moving || f.door.opening || f.door.open
          || dist(p.x, p.y, f.door.cx, f.door.cy) > 2 * U) this.endFiber(p);
      return;
    }
    if (!pr.KeyF || p.act || !p.alive) return;
    this.startFiber(p, this.nearestDoor(p, 1.6 * U), false);
  }

  startFiber(p, d, sticky) {
    if (p.act || p.fiber || !p.alive) return;
    if (this.camp === 'armed') { this.say('Pas de fibre optique dans ce camp', 1.2); return; }
    if (!d || dist(p.x, p.y, d.cx, d.cy) > 1.6 * U) { this.say('Aucune porte à portée', 1); return; }
    if (d.open) { this.say('La porte est déjà ouverte', 1); return; }
    const spot = this.fiberSpot(p, d);
    if (!spot) { this.say('Impossible de glisser la fibre ici', 1.2); return; }
    Sound.tick(0.1);
    this.startAction(p, 'fiber', 0.7, () => {
      if ((sticky || this.input.keys.KeyF) && p.alive) p.fiber = { ...spot, sticky };
      if (sticky && p.fiber) this.say('Fibre en place — un pas, un clic ou F la retire', 1.6);
    });
  }

  endFiber(p) {
    p.fiber = null;
    Sound.tick(0.07);
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
    this.placeChargeOn(p, this.nearestDoor(p, 1.6 * U));
  }

  // Poser la charge sur cette porte-là (B : la plus proche ; le menu d'actions : celle qu'il désigne).
  placeChargeOn(p, d) {
    if (this.camp === 'armed' || !p.alive || p.act || p.fiber || p.cooking) return;
    if (p.charges <= 0) { this.say('Plus de charge de brèche', 1.2); return; }
    if (!d || dist(p.x, p.y, d.cx, d.cy) > 1.6 * U) { this.say('Aucune porte à portée', 1); return; }
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
    // l'erreur de visée vaut pour tout le coup ; les plombs s'ouvrent ensuite en gerbe autour (pattern)
    const spread = this.spreadOf(shooter), aim = shooter.angle + rand(-spread, spread), pattern = w.pattern || 0;
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
      const a = aim + rand(-pattern, pattern);
      const clear = !blocked && !this.map.castRay(shooter.x, shooter.y, a, ml, false).hit;
      const bx = clear ? shooter.x + Math.cos(a) * ml : shooter.x, by = clear ? shooter.y + Math.sin(a) * ml : shooter.y;
      this.bullets.push({ x: bx, y: by, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, team: shooter.team, damage: w.damage, life: BULLET_REACH / w.speed, shooter, ox: shooter.x, oy: shooter.y, heavy: w.heavy, pierce: w.pierce === undefined ? 0.4 : w.pierce, pierced: 0, breach, pen: w.pen || 1 });
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
      // au bout de sa course (BULLET_REACH), elle s'arrête en l'air : on ne la fait pas voler une image de trop
      const step = Math.min(dt, b.life), sp = Math.hypot(b.vx, b.vy), len = sp * step;
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
      // ce qu'elle a parcouru pendant cette image, jusqu'à ce qui l'arrête, reste tracé un instant
      this.tracers.push({ x0: b.x, y0: b.y, x1: b.x + cs * hitT, y1: b.y + sn * hitT, t: 0, heavy: !!b.heavy });
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
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          b.x = r.x + Math.cos(na) * 3; b.y = r.y + Math.sin(na) * 3; // ressort de l'autre côté
          b.life -= r.dist / sp;
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
      b.x += b.vx * step; b.y += b.vy * step; b.life -= step;
      if (b.life > 1e-9) keep.push(b);
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
        if (I > 0 && !(ally && !ALLY_ALARM.has(kind))) this.hearNoise(m, x, y, I, K, ally, source);
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
      if (this.hearNoise(e, x, y, I, K, ally, source)) goers.push({ e, I });
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
  hearNoise(e, x, y, I, K, ally, source) {
    const s = I * K.w;
    // une rafale compte moins que des bruits distincts : c'est la répétition qui inquiète
    const gain = this.time - e.heardT < 0.4 ? 0.35 : 1;
    e.heardT = this.time;
    e.suspicion = Math.min(2, (e.suspicion || 0) + s * gain);
    if (s < HEAR_TURN) return false;
    const toward = Math.atan2(y - e.y, x - e.x);
    if (e.hunter) {
      if (ally) {
        // les siens qui tirent tout près, d'un autre trinôme : on vient en renfort sur ce qu'ils ont trouvé (on ne se
        // retourne pas vers eux : ce n'est pas là qu'est l'adversaire)
        const c = source && source.group && source.group !== e.group && source.group.contact;
        if (K === NOISE_KINDS.shot && s >= HEAR_GO && c && this.time - c.t < CONTACT_HOLD) this.know(e, c.x, c.y);
        return false;
      }
      // l'intervention (ou un trinôme) converge sur ce qu'elle entend du camp d'en face (un impact ou une grenade
      // qui rebondit ne disent pas où est le tireur)
      if (K !== NOISE_KINDS.impact && K !== NOISE_KINDS.bounce && (K.important || s >= HEAR_GO)) this.know(e, x, y);
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
    // un équipier d'un trinôme qui suit son chef regarde son côté en marchant (watchDir, voir followStep)
    if (!agent.engaged) turnToward(agent, agent.watchDir == null ? ang : agent.watchDir, agent.turnRate, dt);
    if (agent.hunter) agent.moveDir = ang; // le sens de sa marche : sa file s'y range derrière lui (formationPos)
    const ax = agent.x + Math.cos(ang) * (agent.radius + 4), ay = agent.y + Math.sin(ang) * (agent.radius + 4);
    const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
    if (door && !this.map.doorPassable(door)) {
      if (!door.opening) this.doorAction(agent, door, 1);
      agent.waitDoor = door;
      return;
    }
    // un suspect en ronde marche, il ne court pas ; un trinôme hors combat avance au pas (pace, voir updateAssault)
    const step = Math.min(d, agent.speed * (agent.pace || 1) * (agent.patrol && agent.state === 'idle' ? PATROL_SPEED : 1) * dt);
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
    if (a.hunter) return (a.pace || 1) < 1 ? 0 : STEP_NOISE.operator; // un trinôme au pas ne s'entend pas
    if (a.team === 'enemy') return a.state === 'investigate' || a.state === 'engage' ? STEP_NOISE.suspect : 0;
    return a.walkMode ? 0 : STEP_NOISE.mate;
  }

  // Les siens (le camp de a, vous compris côté ops) et ceux d'en face (le VIP compris, pour le commando de l'escorte).
  teamOf(a) { return a.team === 'ops' ? this.ops : this.enemies; }
  foesOf(a) { return a.team === 'ops' ? this.enemies : this.vip ? [...this.ops, this.vip] : this.ops; }

  // Un agent autonome apprend où est l'adversaire (seen : celui qu'il voit, lui ou son laser ; rien s'il l'entend) :
  // son trinôme le sait aussitôt, à moins de tenir mieux depuis moins de CONTACT_HOLD s. Ce qu'on voit passe avant ce
  // qu'on entend ; un second adversaire en vue ne remplace pas le premier tant qu'on voit encore celui-ci ; un bruit
  // ailleurs ne remplace un bruit que s'il est plus proche. Sans quoi chaque coup de feu de la bataille ferait changer
  // le trinôme de cap.
  know(e, x, y, seen) {
    e.lastKnown = { x, y };
    const g = e.group;
    if (!g) return;
    const c = g.contact, age = c ? this.time - c.t : Infinity;
    if (age < CONTACT_HOLD) {
      if (c.seen && !seen) return;
      if (seen ? c.foe && c.foe !== seen && age < 0.5
        : dist(c.x, c.y, x, y) > 2 * U && dist(e.x, e.y, x, y) > dist(e.x, e.y, c.x, c.y) - U) return;
    }
    g.contact = { x, y, t: this.time, seen: !!seen, foe: seen || null };
  }

  // Progression d'un agent autonome : l'équipe d'intervention du siège, ou un trinôme (d'un camp comme de l'autre).
  // Seul, il avance vers le dernier contact, sinon vers le prochain secteur à nettoyer ; en trinôme, le chef de file
  // (leaderOf) mène où va le trinôme (son contact, la fouille qui suit, le secteur choisi pour tous), au pas, en marquant
  // les portes, et attend les siens (waitsForGroup) ; les deux autres le suivent en file (followStep). Chacun s'arrête
  // pour tirer dès qu'il voit.
  updateAssault(e, dt) {
    if (!e.alive) return;
    e.pace = 1; e.watchDir = null; // au pas, et le regard d'un équipier en file : voir followStep
    e.noiseT -= dt;
    e.suspicion = Math.max(0, e.suspicion - SUSPICION_DECAY * dt);
    if (this.siege && this.siege.prep > 0) { e.moving = false; return; } // ils attendent devant la porte
    this.enemyCombat(e, dt);
    if (e.stun > 0) return;
    if (!e.target) this.spotLaser(e, dt);
    this.markSwept(e, dt);
    e.repathT -= dt;
    const h = e.escorting;
    if (h && (!h.alive || h.evacuated || h.escort !== e)) { e.escorting = null; e.exit = null; }
    // en colonne sur une porte : il tient son poste (voir updateAiStack)
    if (e.entry) { this.stackStep(e, dt); return; }
    if (e.target) {
      this.know(e, e.target.x, e.target.y, e.target);
      if (e.blockedLine) {
        // otage dans l'axe : on cherche un angle dégagé plutôt que de tirer à travers
        const spot = this.firingSpot(e, e.target);
        if (spot && (!e.path.length || e.repathT <= 0)) { e.path = this.pathTo(e, spot.x, spot.y); e.repathT = 0.5; }
        this.moveAlong(e, dt); // engagé, il se déplace sans lâcher la cible des yeux (enemyCombat)
        return;
      }
      if (e.engaged) { e.path = []; e.moving = false; return; }
      // en escorte, on ne court pas après une cible hors de portée : la sortie d'abord ; un trinôme sous vos ordres
      // (stratégie) non plus, sauf s'il a l'ordre d'attaquer : il tient son poste ou poursuit sa route
      const ordered = e.group && e.group.order && e.group.order.type !== 'attack';
      if (!e.escorting && !ordered) {
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
    let lead = null;
    if (g) {
      // un trinôme sous vos ordres (stratégie) fait ce que vous lui dites ; sans ordre, il ratisse son couloir
      if (g.order) { this.orderStep(g, e, dt); return; }
      // en trinôme, ce que l'un sait, tous le savent (voir know) : on va ensemble au contact, on fouille là où il
      // n'a rien donné, et seulement ensuite on reprend le ratissage ; seul le chef de file choisit le chemin
      if (this.searchStep(g, e, dt)) return;
      lead = this.leaderOf(g);
      if (lead !== e) { this.followStep(e, lead, dt); return; }
      goal = this.contactGoal(g, e) || g.search;
    }
    if (!goal) goal = this.assaultGoal(e);
    if (!goal) { this.moveAlong(e, dt); return; }
    // un nouveau but : on y part aussitôt, sans finir le chemin de l'ancien (path.to : le but de ce chemin-ci ; un
    // chemin tracé ailleurs, vers une cible ou un poste, n'en a pas)
    const to = e.path.to;
    if (!e.path.length || e.repathT <= 0 || !to || dist(to.x, to.y, goal.x, goal.y) > 1.5 * U) {
      e.path = this.pathTo(e, goal.x, goal.y);
      e.path.to = { x: goal.x, y: goal.y };
      e.repathT = 1.2;
      // point injoignable (au ras d'un mur, derrière un meuble) : on l'oublie et on reprend le ratissage (un secteur
      // injoignable compte comme fait)
      if (!e.path.length && dist(e.x, e.y, goal.x, goal.y) > 1.2 * U) {
        if (goal === e.lastKnown) e.lastKnown = null;
        if (g && goal === g.contact) g.contact = null;
        if (g && goal === g.search) g.search = null;
        if (goal.done === false) goal.done = true;
      }
    }
    if (this.considerStack(e)) return;
    if (lead) {
      if (this.waitsForGroup(e, dt)) { e.moving = false; return; }
      // hors combat, le chef avance au pas et marque les portes ; les siens viennent de voir l'adversaire : il y court
      const c = g.contact;
      if (!(c && c.seen && this.time - c.t < 2)) { e.pace = SQUAD_PACE; this.doorPause(e, g); }
    }
    this.moveAlong(e, dt);
  }

  // Le chef de file d'un trinôme : le premier des siens encore debout (celui qui entrait en tête). S'il tombe, le
  // suivant prend la tête.
  leaderOf(g) { return g.members.find(o => o.alive && o.group === g) || null; }

  // Chemin restant d'un agent (px).
  pathLeft(a) {
    let L = 0, x = a.x, y = a.y;
    for (const q of a.path) { L += dist(x, y, q.x, q.y); x = q.x; y = q.y; }
    return L;
  }

  // Le chef de file attend celui des siens resté à plus de SQUAD_SPREAD (à vol d'oiseau ou à pied), SQUAD_WAIT s au plus
  // de suite : un équipier coincé ne fige pas le trinôme. Celui qui se bat ou tient son poste en colonne ne compte pas.
  waitsForGroup(e, dt) {
    const g = e.group;
    const lag = g.members.some(o => o !== e && o.alive && o.group === g && !o.target && !o.entry && !o.clear
      && (dist(o.x, o.y, e.x, e.y) > SQUAD_SPREAD || this.pathLeft(o) > SQUAD_SPREAD + U));
    if (!lag) { g.waitT = 0; return false; }
    g.waitT = (g.waitT || 0) + dt;
    return g.waitT < SQUAD_WAIT;
  }

  // Avant de franchir une porte (ouverte, ou qu'il vient d'ouvrir), le chef de file marque SQUAD_DOOR_PAUSE s sur le
  // seuil : il regarde dans la pièce, et sa file se resserre derrière lui. Une fois par porte (une même porte, de
  // nouveau au bout de 8 s).
  doorPause(e, g) {
    if (e.holdT > 0 || e.act) return;
    const r = this.doorAhead(e, 1.2 * U);
    if (!r || r.at < 8 || !this.map.doorPassable(r.d)) return;
    const was = g.doorPaused;
    if (was && was.d === r.d && this.time - was.t < 8) return;
    g.doorPaused = { d: r.d, t: this.time };
    e.holdT = SQUAD_DOOR_PAUSE;
  }

  // Un équipier d'un trinôme suit son chef de file en file décalée (SQUAD_FILE), sans ouvrir de porte (c'est le chef
  // qui les ouvre), au pas du chef près de sa place, au pas de course s'il en est à plus de SQUAD_CATCH. Le trinôme vient
  // de voir l'adversaire : il se porte d'un pas de côté là d'où il le verrait aussi (firingSpot), sinon à hauteur du chef
  // (SQUAD_LINE, face à l'adversaire). En marche, le second couvre le flanc gauche, le dernier le flanc droit, avec un
  // coup d'œil en arrière de temps en temps ; arrêtés, le second garde la gauche, le dernier les arrières.
  // Un trinôme qui tient une position sur votre ordre (stratégie) se met en ligne, à hauteur du chef, face à la direction
  // donnée, chacun couvrant son côté.
  followStep(e, lead, dt) {
    const g = e.group;
    let rank = Math.min(1, g.members.filter(o => o !== lead && o.alive && o.group === g).indexOf(e));
    this.trackStuck(e, dt);
    const c = g.contact, foe = c && c.seen && c.foe && c.foe.alive && this.time - c.t < 1.5 ? c.foe : null;
    const hold = !foe && g.order && g.order.type === 'hold' && !lead.moving ? g.order : null;
    const head = foe ? Math.atan2(foe.y - lead.y, foe.x - lead.x) : hold ? hold.angle : lead.moveDir === undefined ? lead.angle : lead.moveDir;
    if (hold) {
      // en ligne, chacun prend le côté du chef où il se trouve déjà (choisi une fois par ordre) : personne ne croise
      const fol = g.members.filter(o => o !== lead && o.alive && o.group === g);
      if (fol.length === 2 && !fol.includes(hold.left)) {
        const lat = o => (o.y - lead.y) * Math.cos(head) - (o.x - lead.x) * Math.sin(head);
        hold.left = lat(fol[0]) <= lat(fol[1]) ? fol[0] : fol[1];
      }
      if (fol.length === 2) rank = e === hold.left ? 0 : 1;
    }
    let dest = null;
    if (foe && dist(e.x, e.y, lead.x, lead.y) < 4 * U) dest = this.firingSpot(e, foe);
    if (!dest) {
      // la place en file ne se recalcule que par à-coups : la chercher coûte (formationPos)
      if (!e.formAt || e.formT <= this.time) {
        e.formAt = this.formationPos(e, lead, (foe || hold ? SQUAD_LINE : SQUAD_FILE)[rank], head);
        e.formT = this.time + 0.15;
      }
      dest = e.formAt;
    }
    const d = dist(e.x, e.y, dest.x, dest.y);
    // il ne recule pas vers une place restée un peu derrière lui ; le chef arrêté, il ne bouge plus pour quelques pas
    // d'écart ; le chef en marche, il marche avec lui
    const behind = (dest.x - e.x) * Math.cos(head) + (dest.y - e.y) * Math.sin(head) < 0;
    const settle = dest === e.fireSpot ? 4 : behind ? 1.5 * U : lead.moving ? 4 : e.moving ? 12 : 0.7 * U;
    if (d > settle) {
      const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
      const changed = !e.destTile || e.destTile.x !== tile.x || e.destTile.y !== tile.y;
      if (changed || e.repathT <= 0 || !e.path.length) {
        const avoid = this.teamOf(e).filter(o => o !== e && o.alive && dist(o.x, o.y, e.x, e.y) < 4 * U).map(o => ({ x: o.x, y: o.y, r: e.stuckCount ? 30 : 22 }));
        let path = this.map.routeTo(e.x, e.y, tile.x, tile.y, e.radius, { noClosedDoors: true, avoid });
        if (path && path.length) path[path.length - 1] = { x: dest.x, y: dest.y };
        // pas de chemin sans ouvrir de porte (une porte s'est refermée entre eux) : il rejoint le chef, porte comprise
        else if (!path) path = this.map.routeTo(e.x, e.y, lead.tx, lead.ty, e.radius, { avoid });
        e.path = path || [];
        e.destTile = tile;
        e.repathT = 0.4;
      }
      // à sa place, au pas du chef ; un peu en retard, un peu plus vite (toujours sans bruit) ; distancé, il court
      if (d <= SQUAD_CATCH) e.pace = d < 0.3 * U ? SQUAD_PACE : SQUAD_PACE * 1.3;
      // il couvre son côté en marchant (le dernier jette un coup d'œil derrière, 1,2 s toutes les 5 s) ; l'adversaire
      // vu à l'instant, il le cherche des yeux
      if (foe) e.watchDir = Math.atan2(foe.y - e.y, foe.x - e.x);
      else if (e.alertAngle === null && d <= 3 * U) {
        e.coverPhase = e.coverPhase === undefined ? rand(0, 5) : e.coverPhase;
        e.watchDir = head + (rank === 0 ? -55 * DEG : (this.time + e.coverPhase) % 5 < 1.2 ? Math.PI : 55 * DEG);
      }
      e.lastStep = { x: e.x, y: e.y };
      this.moveAlong(e, dt);
      return;
    }
    e.path = []; e.moving = false;
    if (e.alertAngle !== null) return;
    const want = foe ? Math.atan2(foe.y - e.y, foe.x - e.x)
      : hold ? head + (rank === 0 ? -35 * DEG : 35 * DEG) + Math.sin(this.time * 0.8 + rank * 2) * 0.3
      : head + (rank === 0 ? -80 * DEG : Math.PI) + Math.sin(this.time * 0.9 + rank * 2) * 0.45;
    turnToward(e, want, e.turnRate * 0.5, dt);
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

  // Première porte sur le chemin d'un agent, à moins de range : { d, at }, at le chemin qui l'en sépare.
  doorAhead(a, range) {
    let x = a.x, y = a.y, walked = 0;
    for (const wp of a.path) {
      const L = dist(x, y, wp.x, wp.y), n = Math.max(1, Math.ceil(L / 6));
      for (let i = 1; i <= n; i++) {
        if (walked + L * i / n > range) return null;
        const d = this.map.door(Math.floor((x + (wp.x - x) * i / n) / TILE), Math.floor((y + (wp.y - y) * i / n) / TILE));
        if (d) return { d, at: walked + L * i / n };
      }
      walked += L; x = wp.x; y = wp.y;
      if (walked >= range) return null;
    }
    return null;
  }

  // Première porte sur le chemin d'un agent, à moins de range : null si elle laisse déjà passer (ou s'ouvre).
  doorOnPath(a, range) {
    const r = this.doorAhead(a, range);
    return r && !r.d.opening && !this.map.doorPassable(r.d) ? r.d : null;
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
    // stratégie : sous vos ordres, un trinôme ne lance que sur votre ordre (G, menu d'actions, entrée à la flash), pas
    // sur ce qu'il entend en route ou une fois en place ; à l'assaut, ou laissé à ratisser seul, il garde l'initiative
    const o = e.group && e.group.order;
    if (o && o.type !== 'attack') return false;
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

  // Les otages repérés que personne n'emmène encore (c'est leur mission), sinon le prochain secteur à ratisser.
  assaultGoal(e) {
    let best = null, bd = Infinity;
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.escort || h.exiting || !h.found) continue;
      const d = dist(e.x, e.y, h.x, h.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) return { x: best.x, y: best.y };
    return this.sweepGoal(e);
  }

  // Le contact du trinôme, tant qu'il vaut quelque chose : le premier arrivé dessus sans rien voir le lève, et le
  // trinôme fouille les alentours (searchStep).
  contactGoal(g, e) {
    const c = g.contact;
    if (!c) return null;
    if (this.time - c.t > SQUAD_CONTACT) { g.contact = null; return null; }
    if (dist(e.x, e.y, c.x, c.y) >= 1.2 * U) return c;
    g.contact = null;
    for (const o of g.members) if (o.lastKnown && dist(o.lastKnown.x, o.lastKnown.y, c.x, c.y) < 2 * U) o.lastKnown = null;
    g.search = { x: c.x, y: c.y, dir: e.angle, until: this.time + SQUAD_SEARCH };
    return null;
  }

  // Fouille : le trinôme s'arrête SQUAD_SEARCH s là où le contact n'a rien donné, chacun regardant de son côté (celui
  // qui traîne à plus de 2,5 cases rejoint d'abord). Un nouveau contact l'interrompt. true : il fouille sur place.
  searchStep(g, e, dt) {
    const s = g.search;
    if (!s) return false;
    if (this.time >= s.until || g.contact) { g.search = null; return false; }
    if (dist(e.x, e.y, s.x, s.y) > 2.5 * U) return false;
    e.path = []; e.moving = false;
    const k = g.members.indexOf(e);
    if (e.alertAngle === null) turnToward(e, s.dir + (k - 1) * 2.1 + Math.sin(this.time * 1.5 + k) * 0.6, e.turnRate * 0.4, dt);
    return true;
  }

  // Les secteurs à ratisser d'un agent autonome : ceux de son trinôme, ou ceux que se partage l'intervention du siège.
  sectorsOf(e) { return (e.group && e.group.sectors) || (this.siege && this.siege.sectors) || []; }

  // Quatre fois par seconde, les secteurs que l'agent a sous les yeux (à moins de SWEEP_SEEN, la vue dégagée) ou qu'il
  // touche presque sont ratissés : on ne va pas toucher chaque recoin d'une pièce qu'on voit déjà.
  markSwept(e, dt) {
    if ((e.sectorT = (e.sectorT || 0) - dt) > 0) return;
    e.sectorT = 0.25;
    for (const s of this.sectorsOf(e)) {
      if (s.done) continue;
      const d = dist(e.x, e.y, s.x, s.y);
      if (d < 1.4 * U || (d < SWEEP_SEEN && this.map.hasLOS(e.x, e.y, s.x, s.y))) s.done = true;
    }
  }

  // Le secteur à ratisser, choisi pour tout le trinôme (pour l'agent seul, au siège) et gardé jusqu'à ce qu'il soit vu :
  // tous les hommes vont au même endroit, et l'on ne change pas d'avis en route.
  sweepGoal(e) {
    const own = e.group || e, secs = this.sectorsOf(e);
    if (own.sweepTo && !own.sweepTo.done && secs.includes(own.sweepTo)) return own.sweepTo;
    if (!secs.length || this.time < (own.pickAt || 0)) return null;
    own.sweepTo = this.pickSector(own, e, secs);
    if (!own.sweepTo) own.pickAt = this.time + 1; // rien de joignable : on ne recalcule pas à chaque image
    return own.sweepTo;
  }

  // Le secteur suivant, vu de l'homme le plus au centre du trinôme : le plus proche à pied (walkField), de SWEEP_AHEAD
  // plus volontiers dans le sens de la marche ; quand d'autres de son camp ratissent la même liste (l'autre trinôme
  // d'en face, ou vous avec le vôtre), parmi ceux qui sont plus près de lui que d'eux. Un couloir de la guerre totale se
  // parcourt dans l'ordre : on le rejoint au plus près et l'on continue vers l'avant, puis, au bout, dans l'autre sens.
  // Tout ratissé, on recommence.
  pickSector(own, e, secs) {
    const m = this.map, at = this.anchorOf(own, e);
    if (!secs.some(s => !s.done)) {
      for (const s of secs) s.done = false;
      if (own.pingpong) secs.reverse();
    }
    const f = m.walkField(at.x, at.y), cell = s => Math.floor(s.y / TILE) * m.w + Math.floor(s.x / TILE);
    if (own.pingpong) {
      let k = 0;
      secs.forEach((s, i) => { if (dist(s.x, s.y, at.x, at.y) < dist(secs[k].x, secs[k].y, at.x, at.y)) k = i; });
      secs.forEach((s, i) => { if (i < k || f[cell(s)] === Infinity) s.done = true; });
      return secs.find(s => !s.done) || null;
    }
    const others = (this.squads ? this.squads.groups : []).filter(o => o !== own && o.sectors === secs).map(o => this.anchorOf(o)).filter(Boolean);
    if (this.squads && !this.war && own.team === 'ops' && this.player.alive) others.push(this.player);
    const fo = others.map(o => m.walkField(o.x, o.y));
    let best = null, bs = Infinity, any = null, as = Infinity;
    for (const s of secs) {
      if (s.done) continue;
      const i = cell(s), d = f[i];
      if (d === Infinity) { s.done = true; continue; } // injoignable
      const sc = own.sectorDir === undefined ? d : d - SWEEP_AHEAD * Math.cos(angleDiff(Math.atan2(s.y - at.y, s.x - at.x), own.sectorDir));
      if (sc < as) { as = sc; any = s; }
      if (fo.some(o => o[i] + U < d)) continue; // plus près d'un autre des siens : à lui
      if (sc < bs) { bs = sc; best = s; }
    }
    const pick = best || any;
    if (pick) own.sectorDir = Math.atan2(pick.y - at.y, pick.x - at.x);
    return pick;
  }

  // Où se tient un trinôme : celui de ses hommes debout le plus près de leur centre (l'agent lui-même, hors trinôme).
  anchorOf(own, e) {
    const ms = own.members ? own.members.filter(o => o.alive && o.group === own) : [e];
    if (!ms.length) return null;
    const cx = ms.reduce((s, o) => s + o.x, 0) / ms.length, cy = ms.reduce((s, o) => s + o.y, 0) / ms.length;
    return ms.reduce((b, o) => (dist(o.x, o.y, cx, cy) < dist(b.x, b.y, cx, cy) ? o : b));
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

  // Un point est dans l'axe de tir du joueur (cône étroit devant lui), ou de p.
  inAimCone(x, y, halfAngle, p = this.player) {
    const d = dist(p.x, p.y, x, y);
    if (d < 6 || d > 7 * U) return false;
    return Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < (halfAngle || 20 * DEG);
  }

  // Place du coéquipier en formation derrière le joueur, hors de son axe de tir,
  // sinon la case libre la plus proche visible du joueur. Un équipier d'un trinôme autonome se range de même derrière
  // son chef de file p, à la place off, dans le sens a (voir followStep).
  formationPos(m, p = this.player, off = m.slotOffset, a = p.moveDir === undefined ? p.angle : p.moveDir) {
    const [fx, fy] = off;
    const wx = p.x + (Math.cos(a) * fx - Math.sin(a) * fy) * U, wy = p.y + (Math.sin(a) * fx + Math.cos(a) * fy) * U;
    const bad = m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - Math.floor(wx / TILE)) <= 1 && Math.abs(m.badDest.y - Math.floor(wy / TILE)) <= 1;
    if (!bad && this.map.circleFree(wx, wy, m.radius + 1, true) && this.map.hasLOS(p.x, p.y, wx, wy) && !this.inAimCone(wx, wy, 30 * DEG, p)) return { x: wx, y: wy };
    const mates = m.group ? m.group.members : this.mates;
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
      if (this.inAimCone(cx, cy, 35 * DEG, p)) score += 6 * U;
      if (m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - tx) <= 1 && Math.abs(m.badDest.y - ty) <= 1) score += 10 * U;
      if (mates.some(o => o !== m && o.alive && o.destTile && o.destTile.x === tx && o.destTile.y === ty)) score += 2 * U;
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
    // elle ne tire plus jamais dans une pièce encombrée. Une chevrotine ouvre en plus sa gerbe de plombs.
    const spread = this.spreadOf(shooter, d) + (shooter.weapon.pattern || 0);
    const cone = trained ? Math.tan(spread * (strict ? 1 : 0.5) + (strict ? 2 : 1) * DEG) : 0;
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
      // un coéquipier ne se place ni sur le joueur ni dans son axe de visée (s'il est debout)
      if (m.team === 'ops' && this.player.alive && dist(x, y, this.player.x, this.player.y) < 0.8 * U) continue;
      if (m.team === 'ops' && this.player.alive && this.inAimCone(x, y, 30 * DEG)) continue;
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

  // Détection de blocage d'un équipier qui suit (repoussé par un allié, coincé contre un angle) : nouveau trajet,
  // puis, si ça persiste, abandon temporaire de cette case.
  trackStuck(m, dt) {
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
        m.watchSpot = null; m.formT = 0;
        m.stuckCount = 0;
      }
    }
    if (m.stuckCount && !m.moving) m.stuckCount = 0;
  }

  updateMate(m, dt) {
    if (!m.alive) return;
    this.trackStuck(m, dt);
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
