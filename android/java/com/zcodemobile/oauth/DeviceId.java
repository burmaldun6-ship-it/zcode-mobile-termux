package com.zcodemobile.oauth;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** Stable device identifier persisted in app-private preferences. */
public final class DeviceId {

    private static final String PREFS = "zcode_native";
    private static final String KEY = "device_mid";

    private DeviceId() {
    }

    public static synchronized String getOrCreate(Context context) {
        if (context == null) {
            return "android-unknown";
        }
        SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = prefs.getString(KEY, null);
        if (existing != null && !existing.isEmpty()) {
            return existing;
        }
        String mid = "android-" + UUID.randomUUID().toString();
        prefs.edit().putString(KEY, mid).apply();
        return mid;
    }
}
