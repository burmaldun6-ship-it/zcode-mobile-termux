package com.zcodemobile.core;

import android.util.Log;

import com.zcodemobile.ZCodeConfig;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** One-shot GET /health probe of the Node bridge. */
public final class BackendHealthProbe {

    private static final String TAG = "BackendHealthProbe";
    public static final long READY_TIMEOUT_MS = 60000;

    private BackendHealthProbe() {
    }

    /** True when /health returns HTTP 200 with {"ok": true}. */
    public static boolean probeOnce() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(ZCodeConfig.HEALTH_URL).openConnection();
            connection.setConnectTimeout(800);
            connection.setReadTimeout(800);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            if (code != 200) {
                return false;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            try (BufferedInputStream in = new BufferedInputStream(connection.getInputStream())) {
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            JSONObject json = new JSONObject(out.toString("UTF-8"));
            return json.optBoolean("ok", false);
        } catch (Exception notReady) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}
