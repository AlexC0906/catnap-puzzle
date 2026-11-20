// Catnap — gentle procedural lo-fi background music (Web Audio, no files).
// Soft pads on a Fmaj7 – Em7 – Dm7 – Cmaj7 loop, a round bass, a dreamy
// pentatonic melody that never repeats exactly, and quiet brushed hats.
(function (root) {
  'use strict';
  const BPM = 72, BEAT = 60 / BPM, BAR = BEAT * 4;
  const CHORDS = [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59]  // Cmaj7
  ];
  const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  let ctx = null, out = null, wet = null, noise = null;
  let playing = false, timer = null, nextTime = 0, step = 0, lastNote = 3;

  function setup() {
    if (ctx) return true;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    out = ctx.createGain(); out.gain.value = 0;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 2400;
    out.connect(warm).connect(ctx.destination);
    // simple echo for the melody
    const delay = ctx.createDelay(); delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    wet = ctx.createGain(); wet.gain.value = 0.5;
    wet.connect(delay); delay.connect(fb).connect(delay); delay.connect(out);
    // noise buffer for hats
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    return true;
  }

  function pad(notes, t) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.8);
    g.gain.setValueAtTime(0.05, t + BAR - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + BAR + 0.4);
    f.connect(g).connect(out);
    notes.forEach((m, k) => {
      const o = ctx.createOscillator();
      o.type = k % 2 ? 'sine' : 'triangle';
      o.frequency.value = hz(m);
      o.detune.value = (k - 1.5) * 4;
      o.connect(f); o.start(t); o.stop(t + BAR + 0.5);
    });
  }
  function bass(m, t, len) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = hz(m - 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
  }
  function pluck(m, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = hz(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(out); g.connect(wet);
    o.start(t); o.stop(t + 1);
  }
  function hat(t, v) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
    const g = ctx.createGain(); g.gain.value = v;
    s.connect(f).connect(g).connect(out); s.start(t);
  }

  // schedule one eighth note at time t
  function schedule(t) {
    const eighth = step % 8, bar = Math.floor(step / 8) % CHORDS.length;
    const chord = CHORDS[bar];
    if (eighth === 0) { pad(chord, t); bass(chord[0], t, BEAT * 1.8); }
    if (eighth === 4) bass(chord[0] + (Math.random() < 0.5 ? 7 : 0), t, BEAT * 1.6);
    if (eighth % 2 === 1) hat(t + (Math.random() * 0.02), 0.025);
    // melody: a lazy random walk on the pentatonic scale
    if (Math.random() < (eighth % 2 ? 0.22 : 0.4)) {
      lastNote = Math.max(0, Math.min(PENTA.length - 1, lastNote + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
      pluck(PENTA[lastNote], t + (eighth % 2 ? 0.04 : 0));
    }
    step++;
  }

  function tick() {
    while (nextTime < ctx.currentTime + 0.6) { schedule(nextTime); nextTime += BEAT / 2; }
  }

  root.CatnapMusic = {
    start() {
      if (playing) return;
      try {
        if (!setup()) return;
        if (ctx.state === 'suspended') ctx.resume();
        playing = true;
        nextTime = ctx.currentTime + 0.1;
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2);
        timer = setInterval(tick, 120);
        tick();
      } catch { playing = false; }
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      try {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      } catch { /* ignore */ }
    },
    get playing() { return playing; }
  };
})(window);
