'use strict';

// spread en radians (demi-angle), speed en px/s, gunLen en px (longueur visible du canon).
// bloom : dispersion ajoutée à chaque tir (plafonnée à bloomMax), recoil : recul visuel (px caméra)
// effRange : portée efficace ; au-delà, rangeSpread s'ajoute progressivement (tenue de visée)
// Armes réelles : calibre, cadence (coups/min), capacité et masse (kg, chargée) reprennent les données constructeur ;
// les dégâts suivent le calibre, la mobilité découle de la masse.
// kind : dessin (Sprites.gun), tint : variante de couleurs, snd : [durée, coupure] du son de tir.
// reloadType 'shell' : chargement cartouche par cartouche (reload = durée par cartouche), interrompu par un tir.
// pierce : part des dégâts conservée après avoir traversé une porte (les murs, eux, arrêtent tout).
// pen : classe de perforation face à un bouclier (1 : arme de poing, PM en 9 mm, chevrotine ; 2 : munition de
// poing rapide, 4,6 × 30 et 7,62 × 25 ; 3 : balle de fusil). Déduite de kind, sauf exception (voir SHIELDS).
// AK-74 : bois plus sombre, chargeur orangé, long frein de bouche (le même pour le joueur et les suspects).
const AK74_TINT = { wood: '#5a3519', fore: '#64391b', mag: '#8a4524', brake74: true };
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
    effRange: 7 * U, rangeSpread: 3.5 * DEG, mag: 40, reserve: 160, reload: 1.8, pierce: 0.5, pen: 2, speed: 1050, gunLen: 13, heavy: false, range: 12 * U,
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
  ak74P: {
    kind: 'ak', cat: 'ar', name: 'AK-74', maker: 'Kalachnikov', caliber: '5,45×39 mm', mode: 'Auto', rpm: 650, weight: 3.6,
    note: "Le petit calibre de la famille : moins d'arrêt que l'AKM, mais une balle tendue et un frein de bouche qui tient la rafale.",
    tint: AK74_TINT,
    damage: 28, auto: true, spread: 1 * DEG, moveSpread: 4 * DEG, bloom: 1.8 * DEG, bloomMax: 9 * DEG, recoil: 5,
    effRange: 9 * U, rangeSpread: 3 * DEG, mag: 30, reserve: 90, reload: 2.7, pierce: 0.55, speed: 1100, gunLen: 20, heavy: false, range: 15 * U,
    snd: [0.1, 2000],
  },
  makarovP: {
    kind: 'pistol', cat: 'hg', name: 'Makarov PM', maker: 'Ijmach', caliber: '9×18 mm', mode: 'Semi', rpm: 300, weight: 0.8,
    note: "Huit coups, sans plus. De quoi finir un chargeur vide, pas de quoi tenir un couloir.",
    tint: { slide: '#3a3d42' },
    damage: 20, auto: false, spread: 1.1 * DEG, moveSpread: 3 * DEG, bloom: 3 * DEG, bloomMax: 9 * DEG, recoil: 4,
    effRange: 4 * U, rangeSpread: 4.5 * DEG, mag: 8, reserve: 32, reload: 1.6, pierce: 0.3, speed: 900, gunLen: 10, heavy: false, range: 9 * U,
    snd: [0.07, 2400],
  },
  uziP: {
    kind: 'smg', cat: 'smg', name: 'IMI Uzi', maker: 'Israel Military Industries', caliber: '9×19 mm Parabellum', mode: 'Auto', rpm: 600, weight: 3.7,
    note: "Trapue, increvable, increvablement bruyante. Le chargeur dans la crosse tient 32 coups.",
    tint: { body: '#2b2d31', dark: '#1e2024' },
    damage: 21, auto: true, spread: 1.6 * DEG, moveSpread: 2.6 * DEG, bloom: 1.6 * DEG, bloomMax: 8 * DEG, recoil: 3,
    effRange: 5 * U, rangeSpread: 4.5 * DEG, mag: 32, reserve: 96, reload: 2.1, pierce: 0.35, speed: 880, gunLen: 13, heavy: false, range: 10 * U,
    snd: [0.08, 2300],
  },
  skorpionP: {
    kind: 'pdw', cat: 'smg', name: 'Škorpion vz. 61', maker: 'Zbrojovka Brno', caliber: '7,65×17 mm (.32 ACP)', mode: 'Auto', rpm: 850, weight: 1.6,
    note: "Pistolet mitrailleur de poche : très maniable et très rapide, mais une munition faible.",
    tint: { body: '#3a3a3e', dark: '#26262a' },
    damage: 14, auto: true, spread: 2.2 * DEG, moveSpread: 2.2 * DEG, bloom: 1.5 * DEG, bloomMax: 9 * DEG, recoil: 2,
    effRange: 4 * U, rangeSpread: 5 * DEG, mag: 20, reserve: 80, reload: 1.7, pierce: 0.25, speed: 820, gunLen: 9, heavy: false, range: 8 * U,
    snd: [0.06, 2900],
  },
  tt33: {
    kind: 'pistol', cat: 'hg', name: 'Tokarev TT-33', maker: 'Toula', caliber: '7,62×25 mm', mode: 'Semi', rpm: 300, weight: 0.9,
    note: "Munition très rapide : elle perce le bois et les gilets là où un 9 mm s'arrête. Huit coups.",
    tint: { slide: '#4a4136' },
    damage: 26, auto: false, spread: 1 * DEG, moveSpread: 3 * DEG, bloom: 3.2 * DEG, bloomMax: 9 * DEG, recoil: 4.5,
    effRange: 5 * U, rangeSpread: 4 * DEG, mag: 8, reserve: 32, reload: 1.6, pierce: 0.55, pen: 2, speed: 1100, gunLen: 11, heavy: false, range: 11 * U,
    snd: [0.08, 2200],
  },
  sgE:     { kind: 'shotgun', pickup: 'm870', name: 'Remington 870 scié', damage: 11, pellets: 7, rof: 0.9, auto: false, spread: 7 * DEG, moveSpread: 4 * DEG, bloom: 3 * DEG, bloomMax: 10 * DEG, effRange: 3 * U, rangeSpread: 3 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.2, speed: 850, gunLen: 16, heavy: true, burst: 1, pause: 1.3, range: 6 * U, snd: [0.22, 800] },
  uziE:    { kind: 'smg', pickup: 'uziP', name: 'IMI Uzi', damage: 15, rof: 10, auto: true, spread: 5 * DEG, moveSpread: 4 * DEG, bloom: 2.2 * DEG, bloomMax: 12 * DEG, effRange: 4 * U, rangeSpread: 5 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.35, speed: 880, gunLen: 13, heavy: false, burst: 6, pause: 1, range: 9 * U, snd: [0.08, 2300] },
  // ---- Armes de l'équipe d'intervention quand elle donne l'assaut (mode siège) ----
  hk416op: { kind: 'rifle', pickup: 'hk416', name: 'HK416 A5', damage: 26, rof: 12, auto: true, spread: 1.2 * DEG, moveSpread: 3.5 * DEG, bloom: 1.6 * DEG, bloomMax: 8 * DEG, effRange: 9 * U, rangeSpread: 3 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.55, speed: 1150, gunLen: 20, heavy: false, burst: 4, pause: 0.75, range: 15 * U, snd: [0.1, 2200] },
  mp5op:   { kind: 'smg', pickup: 'mp5',   name: 'HK MP5A3', damage: 20, rof: 13, auto: true, spread: 1.4 * DEG, moveSpread: 2 * DEG,   bloom: 1.2 * DEG, bloomMax: 7 * DEG, effRange: 6 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.4,  speed: 900,  gunLen: 16, heavy: false, burst: 4, pause: 0.7,  range: 11 * U, snd: [0.08, 2600] },
  // ---- Armes ennemies (munitions illimitées, tir en rafales) ----
  ak:      { kind: 'ak', pickup: 'akP',      name: 'AKM',        damage: 18, rof: 10,  auto: true,  spread: 4.5 * DEG,   moveSpread: 4 * DEG, bloom: 2 * DEG, bloomMax: 12 * DEG, effRange: 6 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.6, speed: 950, gunLen: 20, heavy: false, burst: 5, pause: 0.9, range: 12 * U, snd: [0.12, 1700] },
  ak74E:   { kind: 'ak', pickup: 'ak74P',    name: 'AK-74',      damage: 15, auto: true, tint: AK74_TINT, rof: 10.8, spread: 3.8 * DEG, moveSpread: 4 * DEG, bloom: 1.6 * DEG, bloomMax: 10 * DEG, effRange: 7 * U, rangeSpread: 3.5 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.55, speed: 1100, gunLen: 20, heavy: false, burst: 6, pause: 0.9, range: 13 * U, snd: [0.1, 2000] },
  pistolE: { kind: 'pistol', pickup: 'makarovP',  name: 'Makarov PM', damage: 18, rof: 4,   auto: true,  spread: 4 * DEG,   moveSpread: 3 * DEG, bloom: 1.5 * DEG, bloomMax: 9 * DEG, effRange: 4 * U, rangeSpread: 4 * DEG, mag: Infinity, reserve: 0, reload: 0, pierce: 0.3, speed: 900, gunLen: 10, heavy: false, burst: 2, pause: 0.8, range: 8 * U, snd: [0.07, 2400] },
};
// Mobilité (multiplicateur de vitesse) tirée de la masse.
const mobilityOf = weight => (weight ? clamp(1.06 - 0.035 * weight, 0.85, 1.04) : 1);
// Cadence de jeu tirée de la cadence réelle ; mobilité tirée de la masse ; portée du coup de feu (en
// cases, en plein air) selon l'arme : les murs et les portes l'atténuent (voir Game.soundField).
for (const w of Object.values(WEAPONS)) {
  if (w.rpm && !w.rof) w.rof = w.rpm / 60;
  w.mobility = mobilityOf(w.weight);
  if (w.noise === undefined) w.noise = w.kind === 'shotgun' || w.heavy ? 18 : w.kind === 'pistol' ? 13 : w.kind === 'smg' || w.kind === 'pdw' ? 14 : 16;
  if (w.pen === undefined) w.pen = w.kind === 'rifle' || w.kind === 'ak' ? 3 : 1;
}

