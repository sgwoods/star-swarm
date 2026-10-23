/**
 * Drawing one sound's plan onto the 224x288 backbuffer, for `/lab`.
 *
 * What is drawn is the `SoundPlan` that `buildSoundPlan` in `src/audio/synth.ts`
 * makes — the very description of the graph `playPlan` then builds — so a curve
 * here is the pitch and the level the synth will schedule, voice by voice, and
 * not a second reading of the sound document. Pitch is on a log scale with any
 * vibrato drawn as the wobble it is; level is each voice's gain envelope.
 */

import type { ParamRamp, SoundPlan, Waveform } from '../../audio/synth.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import type { Font } from '../../render/text.js';

/** One colour per waveform, so a jingle's lines read apart when they differ. */
export const WAVE_COLOURS: Readonly<Record<Waveform, string>> = Object.freeze({
  square: '#37e0e8',
  triangle: '#ffe95c',
  sine: '#7cff7c',
  sawtooth: '#ff7edb',
  noise: '#b0b0c8',
});

const INK = '#e8e8f0';
const DIM = '#8a8aa0';
const GRID = '#232334';
const PLAYHEAD = '#ff6060';

const LEFT = 8;
const RIGHT = LOGICAL_WIDTH - 8;
const PITCH_TOP = 44;
const PITCH_BOTTOM = 164;
const LEVEL_TOP = 196;
const LEVEL_BOTTOM = 268;

/**
 * A scheduled parameter's value at `time` seconds from the sound's start, as
 * Web Audio evaluates the automation: a `set` holds from its time, and a linear
 * or exponential ramp runs from the previous event's value to its own.
 */
export function paramAt(ramps: readonly ParamRamp[], time: number): number {
  let previous: ParamRamp | undefined;
  for (const ramp of ramps) {
    if (ramp.time > time) {
      if (previous === undefined) return ramp.value;
      if (ramp.kind === 'set') return previous.value;
      const span = ramp.time - previous.time;
      const t = span <= 0 ? 1 : (time - previous.time) / span;
      if (ramp.kind === 'exponential' && previous.value > 0 && ramp.value > 0) {
        return previous.value * (ramp.value / previous.value) ** t;
      }
      return previous.value + (ramp.value - previous.value) * t;
    }
    previous = ramp;
  }
  return previous?.value ?? 0;
}

/** The lowest and highest pitch any voice reaches, vibrato included. */
export function pitchRange(plan: SoundPlan): { readonly low: number; readonly high: number } {
  let low = Number.POSITIVE_INFINITY;
  let high = 0;
  for (const voice of plan.voices) {
    const wobble = voice.vibrato?.peak ?? 0;
    for (const ramp of voice.frequency) {
      low = Math.min(low, ramp.value - wobble);
      high = Math.max(high, ramp.value + wobble);
    }
  }
  if (!Number.isFinite(low) || high <= 0) return { low: 100, high: 1000 };
  return { low: Math.max(20, low), high: Math.max(high, low * 1.5) };
}

export function drawSoundPlan(
  ctx: CanvasRenderingContext2D,
  font: Font,
  plan: SoundPlan,
  playhead: number | undefined,
): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  font.draw(ctx, plan.id, LOGICAL_WIDTH / 2, 8, { colour: INK, align: 'center' });
  font.draw(
    ctx,
    `${(plan.duration * 1000).toFixed(0)} MS  ${String(plan.voices.length)} VOICE${plan.voices.length === 1 ? '' : 'S'}`,
    LOGICAL_WIDTH / 2,
    20,
    { colour: DIM, align: 'center' },
  );

  const duration = Math.max(plan.duration, 1e-3);
  const xOf = (time: number): number => LEFT + ((RIGHT - LEFT) * time) / duration;
  const { low, high } = pitchRange(plan);
  const logLow = Math.log(low * 0.9);
  const logHigh = Math.log(high * 1.1);
  const yOfPitch = (hz: number): number =>
    PITCH_BOTTOM - ((PITCH_BOTTOM - PITCH_TOP) * (Math.log(hz) - logLow)) / (logHigh - logLow);
  const yOfLevel = (gain: number): number =>
    LEVEL_BOTTOM - (LEVEL_BOTTOM - LEVEL_TOP) * Math.min(1, Math.max(0, gain));

  // Frames for the two plots, and their labels.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(LEFT - 0.5, PITCH_TOP - 0.5, RIGHT - LEFT + 1, PITCH_BOTTOM - PITCH_TOP + 1);
  ctx.strokeRect(LEFT - 0.5, LEVEL_TOP - 0.5, RIGHT - LEFT + 1, LEVEL_BOTTOM - LEVEL_TOP + 1);
  font.draw(ctx, `PITCH ${Math.round(low)}-${Math.round(high)} HZ`, LEFT, PITCH_TOP - 11, {
    colour: DIM,
  });
  font.draw(ctx, 'LEVEL', LEFT, LEVEL_TOP - 11, { colour: DIM });

  for (const voice of plan.voices) {
    const colour = WAVE_COLOURS[voice.wave];
    const from = Math.floor(xOf(voice.start));
    const to = Math.ceil(xOf(voice.stop));

    // Level first, so the pitch line sits on top where the plots touch.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = colour;
    for (let x = from; x <= to; x += 1) {
      const time = ((x - LEFT) * duration) / (RIGHT - LEFT);
      const y = yOfLevel(paramAt(voice.gain, time));
      ctx.fillRect(x, Math.round(y), 1, LEVEL_BOTTOM - Math.round(y));
    }
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (let x = from; x <= to; x += 1) {
      const time = ((x - LEFT) * duration) / (RIGHT - LEFT);
      const wobble =
        voice.vibrato === undefined
          ? 0
          : voice.vibrato.peak * Math.sin(2 * Math.PI * voice.vibrato.rate * (time - voice.start));
      const y = yOfPitch(Math.max(1, paramAt(voice.frequency, time) + wobble)) + 0.5;
      if (x === from) ctx.moveTo(x + 0.5, y);
      else ctx.lineTo(x + 0.5, y);
    }
    ctx.strokeStyle = colour;
    ctx.stroke();
  }

  // The waveforms in play, as a key.
  const waves = [...new Set(plan.voices.map((voice) => voice.wave))];
  waves.forEach((wave, index) => {
    font.draw(ctx, wave, LEFT + index * 72, LEVEL_BOTTOM + 8, { colour: WAVE_COLOURS[wave] });
  });

  if (playhead !== undefined && playhead >= 0 && playhead <= plan.duration) {
    ctx.fillStyle = PLAYHEAD;
    const x = Math.round(xOf(playhead));
    ctx.fillRect(x, PITCH_TOP, 1, PITCH_BOTTOM - PITCH_TOP);
    ctx.fillRect(x, LEVEL_TOP, 1, LEVEL_BOTTOM - LEVEL_TOP);
  }
}
