# 版权所有：波哥
"""为 Android 构建准备官方 sherpa-onnx AAR 与随包内置的离线神经语音模型。

所有资源都按官方发布的字节数与 SHA-256 校验；不生成、不替换任何密钥，
也不把书籍正文或用户数据发送到网络。仅在构建机上运行。
"""
import hashlib
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'artifacts/android-tools'
AAR_NAME = 'sherpa-onnx-2.0.1.aar'
AAR_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/' + AAR_NAME
AAR_SHA256 = 'a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7'
AAR_BYTES = 49441341
AAR_SOURCE = TOOLS / AAR_NAME
AAR_TARGET = ROOT / 'android/app/libs' / AAR_NAME
MODEL_SOURCE = ROOT / 'artifacts/tts-models/bundle/tts'
MODEL_TARGET = ROOT / 'android/app/src/main/assets/tts'
MODEL_FILES = {
    'model.onnx': 170429550,
    'lexicon.txt': 6837671,
    'tokens.txt': 655,
    'date.fst': 59154,
    'number.fst': 64482,
    'LICENSE': 1053,
    'README.md': 257,
}
GENERATED_GRADLE = (
    ROOT / 'android/app/capacitor.build.gradle',
    ROOT / 'android/capacitor.settings.gradle',
)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or ''
        allowed = host == 'github.com' or host.endswith('.githubusercontent.com')
        if parsed.scheme != 'https' or parsed.port not in (None, 443) or not allowed or parsed.username or parsed.password:
            raise RuntimeError('AAR 下载重定向到未授权的主机，已中止。')
        return urllib.request.Request(url, headers={'User-Agent': 'Chanyue-Android-TTS'})


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def valid_aar(path: Path) -> bool:
    return path.is_file() and path.stat().st_size == AAR_BYTES and sha256(path) == AAR_SHA256


def ensure_aar() -> None:
    if not valid_aar(AAR_SOURCE):
        TOOLS.mkdir(parents=True, exist_ok=True)
        opener = urllib.request.build_opener(SafeRedirect())
        request = urllib.request.Request(AAR_URL, headers={'User-Agent': 'Chanyue-Android-TTS'})
        total, digest = 0, hashlib.sha256()
        with opener.open(request, timeout=120) as response, AAR_SOURCE.open('wb') as stream:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > AAR_BYTES:
                    raise RuntimeError('AAR 超过官方发布的字节数，已中止。')
                digest.update(block)
                stream.write(block)
        if total != AAR_BYTES or digest.hexdigest() != AAR_SHA256:
            raise RuntimeError('AAR SHA-256 校验失败，已中止构建。')
    AAR_TARGET.parent.mkdir(parents=True, exist_ok=True)
    if not valid_aar(AAR_TARGET):
        shutil.copy2(AAR_SOURCE, AAR_TARGET)
    if not valid_aar(AAR_TARGET):
        raise RuntimeError('写入 Gradle 依赖目录的 AAR 校验失败。')


def ensure_models() -> None:
    def complete() -> bool:
        return all((MODEL_SOURCE / name).is_file() and (MODEL_SOURCE / name).stat().st_size == size
                   for name, size in MODEL_FILES.items())

    if not complete():
        subprocess.run([sys.executable, str(ROOT / 'scripts/fetch_tts_model.py')], cwd=ROOT, check=True)
    if not complete():
        raise RuntimeError('离线神经语音模型不完整，请先运行 scripts/fetch_tts_model.py。')
    MODEL_TARGET.mkdir(parents=True, exist_ok=True)
    for name, size in MODEL_FILES.items():
        source, target = MODEL_SOURCE / name, MODEL_TARGET / name
        if target.is_file() and target.stat().st_size == size and sha256(target) == sha256(source):
            continue
        shutil.copy2(source, target)
        if target.stat().st_size != size or sha256(target) != sha256(source):
            raise RuntimeError('模型文件写入 Android assets 后校验失败：' + name)
    extra = {path.name for path in MODEL_TARGET.iterdir() if path.is_file()} - set(MODEL_FILES)
    if extra:
        raise RuntimeError('Android tts assets 存在非预期文件：' + ', '.join(sorted(extra)))


def restore_copyright() -> None:
    """Capacitor 每次同步都会重写 Gradle 生成文件，这里按原字节补回首行版权注释。"""
    for path in GENERATED_GRADLE:
        if not path.is_file():
            continue
        data = path.read_bytes()
        bom = b'\xef\xbb\xbf' if data.startswith(b'\xef\xbb\xbf') else b''
        body = data[len(bom):]
        newline = b'\r\n' if b'\r\n' in body[:200] else b'\n'
        line = '// 版权所有：波哥'.encode('utf-8') + newline
        if body.startswith(line):
            continue
        path.write_bytes(bom + line + body)


def main() -> None:
    ensure_aar()
    ensure_models()
    restore_copyright()
    print('PASS Android 原生语音资源已就位：', AAR_TARGET.relative_to(ROOT), '与', MODEL_TARGET.relative_to(ROOT), flush=True)
    print('sherpa-onnx v2.0.1 官方 AAR 与 vits-melo-tts-zh_en（MIT）模型仅随安装包内置，不联网合成。', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Android 原生语音资源准备失败：', str(error), flush=True)
        raise SystemExit(1)