// Accessoires, choisis arme par arme au briefing. Silencieux : portée du coup de feu (cases), masse (kg)
// et longueur (px) ajoutées. Il freine les gaz, pas la balle : sa vitesse ne bouge pas. Le 5,56, le 7,62 et
// le 4,6 restent donc supersoniques, sans rien perdre, mais le claquement de la balle s'entend encore à quelques
// cases. Pour qu'un 9 mm se taise, il faut une munition subsonique (subsonic: 'load', 147 gr à 300 m/s au lieu
// de 124 gr à 360 m/s) : plus lente, elle frappe un peu moins fort et porte moins loin (SUBSONIC). Le .45 ACP
// est subsonique d'origine (subsonic: 'native') : il se tait sans rien perdre. Pas de silencieux sur un fusil à pompe.
const SUPPRESSORS = {
  hk416:   { noise: 4,   weight: 0.5,  len: 6 },
  scarh:   { noise: 5,   weight: 0.6,  len: 6 },
  mp5:     { noise: 2.5, weight: 0.45, len: 6, subsonic: 'load' },
  mp7:     { noise: 3,   weight: 0.35, len: 5 },
  glock17: { noise: 2.5, weight: 0.2,  len: 5, subsonic: 'load' },
  usp45:   { noise: 2,   weight: 0.25, len: 5, subsonic: 'native' },
};
// Munition subsonique : multiplicateurs des dégâts, de la portée efficace, de la portée et de la vitesse de la balle.
const SUBSONIC = { damage: 0.9, effRange: 0.85, range: 0.9, speed: 0.85 };
// Module laser (masse en kg) : il lui faut un rail, que n'ont ni l'AKM, ni l'AK-74, ni l'Uzi, ni le Škorpion, ni le
// Makarov, ni le Tokarev. Le point montre où part la balle sans épauler : la dispersion due au déplacement
// est multipliée par LASER_MOVE, et la gêne de la tenue d'une main derrière un bouclier réduite de moitié.
// Mais un faisceau se voit : un suspect qui l'aperçoit se tourne vers sa source (voir Game.spotLaser).
const LASERS = { hk416: 0.2, scarh: 0.2, mp5: 0.2, mp7: 0.15, m870: 0.2, m4super90: 0.2, glock17: 0.1, usp45: 0.1 };
const LASER_MOVE = 0.5;
const FITTED = {};
// L'arme équipée de ses accessoires (acc : { sup, laser }) ; ceux qu'elle n'accepte pas sont ignorés.
// Chaque combinaison n'est calculée qu'une fois.
function fittedDef(key, acc) {
  const w = WEAPONS[key], s = SUPPRESSORS[key];
  const sup = !!(acc && acc.sup && s), laser = !!(acc && acc.laser && LASERS[key]);
  if (!sup && !laser) return w;
  const id = key + (sup ? '+sup' : '') + (laser ? '+laser' : '');
  if (FITTED[id]) return FITTED[id];
  const d = { ...w, tint: { ...(w.tint || {}) } };
  if (sup) {
    Object.assign(d, {
      suppressed: true, noise: s.noise, weight: d.weight + s.weight, gunLen: w.gunLen + s.len,
      snd: [w.snd[0] * 0.6, Math.min(900, w.snd[1] * 0.45)],
    });
    if (s.subsonic === 'load') {
      Object.assign(d, {
        damage: Math.round(w.damage * SUBSONIC.damage), effRange: w.effRange * SUBSONIC.effRange,
        range: w.range * SUBSONIC.range, speed: w.speed * SUBSONIC.speed,
      });
    }
    d.tint.sup = s.len;
  }
  if (laser) { d.laser = true; d.weight += LASERS[key]; d.tint.laser = true; }
  d.mobility = mobilityOf(d.weight);
  return (FITTED[id] = d);
}
// Version silencieuse d'une arme (la même si elle n'en accepte pas).
const suppressedDef = key => fittedDef(key, { sup: true });
// Accessoires choisis pour une arme dans un équipement.
const accOf = (loadout, key) => (loadout && loadout.acc && loadout.acc[key]) || {};

