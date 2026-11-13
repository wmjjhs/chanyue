# 版权所有：波哥
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts/android'
TTS_ASSETS = ('model.onnx', 'lexicon.txt', 'tokens.txt', 'date.fst', 'number.fst')


def run(command, **kwargs):
    return subprocess.run(command, cwd=ROOT, check=True, **kwargs)


def stream_sha256(stream):
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(block)
    return digest.hexdigest()


def verify_assets(archive):
    config = json.loads(archive.read('assets/capacitor.config.json'))
    if config.get('appId') != 'app.chanyue.reader' or config.get('server', {}).get('url'):
        raise RuntimeError('Android配置不是预期的离线应用')
    if config.get('android', {}).get('webContentsDebuggingEnabled') is not False:
        raise RuntimeError('未禁用生产WebView调试')
    for source in (ROOT / 'dist-native').rglob('*'):
        if source.is_file():
            name = 'assets/public/' + source.relative_to(ROOT / 'dist-native').as_posix()
            if archive.read(name) != source.read_bytes():
                raise RuntimeError('APK与已验证离线资源不同：' + name)
    names = set(archive.namelist())
    if any(name.endswith(('/sw.js', '/registerSW.js')) for name in names):
        raise RuntimeError('原生安装包不应包含Service Worker')
    for name in TTS_ASSETS:
        entry = 'assets/tts/' + name
        source = ROOT / 'android/app/src/main/assets/tts' / name
        if entry not in names or not source.is_file():
            raise RuntimeError('APK缺少内置神经语音模型：' + name)
        with archive.open(entry) as packed, source.open('rb') as local:
            if stream_sha256(packed) != stream_sha256(local):
                raise RuntimeError('APK内神经语音模型与已校验文件不一致：' + name)
    if not any(part.startswith('lib/') and part.endswith('/libsherpa-onnx-jni.so') for part in names):
        raise RuntimeError('APK缺少本地神经语音JNI库')


def main():
    parser = argparse.ArgumentParser(description='编译并验证签名Android Release APK；签名参数仅从环境读取')
    parser.add_argument('--skip-sync', action='store_true')
    args = parser.parse_args()
    for key in ['JAVA_HOME', 'ANDROID_HOME', 'CHANYUE_KEYSTORE_PATH', 'CHANYUE_KEYSTORE_PASSWORD']:
        if not os.environ.get(key):
            raise RuntimeError('缺少环境变量：' + key)
    if not Path(os.environ['CHANYUE_KEYSTORE_PATH']).is_file():
        raise RuntimeError('签名密钥不存在，禁止自动生成其他密钥替代')
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise RuntimeError('版本号不合法')
    build_text = (ROOT / 'android/app/build.gradle').read_text(encoding='utf-8')
    version_code = re.search(r'versionCode (\d+)', build_text).group(1)
    run([sys.executable, str(ROOT / 'scripts/prepare_android_native.py')])
    windows = os.name == 'nt'
    npm = 'npm.cmd' if windows else 'npm'
    if not args.skip_sync:
        run([npm, 'run', 'android:sync'])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    gradle = str(ROOT / ('android/gradlew.bat' if windows else 'android/gradlew'))
    with (OUTPUT / 'build.log').open('w', encoding='utf-8') as log:
        subprocess.run([gradle, 'assembleRelease', '--no-daemon', '--console=plain', '--max-workers=1', '--no-watch-fs', '--stacktrace'], cwd=ROOT / 'android', stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800)
    apk = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
    tools = Path(os.environ['ANDROID_HOME']) / 'build-tools/36.0.0'
    signer = tools / ('apksigner.bat' if windows else 'apksigner')
    aapt = tools / ('aapt.exe' if windows else 'aapt')
    signature = run([str(signer), 'verify', '--verbose', '--print-certs', str(apk)], capture_output=True, text=True).stdout
    badging = run([str(aapt), 'dump', 'badging', str(apk)], capture_output=True).stdout.decode('utf-8', errors='replace')
    if not re.search(r"package: name='app.chanyue.reader' versionCode='" + version_code + r"' versionName='" + re.escape(version) + "'", badging):
        raise RuntimeError('APK应用标识或版本号不符')
    if 'application-debuggable' in badging or "sdkVersion:'24'" not in badging:
        raise RuntimeError('APK不是预期的非调试Android7+安装包')
    if 'Verified using v2 scheme (APK Signature Scheme v2): true' not in signature:
        raise RuntimeError('APK缺少有效的v2签名')
    with zipfile.ZipFile(apk) as archive:
        verify_assets(archive)
    destination = OUTPUT / f'Chanyue-{version}-android.apk'
    shutil.copy2(apk, destination)
    metadata = {'_copyright': '版权所有：波哥', 'version': version, 'versionCode': int(version_code), 'package': 'app.chanyue.reader', 'signed': True, 'debuggable': False, 'minAndroid': '7.0', 'apk': str(destination), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'installed_on_phone': False}
    (OUTPUT / 'package.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS Android Release签名、版本、无调试、完整离线资源：', destination, flush=True)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print('Android构建/校验失败，退出码：', error.returncode, '；检查 artifacts/android/build.log', flush=True)
        raise SystemExit(1)
    except Exception as error:
        print('Android构建未完成：', str(error), flush=True)
        raise SystemExit(1)
