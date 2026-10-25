'use strict';
// Banc d'équilibrage : des parties simulées, sans dessin, à la vitesse du processeur, et leur bilan. Le joueur n'y prend
// pas part (il reste hors jeu, comme le commandant de la stratégie) : on mesure ce que fait l'IA seule.
//
//   tests/sim.html?scenario=squads&n=12           trinômes, deux contre deux (vos deux trinômes : le second et le vôtre
//                                                 sans vous, laissés à eux-mêmes)
//   tests/sim.html?scenario=duel&camp=armed       un trinôme contre un, le vôtre du côté du groupe armé
//   tests/sim.html?scenario=war&n=6&time=300      guerre totale : trois trinômes autonomes par armée
//   tests/sim.html?scenario=defense               stratégie : assaut, vos trois trinômes ratissant seuls
//   tests/sim.html?scenario=siege                 siège : vos complices tiennent seuls face aux vagues
// Autres paramètres : level (numéro de carte dans la liste du mode, ou all : chacune à tour de rôle), time (durée maximale
// d'une partie, en secondes), camp (police | armed : le camp de « votre » côté), army (war et defense : la sorte de vos
// trois groupes, séparées par des virgules, voir GROUP_TYPES ; une seule vaut pour les trois) et sup=1 (en mode
// silencieux). Sans interface : bash tests/run.sh --sim 'scenario=war&n=6&army=assault,normal,precision'. Le titre de la
// page passe à DONE à la fin ; le rapport est dans #report.

const Q = new URLSearchParams(location.search);
const SC = Q.get('scenario') || 'squads', CAMP = Q.get('camp') || 'police';
const N = Math.max(1, +(Q.get('n') || 8)), CAP = +(Q.get('time') || (SC === 'war' ? WAR_TIME : 240));
const MODE = {
  squads: CAMP === 'armed' ? 'squadsArmed' : 'squads', duel: CAMP === 'armed' ? 'squadsArmed' : 'squads',
  war: CAMP === 'armed' ? 'strategyArmed' : 'strategy', defense: 'strategyAssault', siege: 'siege',
}[SC];
if (!MODE) throw new Error('scénario inconnu : ' + SC);
const LIST = MODES[MODE].levels, LEVEL = Q.get('level') || 'all';
const ARMY = (Q.get('army') || 'normal').split(','), SUP = Q.get('sup') === '1';
const $ = id => document.getElementById(id);

// Une partie prête : le joueur hors jeu, chacun laissé à lui-même.
function setup(level) {
  const game = new Game();
  game.mode = MODE;
  const army = [0, 1, 2].map(k => ({ type: ARMY[k] || ARMY[0], sup: SUP }));
  game.loadout = Game.normLoadout({ ...MODES[MODE].loadout, army }, MODES[MODE]);
  Object.assign(game, { entryRandom: true, saveRecords: false });
  game.loadLevel(level);
  game.paused = false;
  const p = game.player;
  Object.assign(p, { alive: false, commander: true });
  if (SC === 'squads' || SC === 'duel') {
    game.mates = game.mates.filter(m => m.hunter); // (votre trinôme : vous et vos coéquipiers, hors jeu)
    if (SC === 'duel') {
      const keep = game.enemies[0].group;
      game.enemies = keep.members;
      game.squads.groups = game.squads.groups.filter(g => g.team === 'ops' || g === keep);
    }
  } else if (game.strat) {
    for (const g of game.war.slots.ops) if (g) Object.assign(g, { order: null, queue: [] }); // ils ratissent seuls
    // (un trinôme qui revient de la base reçoit lui aussi l'ordre de ratisser)
    const warSquad = game.warSquad.bind(game);
    game.warSquad = (team, k) => { const g = warSquad(team, k); if (team === 'ops') Object.assign(g, { order: null, queue: [] }); return g; };
  }
  return game;
}

// Le bilan d'une partie finie (ou arrêtée au bout de CAP s).
function tally(game, level) {
  const ops = game.ops.filter(o => o !== game.player), dead = a => a.filter(o => !o.alive).length;
  const r = { level: LIST[level].name, result: game.over || 'temps', time: game.time, opsDead: dead(ops), enemyDead: dead(game.enemies), opsTotal: ops.length, enemyTotal: game.enemies.length };
  if (game.war) Object.assign(r, { killsOps: game.war.kills.ops, killsEnemy: game.war.kills.enemy });
  if (game.siege) Object.assign(r, { evacuated: game.hostages.filter(h => h.evacuated).length, hostagesDead: game.hostages.filter(h => !h.alive).length });
  return r;
}

const runs = [];
let cur = null, k = 0;
function next() {
  if (!cur) {
    if (k >= N) return finish();
    const level = LEVEL === 'all' ? k % LIST.length : clamp(+LEVEL, 0, LIST.length - 1);
    cur = { game: setup(level), level };
  }
  const g = cur.game;
  for (let i = 0; i < 600 && !g.over && g.time < CAP; i++) g.update(1 / 60);
  if (g.over || g.time >= CAP) {
    const r = tally(g, cur.level);
    runs.push(r);
    cur = null; k++;
    $('progress').textContent = `${k} / ${N} parties`;
  }
  setTimeout(next, 0);
}

const mean = (a, f) => (a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0);
function finish() {
  const n = runs.length, count = v => runs.filter(r => r.result === v).length;
  const lines = [
    `Banc d'équilibrage — scénario ${SC} (${MODES[MODE].name}, votre côté : ${MODES[MODE].camp === 'armed' ? 'groupe armé' : 'intervention'}${MODES[MODE].strategy ? `, groupes : ${ARMY.join(', ')}${SUP ? ' silencieux' : ''}` : ''}), ${n} parties, ${CAP} s au plus`,
    `Victoires de votre côté : ${count('win')} · défaites : ${count('lose')} · égalités : ${count('draw')} · arrêtées au temps : ${count('temps')}`,
    `Durée moyenne : ${mean(runs, r => r.time).toFixed(1)} s · morts de votre côté : ${mean(runs, r => r.opsDead).toFixed(1)} / ${mean(runs, r => r.opsTotal).toFixed(1)} · en face : ${mean(runs, r => r.enemyDead).toFixed(1)} / ${mean(runs, r => r.enemyTotal).toFixed(1)}`,
  ];
  if (runs[0] && runs[0].killsOps !== undefined) lines.push(`Score moyen des armées : ${mean(runs, r => r.killsOps).toFixed(1)} – ${mean(runs, r => r.killsEnemy).toFixed(1)}`);
  if (runs[0] && runs[0].evacuated !== undefined) lines.push(`Otages évacués par l'intervention : ${mean(runs, r => r.evacuated).toFixed(1)} · tués : ${mean(runs, r => r.hostagesDead).toFixed(1)}`);
  lines.push('', 'carte                    résultat  durée  morts (vous / en face)');
  for (const r of runs) lines.push(`${r.level.padEnd(24)} ${String(r.result).padEnd(8)} ${r.time.toFixed(0).padStart(5)} s  ${String(r.opsDead).padStart(5)} / ${r.enemyDead}`);
  lines.push('', JSON.stringify({ scenario: SC, mode: MODE, runs }));
  $('report').textContent = lines.join('\n');
  document.title = 'DONE';
}
setTimeout(next, 0);