// Boucliers balistiques portables, tenus au bras gauche : il ne reste que l'arme de poing, tenue d'une main
// par-dessus le bord. Ils couvrent ±arc devant le porteur, jusqu'à SHIELD_REACH de son centre. stops :
// classe de perforation arrêtée (pen des armes) ; au-delà, la balle traverse et le porteur encaisse through
// de ses dégâts. Le poids coûte de la vitesse (mobility), la tenue d'une main de la précision (aim,
// multiplicateur de dispersion), la lucarne du champ de vision (fov). Formats et masses de boucliers de
// colonne courants, niveau NIJ IIIA (armes de poing) et NIJ III (fusils).
const SHIELD_REACH = 14;
const SHIELDS = {
  shieldL: {
    cat: 'sh', name: 'Bouclier léger', rating: 'NIJ IIIA', size: '50 × 90 cm', weight: 7.3,
    note: "Arrête les balles d'arme de poing et de pistolet mitrailleur, et la chevrotine — pas celles d'un fusil d'assaut. Assez léger pour avancer presque à l'allure normale.",
    stops: 1, through: 0.75, arc: 60 * DEG, mobility: 0.88, aim: 1.35, fov: 110 * DEG, look: { r: 17, span: 55 * DEG, thick: 3.6, color: '#545c66' },
  },
  shieldH: {
    cat: 'sh', name: 'Bouclier lourd', rating: 'NIJ III', size: '55 × 95 cm', weight: 14,
    note: "Renforcé de céramique : il arrête aussi les balles de fusil, 5,56 et 7,62 compris. Mais il pèse le double : on avance lentement, et sa lucarne étroite rétrécit le champ de vision.",
    stops: 3, through: 0.75, arc: 66 * DEG, mobility: 0.74, aim: 1.5, fov: 95 * DEG, look: { r: 18, span: 60 * DEG, thick: 5, color: '#5b6150' },
  },
};
// Chargeurs d'arme de poing en plus pour le porteur de bouclier : c'est sa seule arme.
const SHIELD_EXTRA_MAGS = 2;

