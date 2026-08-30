/**
 * Relay's four sounds. No music — this is a work tool.
 *
 * Each one is layered (transient + body), because a single sweep reads as a cheap beep
 * and this project has spent six sessions not looking cheap.
 */

const fs = require('fs');
const path = require('path');

const ENGINE = '/Users/havalzebari/.claude/plugins/cache/ls-extensions/ls-clad/1.0.0/skills/build-sfx/tools';
const audio = require(ENGINE);

const PROJECT_ASSETS_SFX = '/Users/havalzebari/Desktop/Relay/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });

const p = audio.sfx_presets;
const SR = audio.SAMPLE_RATE;

/**
 * CLAIM — "lifting a smooth stone."
 * Weight comes from the low thump; the stone comes from a short, dull stone impact with
 * its brightness pulled down. Deliberately not a UI click: this is the one moment in the
 * lens where the user takes physical possession of something.
 */
function claim() {
  const stone = p.impact({ material: 'stone', size: 0.35 });
  const weight = audio.transient_designer.designImpact({
    attack: { kind: 'click', durationMs: 6, lpHz: 1800, hpHz: 200, gain: 0.45 },
    body: { kind: 'thump', freq: 78, decay: 0.16, lpHz: 520, gain: 0.8 },
  });

  const out = new Float32Array(Math.floor(0.34 * SR));
  audio.addInto(out, weight, 0, 1.0);
  audio.addInto(out, stone, Math.floor(0.004 * SR), 0.42);

  // Dull it: a lifted stone is muted, not bright.
  const mixed = audio.mix_bus.applyFx(out, { hpf: 70, lpf: 2600, gain: 0.9 });
  audio.fadeOut(mixed, 0.02);
  return mixed;
}

/**
 * DISSOLVE — "a rising whisper." Played AT the partner's card position, so it has to
 * survive being spatialised: mono, mid-forward, no stereo tricks the panner would fight.
 * Airy noise sweeping upward under a faint bell that rises with it.
 */
function dissolve() {
  const air = audio.whiteNoise(0.42, 0.5);
  audio.lowPassSweep(air, 900, 5200, 1.4, 'exponential');
  audio.adsrExp(air, 0.06, 0.10, 0.55, 0.24, 2);

  const breath = audio.sweep(520, 1240, 0.40, 'sine', 'exponential');
  audio.adsrExp(breath, 0.05, 0.12, 0.4, 0.22, 3);

  const out = audio.mix([air, breath], [0.5, 0.22]);

  // Keep it mono — the spatialiser supplies the position, not the mix.
  const mixed = audio.mix_bus.applyFx(out, { hpf: 320, lpf: 7000, gain: 0.5 });
  audio.fadeIn(mixed, 0.03);
  audio.fadeOut(mixed, 0.05);
  audio.removeDC(mixed);
  return mixed;
}

/**
 * ARRIVAL — "a very faint metallic chime." One small bell with a long-ish tail and a
 * thin metallic tick in front of it. Quiet by design: something arrived, it is not
 * demanding anything.
 */
function arrival() {
  const tick = audio.transient_designer.designImpact({
    attack: { kind: 'snap', durationMs: 4, centerHz: 6200, lpHz: 9500, gain: 0.28 },
    body: { kind: 'tonal', freq: 1180, partials: 5, decay: 0.30, hpHz: 700, lpHz: 8000, gain: 0.22 },
  });
  const bell = audio.synth_voices.bell(88, 0.55, 90, 260);

  const out = new Float32Array(Math.floor(0.62 * SR));
  audio.addInto(out, tick, 0, 0.7);
  audio.addInto(out, bell, Math.floor(0.006 * SR), 0.20);

  const mixed = audio.mix_bus.applyFx(out, { hpf: 500, reverb: 'plate', gain: 0.34 });
  audio.fadeOut(mixed, 0.03);
  return mixed;
}

