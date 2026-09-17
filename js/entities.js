'use strict';

// spread en radians (demi-angle), speed en px/s, gunLen en px (longueur visible du canon).
const WEAPONS = {
  // bloom : dispersion ajoutée à chaque tir (plafonnée à bloomMax), recoil : recul visuel (px caméra)
  // effRange : portée efficace ; au-delà, rangeSpread s'ajoute progressivement (tenue de visée)
  rifle:   { kind: 'rifle',   name: "Fusil d'assaut", damage: 30, rof: 11.5, auto: true,  spread: 0.7 * DEG, moveSpread: 3.5 * DEG, bloom: 1.5 * DEG, bloomMax: 9 * DEG,  recoil: 4,  effRange: 9 * U, rangeSpread: 3 * DEG, mag: 30, reserve: 120, reload: 1.9, speed: 1100, gunLen: 20, heavy: false, range: 16 * U },
  shotgun: { kind: 'shotgun', name: 'Fusil à pompe',  damage: 16, rof: 1.3,  auto: false, spread: 6 * DEG,   moveSpread: 3 * DEG,   bloom: 4 * DEG,   bloomMax: 10 * DEG, recoil: 12, effRange: 4 * U, rangeSpread: 2 * DEG, mag: 6,  reserve: 30,  reload: 2.4, speed: 900,  gunLen: 22, heavy: true,  pellets: 8, range: 7 * U },
  pistol:  { kind: 'pistol',  name: 'Pistolet',       damage: 24, rof: 6,    auto: false, spread: 0.9 * DEG, moveSpread: 3 * DEG,   bloom: 2.8 * DEG, bloomMax: 9 * DEG,  recoil: 4,  effRange: 5 * U, rangeSpread: 4 * DEG, mag: 15, reserve: 60,  reload: 1.3, speed: 950,  gunLen: 10, heavy: false, range: 10 * U },
  // Armes ennemies (munitions illimitées, tir en rafales)
  ak:      { kind: 'ak',      name: 'AK',             damage: 18, rof: 10,  auto: true,  spread: 4.5 * DEG,   moveSpread: 4 * DEG, bloom: 2 * DEG, bloomMax: 12 * DEG, effRange: 6 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, speed: 950, gunLen: 20, heavy: false, burst: 5, pause: 0.9, range: 12 * U },
  pistolE: { kind: 'pistol',  name: 'Pistolet',       damage: 18, rof: 4,   auto: true,  spread: 4 * DEG,   moveSpread: 3 * DEG, bloom: 1.5 * DEG, bloomMax: 9 * DEG, effRange: 4 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, speed: 900, gunLen: 10, heavy: false, burst: 2, pause: 0.8, range: 8 * U },
};

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
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
  get weapon() { return this.slot.def; }
}

class Player extends Agent {
  constructor(x, y) {
    super(x, y, 'ops');
    this.name = 'Opérateur';
    this.fov = 120 * DEG;
    this.viewRange = 15 * U;
    this.runSpeed = 118;
    this.walkSpeed = 62;
    this.walkMode = false;
    this.hp = this.maxHp = 100;
    this.slots = [
      { def: WEAPONS.rifle, mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve },
      { def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
    ];
    this.cur = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.flashbangs = 3;
    this.flashT = 0; // aveuglé (écran blanc)
  }
  get slot() { return this.slots[this.cur]; }
}

// Coéquipier contrôlé par l'IA (voir Game.updateMate).
const TEAMMATE_DEFS = [
  { name: 'Bravo',   accent: '#7fd18a', slot: [-1.3, -0.85], sector: -100 * DEG, helmet: '#3f5266', vest: '#233140' },
  { name: 'Charlie', accent: '#ffb74d', slot: [-1.3, 0.85],  sector: 160 * DEG,  helmet: '#4a5563', vest: '#2a3542' },
];

class Teammate extends Agent {
  constructor(x, y, def) {
    super(x, y, 'ops');
    this.name = def.name;
    this.accent = def.accent;
    this.style = { ...STYLE_PLAYER, helmet: def.helmet, vest: def.vest };
    this.slot = { def: WEAPONS.rifle, mag: WEAPONS.rifle.mag, reserve: Infinity };
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

class Hostage {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 10;
    this.alive = true;
    this.visible = false;
    this.angle = rand(0, TAU);
    this.team = 'civ';
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
}
