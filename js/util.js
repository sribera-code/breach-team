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

// Petits sons synthétisés (pas d'assets externes).
const Sound = {
  ctx: null,
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  noise(dur, vol, cutoff, decayPow) {
    const c = this.ctx; if (!c) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decayPow);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  },
  // un silencieux : un claquement sourd et bref au lieu de la détonation
  shot(vol, w) { const [dur, cutoff] = w.snd || (w.heavy ? [0.2, 800] : [0.09, 2400]); this.noise(dur, w.suppressed ? vol * 0.4 : vol, cutoff, 3); },
  door() { this.noise(0.12, 0.15, 400, 2); },
  pierce() { this.noise(0.07, 0.2, 900, 2); }, // balle qui traverse un battant
  ping() { this.noise(0.05, 0.22, 5200, 2); },  // balle sur un bouclier
  tick(vol) { this.noise(0.03, vol || 0.15, 3500, 1); },
  reload() { this.noise(0.05, 0.12, 1500, 1); setTimeout(() => this.noise(0.06, 0.14, 1200, 1), 350); },
  // alerte générale : un cri qui monte, trois fois
  alarm() {
    const c = this.ctx; if (!c) return;
    [0, 0.3, 0.6].forEach(at => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(260, c.currentTime + at); o.frequency.linearRampToValueAtTime(420, c.currentTime + at + 0.22);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.09, c.currentTime + at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + 0.26);
      o.connect(f); f.connect(g); g.connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + 0.28);
    });
  },
  // sommation : une voix forte, deux syllabes graves
  shout() {
    const c = this.ctx; if (!c) return;
    [0, 0.22].forEach((at, i) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = i ? 170 : 210;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + 0.2);
      o.connect(f); f.connect(g); g.connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + 0.22);
    });
  },
  frag() {
    const c = this.ctx; if (!c) return;
    this.noise(1.1, 0.9, 700, 2);
    this.noise(0.25, 0.6, 3000, 4);
  },
  flash() {
    const c = this.ctx; if (!c) return;
    this.noise(0.5, 0.5, 6000, 1.5);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1800;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.2);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 1.2);
  },
};
