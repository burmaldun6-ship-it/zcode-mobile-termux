package com.zcodemobile.runtime;

import android.content.Context;

import java.io.File;

/** Resolves app-private runtime directories and bundled asset names. */
public final class RuntimePaths {

    public static final String BACKEND_ASSET = "backend";
    public static final String NODE_ASSET = "node";
    public static final String WEB_ASSET = "web";

    public static final String BACKEND_MARKER = ".zcode_backend_installed";
    public static final String NODE_MARKER = ".zcode_node_installed";
    public static final String WEB_MARKER = ".zcode_web_installed";

    public static final String BOOTSTRAP_REL = "bootstrap.js";
    public static final String NODE_REL = "bin/node";
    public static final String USER_DATA_DIR = ".zcode";

    private final Context appContext;

    public RuntimePaths(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public File getFilesDir() {
        return appContext.getFilesDir();
    }

    public File getCacheDir() {
        return appContext.getCacheDir();
    }

    public File getBackendDir() {
        return new File(getFilesDir(), BACKEND_ASSET);
    }

    public File getNodeDir() {
        return new File(getFilesDir(), NODE_ASSET);
    }

    public File getWebDir() {
        return new File(getFilesDir(), WEB_ASSET);
    }

    public File getBootstrapFile() {
        return new File(getBackendDir(), BOOTSTRAP_REL);
    }

    public File getNodeBin() {
        return new File(getNodeDir(), NODE_REL);
    }

    public File getUsrBinDir() {
        return new File(getFilesDir(), "usr/bin");
    }
}
