package com.zcodemobile.bridge;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.oauth.DeviceId;
import com.zcodemobile.oauth.OAuthManager;
import com.zcodemobile.oauth.TokenStore;
import com.zcodemobile.ui.MainActivity;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.regex.Pattern;

/** Minimal JS bridge exposed to the trusted backend WebView as {@code Android}. */
public final class AndroidBridge {

    private static final String TAG = "AndroidBridge";
    private static final Pattern JS_CALLBACK =
            Pattern.compile("^[A-Za-z_$][A-Za-z0-9_$.]*$");

    private final Context appContext;
    private final OAuthManager oauth;
    private volatile WeakReference<MainActivity> activityRef;

    public AndroidBridge(Context context, OAuthManager oauth) {
        this.appContext = context.getApplicationContext();
        this.oauth = oauth;
    }

    public void setActivity(MainActivity activity) {
        this.activityRef = activity == null ? null : new WeakReference<MainActivity>(activity);
    }

    private MainActivity activity() {
        return activityRef == null ? null : activityRef.get();
    }

    @JavascriptInterface
    public String getToken() {
        return TokenStore.getToken(appContext);
    }

    @JavascriptInterface
    public void saveToken(String token) {
        TokenStore.saveToken(appContext, token);
    }

    @JavascriptInterface
    public String getDeviceMid() {
        return DeviceId.getOrCreate(appContext);
    }

    @JavascriptInterface
    public boolean openExternal(String url) {
        return oauth.openInBrowser(appContext, url);
    }

    @JavascriptInterface
    public String getBackendUrl() {
        return ZCodeConfig.BACKEND_BASE_URL;
    }

    /** Called by the UI once it has painted; hides the native splash. */
    @JavascriptInterface
    public void notifyReady() {
        MainActivity act = activity();
        if (act != null) {
            act.dismissSplash();
        }
    }

    /** Starts the external OAuth flow with our zcode:// callback attached. */
    @JavascriptInterface
    public boolean oauthStart(String authUrl) {
        return oauth.oauthStart(appContext, authUrl);
    }

    /**
     * Placeholder claim call. POSTs to the backend claim endpoint via loopback
     * and invokes {@code callback(resultJsonObject)} in JS.
     */
    @JavascriptInterface
    public void claimPlan(String planId, String callback) {
        final String cb = (callback != null && JS_CALLBACK.matcher(callback).matches())
                ? callback : null;
        final String result = callClaimEndpoint(planId);
        MainActivity act = activity();
        if (act == null || cb == null) {
            return;
        }
        final String js = cb + "(" + result + ");";
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    act.evaluateJavascript(js);
                } catch (Exception e) {
                    Log.w(TAG, "claim callback failed: " + e.getMessage());
                }
            }
        });
    }

    private String callClaimEndpoint(String planId) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("planId", planId == null ? "" : planId);
            body.put("deviceMid", DeviceId.getOrCreate(appContext));
            String token = TokenStore.getToken(appContext);
            if (token != null && !token.isEmpty()) {
                body.put("token", token);
            }

            connection = (HttpURLConnection) new URL(
                    ZCodeConfig.BACKEND_BASE_URL + "claim").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] payload = body.toString().getBytes(Charset.forName("UTF-8"));
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            int code = connection.getResponseCode();
            ByteArrayOutputStream captured = new ByteArrayOutputStream();
            try (BufferedInputStream in = new BufferedInputStream(
                    code < 400 ? connection.getInputStream() : connection.getErrorStream())) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) {
                    captured.write(buf, 0, n);
                }
            }
            String raw = captured.toString("UTF-8");
            if (code >= 400) {
                return "{\"ok\":false,\"status\":" + code + ",\"error\":"
                        + JSONObject.quote(raw.isEmpty() ? "claim endpoint returned " + code : raw) + "}";
            }
            JSONObject response = new JSONObject(raw);
            JSONObject wrapped = new JSONObject();
            wrapped.put("ok", true);
            wrapped.put("result", response);
            return wrapped.toString();
        } catch (Exception e) {
            Log.w(TAG, "claim request failed: " + e.getMessage());
            try {
                JSONObject error = new JSONObject();
                error.put("ok", false);
                error.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                return error.toString();
            } catch (Exception ignored) {
                return "{\"ok\":false}";
            }
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}
