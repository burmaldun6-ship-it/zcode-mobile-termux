#!/usr/bin/env python3
"""Unit tests for the aapt2-based modules/builder pipeline."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BUILDER_DIR = os.path.dirname(TESTS_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(BUILDER_DIR))
sys.path.insert(0, BUILDER_DIR)

import align  # noqa: E402


class TestBuilder(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="test_builder_")

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _run(self, cmd, env=None):
        return subprocess.run(cmd, capture_output=True, text=True, env=env)

    def test_python_zipalign(self):
        raw_zip = os.path.join(self.tmp_dir, "raw.zip")
        aligned_zip = os.path.join(self.tmp_dir, "aligned.zip")
        with zipfile.ZipFile(raw_zip, "w") as z:
            z.writestr("test1.txt", "123", compress_type=zipfile.ZIP_STORED)
            z.writestr("test2.bin", "1234567", compress_type=zipfile.ZIP_STORED)
            z.writestr("compressed.dat", "Hello world", compress_type=zipfile.ZIP_DEFLATED)
        self.assertTrue(align.align_with_python(raw_zip, aligned_zip, 4))
        with zipfile.ZipFile(aligned_zip) as z:
            self.assertIsNone(z.testzip())
            self.assertEqual(z.read("test1.txt"), b"123")
            self.assertEqual(z.read("test2.bin"), b"1234567")
            for info in z.infolist():
                if info.compress_type == 0:
                    data_offset = info.header_offset + 30 + len(info.filename) + len(info.extra)
                    self.assertEqual(data_offset % 4, 0)

    def test_01_gen_config(self):
        build_dir = os.path.join(self.tmp_dir, "build")
        res = self._run([sys.executable, os.path.join(BUILDER_DIR, "01_gen_config.py"), build_dir],
                        env={**os.environ})
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(build_dir, "AndroidManifest.xml")))
        self.assertTrue(os.path.isfile(os.path.join(build_dir, "res", "values", "gen.xml")))
        self.assertTrue(os.path.isfile(
            os.path.join(build_dir, "gen", "com", "zcodemobile", "BuildConfig.java")))
        with open(os.path.join(build_dir, "AndroidManifest.xml"), encoding="utf-8") as f:
            manifest = f.read()
        self.assertIn('package="com.zcodemobile"', manifest)
        self.assertIn('android:versionName="3.18.2"', manifest)

    def test_02_aapt2_compile_link(self):
        build_dir = os.path.join(self.tmp_dir, "build")
        subprocess.run([sys.executable, os.path.join(BUILDER_DIR, "01_gen_config.py"), build_dir],
                       check=True, capture_output=True)
        args = [
            "bash", os.path.join(BUILDER_DIR, "02_r_java.sh"),
            os.path.join(build_dir, "gen"),
            os.path.join(build_dir, "AndroidManifest.xml"),
            os.path.join(PROJECT_ROOT, "app", "src", "main", "res"),
            os.path.join(PROJECT_ROOT, "tools", "android.jar"),
            os.path.join(build_dir, "res"),
            os.path.join(build_dir, "base.apk"),
            "24", "28", "1", "3.18.2",
        ]
        res = self._run(args)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(build_dir, "base.apk")))
        self.assertTrue(os.path.isfile(
            os.path.join(build_dir, "gen", "com", "zcodemobile", "R.java")))
        with zipfile.ZipFile(os.path.join(build_dir, "base.apk")) as z:
            self.assertIn("AndroidManifest.xml", z.namelist())
            self.assertIn("resources.arsc", z.namelist())

    def test_03_and_04_compile_and_dex(self):
        build_dir = os.path.join(self.tmp_dir, "build")
        subprocess.run([sys.executable, os.path.join(BUILDER_DIR, "01_gen_config.py"), build_dir],
                       check=True, capture_output=True)
        env = {**os.environ, "BUILD_DIR": build_dir}
        subprocess.run([
            "bash", os.path.join(BUILDER_DIR, "02_r_java.sh"),
            os.path.join(build_dir, "gen"),
            os.path.join(build_dir, "AndroidManifest.xml"),
            os.path.join(PROJECT_ROOT, "app", "src", "main", "res"),
            os.path.join(PROJECT_ROOT, "tools", "android.jar"),
            os.path.join(build_dir, "res"),
            os.path.join(build_dir, "base.apk"),
            "24", "28", "1", "3.18.2",
        ], check=True, capture_output=True)

        obj_dir = os.path.join(build_dir, "obj")
        res = self._run([
            "bash", os.path.join(BUILDER_DIR, "03_compile_java.sh"),
            obj_dir, os.path.join(build_dir, "gen"),
            os.path.join(PROJECT_ROOT, "app", "src", "main", "java"),
            os.path.join(PROJECT_ROOT, "tools", "android.jar"),
        ], env=env)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(build_dir, "java_sources.txt")))

        dex_dir = os.path.join(build_dir, "dex")
        res = self._run([
            "bash", os.path.join(BUILDER_DIR, "04_dex.sh"),
            dex_dir, obj_dir,
            os.path.join(PROJECT_ROOT, "tools", "r8.jar"),
            os.path.join(PROJECT_ROOT, "tools", "android.jar"), "24",
        ], env=env)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(build_dir, "class_files.txt")))
        self.assertTrue(os.path.isfile(os.path.join(dex_dir, "classes.dex")))


if __name__ == "__main__":
    unittest.main()
