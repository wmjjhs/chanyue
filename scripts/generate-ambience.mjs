// 版权所有：波哥
import { mkdirSync, writeFileSync } from 'node:fs';

export function synthesizeAmbience(kind, rate = 22050, seconds = 24) {
  if (!['rain', 'wind', 'stream'].includes(kind)) throw new Error('Unknown ambience');
  const length = Math.round(rate * seconds);
  const overlap = Math.min(Math.round(rate * 2), Math.floor(length / 4));
  const raw = new Float32Array(length + overlap);
  let seed = { rain: 7531, wind: 3817, stream: 9421 }[kind];
  let low = 0, mid = 0, slow = 0, bubble = 0, phase = 0;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  for (let i = 0; i < raw.length; i++) {
    const t = i / rate, white = noise();
    low += 0.025 * (white - low);
    mid += 0.28 * (white - mid);
    slow += 0.0005 * (white - slow);
    if (kind === 'rain') {
      raw[i] = (mid * 0.65 + (white - low) * 0.18) * (0.86 + 0.07 * Math.sin(t * 0.7) + slow * 0.3);
    } else if (kind === 'wind') {
      raw[i] = low * (1.5 + 0.35 * Math.sin(t * 0.53) + 0.2 * Math.sin(t * 0.91)) + mid * 0.035;
    } else {
      bubble += (white * white - 1 / 3 - bubble) * 0.006;
      phase += 2 * Math.PI * (430 + 90 * Math.sin(t * 1.23) + 180 * slow) / rate;
      raw[i] = mid * 0.28 + low * 1.3 + Math.sin(phase) * bubble * 0.22;
    }
  }
  const samples = new Float32Array(length);
  let mean = 0;
  for (let i = 0; i < length; i++) {
    const weight = i < length - overlap ? 0 : (1 - Math.cos(Math.PI * (i - (length - overlap)) / overlap)) / 2;
    samples[i] = raw[i + overlap] * (1 - weight) + (weight ? raw[i - (length - overlap)] * weight : 0);
    mean += samples[i] / length;
  }
  let peak = 0, energy = 0;
  for (let i = 0; i < length; i++) { samples[i] -= mean; peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2; }
  const scale = Math.min(0.6 / peak, 0.13 / Math.sqrt(energy / length));
  for (let i = 0; i < length; i++) samples[i] *= scale;
  return samples;
}

export function writeAmbience(directory) {
  mkdirSync(directory, { recursive: true });
  for (const kind of ['rain', 'wind', 'stream']) {
    const samples = synthesizeAmbience(kind);
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
    writeFileSync(new URL(`${kind}.wav`, directory), wav);
  }
}
