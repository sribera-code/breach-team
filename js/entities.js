'use strict';

// spread en radians (demi-angle), speed en px/s, gunLen en px (longueur visible du canon).
// bloom : dispersion ajoutée à chaque tir (plafonnée à bloomMax), recoil : recul visuel (px caméra)
// effRange : portée efficace ; au-delà, rangeSpread s'ajoute progressivement (tenue de visée)
// Armes réelles : calibre, cadence (coups/min), capacité et masse (kg, chargée) reprennent les données constructeur ;
// les dégâts suivent le calibre, la mobilité découle de la masse.
// kind : dessin (Sprites.gun), tint : variante de couleurs, snd : [durée, coupure] du son de tir.
// reloadType 'shell' : chargement cartouche par cartouche (reload = durée par cartouche), interrompu par un tir.
// pierce : part des dégâts conservée après avoir traversé une porte (les murs, eux, arrêtent tout).
const WEAPONS = {
  // ---- Fusils d'assaut ----
  hk416: {
    kind: 'rifle', cat: 'ar', name: 'HK416 A5', maker: 'Heckler & Koch', caliber: '5,56×45 mm OTAN', mode: 'Auto', rpm: 850, weight: 3.6,
    note: "Fusil de dotation des forces spéciales françaises. Précis, contrôlable, polyvalent.",
    damage: 30, auto: true, spread: 0.6 * DEG, moveSpread: 3.5 * DEG, bloom: 1.4 * DEG, bloomMax: 9 * DEG, recoil: 4,
    effRange: 10 * U, rangeSpread: 3 * DEG, mag: 30, reserve: 120, reload: 2.2, pierce: 0.55, speed: 1150, gunLen: 20, heavy: false, range: 16 * U,
    snd: [0.1, 2200],
  },
  scarh: {
    kind: 'rifle', cat: 'ar', name: 'FN SCAR-H CQC', maker: 'FN Herstal', caliber: '7,62×51 mm OTAN', mode: 'Auto', rpm: 600, weight: 4.1,
    note: "Calibre lourd : deux impacts suffisent, mais le recul est sévère en rafale et le chargeur court.",
    tint: { body: '#a38b62', dark: '#8a7450', mag: '#2e2f33', straightMag: true },
    damage: 42, auto: true, spread: 0.5 * DEG, moveSpread: 4.5 * DEG, bloom: 2.6 * DEG, bloomMax: 11 * DEG, recoil: 7,
    effRange: 12 * U, rangeSpread: 2.5 * DEG, mag: 20, reserve: 80, reload: 2.5, pierce: 0.7, speed: 1250, gunLen: 21, heavy: true, range: 18 * U,
    snd: [0.16, 1400],
  },
  // ---- Pistolets mitrailleurs ----
  mp5: {
    kind: 'smg', cat: 'smg', name: 'HK MP5A3', maker: 'Heckler & Koch', caliber: '9×19 mm Parabellum', mode: 'Auto', rpm: 800, weight: 3.1,
    note: "La référence des unités d'intervention. Recul très doux, maniable, mais portée limitée.",
    damage: 22, auto: true, spread: 0.9 * DEG, moveSpread: 2 * DEG, bloom: 1 * DEG, bloomMax: 6 * DEG, recoil: 2.5,
    effRange: 6 * U, rangeSpread: 4 * DEG, mag: 30, reserve: 120, reload: 2.0, pierce: 0.4, speed: 900, gunLen: 16, heavy: false, range: 11 * U,
    snd: [0.08, 2600],
  },
  mp7: {
    kind: 'pdw', cat: 'smg', name: 'HK MP7A1', maker: 'Heckler & Koch', caliber: '4,6×30 mm HK', mode: 'Auto', rpm: 950, weight: 2.1,
    note: "Arme de défense compacte à très haute cadence. Munition légère et tendue, chargeur de 40.",
    damage: 19, auto: true, spread: 1 * DEG, moveSpread: 2 * DEG, bloom: 0.9 * DEG, bloomMax: 6.5 * DEG, recoil: 2,
    effRange: 7 * U, rangeSpread: 3.5 * DEG, mag: 40, reserve: 160, reload: 1.8, pierce: 0.5, speed: 1050, gunLen: 13, heavy: false, range: 12 * U,
    snd: [0.07, 3000],
  },
  // ---- Fusils à pompe ----
  m870: {
    kind: 'shotgun', cat: 'sg', name: 'Remington 870', maker: 'Remington', caliber: '12/70 chevrotine 00', mode: 'Pompe', rpm: 75, weight: 3.8,
    note: "Pompe classique : dévastateur à courte portée, lent à réarmer et à recharger (cartouche par cartouche).",
    damage: 15, pellets: 9, auto: false, spread: 5.5 * DEG, moveSpread: 3 * DEG, bloom: 3 * DEG, bloomMax: 8 * DEG, recoil: 12,
    effRange: 4 * U, rangeSpread: 2 * DEG, mag: 6, reserve: 30, reloadType: 'shell', reload: 0.55, pierce: 0.2, speed: 900, gunLen: 22, heavy: true, range: 7 * U,
    snd: [0.22, 800],
  },
  m4super90: {
    kind: 'shotgun', cat: 'sg', name: 'Benelli M4 Super 90', maker: 'Benelli', caliber: '12/70 chevrotine 00', mode: 'Semi', rpm: 240, weight: 4.1,
    note: "Semi-automatique : enchaîne les tirs bien plus vite qu'un pompe, au prix d'une gerbe plus large.",
    tint: { semi: true },
    damage: 15, pellets: 9, auto: false, spread: 6.5 * DEG, moveSpread: 3 * DEG, bloom: 4.5 * DEG, bloomMax: 12 * DEG, recoil: 11,
    effRange: 4 * U, rangeSpread: 2 * DEG, mag: 7, reserve: 28, reloadType: 'shell', reload: 0.5, pierce: 0.2, speed: 900, gunLen: 22, heavy: true, range: 7 * U,
    snd: [0.2, 850],
  },
  // ---- Armes de poing ----
  glock17: {
    kind: 'pistol', cat: 'hg', name: 'Glock 17', maker: 'Glock', caliber: '9×19 mm Parabellum', mode: 'Semi', rpm: 360, weight: 0.9,
    note: "Pistolet de service fiable, 17 coups. Plus rapide à manier qu'une arme d'épaule.",
    damage: 22, auto: false, spread: 0.9 * DEG, moveSpread: 3 * DEG, bloom: 2.6 * DEG, bloomMax: 9 * DEG, recoil: 4,
    effRange: 5 * U, rangeSpread: 4 * DEG, mag: 17, reserve: 51, reload: 1.5, pierce: 0.4, speed: 900, gunLen: 10, heavy: false, range: 10 * U,
    snd: [0.07, 2600],
  },
  usp45: {
    kind: 'pistol', cat: 'hg', name: 'HK USP .45', maker: 'Heckler & Koch', caliber: '.45 ACP', mode: 'Semi', rpm: 270, weight: 1.0,
    note: "Balle lourde et lente : plus d'arrêt, moins de coups et un relèvement plus marqué.",
    tint: { slide: '#2c2f34' },
    damage: 30, auto: false, spread: 0.8 * DEG, moveSpread: 3 * DEG, bloom: 3.6 * DEG, bloomMax: 10 * DEG, recoil: 5.5,
    effRange: 5 * U, rangeSpread: 4 * DEG, mag: 12, reserve: 48, reload: 1.6, pierce: 0.3, speed: 800, gunLen: 11, heavy: false, range: 10 * U,
    snd: [0.1, 1900],
  },
  // ---- Armes du groupe armé, utilisables par le joueur (mode siège) ----
  akP: {
    kind: 'ak', cat: 'ar', name: 'AKM', maker: 'Kalachnikov', caliber: '7,62×39 mm', mode: 'Auto', rpm: 600, weight: 4.3,
    note: "Le fusil du groupe : brutal, dur à tenir en rafale, mais il perce le bois et les gilets.",
    damage: 34, auto: true, spread: 1.3 * DEG, moveSpread: 4.5 * DEG, bloom: 2.6 * DEG, bloomMax: 11 * DEG, recoil: 7,
    effRange: 8 * U, rangeSpread: 3.5 * DEG, mag: 30, reserve: 90, reload: 2.8, pierce: 0.6, speed: 950, gunLen: 20, heavy: true, range: 14 * U,
    snd: [0.12, 1700],
  },
  makarovP: {
    kind: 'pistol', cat: 'hg', name: 'Makarov PM', maker: 'Ijmach', caliber: '9×18 mm', mode: 'Semi', rpm: 300, weight: 0.8,
    note: "Huit coups, sans plus. De quoi finir un chargeur vide, pas de quoi tenir un couloir.",
    tint: { slide: '#3a3d42' },
    damage: 20, auto: false, spread: 1.1 * DEG, moveSpread: 3 * DEG, bloom: 3 * DEG, bloomMax: 9 * DEG, recoil: 4,
    effRange: 4 * U, rangeSpread: 4.5 * DEG, mag: 8, reserve: 32, reload: 1.6, pierce: 0.3, speed: 900, gunLen: 10, heavy: false, range: 9 * U,
    snd: [0.07, 2400],
  },
  // ---- Armes de l'équipe d'intervention quand elle donne l'assaut (mode siège) ----
  hk416op: { kind: 'rifle', pickup: 'hk416', name: 'HK416 A5', damage: 26, rof: 12, auto: true, spread: 1.2 * DEG, moveSpread: 3.5 * DEG, bloom: 1.6 * DEG, bloomMax: 8 * DEG, effRange: 9 * U, rangeSpread: 3 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.55, speed: 1150, gunLen: 20, heavy: false, burst: 4, pause: 0.75, range: 15 * U, snd: [0.1, 2200] },
  mp5op:   { kind: 'smg', pickup: 'mp5',   name: 'HK MP5A3', damage: 20, rof: 13, auto: true, spread: 1.4 * DEG, moveSpread: 2 * DEG,   bloom: 1.2 * DEG, bloomMax: 7 * DEG, effRange: 6 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.4,  speed: 900,  gunLen: 16, heavy: false, burst: 4, pause: 0.7,  range: 11 * U, snd: [0.08, 2600] },
  // ---- Armes ennemies (munitions illimitées, tir en rafales) ----
  ak:      { kind: 'ak', pickup: 'akP',      name: 'AKM',        damage: 18, rof: 10,  auto: true,  spread: 4.5 * DEG,   moveSpread: 4 * DEG, bloom: 2 * DEG, bloomMax: 12 * DEG, effRange: 6 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.6, speed: 950, gunLen: 20, heavy: false, burst: 5, pause: 0.9, range: 12 * U, snd: [0.12, 1700] },
  pistolE: { kind: 'pistol', pickup: 'makarovP',  name: 'Makarov PM', damage: 18, rof: 4,   auto: true,  spread: 4 * DEG,   moveSpread: 3 * DEG, bloom: 1.5 * DEG, bloomMax: 9 * DEG, effRange: 4 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.3, speed: 900, gunLen: 10, heavy: false, burst: 2, pause: 0.8, range: 8 * U, snd: [0.07, 2400] },
};
// Cadence de jeu tirée de la cadence réelle ; mobilité tirée de la masse.
for (const w of Object.values(WEAPONS)) {
  if (w.rpm && !w.rof) w.rof = w.rpm / 60;
  w.mobility = w.weight ? clamp(1.06 - 0.035 * w.weight, 0.85, 1.04) : 1;
}

