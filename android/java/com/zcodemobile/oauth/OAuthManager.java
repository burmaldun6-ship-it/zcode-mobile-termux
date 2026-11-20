package com.zcodemobile.oauth;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.zcodemobile.ZCodeConfig;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** External-browser OAuth plus zcode:// deep-link handoff. */
public final class OAuthManager {

    private static final String TAG = "OAuthManager";

    public interface CallbackListener {
        void onOAuthResult(String token, String code);
    }

    private CallbackListener listener;

    public void setListener(CallbackListener listener) {
        this.listener = listener;
    }

    public static String getCallbackScheme() {
        return ZCodeConfig.OAUTH_SCHEME;
    }

    /** True when the URL is a Google-style auth endpoint that must leave the WebView. */
    public boolean isAuthUrl(String url) {
        if (url == null) {
            return false;
        }
        String lower = url.toLowerCase();
        return lower.contains("accounts.google.com")
                || lower.contains("oauth2/v")
                || lower.contains("/authorize")
                || lower.contains("login.microsoftonline.com")
                || lower.contains("github.com/login/oauth");
    }

    public boolean intercept(Context context, String url) {
        if (!isAuthUrl(url)) {
            return false;
        }
        return openInBrowser(context, url);
    }

    public boolean openInBrowser(Context context, String url) {
        if (context == null || url == null || url.isEmpty()) {
            return false;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(intent);
                return true;
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot open browser: " + e.getMessage());
        }
        return false;
    }

    /** Starts login in the system browser, attaching our callback redirect. */
    public boolean oauthStart(Context context, String authUrl) {
        if (authUrl == null || authUrl.isEmpty()) {
            return false;
        }
        String redirect = Uri.encode(ZCodeConfig.OAUTH_CALLBACK);
        String url = authUrl + (authUrl.contains("?") ? "&" : "?") + "redirect_uri=" + redirect;
        return openInBrowser(context, url);
    }

    /** Exchanges a zcode://oauth/callback?code=... via the local claim service. */
    public void exchangeBackendCallback(final String url, final String code, final String state) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    JSONObject body = new JSONObject();
                    if (url != null && !url.isEmpty()) body.put("url", url);
                    if (code != null && !code.isEmpty()) body.put("code", code);
                    if (state != null && !state.isEmpty()) body.put("state", state);
                    connection = (HttpURLConnection) new URL(
                            ZCodeConfig.BACKEND_BASE_URL + "claim/start").openConnection();
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(15000);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json");
                    byte[] payload = body.toString().getBytes("UTF-8");
                    connection.setFixedLengthStreamingMode(payload.length);
                    OutputStream out = connection.getOutputStream();
                    try {
                        out.write(payload);
                    } finally {
                        out.close();
                    }
                    int status = connection.getResponseCode();
                    InputStream in = status < 400 ? connection.getInputStream() : connection.getErrorStream();
                    if (in != null) {
                        try {
                            byte[] buf = new byte[4096];
                            while (in.read(buf) > 0) { }
                        } finally {
                            in.close();
                        }
                    }
                    Log.i(TAG, "backend OAuth exchange status=" + status);
                } catch (Exception e) {
                    Log.w(TAG, "backend OAuth exchange failed: " + e.getMessage());
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        }, "oauth-exchange").start();
    }

    /** Handles zcode://oauth/callback?token=...&code=... Adds nothing to the token file. */
    public boolean handleDeepLink(Activity activity, Intent intent) {
        if (activity == null || intent == null || intent.getData() == null) {
            return false;
        }
        Uri uri = intent.getData();
        if (!ZCodeConfig.OAUTH_SCHEME.equalsIgnoreCase(uri.getScheme())) {
            return false;
        }
        String path = uri.getPath();
        if (path == null || !path.contains("callback")) {
            return false;
        }
        String token = uri.getQueryParameter("token");
        String code = uri.getQueryParameter("code");
        if (token == null) {
            token = uri.getFragment();
        }
        Log.i(TAG, "oauth deep link received (token="
                + (token == null ? "none" : token.length() + " chars") + ")");
        if (token != null && !token.isEmpty()) {
            TokenStore.saveToken(activity, token);
        }
        if (listener != null) {
            listener.onOAuthResult(token, code);
        }
        return true;
    }
}
