package com.zcodemobile.oauth;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;

/** Persists a random 32-byte hex secret used by the backend to decrypt credentials. */
public final class SecretStore {

    private static final String PREFS = "zcode_native";
    private static final String KEY = "credential_secret";

    private SecretStore() {
    }

    public static synchronized String getOrCreate(Context context) {
        if (context == null) {
            return "";
        }
        SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = prefs.getString(KEY, null);
        if (existing != null && existing.length() == 64) {
            return existing;
        }
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        char[] hex = "0123456789abcdef".toCharArray();
        char[] encoded = new char[random.length * 2];
        for (int i = 0; i < random.length; i++) {
            int value = random[i] & 0xff;
            encoded[i * 2] = hex[value >>> 4];
            encoded[i * 2 + 1] = hex[value & 0x0f];
        }
        String secret = new String(encoded);
        prefs.edit().putString(KEY, secret).apply();
        return secret;
    }
}
