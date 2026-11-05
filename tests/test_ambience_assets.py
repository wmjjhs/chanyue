# 版权所有：波哥
import array
import gzip
import hashlib
import io
import json
import math
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/ambience'
EXPECTED = {'rain': ('rain-b', '167034', 24), 'wind': ('wind-a', '475448', 58), 'stream': ('stream-a', '446019', 58)}


class AmbienceAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ASSETS / 'sources.json').read_text(encoding='utf-8'))
        cls.items = {item['kind']: item for item in cls.manifest['items']}
        cls.wav = {kind: gzip.decompress((ASSETS / f'{kind}.wav.gz').read_bytes()) for kind in EXPECTED}

    def test_selected_recordings_and_license(self):
        self.assertEqual(set(self.items), set(EXPECTED))
        for kind, (selection, sound_id, duration) in EXPECTED.items():
            with self.subTest(kind=kind):
                item = self.items[kind]
                self.assertEqual(item['selection'], selection)
                self.assertTrue(item['source'].endswith(f'/sounds/{sound_id}/'))
                self.assertEqual(item['licenseUrl'], 'https://creativecommons.org/publicdomain/zero/1.0/')
                self.assertEqual(item['duration'], duration)
                self.assertEqual(item['overlapSeconds'], 2)

    def test_wave_layout_and_checksums(self):
        for kind, (_, _, duration) in EXPECTED.items():
            with self.subTest(kind=kind):
                item, data = self.items[kind], self.wav[kind]
                self.assertEqual(hashlib.sha256(data).hexdigest(), item['wavSha256'])
                self.assertEqual(hashlib.sha256((ASSETS / f'{kind}.wav.gz').read_bytes()).hexdigest(), item['archiveSha256'])
                self.assertEqual(len(data), 44 + duration * 44100 * 4)
                self.assertEqual(len(data), item['wavBytes'])
                self.assertLessEqual(len(data), 11_000_000)
                with wave.open(io.BytesIO(data)) as reader:
                    self.assertEqual((reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getnframes()), (2, 2, 44100, duration * 44100))

    def test_continuity_energy_and_original_channels(self):
        for kind, data in self.wav.items():
            with self.subTest(kind=kind):
                samples = array.array('h', data[44:])
                if sys.byteorder != 'little':
                    samples.byteswap()
                left, right = samples[::2], samples[1::2]
                for channel, pcm in enumerate((left, right)):
                    peak = max(abs(sample) for sample in pcm) / 32768
                    rms = math.sqrt(sum(sample * sample for sample in pcm) / len(pcm)) / 32768
                    self.assertLessEqual(peak, 0.701)
                    self.assertAlmostEqual(rms, self.items[kind]['rms'][channel], places=8)
                    self.assertLess(abs(sum(pcm) / len(pcm)), 1)
                    self.assertLessEqual(abs(pcm[0] - pcm[-1]), max(abs(a - b) for a, b in zip(pcm, pcm[1:])))
                    for offset in range(0, len(pcm), 44100):
                        part = pcm[offset:offset + 44100]
                        self.assertGreater(sum(sample * sample for sample in part) / len(part), 10)
                self.assertEqual(left == right, kind == 'rain')

    def test_offline_node_extraction_and_tamper_rejection(self):
        (ROOT / 'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='audio-assets-', dir=ROOT / 'artifacts') as directory:
            target = Path(directory)
            module = (ROOT / 'scripts/generate-ambience.mjs').as_uri()
            script = f"import assert from 'node:assert/strict';import {{writeAmbience,verifyAmbience}} from {json.dumps(module)};import {{readFileSync}} from 'node:fs';const root=new URL({json.dumps(target.as_uri() + '/')});writeAmbience(root);const good=readFileSync(new URL('rain.wav',root));verifyAmbience(good,'rain');const bad=Buffer.from(good);bad[100]^=1;assert.throws(()=>verifyAmbience(bad,'rain'));assert.throws(()=>verifyAmbience(good,'wind'));assert.throws(()=>verifyAmbience(good,'unknown'));writeAmbience(root);"
            result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            for kind, data in self.wav.items():
                self.assertEqual((target / f'{kind}.wav').read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
