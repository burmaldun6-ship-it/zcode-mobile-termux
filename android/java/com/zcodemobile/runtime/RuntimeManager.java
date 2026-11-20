package com.zcodemobile.runtime;

import android.content.Context;
import android.util.Log;

import com.zcodemobile.core.CoreEnvironment;
import com.zcodemobile.install.EnvInstaller;
import com.zcodemobile.oauth.SecretStore;

import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/** Installs bundled assets and describes how to launch the Bionic Node backend. */
public final class RuntimeManager {

    private static final String TAG = "RuntimeManager";

    private final Context appContext;
    private final RuntimePaths paths;
    private final AtomicBoolean envInstallStarted = new AtomicBoolean(false);

    public RuntimeManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.paths = new RuntimePaths(context);
    }

    public Context appContext() {
        return appContext;
    }

    public RuntimePaths paths() {
        return paths;
    }

    public File getNodeBin() {
        return paths.getNodeBin();
    }

    public File getBootstrapFile() {
        return paths.getBootstrapFile();
    }

    public String getCredentialSecret() {
        return SecretStore.getOrCreate(appContext);
    }

    /** Phase 1: extract backend + node (fail-closed). */
    public synchronized void installCore() {
        CoreInstaller.install(this);
    }

    /**
     * Phase 2: optional Bionic userspace, deferred until the backend is already
     * serving. Never blocks the Node/WebView launch path.
     */
    public void installEnvInBackground() {
        if (!envInstallStarted.compareAndSet(false, true)) {
            return;
        }
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Thread.sleep(3500);
                    if (!EnvInstaller.isInstalled(appContext)) {
                        String status = EnvInstaller.install(appContext);
                        Log.i(TAG, "env install: " + status);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    Log.w(TAG, "env install failed (non-fatal): " + e.getMessage());
                }
            }
        }, "ZCodeEnvInstaller");
        thread.setDaemon(true);
        thread.start();
    }

    /** Bionic Node needs no glibc loader: exec node <backend>/bootstrap.js. */
    public String[] coreCommand() {
        File node = paths.getNodeBin();
        File bootstrap = paths.getBootstrapFile();
        if (!node.isFile()) {
            throw new IllegalStateException("node binary missing: " + node);
        }
        if (!bootstrap.isFile()) {
            throw new IllegalStateException("bootstrap.js missing: " + bootstrap);
        }
        return new String[]{node.getAbsolutePath(), bootstrap.getAbsolutePath()};
    }

    public void applyEnvironment(ProcessBuilder pb) {
        CoreEnvironment.apply(this, pb);
    }
}
