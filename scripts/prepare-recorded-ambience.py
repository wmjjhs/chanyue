# 版权所有：波哥
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SELECTED = {'rain': ('rain-b', '167034', 0, 26), 'wind': ('wind-a', '475448', 5, 60), 'stream': ('stream-a', '446019', 1, 60)}
RATE = 44100
OVERLAP = 2


def prepare(source_directory, output):
    manifest = json.loads((source_directory / 'manifest.json').read_text(encoding='utf-8'))
    output.mkdir(parents=True, exist_ok=True)
    items = []
    for kind, (selection, sound_id, start, seconds) in SELECTED.items():
        item = next(value for value in manifest['items'] if value['id'] == selection)
        if item['licenseUrl'] != 'https://creativecommons.org/publicdomain/zero/1.0/' or not item['source'].endswith(f'/sounds/{sound_id}/'):
            raise ValueError('选定音源或许可与试听记录不符')
        source = source_directory / 'original-previews' / f'{selection}.mp3'
        if hashlib.sha256(source.read_bytes()).hexdigest() != item['sourceSha256']:
            raise ValueError('源录音与已确认的试听来源不一致')
        result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-nostdin', '-v', 'error', '-i', str(source), '-ss', str(start), '-t', str(seconds), '-vn', '-ar', str(RATE), '-ac', '2', '-f', 'f32le', 'pipe:1'], capture_output=True, check=True, timeout=120)
        raw = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).astype(np.float64)
        if raw.shape != (seconds * RATE, 2) or not np.isfinite(raw).all():
            raise ValueError('源录音未完整解码')
        overlap = OVERLAP * RATE
        loop = raw[overlap:].copy()
        t = (np.arange(overlap) + 1) / overlap
        angle = ((1 - np.cos(np.pi * t)) / 2 * np.pi / 2)[:, None]
        loop[-overlap:] = raw[-overlap:] * np.cos(angle) + raw[:overlap] * np.sin(angle)
        loop -= np.mean(loop, axis=0)
        gain = min(float(item['gainDb']), 20 * np.log10(0.7 / np.max(np.abs(loop))))
        loop *= 10 ** (gain / 20)
        pcm = np.round(loop * 32767).astype('<i2')
        data = io.BytesIO()
        with wave.open(data, 'wb') as writer:
            writer.setnchannels(2); writer.setsampwidth(2); writer.setframerate(RATE)
            writer.writeframes(pcm.tobytes())
        wav = data.getvalue()
        frames = len(loop)
        seam = np.abs(pcm[0].astype(np.int32) - pcm[-1].astype(np.int32))
        adjacent = np.abs(np.diff(pcm.astype(np.int32), axis=0))
        if np.any(seam > np.max(adjacent, axis=0)):
            raise ValueError('接缝校验失败')
        energies = [float(np.sqrt(np.mean(part.astype(np.float64) ** 2))) / 32768 for part in np.array_split(pcm, frames // RATE)]
        if min(energies) < 0.0001:
            raise ValueError('循环包含静音段')
        archive = gzip.compress(wav, compresslevel=9, mtime=0)
        (output / f'{kind}.wav.gz').write_bytes(archive)
        items.append({'kind': kind, 'selection': selection, 'title': item['title'], 'author': item['author'], 'originalTitle': item['originalTitle'], 'source': item['source'], 'previewUrl': item['previewUrl'], 'license': 'CC0 1.0', 'licenseUrl': item['licenseUrl'], 'sourceSha256': item['sourceSha256'], 'sourceStartSeconds': start, 'sourceLengthSeconds': seconds, 'overlapSeconds': OVERLAP, 'gainDb': round(gain, 6), 'sampleRate': RATE, 'channels': 2, 'bitsPerSample': 16, 'frames': frames, 'duration': frames / RATE, 'wavBytes': len(wav), 'wavSha256': hashlib.sha256(wav).hexdigest(), 'archiveSha256': hashlib.sha256(archive).hexdigest(), 'rms': np.sqrt(np.mean((pcm.astype(np.float64) / 32768) ** 2, axis=0)).tolist(), 'peak': float(np.max(np.abs(pcm.astype(np.int32)))) / 32768, 'seamDelta': seam.tolist(), 'minimumSecondRms': min(energies)})
        items[-1]['channelDifferenceRms'] = float(np.sqrt(np.mean((pcm[:, 0].astype(np.float64) - pcm[:, 1]) ** 2))) / 32768
        print(kind, selection, frames / RATE, 'seconds, 2 channels, WAV', len(wav), 'bytes, archive', len(archive), 'bytes', flush=True)
    result = {'_copyright': '版权所有：波哥；仅适用于处理程序，原录音为各作者CC0贡献', 'format': 'PCM WAV / gzip', 'note': '用户确认雨B、风A、溪A；源为作者公开高质量MP3预览，并非原始无损录音。保持原双声道（雨B左右相同），恒定增益、去直流、2秒同音源等功率平滑交叠；PCM与gzip不再有损压缩。常规构建仅解压本地资产，无需联网或Python。', 'items': items}
    text = json.dumps(result, ensure_ascii=False, indent=2).replace('{\n  "_copyright":', '{ "_copyright":', 1)
    (output / 'sources.json').write_text(text + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='从已确认试听的原录音准备离线循环资产，不修改原始MP3。需numpy与imageio-ffmpeg。')
    parser.add_argument('--source-directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets' / 'ambience')
    args = parser.parse_args()
    prepare(args.source_directory.resolve(), args.output.resolve())
