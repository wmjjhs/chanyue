# 版权所有：波哥
"""下载并校验随 App 内置的离线中文神经语音模型（只在构建机运行）。"""
import hashlib
import shutil
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2'
ARCHIVE_SHA256 = 'e58351ed7149f290a54534538badd4077cdbe6fddc964b24d0bee870415d1514'
ARCHIVE_BYTES = 167006755
PREFIX = 'vits-melo-tts-zh_en/'
MODEL_FILES = {
    'model.onnx': 170429550,
    'lexicon.txt': 6837671,
    'tokens.txt': 655,
    'date.fst': 59154,
    'number.fst': 64482,
    'LICENSE': 1053,
    'README.md': 257,
}
ARCHIVE = ROOT / 'artifacts/tts-models/vits-melo-tts-zh_en.tar.bz2'
OUTPUT = ROOT / 'artifacts/tts-models/bundle/tts'


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or ''
        allowed = host == 'github.com' or host.endswith('.githubusercontent.com')
        if parsed.scheme != 'https' or parsed.port not in (None, 443) or not allowed or parsed.username or parsed.password:
            raise RuntimeError('模型下载重定向到未授权的主机，已中止。')
        return urllib.request.Request(url, headers={'User-Agent': 'Chanyue-TTS-Model'})


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download() -> None:
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    if ARCHIVE.is_file() and ARCHIVE.stat().st_size == ARCHIVE_BYTES and sha256(ARCHIVE) == ARCHIVE_SHA256:
        print('模型压缩包已存在且哈希一致，跳过重复下载。', flush=True)
        return
    opener = urllib.request.build_opener(SafeRedirect())
    total, digest = 0, hashlib.sha256()
    with opener.open(urllib.request.Request(URL, headers={'User-Agent': 'Chanyue-TTS-Model'}), timeout=120) as response:
        with ARCHIVE.open('wb') as stream:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > ARCHIVE_BYTES:
                    raise RuntimeError('模型压缩包超过预期大小，已中止。')
                digest.update(block)
                stream.write(block)
    if total != ARCHIVE_BYTES or digest.hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError('模型压缩包 SHA-256 校验失败，已中止构建。')


def extract() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    found = set()
    with tarfile.open(ARCHIVE, 'r:bz2') as bundle:
        for member in bundle.getmembers():
            if not member.name.startswith(PREFIX) or '..' in Path(member.name).parts:
                continue
            relative = member.name[len(PREFIX):]
            if relative not in MODEL_FILES:
                continue
            if not member.isfile() or member.size != MODEL_FILES[relative]:
                raise RuntimeError(f'模型文件大小异常：{relative}')
            source = bundle.extractfile(member)
            if source is None:
                raise RuntimeError(f'模型文件不可读取：{relative}')
            with source, (OUTPUT / relative).open('wb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
            if (OUTPUT / relative).stat().st_size != MODEL_FILES[relative]:
                raise RuntimeError(f'模型文件写入不完整：{relative}')
            found.add(relative)
    if found != set(MODEL_FILES):
        raise RuntimeError('模型压缩包缺少预期的文件。')


def main() -> None:
    download()
    extract()
    print(f'PASS 离线神经语音模型已校验：{OUTPUT.relative_to(ROOT)}，{len(MODEL_FILES)} 个文件。', flush=True)
    print('模型来源：k2-fsa/sherpa-onnx vits-melo-tts-zh_en（MIT），仅随安装包内置，不上传任何书籍正文。', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'模型准备失败：{error}', flush=True)
        raise SystemExit(1)
