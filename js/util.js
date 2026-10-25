'use strict';
const TILE = 16; // taille d'une case de la grille (px)
const U = 32;    // unité de distance de jeu (px) : une case des cartes ASCII
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Tourne agent.angle vers target à la vitesse rate (rad/s). Retourne true quand aligné.
function turnToward(agent, target, rate, dt) {
  const d = angleDiff(agent.angle, target);
  const step = rate * dt;
  if (Math.abs(d) <= step) { agent.angle = target; return true; }
  agent.angle += Math.sign(d) * step;
  return false;
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

// Pas de course, selon le sol (dans l'ordre de FLOOR, js/map.js) : [durée, volume, coupure des aigus, courbe, fréquence de
// la tôle qui sonne]. Béton, parquet, carrelage, moquette (presque rien), marbre, tôle striée, herbe, gravier (il crisse),
// dallage, asphalte.
const STEP_SOUNDS = [
  [0.05, 0.1, 1400, 3], [0.06, 0.11, 700, 2.5], [0.035, 0.1, 3000, 4], [0.05, 0.035, 450, 2], [0.035, 0.11, 3400, 4],
  [0.04, 0.09, 2000, 3, 950], [0.07, 0.05, 2600, 1.5], [0.11, 0.09, 3200, 1.2], [0.045, 0.09, 1800, 3], [0.05, 0.08, 1300, 3],
];

// Sons synthétisés, sans aucun fichier : des bruits filtrés et des oscillateurs. Tout passe par une sortie générale (out)
// suivie d'un compresseur, pour qu'une bataille de dix-huit tireurs ne sature pas. Un son joué dans le monde (Game.sfx)
// reçoit en dernier argument o = { gain, pan, muffle } : son volume selon la distance acoustique jusqu'à l'auditeur
// (Game.hearAt), son côté à l'écran, et combien les murs et la distance l'étouffent (muffle : 1 en champ libre, vers 0
// derrière les murs : les aigus tombent). Sans o, il joue au centre et à plein volume (l'interface).
// Les voix de synthèse retenues pour les répliques (Sound.maleVoices) : une voix neuronale, et un prénom d'homme.
const VOICE_NATURAL = /natural|online|neural|premium|enhanced/i;
const VOICE_MEN = /\b(henri|r[ée]my|alain|claude|j[ée]r[ôo]me|maurice|yves|antoine|jean|thierry|g[ée]rard|fabrice|thomas|nicolas|daniel|paul|guillaume|mathieu|lucien|louis|olivier)\b/i;
const Sound = {
  ctx: null,
  out: null,  // sortie générale, avant le compresseur
  bufs: {},   // tampons de bruit déjà calculés (voir buf)
  // répliques dites par la synthèse vocale du navigateur (réglage du joueur, gardé dans le navigateur, voir setVoices)
  voices: (() => { try { return localStorage.getItem('breach.voices') !== 'off'; } catch (e) { return true; } })(),
  talk: null, // réplique en cours : { prio, until }
  init() {
    if (!this.ctx) {
      try {
        const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        // le compresseur tient les pics (explosions, rafales croisées) sans écraser un pas lointain
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
        this.out = c.createGain();
        this.out.gain.value = 0.9;
        this.out.connect(comp); comp.connect(c.destination);
      } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  setVoices(on) {
    this.voices = !!on;
    try { localStorage.setItem('breach.voices', on ? 'on' : 'off'); } catch (e) { /* stockage indisponible */ }
    if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
  },
  // Bruit blanc qui décroît (durée en s, courbe decayPow), calculé une seule fois par forme : quatre tirages, pris au
  // hasard, pour que deux tirs de suite ne sonnent pas exactement pareil.
  buf(dur, decayPow) {
    const key = dur.toFixed(3) + '|' + decayPow;
    let set = this.bufs[key];
    if (!set) {
      const c = this.ctx, n = Math.max(1, Math.floor(c.sampleRate * dur));
      set = this.bufs[key] = [0, 1, 2, 3].map(() => {
        const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decayPow);
        return b;
      });
    }
    return set[Math.floor(Math.random() * set.length)];
  },
  // Fin de chaîne : le volume (o.gain), le côté (o.pan), la sortie générale.
  chain(node, vol, o) {
    const c = this.ctx, g = c.createGain();
    g.gain.value = vol * (o ? o.gain : 1);
    node.connect(g);
    let last = g;
    if (o && o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); last = p;
    }
    last.connect(this.out);
  },
  // Coupure des aigus selon l'étouffement (o.muffle).
  cut(f, o) { const m = o ? o.muffle : 1; return f * (0.12 + 0.88 * m * m); },
  // Bruit filtré ; delay : départ différé (s).
  noise(dur, vol, cutoff, decayPow, o, delay) {
    const c = this.ctx; if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.buf(dur, decayPow);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.cut(cutoff, o);
    src.connect(f); this.chain(f, vol, o); src.start(c.currentTime + (delay || 0));
  },
  // Bruit passé dans un filtre étroit autour de freq : métal qui sonne, déclic, cliquetis.
  ring(dur, vol, freq, q, o, delay) {
    const c = this.ctx; if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.buf(dur, 1.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = this.cut(freq, o); f.Q.value = q;
    src.connect(f); this.chain(f, vol * Math.sqrt(q), o); src.start(c.currentTime + (delay || 0));
  },
  // Note d'un oscillateur qui glisse de f0 à f1 et s'éteint en dur s.
  tone(type, f0, f1, dur, vol, o, delay) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (delay || 0), osc = c.createOscillator(), env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + Math.min(0.02, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.cut(Math.max(f0, f1) * 3, o);
    osc.connect(env); env.connect(f); this.chain(f, vol, o);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  // Coup de feu (w.snd : [durée, coupure]) : un silencieux le réduit à un claquement sourd ; sinon un coup grave le
  // soutient, plus fort pour une arme lourde.
  shot(w, o) {
    const [dur, cutoff] = w.snd || (w.heavy ? [0.2, 800] : [0.09, 2400]);
    this.noise(dur, w.suppressed ? 0.12 : 0.3, cutoff, 3, o);
    if (!w.suppressed) this.tone('sine', w.heavy ? 95 : 140, 45, 0.12, w.heavy ? 0.22 : 0.1, o);
  },
  // Fusil à pompe : on réarme après le coup (la pompe recule, puis revient).
  pump(o) { this.ring(0.05, 0.08, 1300, 3, o, 0.22); this.ring(0.06, 0.1, 1050, 3, o, 0.36); },
  // Fusil à verrou : on lève et tire le levier (la douille saute), puis on le repousse et on le rabat.
  cycle(o) { this.ring(0.04, 0.07, 1900, 4, o, 0.3); this.ring(0.05, 0.07, 1500, 4, o, 0.42); this.ring(0.05, 0.08, 1250, 4, o, 0.6); },
  // Temps d'un rechargement (voir Game.reloadCues) : le chargeur sort ('out'), entre ('in'), puis on réarme ('bolt' pour
  // une arme d'épaule, 'slide' pour une arme de poing) ; une cartouche entre dans le magasin d'un fusil à pompe ('shell').
  // Une AK ou une arme lourde sonne plus grave, un tambour plus lourd.
  reload(cue, w, o) {
    const low = w.kind === 'ak' || w.heavy ? 0.8 : 1, drum = !!(w.tint && w.tint.extMag === 'drum');
    switch (cue) {
      case 'out': this.ring(0.04, 0.06, 2600 * low, 4, o); this.noise(0.09, 0.07, 1800, 2, o, 0.04); break;
      case 'in': this.noise(0.05, drum ? 0.28 : 0.2, 1400 * low, 2, o); this.ring(0.05, 0.07, 2000 * low, 5, o, 0.01); break;
      case 'bolt': this.ring(0.05, 0.08, 1700 * low, 4, o); this.ring(0.06, 0.09, 1300 * low, 4, o, 0.09); break;
      case 'slide': this.ring(0.05, 0.09, 2300, 5, o); break;
      case 'shell': this.noise(0.04, 0.14, 1500, 2, o); this.ring(0.03, 0.04, 2400, 6, o, 0.03); break;
    }
  },
  // Changer d'arme, ramasser celle d'un corps : la bretelle, puis l'arme en main.
  draw(o) { this.noise(0.12, 0.07, 900, 1, o); this.ring(0.03, 0.05, 2200, 5, o, 0.12); },
  // Pas de course sur le sol floor (STEP_SOUNDS).
  step(floor, o) {
    const s = STEP_SOUNDS[floor] || STEP_SOUNDS[0];
    this.noise(s[0], s[1], s[2], s[3], o);
    if (s[4]) this.ring(0.08, s[1] * 0.3, s[4], 6, o);
  },
  // Balle qui s'arrête : sur un mur (le crépi claque, parfois un ricochet siffle), dans la chair (un choc mat), dans un
  // couvert bas (des sacs de sable étouffent, un muret claque sourd, la tôle d'une voiture sonne).
  impact(mat, o) {
    switch (mat) {
      case 'flesh': this.noise(0.07, 0.22, 650, 3, o); this.tone('sine', 140, 60, 0.07, 0.16, o); break;
      case 'sand': this.noise(0.08, 0.2, 420, 2.5, o); break;
      case 'metal': this.noise(0.03, 0.14, 3000, 3, o); this.ring(0.25, 0.07, 850 + Math.random() * 300, 9, o); break;
      case 'stone': this.noise(0.05, 0.18, 1800, 3, o); break;
      default:
        this.noise(0.05, 0.16, 3200, 3, o);
        if (Math.random() < 0.25) this.tone('sine', 2600, 900, 0.18, 0.04, o); // ricochet
    }
  },
  // Un corps qui tombe.
  body(o) { this.noise(0.18, 0.2, 320, 2, o); this.tone('sine', 90, 45, 0.12, 0.16, o, 0.03); },
  door(o) { this.noise(0.12, 0.15, 400, 2, o); },
  pierce(o) { this.noise(0.07, 0.2, 900, 2, o); }, // balle qui traverse un battant
  ping(o) { this.noise(0.05, 0.22, 5200, 2, o); this.ring(0.12, 0.04, 3200, 10, o); }, // balle sur un bouclier
  tick(vol, o) { this.noise(0.03, vol || 0.15, 3500, 1, o); },
  // Menottes : le cliquet, quatre crans.
  cuffs(o) { for (let i = 0; i < 4; i++) this.ring(0.025, 0.04, 3400, 8, o, i * 0.055); },
  // alerte générale : un cri qui monte, trois fois
  alarm(o) { for (const at of [0, 0.3, 0.6]) this.tone('sawtooth', 260, 420, 0.26, 0.09, o, at); },
  frag(o) {
    this.noise(1.1, 0.9, 700, 2, o);
    this.noise(0.25, 0.6, 3000, 4, o);
    this.tone('sine', 70, 30, 0.6, 0.4, o);
  },
  flash(o) {
    this.noise(0.5, 0.5, 6000, 1.5, o);
    this.tone('sine', 1800, 1800, 1.2, 0.25, o); // le sifflement dans les oreilles
  },
  // Réplique dite par la synthèse vocale du navigateur, avec une voix d'homme naturelle en français (maleVoices) : une à
  // la fois, la plus importante (prio) passe devant. Sans une telle voix, rien : une voix de synthèse ancienne, ou une
  // voix de femme pour une équipe d'hommes, sonnait faux. voice : le rang de la voix de celui qui parle (chacun garde la
  // sienne quand il y en a plusieurs). La hauteur n'est jamais retouchée : c'est ce qui rendait les voix robotiques. La
  // voix ne passe pas par le mixage : plus faible de loin (o.gain), elle ne se place ni à gauche ni à droite.
  speak(text, o, prio, voice) {
    if (!this.ctx || !this.voices) return;
    const S = window.speechSynthesis, vs = S ? this.maleVoices() : [];
    if (!vs.length) return;
    const v = vs[(voice || 0) % vs.length], now = performance.now();
    if (this.talk && this.talk.until > now && this.talk.prio >= prio) return;
    if (S.speaking || S.pending) S.cancel();
    const u = new SpeechSynthesisUtterance(text);
    Object.assign(u, { voice: v, lang: v.lang, volume: clamp(o ? o.gain * 1.3 : 1, 0.05, 1), rate: 1.08 });
    this.talk = { prio, until: now + 500 + 75 * text.length };
    u.onend = () => { this.talk = null; };
    S.speak(u);
  },
  // Les voix d'homme du navigateur qui parlent français et sonnent naturel : les voix neuronales (« Natural », « Online »
  // chez Microsoft, « Premium » ou « Enhanced » chez Apple), reconnues à leur prénom puisque l'API ne dit pas le genre ;
  // celles de France d'abord. La liste arrive parfois après coup : on la redemande tant qu'elle est vide.
  maleVoices() {
    if (this._male && this._male.length) return this._male;
    const all = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    this._male = all.filter(v => /^fr/i.test(v.lang) && VOICE_NATURAL.test(v.name) && VOICE_MEN.test(v.name))
      .sort((a, b) => (/^fr-FR/i.test(b.lang) - /^fr-FR/i.test(a.lang)) || a.name.localeCompare(b.name));
    return this._male;
  },
};
