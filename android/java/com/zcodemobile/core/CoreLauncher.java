package com.zcodemobile.core;

import android.util.Log;

import com.zcodemobile.runtime.RuntimeManager;
import com.zcodemobile.util.ProcessUtils;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

/** Installs the backend then launches the Bionic Node process. */
public final class CoreLauncher {

    private static final String TAG = "CoreLauncher";

    private CoreLauncher() {
    }

    /** Kill leftover backend processes from previous sessions to free the loopback port. */
    public static void killOrphanBackendProcesses() {
        killOrphanBackendProcesses(null);
    }

    public static void killOrphanBackendProcesses(File filesDir) {
        int myPid = android.os.Process.myPid();
        String appRoot = filesDir == null ? null : filesDir.getAbsolutePath();
        File[] entries = new File("/proc").listFiles();
        if (entries == null) {
            return;
        }
        boolean killed = false;
        for (File entry : entries) {
            String name = entry.getName();
            if (!name.matches("\\d+")) {
                continue;
            }
            try {
                int pid = Integer.parseInt(name);
                if (pid == myPid) {
                    continue;
                }
                File cmdline = new File(entry, "cmdline");
                if (!cmdline.canRead()) {
                    continue;
                }
                byte[] buf = new byte[512];
                int n;
                try (FileInputStream in = new FileInputStream(cmdline)) {
                    n = in.read(buf);
                }
                if (n > 0) {
                    String cmd = new String(buf, 0, n).replace('\0', ' ');
                    if (appRoot != null ? cmd.contains(appRoot)
                            : (cmd.contains("backend/bootstrap.js")
                            || cmd.contains("out/host/index.js")
                            || cmd.contains("out/scheduler/index.js")
                            || cmd.contains("out/extension-host/index.js")
                            || cmd.contains("zcode.cjs"))) {
                        Log.w(TAG, "killing orphan backend pid=" + pid + " cmd=" + cmd);
                        android.os.Process.sendSignal(pid, android.os.Process.SIGNAL_KILL);
                        killed = true;
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (killed) {
            ProcessUtils.sleep(200);
        }
    }

    public static Process launch(RuntimeManager runtime, File filesDir) throws IOException {
        killOrphanBackendProcesses(filesDir);
        runtime.installCore();
        runtime.installEnvInBackground();
        ProcessBuilder pb = new ProcessBuilder(runtime.coreCommand());
        pb.directory(filesDir);
        pb.redirectErrorStream(true);
        runtime.applyEnvironment(pb);
        return pb.start();
    }
}
