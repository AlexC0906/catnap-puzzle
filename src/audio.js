// Catnap — tiny synthesized sound effects (Web Audio, no files).
(function (root) {
  'use strict';
  let ctx = null, master = null, enabled = true;

  function ac() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch { return null; }
  }

  function tone({ type = 'sine', f0, f1 = f0, dur = 0.12, vol = 0.5, delay = 0, attack = 0.005 }) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A soft synthetic "mew": sawtooth through a sweeping band-pass filter.
  function meow(pitch = 1, delay = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520 * pitch, t);
    o.frequency.linearRampToValueAtTime(760 * pitch, t + 0.12);
    o.frequency.linearRampToValueAtTime(430 * pitch, t + 0.42);
    f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1700, t + 0.14);
    f.frequency.linearRampToValueAtTime(800, t + 0.42);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + 0.5);
  }

  const S = {
    cat() { tone({ f0: 420, f1: 880, dur: 0.11, vol: 0.45 }); tone({ type: 'triangle', f0: 1320, f1: 1500, dur: 0.07, vol: 0.12, delay: 0.04 }); },
    mark() { tone({ type: 'triangle', f0: 260, f1: 200, dur: 0.05, vol: 0.18 }); },
    clear() { tone({ type: 'sine', f0: 330, f1: 180, dur: 0.07, vol: 0.18 }); },
    error() { tone({ type: 'square', f0: 180, f1: 140, dur: 0.14, vol: 0.08 }); },
    hint() { tone({ f0: 660, dur: 0.09, vol: 0.2 }); tone({ f0: 990, dur: 0.12, vol: 0.18, delay: 0.08 }); },
    win() {
      [523, 659, 784, 1047].forEach((f, k) => tone({ type: 'triangle', f0: f, dur: 0.22, vol: 0.28, delay: k * 0.09 }));
      meow(1.05, 0.45);
    },
    chime(k = 0) {
      const scale = [784, 880, 988, 1175, 1319, 1568, 1760, 1976, 2349, 2637];
      const f = scale[Math.max(0, Math.min(scale.length - 1, k))];
      tone({ type: 'sine', f0: f, dur: 0.35, vol: 0.12 });
      tone({ type: 'sine', f0: f * 1.5, dur: 0.25, vol: 0.05, delay: 0.05 });
    },
    unlock() { [784, 988, 1175, 1568].forEach((f, k) => tone({ f0: f, dur: 0.16, vol: 0.2, delay: k * 0.07 })); },
    meow
  };

  // Purring: low filtered noise, amplitude-modulated at ~26 Hz, breathing in and out.
  let purrNodes = null;
  function purrStart() {
    const c = ac(); if (!c || purrNodes) return;
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 1.2;
    const am = c.createGain(); am.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 26;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    const breath = c.createGain(); breath.gain.value = 0.0001;
    const t = c.currentTime;
    breath.gain.exponentialRampToValueAtTime(1.4, t + 0.25);
    // in-out breathing
    const slow = c.createOscillator(); slow.frequency.value = 0.55;
    const slowGain = c.createGain(); slowGain.gain.value = 0.5;
    slow.connect(slowGain).connect(breath.gain);
    src.connect(lp).connect(am).connect(breath).connect(master);
    src.start(); lfo.start(); slow.start();
    purrNodes = { src, lfo, slow, breath };
  }
  function purrStop() {
    if (!purrNodes || !ctx) return;
    const n = purrNodes; purrNodes = null;
    const t = ctx.currentTime;
    try {
      n.breath.gain.cancelScheduledValues(t);
      n.breath.gain.setValueAtTime(n.breath.gain.value || 0.5, t);
      n.breath.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      [n.src, n.lfo, n.slow].forEach(o => o.stop(t + 0.45));
    } catch { /* already stopped */ }
  }

  root.CatnapAudio = {
    purrStart() { if (enabled) try { purrStart(); } catch { /* audio unavailable */ } },
    purrStop() { try { purrStop(); } catch { /* ignore */ } },
    play(name, ...args) { if (enabled && S[name]) try { S[name](...args); } catch { /* audio unavailable */ } },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; }
  };
})(window);
