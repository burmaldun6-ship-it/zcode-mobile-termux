package com.zcodemobile.runtime;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.util.AssetUnpacker;
import com.zcodemobile.util.AtomicFileWriter;
import com.zcodemobile.util.FileModeUtil;
import com.zcodemobile.util.IoUtil;
import com.zcodemobile.util.PathSafety;

import java.io.File;
import java.io.IOException;

/** Extracts assets/backend and assets/node into filesDir with marker verification. */
public final class CoreInstaller {

    private static final String TAG = "CoreInstaller";

    private CoreInstaller() {
    }

    public static void install(RuntimeManager rm) {
        Context ctx = rm.appContext();
        File files = rm.paths().getFilesDir();
        String stamp = versionStamp(ctx);

        File backendDir = rm.paths().getBackendDir();
        File nodeDir = rm.paths().getNodeDir();
        File webDir = rm.paths().getWebDir();

        if (!isUpToDate(files, backendDir, RuntimePaths.BACKEND_MARKER, stamp)
                || !rm.paths().getBootstrapFile().isFile()) {
            Log.i(TAG, "extracting assets/backend -> " + backendDir);
            try {
                wipe(files, backendDir);
                AssetUnpacker.unpackTree(ctx.getAssets(), RuntimePaths.BACKEND_ASSET, backendDir);
                File tools = new File(backendDir, "tools");
                if (tools.isDirectory()) {
                    FileModeUtil.recursiveSetExec(tools);
                }
                writeMarker(backendDir, RuntimePaths.BACKEND_MARKER, stamp);
            } catch (IOException e) {
                throw new IllegalStateException("cannot install backend: " + e.getMessage(), e);
            }
        } else {
            Log.i(TAG, "backend up to date");
        }

        if (!isUpToDate(files, nodeDir, RuntimePaths.NODE_MARKER, stamp)
                || !rm.paths().getNodeBin().isFile()) {
            Log.i(TAG, "extracting assets/node -> " + nodeDir);
            try {
                wipe(files, nodeDir);
                AssetUnpacker.unpackTree(ctx.getAssets(), RuntimePaths.NODE_ASSET, nodeDir);
                FileModeUtil.recursiveSetExec(new File(nodeDir, "bin"));
                writeMarker(nodeDir, RuntimePaths.NODE_MARKER, stamp);
            } catch (IOException e) {
                throw new IllegalStateException("cannot install node: " + e.getMessage(), e);
            }
        } else {
            Log.i(TAG, "node up to date");
        }

        if (AssetUnpacker.hasTree(ctx.getAssets(), RuntimePaths.WEB_ASSET)) {
            if (!isUpToDate(files, webDir, RuntimePaths.WEB_MARKER, stamp)) {
                try {
                    wipe(files, webDir);
                    AssetUnpacker.unpackTree(ctx.getAssets(), RuntimePaths.WEB_ASSET, webDir);
                    writeMarker(webDir, RuntimePaths.WEB_MARKER, stamp);
                } catch (IOException e) {
                    Log.w(TAG, "web asset extraction failed (non-fatal): " + e.getMessage());
                }
            }
        }

        if (!rm.paths().getNodeBin().isFile()) {
            throw new IllegalStateException("node binary missing: " + rm.paths().getNodeBin());
        }
        FileModeUtil.setExec(rm.paths().getNodeBin());
        if (!rm.paths().getBootstrapFile().isFile()) {
            throw new IllegalStateException("bootstrap.js missing: " + rm.paths().getBootstrapFile());
        }
    }

    private static String versionStamp(Context ctx) {
        long lastUpdate = 0;
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            lastUpdate = info.lastUpdateTime;
        } catch (Exception ignored) {
        }
        return ZCodeConfig.APP_VERSION_NAME + "." + lastUpdate;
    }

    private static boolean isUpToDate(File files, File dir, String markerName, String stamp) {
        File marker = new File(dir, markerName);
        if (!marker.isFile()) {
            return false;
        }
        try {
            return stamp.equals(IoUtil.readAll(new java.io.FileInputStream(marker), "UTF-8").trim());
        } catch (Exception e) {
            return false;
        }
    }

    private static void writeMarker(File dir, String name, String content) {
        AtomicFileWriter.writeText(new File(dir, name), content + "\n");
    }

    private static void wipe(File files, File dir) throws IOException {
        assertSafeToWipe(files, dir);
        if (!dir.exists()) {
            return;
        }
        try {
            Process process = new ProcessBuilder("/system/bin/rm", "-rf", dir.getAbsolutePath())
                    .redirectErrorStream(true).start();
            byte[] buf = new byte[1024];
            while (process.getInputStream().read(buf) > 0) {
            }
            int code = process.waitFor();
            Log.i(TAG, "rm -rf " + dir.getName() + " exit=" + code);
        } catch (Exception e) {
            Log.w(TAG, "rm -rf failed for " + dir + ": " + e.getMessage());
        }
        if (dir.exists()) {
            wipeJava(dir);
        }
        if (dir.exists()) {
            throw new IOException("cannot delete " + dir);
        }
    }

    private static void wipeJava(File dir) {
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                wipeJava(child);
            }
        }
        try {
            dir.setWritable(true, false);
            dir.setExecutable(true, false);
        } catch (Exception ignored) {
        }
        dir.delete();
    }

    /** Only regenerable asset dirs may be wiped; never filesDir or user data. */
    private static void assertSafeToWipe(File files, File dir) throws IOException {
        String target = dir.getCanonicalPath();
        if (!PathSafety.isInside(files, dir) || target.equals(files.getCanonicalPath())) {
            throw new IOException("refusing to wipe outside filesDir: " + dir);
        }
        String[] protectedNames = {RuntimePaths.USER_DATA_DIR, "usr", "logs", "shared_prefs"};
        for (String name : protectedNames) {
            String protectedPath = new File(files, name).getCanonicalPath();
            if (target.equals(protectedPath) || target.startsWith(protectedPath + File.separator)) {
                throw new IOException("refusing to wipe protected dir: " + dir);
            }
        }
    }
}
