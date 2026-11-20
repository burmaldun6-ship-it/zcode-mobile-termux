package com.zcodemobile.oauth;

import android.content.Context;
import android.content.SharedPreferences;

/** App-private JWT store for the JS bridge. */
public final class TokenStore {

    private static final String PREFS = "zcode_native";
    private static final String KEY = "jwt_token";

    private TokenStore() {
    }

    public static String getToken(Context context) {
        if (context == null) {
            return "";
        }
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, "");
    }

    public static void saveToken(Context context, String token) {
        if (context == null) {
            return;
        }
        context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY, token == null ? "" : token).apply();
    }

    public static void clear(Context context) {
        saveToken(context, "");
    }
}
