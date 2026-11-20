package com.zcodemobile.core;

import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import com.zcodemobile.runtime.RuntimeManager;

/** Foreground host for the Bionic Node backend. */
public final class CoreServerService extends Service {

    private static final String TAG = "CoreServerService";

    private RuntimeManager runtime;
    private WakeLockHolder wakeLock;
    private CoreProcessSupervisor supervisor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean destroyed;

    @Override
    public void onCreate() {
        super.onCreate();
        destroyed = false;
        runtime = new RuntimeManager(this);
        CoreRuntimeState.backendUrl = null;
        CoreRuntimeState.lastError = null;
        CoreRuntimeState.restarting = false;

        ForegroundNotification.start(this);
        wakeLock = new WakeLockHolder();
        wakeLock.acquire(this);

        Log.i(TAG, "starting backend from " + runtime.paths().getBootstrapFile());
        supervisor = new CoreProcessSupervisor(this, runtime, new Runnable() {
            @Override
            public void run() {
                onSupervisorTerminated();
            }
        });
        supervisor.start();
    }

    private void onSupervisorTerminated() {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (destroyed) {
                    return;
                }
                CoreRuntimeState.backendUrl = null;
                CoreRuntimeState.restarting = false;
                if (CoreRuntimeState.lastError == null) {
                    CoreRuntimeState.lastError = "backend supervisor stopped unexpectedly";
                }
                if (wakeLock != null) {
                    wakeLock.release();
                }
                ForegroundNotification.update(CoreServerService.this, "Backend stopped — reopen the app");
            }
        });
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        mainHandler.removeCallbacksAndMessages(null);
        if (supervisor != null) {
            supervisor.stop();
        }
        if (wakeLock != null) {
            wakeLock.release();
        }
        CoreRuntimeState.backendUrl = null;
        CoreRuntimeState.lastError = null;
        CoreRuntimeState.restarting = false;
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