const WEAPON_CATS = { ar: "Fusils d'assaut", smg: 'Pistolets mitrailleurs', sg: 'Fusils à pompe', sh: 'Boucliers (avec arme de poing)', hg: 'Armes de poing' };
const PRIMARY_WEAPONS = ['hk416', 'scarh', 'mp5', 'mp7', 'm870', 'm4super90'];
const SIDEARMS = ['glock17', 'usp45'];
// shield : bouclier pris à la place de l'arme principale (null : aucun) ; acc : accessoires de chaque arme
// ({ hk416: { sup, laser } }) ; teamSup : silencieux pour les coéquipiers (assaut).
const DEFAULT_LOADOUT = { primary: 'hk416', sidearm: 'glock17', shield: null, acc: {}, teamSup: false };

// Deux modes de jeu : l'assaut (on incarne l'opérateur) et le siège (on incarne le groupe armé).
const MODES = {
  assault: { name: 'Assaut', primaries: PRIMARY_WEAPONS, sidearms: SIDEARMS, shields: Object.keys(SHIELDS), loadout: DEFAULT_LOADOUT },
  siege:   { name: 'Siège',  primaries: ['akP', 'ak74P', 'uziP', 'skorpionP', 'm870'], sidearms: ['makarovP', 'tt33', 'glock17'], shields: [], loadout: { ...DEFAULT_LOADOUT, primary: 'akP', sidearm: 'makarovP' } },
};

