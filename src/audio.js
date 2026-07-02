// Tiny procedural audio: wind while flying, chime on ring pickup.
// All synthesized with WebAudio — no audio files.

export function createAudio() {
  let ctx = null;
  let windGain = null;
  let windFilter = null;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // looping noise buffer for wind
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // pink-ish noise via leaky integrator
      const white = Math.random() * 2 - 1;
      last = last * 0.97 + white * 0.03;
      data[i] = last * 8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter).connect(windGain).connect(ctx.destination);
    src.start();
  }

  return {
    resume() { ensure(); if (ctx.state === 'suspended') ctx.resume(); },
    // 0..1 flying speed factor
    setWind(f) {
      if (!ctx) return;
      windGain.gain.setTargetAtTime(f * 0.16, ctx.currentTime, 0.15);
      windFilter.frequency.setTargetAtTime(300 + f * 900, ctx.currentTime, 0.2);
    },
    chime() {
      if (!ctx) return;
      const now = ctx.currentTime;
      // little arpeggio of pure tones
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, now + i * 0.07);
        g.gain.linearRampToValueAtTime(0.12, now + i * 0.07 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.7);
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.07);
        o.stop(now + i * 0.07 + 0.8);
      });
    },
    whoosh() {
      if (!ctx) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(160, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.35);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(now); o.stop(now + 0.55);
    },
  };
}
