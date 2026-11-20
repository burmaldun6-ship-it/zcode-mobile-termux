package com.zcodemobile.core;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Starts/stops the foreground backend host service. */
public final class CoreServiceLauncher {

    private CoreServiceLauncher() {
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, CoreServerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        try {
            context.stopService(new Intent(context, CoreServerService.class));
        } catch (Exception ignored) {
        }
    }
}
