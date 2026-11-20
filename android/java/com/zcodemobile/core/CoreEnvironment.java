package com.zcodemobile.core;

import android.util.Log;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.runtime.RuntimeManager;

import java.io.File;
import java.util.Map;

/** Builds the Bionic environment for the Node backend child process. */
public final class CoreEnvironment {

    private static final String TAG = "CoreEnvironment";

    private CoreEnvironment() {
    }

    public static void apply(RuntimeManager rm, ProcessBuilder pb) {
        File files = rm.paths().getFilesDir();
        File usrBin = rm.paths().getUsrBinDir();
        Map<String, String> env = pb.environment();

        env.put("HOME", files.getAbsolutePath());
        env.put("ZCODE_DATA_BASE_DIR", files.getAbsolutePath());
        env.put("ZCODE_CREDENTIAL_SECRET", rm.getCredentialSecret());
        env.put("TMPDIR", rm.paths().getCacheDir().getAbsolutePath());
        env.put("PATH", usrBin.getAbsolutePath() + ":/system/bin");
        env.put("ZCODE_BRIDGE_HOST", ZCodeConfig.HOST);
        env.put("ZCODE_BRIDGE_PORT", String.valueOf(ZCodeConfig.PORT));
        env.put("ZCODE_NODE_BIN", rm.paths().getNodeBin().getAbsolutePath());
        env.put("ZCODE_LIB_DIR", new File(rm.paths().getNodeDir(), "lib").getAbsolutePath());
        env.put("TERM", "xterm-256color");
        env.put("LANG", "C.UTF-8");
        env.put("LC_ALL", "C.UTF-8");

        // Bionic Node must not inherit glibc/Bionic loader overrides from the app
        // process. bootstrap.js re-adds its own library path for forked children.
        env.remove("LD_PRELOAD");
        env.remove("LD_LIBRARY_PATH");

        Log.i(TAG, "backend env: HOME=" + files.getAbsolutePath()
                + " PATH=" + env.get("PATH")
                + " TMPDIR=" + env.get("TMPDIR"));
    }
}
