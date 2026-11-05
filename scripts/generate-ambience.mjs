// 版权所有：波哥
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const directory = new URL('../assets/ambience/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('sources.json', directory), 'utf8'));
const choices = { rain: ['rain-b', '167034', 24], wind: ['wind-a', '475448', 58], stream: ['stream-a', '446019', 58] };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyAmbience(wav, kind) {
  assert(Object.hasOwn(choices, kind), '未知环境音');
  const [selection, soundId, duration] = choices[kind];
  const item = manifest.items.find(value => value.kind === kind);
  assert(item?.selection === selection && item.source.endsWith(`/sounds/${soundId}/`), `选音不匹配：${kind}`);
  assert(item.licenseUrl === 'https://creativecommons.org/publicdomain/zero/1.0/', `授权不匹配：${kind}`);
  assert(wav.length === 44 + duration * 44100 * 4 && wav.length === item.wavBytes, `环境音长度不匹配：${kind}`);
  assert(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.toString('ascii', 36, 40) === 'data', `环境音格式无效：${kind}`);
  assert(wav.readUInt32LE(4) === wav.length - 8 && wav.readUInt32LE(40) === wav.length - 44, `环境音不完整：${kind}`);
  assert(wav.readUInt32LE(16) === 16 && wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 2 && wav.readUInt32LE(24) === 44100 && wav.readUInt32LE(28) === 176400 && wav.readUInt16LE(32) === 4 && wav.readUInt16LE(34) === 16, `环境音采样参数无效：${kind}`);
  assert(digest(wav) === item.wavSha256, `环境音内容与已选录音不匹配：${kind}`);
}

export function writeAmbience(destination) {
  mkdirSync(destination, { recursive: true });
  for (const kind of Object.keys(choices)) {
    const item = manifest.items.find(value => value.kind === kind);
    const archive = readFileSync(new URL(`${kind}.wav.gz`, directory));
    assert(digest(archive) === item?.archiveSha256, `环境音压缩文件损坏：${kind}`);
    const wav = gunzipSync(archive, { maxOutputLength: 11_000_000 });
    verifyAmbience(wav, kind);
    writeFileSync(new URL(`${kind}.wav`, destination), wav);
  }
}
