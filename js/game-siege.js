'use strict';
// Game : le mode siège (préparation, vagues de l'intervention, otages repérés).

// Mode siège : effectif de chaque vague d'assaut, dans l'ordre d'entrée.
const SIEGE_WAVES = [3, 3, 3];

// Mode siège : durée pendant laquelle la minimap signale la pièce où une vague vient d'entrer.
const ARRIVAL_ALERT = 8;

mixGame(class {
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

  // Une vague entre par une ouverture, différente de la précédente quand c'est possible :
  // on ne doit jamais être sûr du côté par lequel ils arrivent.
  spawnAssault(n) {
    const s = this.siege, kit = this.squadKit('police', n), bs = s.breaches;
    const i = bs.length > 1
      ? (s.lastBreach + 1 + Math.floor(Math.random() * (bs.length - 1))) % bs.length
      : 0;
    s.lastBreach = i;
    const b = bs[i];
    const placed = this.breachFile(b, n);
    for (let k = 0; k < n; k++) {
      const { x, y } = placed[k];
      const op = new Operator(x, y, b.angle, kit[k].weapon), c0 = kit[0].shield ? 1 : 0;
      op.charges = k >= c0 && k < c0 + WAVE_CHARGES ? 1 : 0; // (pas au porteur de bouclier)
      // la première vague compte surprendre (silencieux), les suivantes, l'alerte donnée, entrent au laser (ROLE_KITS) ;
      // de temps en temps, celui qui mène porte un bouclier (voir squadKit)
      op.slot = { def: fittedDef(kit[k].weapon, ROLE_KITS[s.wave === 0 ? 0 : 1]), mag: Infinity, reserve: 0 };
      if (kit[k].shield) this.armShield(op, kit[k].shield);
      op.burstLeft = op.weapon.burst;
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
        const b = this.spawnAssault(s.waves[0]);
        s.nextWave = s.maxGap;
        this.sfx('door', b.cx, b.cy, 24 * U);
      }
      return;
    }
    if (s.wave < s.waves.length) {
      // Pas d'attente inutile : la vague suivante suit de peu l'élimination de la précédente.
      if (!this.enemies.some(e => e.alive) && s.nextWave > s.gap) s.nextWave = s.gap;
      s.nextWave -= dt;
      if (s.nextWave <= 0) {
        const b = this.spawnAssault(s.waves[s.wave]);
        s.nextWave = s.maxGap;
        this.sfx('door', b.cx, b.cy, 24 * U);
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
});