const WEAPON_CATS = { ar: "Fusils d'assaut", smg: 'Pistolets mitrailleurs', sg: 'Fusils à pompe', hg: 'Armes de poing' };
const PRIMARY_WEAPONS = ['hk416', 'scarh', 'mp5', 'mp7', 'm870', 'm4super90'];
const SIDEARMS = ['glock17', 'usp45'];
const DEFAULT_LOADOUT = { primary: 'hk416', sidearm: 'glock17' };

// Deux modes de jeu : l'assaut (on incarne l'opérateur) et le siège (on incarne le groupe armé).
const MODES = {
  assault: { name: 'Assaut', primaries: PRIMARY_WEAPONS, sidearms: SIDEARMS, loadout: DEFAULT_LOADOUT },
  siege:   { name: 'Siège',  primaries: ['akP', 'm870'], sidearms: ['makarovP', 'glock17'], loadout: { primary: 'akP', sidearm: 'makarovP' } },
};

const makeSlot = key => ({ def: WEAPONS[key], mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve });

class Agent {
  constructor(x, y, team) {
    this.x = x; this.y = y; this.team = team;
    this.angle = 0;
    this.radius = 11;
    this.speed = 100;
    this.turnRate = 8;
    this.fov = 120 * DEG;
    this.viewRange = 12 * U;
    this.hp = 100; this.maxHp = 100;
    this.alive = true;
    this.fireT = 0;
    this.bloom = 0;
    this.moving = false;
    this.stun = 0;
    this.path = [];
    this.lookAt = null;
    this.alertAngle = null;
    this.waitDoor = null;
    this.holdT = 0;
    this.target = null;
    this.reactT = 0;
    this.reaction = 0.5;
    this.muzzleT = 0; // flash de bouche récent
    this.kick = 0;    // recul visuel (0..1)
    this.act = null;  // geste à deux mains en cours (porte, grenade) : voir Game.startAction
    this.handBloom = 0; // visée perturbée juste après un geste
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
  get weapon() { return this.slot ? this.slot.def : null; } // un corps peut avoir été délesté de son arme
}

class Player extends Agent {
  constructor(x, y, loadout) {
    super(x, y, 'ops');
    this.name = 'Opérateur';
    this.fov = 120 * DEG;
    this.viewRange = 15 * U;
    this.runSpeed = 118;
    this.walkSpeed = 62;
    this.walkMode = true; // on entre en marche : précis et discret
    this.hp = this.maxHp = 100;
    this.equip(loadout || DEFAULT_LOADOUT);
    this.reloadT = 0;
    this.switchT = 0;
    this.flashbangs = 3;
    this.fiber = null; // fibre optique glissée sous une porte (voir Game.updateFiber)
    this.flashT = 0; // aveuglé (écran blanc)
  }
  get slot() { return this.slots[this.cur]; }
  equip(loadout) {
    this.slots = [makeSlot(loadout.primary), makeSlot(loadout.sidearm)];
    this.cur = 0;
    this.reloadT = 0;
  }
}

// Coéquipier contrôlé par l'IA (voir Game.updateMate).
const TEAMMATE_DEFS = [
  { name: 'Bravo',   accent: '#7fd18a', weapon: 'hk416', slot: [-1.3, -0.85], sector: -100 * DEG, helmet: '#3f5266', vest: '#233140' },
  { name: 'Charlie', accent: '#ffb74d', weapon: 'mp5',   slot: [-1.3, 0.85],  sector: 160 * DEG,  helmet: '#4a5563', vest: '#2a3542' },
];

// Complices du mode siège : mêmes ordres que l'équipe, mais armés et habillés en civils.
const SIEGE_MATE_DEFS = [
  { name: 'Marko', accent: '#e07a5f', weapon: 'akP',      slot: [-1.3, -0.85], sector: -100 * DEG, militant: true, jacket: '#5b4a3a', pants: '#2b2f38' },
  { name: 'Ilya',  accent: '#d9b44a', weapon: 'akP',      slot: [-1.3, 0.85],  sector: 160 * DEG,  militant: true, jacket: '#3d4a3a', pants: '#3a3630' },
  { name: 'Sacha', accent: '#9a8fc7', weapon: 'makarovP', slot: [1.2, -1.1],   sector: 60 * DEG,   militant: true, jacket: '#4a3d4a', pants: '#2f3a33' },
  { name: 'Dimitri', accent: '#6fb3a8', weapon: 'akP',    slot: [1.2, 1.1],    sector: -60 * DEG,  militant: true, jacket: '#575047', pants: '#2b2f38' },
  { name: 'Goran', accent: '#c98bb0', weapon: 'akP',      slot: [-2.4, -0.9],  sector: -140 * DEG, militant: true, jacket: '#3b4553', pants: '#3a3630' },
  { name: 'Lev',   accent: '#b0c46a', weapon: 'akP',      slot: [-2.4, 0.9],   sector: 140 * DEG,  militant: true, jacket: '#5b4a3a', pants: '#2f3a33' },
  { name: 'Petar', accent: '#e0a070', weapon: 'akP',      slot: [0, -1.6],     sector: -90 * DEG,  militant: true, jacket: '#3d4a3a', pants: '#2b2f38' },
  { name: 'Yuri',  accent: '#8fb0e0', weapon: 'makarovP', slot: [0, 1.6],      sector: 90 * DEG,   militant: true, jacket: '#4a3d4a', pants: '#3a3630' },
];

class Teammate extends Agent {
  constructor(x, y, def) {
    super(x, y, 'ops');
    this.name = def.name;
    this.accent = def.accent;
    this.style = def.militant
      ? { ...STYLE_MILITANT, body: def.jacket, shoulder: def.jacket, sleeve: def.jacket, pants: def.pants }
      : { ...STYLE_PLAYER, helmet: def.helmet, vest: def.vest };
    this.slot = { ...makeSlot(def.weapon), reserve: Infinity };
    this.fov = 130 * DEG;
    this.viewRange = 13 * U;
    this.reaction = 0.4;
    this.turnRate = 7;
    this.speed = 118;
    this.hp = this.maxHp = 100;
    this.spreadMul = 1.35;   // un peu moins précis que le joueur
    this.order = 'follow';   // follow | hold | move
    this.orderPos = null;
    this.slotOffset = def.slot; // position en formation (tuiles, repère du joueur)
    this.sector = def.sector;   // direction couverte au repos (relative au joueur)
    this.holdAngle = null;
    this.coverAngle = null;  // direction imposée par le joueur (clic droit maintenu puis tiré)
    this.blockedT = 0;       // temps passé avec un allié ou un otage dans l'axe de tir
    this.blockedLine = false;
    this.repathT = 0;
    this.reloadT = 0;
    this.burst = 0;
    this.engaged = false;
    this.visible = true;
    this.destTile = null;
  }
}

class Enemy extends Agent {
  constructor(x, y, angle, weaponKey) {
    super(x, y, 'enemy');
    this.angle = angle === null || angle === undefined ? rand(0, TAU) : angle;
    this.homeAngle = this.angle;
    const def = WEAPONS[weaponKey === 'pistol' ? 'pistolE' : weaponKey] || WEAPONS.ak;
    this.slot = { def, mag: Infinity, reserve: 0 };
    this.fov = 100 * DEG;
    this.viewRange = 12 * U;
    this.reaction = 0.5;
    this.turnRate = 5;
    this.speed = 95;
    this.hp = this.maxHp = 70;
    this.state = 'idle'; // idle | engage | investigate
    this.idleT = rand(1, 4);
    this.lostT = 0;
    this.searchT = 0;
    this.noiseT = 0;
    this.repathT = 0;
    this.burstLeft = def.burst;
    this.pauseT = 0;
    this.lastKnown = null;
    this.visible = false;
    this.engaged = false;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    this.look = {
      hair: pick(['#2a1e14', '#151210', '#4a3420', '#6b4b2a']),
      jacket: pick(['#5b4a3a', '#3d4a3a', '#4a3d4a', '#575047', '#3b4553']),
      pants: pick(['#2b2f38', '#3a3630', '#2f3a33']),
      head: pick(['hair', 'hair', 'cap', 'mask']),
      skin: pick(['#d2a583', '#c4906a', '#a9714f']),
    };
  }
}

// Opérateur d'intervention pendant un siège : même moteur que les suspects (Game.updateAssault
// pilote sa progression), mais plus résistant, plus réactif et bien plus précis.
class Operator extends Enemy {
  constructor(x, y, angle, weaponKey) {
    super(x, y, angle, weaponKey);
    this.name = 'Opérateur';
    this.hp = this.maxHp = 110; // gilet
    this.fov = 110 * DEG;
    this.viewRange = 14 * U;
    this.reaction = 0.35;
    this.turnRate = 7;
    this.speed = 108;
    this.style = { ...STYLE_PLAYER };
    this.flashbangs = 2; // ils dégoupillent avant d'entrer dans une pièce tenue
    this.flashCd = rand(4, 10);
  }
}

class Hostage {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.found = false;   // repéré par l'intervention (mode siège)
    this.secured = false; // récupéré : autant de perdu pour le preneur d'otages
    this.secureT = 0;
    this.radius = 7;        // à genoux, tête baissée : une petite cible
    this.wounded = false;   // une première blessure légère ne tue pas (voir Game.damage)
    this.alive = true;
    this.visible = false;
    this.angle = rand(0, TAU);
    this.team = 'civ';
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
}