// acc : accessoires ({ sup, laser }), ou true pour un simple silencieux
const makeSlot = (key, acc) => {
  const def = fittedDef(key, acc === true ? { sup: true } : acc);
  return { def, mag: def.mag, reserve: def.reserve };
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
    this.laserOn = true; // L éteint ou rallume le laser de l'arme qui en porte un
  }
  get slot() { return this.slots[this.cur]; }
  // Avec un bouclier, l'arme de poing est la seule arme, avec des chargeurs en plus.
  equip(loadout) {
    this.shield = SHIELDS[loadout.shield] || null;
    const side = makeSlot(loadout.sidearm, accOf(loadout, loadout.sidearm));
    if (this.shield) side.reserve += side.def.mag * SHIELD_EXTRA_MAGS;
    this.slots = this.shield ? [side] : [makeSlot(loadout.primary, accOf(loadout, loadout.primary)), side];
    this.fov = this.shield ? this.shield.fov : 120 * DEG;
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

// Chacun son arme : on tire au sort dans le lot de son camp plutôt que d'armer tout le monde pareil.
const MATE_POOL = ['hk416', 'scarh', 'mp5', 'mp7', 'm870', 'm4super90'];
const SIEGE_MATE_POOL = ['akP', 'akP', 'ak74P', 'uziP', 'skorpionP', 'makarovP', 'tt33', 'm870'];
const OPERATOR_POOL = ['hk416op', 'mp5op'];
// Tirage sans doublon tant que le lot n'est pas épuisé.
function dealWeapons(pool, n) {
  const left = pool.slice(), out = [];
  for (let i = 0; i < n; i++) {
    if (!left.length) left.push(...pool);
    out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
  }
  return out;
}

class Teammate extends Agent {
  constructor(x, y, def) {
    super(x, y, 'ops');
    this.name = def.name;
    this.accent = def.accent;
    this.style = def.militant
      ? { ...STYLE_MILITANT, body: def.jacket, shoulder: def.jacket, sleeve: def.jacket, pants: def.pants }
      : { ...STYLE_PLAYER, helmet: def.helmet, vest: def.vest };
    this.slot = { ...makeSlot(def.weapon, def.sup), reserve: Infinity };
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
    this.state = 'idle'; // idle | engage | investigate | return (retour au poste après une recherche)
    this.home = { x, y }; // son poste : il y retourne après être allé voir un bruit
    this.suspicion = 0;   // bruits entendus récemment, qui s'additionnent et s'estompent (Game.hearNoise)
    this.heardT = -9;     // instant du dernier bruit entendu
    this.shoutT = -9;     // dernier cri d'alerte
    this.idleT = rand(1, 4);
    this.lostT = 0;
    this.searchT = 0;
    this.noiseT = 0;
    this.repathT = 0;
    this.burstLeft = def.burst;
    this.pauseT = 0;
    this.lastKnown = null;
    this.blind = null;    // tir dans une porte : { x, y, t, off } (voir Game.startBlindFire)
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

// Otage : à genoux là où on l'a posé, jusqu'à ce que l'intervention le prenne en charge. Il se relève
// alors et suit son escorte, puis sort du bâtiment par une ouverture (voir Game.updateHostages).
class Hostage {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.found = false;     // repéré par l'intervention (mode siège)
    this.escort = null;     // celui qu'il suit, debout ; null : à genoux, il attend
    this.escortSince = 0;   // instant de la prise en charge : son rang dans la file derrière l'escorte
    this.exiting = null;    // en train de sortir par une ouverture
    this.evacuated = false; // sorti : sauvé pour l'intervention, perdu pour le preneur d'otages
    this.duckT = 0;         // se jette à genoux quand on tire près de lui
    this.wounded = false;   // une première blessure légère ne tue pas (voir Game.damage)
    this.alive = true;
    this.visible = false;
    this.angle = rand(0, TAU);
    this.team = 'civ';
    this.path = [];
    this.repathT = 0;
    this.blockedT = 0;      // sans chemin jusqu'à son escorte (une porte fermée les sépare)
    this.moving = false;
    this.walk = 0;
  }
  get standing() { return !!this.exiting || (!!this.escort && this.duckT <= 0); }
  // à genoux, tête baissée : une petite cible ; debout, il en offre davantage
  get radius() { return this.standing ? 9 : 7; }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }
}