/**
 * DENIED — "a muted falling tone." Someone else got there first. It should read as a
 * small closing door, not an error buzzer: no distortion, no dissonance, just a short
 * fall with the top rolled off.
 */
function denied() {
  const fall = audio.sweep(430, 208, 0.34, 'triangle', 'exponential');
  audio.adsrExp(fall, 0.008, 0.09, 0.45, 0.22, 3);

  const under = audio.sweep(215, 104, 0.34, 'sine', 'exponential');
  audio.adsrExp(under, 0.010, 0.09, 0.40, 0.22, 3);

  const out = audio.mix([fall, under], [0.55, 0.3]);
  const mixed = audio.mix_bus.applyFx(out, { hpf: 90, lpf: 1900, gain: 0.55 });
  audio.fadeOut(mixed, 0.03);
  return mixed;
}

/**
 * PASS — a sheet of paper sent through the air.
 *
 * The previous version was a rising triangle sweep, which is a synthesiser gesture: it
 * said "value increasing", not "object in flight". Paper has no pitch. What it has is a
 * flutter — a fast irregular crackle as the sheet flexes — riding on a body of moving
 * air. So this is built from noise, not from tones, and the only thing that "sweeps" is
 * the filter, because air moving past you gets brighter as it approaches and duller as
 * it goes.
 */
function pass() {
  // The flutter: a dense grain cloud of short bandpassed pink bursts. This is the sheet
  // itself, and the irregular grain spacing is what stops it reading as a machine.
  const flutter = audio.granular.grainCloud({
    source: 'pink',
    duration: 0.46,
    grainSizeMs: 11,
    density: 165,
    ampJitter: 0.75,
    pitchSpread: 5,
    filter: { type: 'bp', freq: 2100, Q: 1.1 },
    panSpread: 0.0,
  });

  // The air it moves through: a broad noise body whose brightness rises then falls, so
  // the send has an approach and a departure rather than one flat gust.
  const air = audio.whiteNoise(0.46, 0.42);
  audio.lowPassSweep(air, 700, 4200, 1.1, 'exponential');
  audio.adsrExp(air, 0.05, 0.14, 0.55, 0.24, 2);

  // A soft leading edge — the moment it leaves the hand. No click: paper does not click.
  const release = audio.transient_designer.designImpact({
    attack: { kind: 'snap', durationMs: 7, centerHz: 3400, lpHz: 7000, gain: 0.18 },
    body: { kind: 'noise', decay: 0.09, hpHz: 1200, lpHz: 6000, gain: 0.14 },
  });

  const flat = audio.audio_primitives.stereoToMono
    ? audio.audio_primitives.stereoToMono(flutter)
    : (flutter.left ? flutter.left : flutter);

  const out = new Float32Array(Math.floor(0.5 * SR));
  audio.addInto(out, flat, 0, 0.5);
  audio.addInto(out, air, 0, 0.42);
  audio.addInto(out, release, 0, 0.6);

  // Mono on purpose: the spatialiser supplies the movement, and a stereo image would
  // fight the panner as the emitter travels across the room.
  const mixed = audio.mix_bus.applyFx(out, { hpf: 260, lpf: 6400, gain: 0.62 });
  audio.fadeIn(mixed, 0.012);
  audio.fadeOut(mixed, 0.05);
  audio.removeDC(mixed);
  return mixed;
}

const RENDERS = [
  ['relay_pass', pass],
  ['relay_claim', claim],
  ['relay_dissolve', dissolve],
  ['relay_arrival', arrival],
  ['relay_denied', denied],
];

for (const [name, render] of RENDERS) {
  const buf = render();
  audio.mix_bus.masterChain(buf, { normalize: 'peak' });
  const outPath = path.join(PROJECT_ASSETS_SFX, name + '.wav');
  audio.WavBuilder.write(buf, outPath);
  const size = fs.statSync(outPath).size;
  console.log(name + '.wav  ' + size + ' bytes');
}
console.log('done');
