# 版权所有：波哥
import importlib.util
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ios_packaging', ROOT / 'scripts/build_unsigned_ios.py')
packaging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packaging)


class IOSPackagingTests(unittest.TestCase):
    def test_archive_is_unsigned_release_for_real_iphone(self):
        command = packaging.archive_command(Path('artifacts/test-build'))
        for item in ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=',
                     'DEVELOPMENT_TEAM=', 'ARCHS=arm64', 'generic/platform=iOS', 'Release', 'archive']:
            self.assertIn(item, command)
        self.assertNotIn('-allowProvisioningUpdates', command)
        self.assertNotIn('-exportArchive', command)
        self.assertEqual(command[command.index('-scheme') + 1], 'App')
        self.assertEqual(command[command.index('-packageCachePath') + 1], str(Path('artifacts/test-build/PackageCache')))

    def test_selects_installed_stable_xcode_26_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ['Xcode_16.4.app', 'Xcode_26.2.app', 'Xcode_26.3.app', 'Xcode_26.4_beta.app']:
                (root / name / 'Contents/Developer').mkdir(parents=True)
            self.assertEqual(packaging.select_xcode(root), root / 'Xcode_26.3.app/Contents/Developer')

    def test_missing_xcode_fails_instead_of_using_unknown_toolchain(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, 'Xcode 26'):
                packaging.select_xcode(Path(temporary))

    def test_xcode_failure_is_not_hidden_by_log_collection(self):
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / 'build.log'
            with patch.object(packaging.subprocess, 'Popen') as popen:
                popen.return_value.stdout = iter(['compile failed\n'])
                popen.return_value.wait.return_value = 65
                with self.assertRaises(subprocess.CalledProcessError) as error:
                    packaging.run_logged(['xcodebuild'], log, {})
                self.assertEqual(error.exception.returncode, 65)
                self.assertEqual(log.read_text(encoding='utf-8'), 'compile failed\n')

    def test_binary_cache_collision_retries_once_and_preserves_logs(self):
        message = "Could not resolve package dependencies: binary target Cordova /Library/Caches/org.swift.swiftpm/artifacts/item already exists in file system"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def run(command, log, env):
                log.write_text(message if log.name == 'xcodebuild.log' else 'archive succeeded', encoding='utf-8')
                if log.name == 'xcodebuild.log':
                    raise subprocess.CalledProcessError(74, command)
            with patch.object(packaging, 'run_logged', side_effect=run) as runner:
                packaging.archive_with_cache_retry(root, {})
                self.assertEqual(runner.call_count, 2)
                self.assertEqual(runner.call_args_list[0].args[0], runner.call_args_list[1].args[0])
            self.assertEqual((root / 'xcodebuild.log').read_text(encoding='utf-8'), message)
            self.assertEqual((root / 'xcodebuild-retry.log').read_text(encoding='utf-8'), 'archive succeeded')

    def test_other_archive_errors_are_not_retried(self):
        for code, message in [(65, 'compile failed'), (74, 'Could not resolve package dependencies: checksum mismatch')]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'xcodebuild.log').write_text(message, encoding='utf-8')
                with patch.object(packaging, 'run_logged', side_effect=subprocess.CalledProcessError(code, ['xcodebuild'])) as runner:
                    with self.assertRaises(subprocess.CalledProcessError):
                        packaging.archive_with_cache_retry(root, {})
                    self.assertEqual(runner.call_count, 1)

    def test_repeated_cache_collision_still_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'xcodebuild.log').write_text('Could not resolve package dependencies: binary target /org.swift.swiftpm/artifacts/item already exists in file system', encoding='utf-8')
            with patch.object(packaging, 'run_logged', side_effect=subprocess.CalledProcessError(74, ['xcodebuild'])) as runner:
                with self.assertRaises(subprocess.CalledProcessError):
                    packaging.archive_with_cache_retry(root, {})
                self.assertEqual(runner.call_count, 2)

    def make_ipa(self, path, executable_mode=0o100755, omit=None):
        with zipfile.ZipFile(path, 'w') as archive:
            for filename in ['Info.plist', 'App', 'public/index.html', 'PrivacyInfo.xcprivacy', 'capacitor.config.json']:
                if filename == omit:
                    continue
                entry = zipfile.ZipInfo(f'Payload/App.app/{filename}')
                entry.create_system = 3
                entry.external_attr = (executable_mode if filename == 'App' else 0o100644) << 16
                archive.writestr(entry, b'packaging test fixture, not an iOS executable')

    def test_ipa_layout_and_executable_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            ipa = Path(temporary) / 'test.ipa'
            self.make_ipa(ipa)
            packaging.verify_ipa(ipa)
            self.make_ipa(ipa, executable_mode=0o100644)
            with self.assertRaisesRegex(RuntimeError, '执行权限'):
                packaging.verify_ipa(ipa)
            self.make_ipa(ipa, omit='PrivacyInfo.xcprivacy')
            with self.assertRaisesRegex(RuntimeError, '缺少文件'):
                packaging.verify_ipa(ipa)

    def test_source_requirements_match_current_project(self):
        packaging.check_sources(ROOT)

    def test_windows_cannot_report_a_successful_native_build(self):
        with patch.object(packaging.sys, 'platform', 'win32'):
            with self.assertRaisesRegex(RuntimeError, 'macOS'):
                packaging.build()


if __name__ == '__main__':
    unittest.main()
