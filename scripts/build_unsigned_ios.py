# 版权所有：波哥
import argparse
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = Path('ios/App/App.xcodeproj')
TARGET_ID = '504EC3031FED79650016851F'


def select_xcode(applications=Path('/Applications')):
    candidates = []
    for app in applications.glob('Xcode_*.app'):
        match = re.fullmatch(r'Xcode_(26(?:\.\d+)+)\.app', app.name)
        developer = app / 'Contents/Developer'
        if match and developer.is_dir():
            candidates.append((tuple(map(int, match[1].split('.'))), developer))
    if not candidates:
        raise RuntimeError('标准构建机未找到稳定版 Xcode 26，请核对 runner-images 清单；不要改用付费 larger runner。')
    return max(candidates)[1]


def check_sources(root=ROOT):
    required = [
        PROJECT / 'project.pbxproj',
        PROJECT / 'xcshareddata/xcschemes/App.xcscheme',
        Path('ios/App/App/Info.plist'),
        Path('ios/App/App/PrivacyInfo.xcprivacy'),
        Path('ios/App/CapApp-SPM/Package.swift'),
        Path('public/apple-touch-icon.png'),
        Path('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
        Path('package-lock.json'),
    ]
    for relative in required:
        if not (root / relative).is_file():
            raise RuntimeError(f'上传的源码不完整，缺少 {relative.as_posix()}')
    scheme = ET.parse(root / required[1]).getroot()
    references = scheme.findall('.//BuildableReference')
    if not references or any(ref.get('BlueprintIdentifier') != TARGET_ID for ref in references):
        raise RuntimeError('共享 scheme 未正确指向 App target。')
    project = (root / required[0]).read_text(encoding='utf-8')
    if TARGET_ID not in project or 'PrivacyInfo.xcprivacy in Resources' not in project:
        raise RuntimeError('Xcode 工程缺少目标或隐私清单资源。')
    for relative in required[2:4]:
        plistlib.loads((root / relative).read_bytes())
    print('PASS 源码、共享 scheme、Apple 配置、图标与依赖锁文件检查。', flush=True)


def archive_command(build_root):
    return [
        'xcodebuild', '-project', str(PROJECT), '-scheme', 'App',
        '-configuration', 'Release', '-sdk', 'iphoneos',
        '-destination', 'generic/platform=iOS',
        '-archivePath', str(build_root / 'Chanyue.xcarchive'),
        '-derivedDataPath', str(build_root / 'DerivedData'),
        '-clonedSourcePackagesDirPath', str(build_root / 'SourcePackages'),
        'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
        'CODE_SIGN_IDENTITY=', 'DEVELOPMENT_TEAM=',
        'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=NO', 'archive',
    ]


def run_logged(command, log, env):
    with log.open('w', encoding='utf-8') as stream:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        for line in process.stdout:
            print(line, end='', flush=True)
            stream.write(line)
        result = process.wait()
    if result:
        raise subprocess.CalledProcessError(result, command)


def archive_with_cache_retry(build_root, env):
    command = archive_command(build_root)
    log = build_root / 'xcodebuild.log'
    try:
        run_logged(command, log, env)
    except subprocess.CalledProcessError as error:
        output = log.read_text(encoding='utf-8')
        if error.returncode != 74 or not all(marker in output for marker in [
            'Could not resolve package dependencies', 'org.swift.swiftpm/artifacts/',
            'already exists in file system', 'binary target',
        ]):
            raise
        print('SwiftPM 二进制缓存写入冲突；保留缓存与首次日志，在同一构建机串行重试一次。', flush=True)
        run_logged(command, build_root / 'xcodebuild-retry.log', env)


def check_compiled_app(app):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
        raise RuntimeError('构建产物不是 iPhone 真机包。')
    executable = app / info['CFBundleExecutable']
    architectures = subprocess.check_output(['xcrun', 'lipo', '-archs', str(executable)], text=True).split()
    if 'arm64' not in architectures:
        raise RuntimeError('App 不包含 iPhone ARM64 可执行文件。')
    config = json.loads((app / 'capacitor.config.json').read_text(encoding='utf-8'))
    if config.get('server', {}).get('url'):
        raise RuntimeError('拒绝打包依赖远程服务器的 App。')
    if not (app / 'PrivacyInfo.xcprivacy').is_file() or not (app / 'public/index.html').is_file():
        raise RuntimeError('App 缺少本地入口或隐私声明。')
    for folder in ['cmaps', 'standard_fonts', 'wasm']:
        if not any((app / 'public/pdf-assets' / folder).iterdir()):
            raise RuntimeError(f'App 缺少 PDF 离线资源：{folder}')
    if not list((app / 'public/assets').glob('pdf.worker*.mjs')):
        raise RuntimeError('App 缺少 PDF 离线工作线程。')


def verify_ipa(path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for name in ['Payload/App.app/Info.plist', 'Payload/App.app/App',
                     'Payload/App.app/public/index.html', 'Payload/App.app/PrivacyInfo.xcprivacy',
                     'Payload/App.app/capacitor.config.json']:
            if name not in names:
                raise RuntimeError(f'IPA 缺少文件：{name}')
        if archive.testzip() is not None:
            raise RuntimeError('IPA 压缩包校验失败。')
        executable = archive.getinfo('Payload/App.app/App')
        if not (executable.external_attr >> 16) & 0o111:
            raise RuntimeError('IPA 未保留程序执行权限。')


def build():
    if sys.platform != 'darwin':
        raise RuntimeError('iOS 编译只能在 macOS/Xcode 运行；Windows 请使用 GitHub Actions。')
    check_sources()
    env = dict(os.environ)
    env['DEVELOPER_DIR'] = str(select_xcode())
    version = subprocess.check_output(['xcodebuild', '-version'], env=env, text=True)
    if not re.search(r'^Xcode 26\.', version, re.MULTILINE):
        raise RuntimeError(f'工具链不符合要求：{version}')
    print(version, flush=True)
    for relative in ['ios/App/App/public/index.html', 'ios/App/App/capacitor.config.json']:
        if not (ROOT / relative).is_file():
            raise RuntimeError('缺少同步后的离线资源，请先运行 npm run ios:sync。')
    output = ROOT / 'artifacts/ios-package'
    output.mkdir(parents=True, exist_ok=True)
    destination = output / 'Chanyue-unsigned.ipa'
    if destination.exists():
        raise RuntimeError('产物已存在，请先自行保存或移走旧 IPA，避免覆盖。')
    work = ROOT / 'artifacts/ios-build'
    work.mkdir(parents=True, exist_ok=True)
    build_root = Path(tempfile.mkdtemp(prefix='run-', dir=work))
    archive_with_cache_retry(build_root, env)
    app = build_root / 'Chanyue.xcarchive/Products/Applications/App.app'
    check_compiled_app(app)
    payload = build_root / 'Payload'
    payload.mkdir()
    subprocess.run(['/usr/bin/ditto', str(app), str(payload / 'App.app')], check=True, env=env)
    subprocess.run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                    str(payload), str(destination)], check=True, env=env)
    verify_ipa(destination)
    print(f'PASS 未签名真机 IPA：{destination.relative_to(ROOT)}', flush=True)
    print('请通过自己的免费 Apple ID 在本机签名安装；不要将 Apple 凭据上传到 GitHub。', flush=True)


def main():
    parser = argparse.ArgumentParser(description='构建禅阅未签名 iPhone IPA，不使用 Apple 账号或证书。')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check-only', action='store_true', help='仅跨平台检查源码及共享 scheme')
    mode.add_argument('--select-xcode', action='store_true', help='输出供 GitHub Actions 使用的 DEVELOPER_DIR')
    arguments = parser.parse_args()
    if arguments.select_xcode:
        print(f'DEVELOPER_DIR={select_xcode()}')
    elif arguments.check_only:
        check_sources()
    else:
        build()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'构建失败：{error}', file=sys.stderr)
        sys.exit(1)
