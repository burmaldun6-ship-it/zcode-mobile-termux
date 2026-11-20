package com.zcodemobile.ui.webview;

import android.content.Context;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.bridge.AndroidBridge;
import com.zcodemobile.oauth.OAuthManager;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Owns the single WebView, its clients and its load/reload operations. */
public final class WebViewHost implements ZWebViewClient.Listener {

    public interface Listener {
        void onPageFinished(String url);
        void onMainFrameError(String url);
    }

    private final WebView webView;
    private final Context context;
    private Listener listener;
    private boolean fallbackShown;

    public WebViewHost(Context context, AndroidBridge bridge, OAuthManager oauth,
                       ZWebChromeClient.FileChooserCallback chooserCallback) {
        this.context = context;
        this.webView = WebViewFactory.create(context, bridge);
        this.webView.setWebViewClient(new ZWebViewClient(context, oauth, this));
        this.webView.setWebChromeClient(new ZWebChromeClient(chooserCallback));
        this.webView.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition,
                                        String mimeType, long length) {
                try {
                    android.content.Intent intent = new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                } catch (Exception ignored) {
                }
            }
        });
    }

    public WebView getWebView() {
        return webView;
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public void loadApp() {
        fallbackShown = false;
        webView.loadUrl(ZCodeConfig.BACKEND_BASE_URL);
    }

    public void reload() {
        webView.reload();
    }

    public void goBack() {
        if (webView.canGoBack()) {
            webView.goBack();
        }
    }

    public boolean canGoBack() {
        return webView.canGoBack();
    }

    public void evaluateJavascript(String script) {
        webView.evaluateJavascript(script, null);
    }

    public void evaluateJavascript(String script, ValueCallback<String> callback) {
        webView.evaluateJavascript(script, callback);
    }

    /** Shows a local status page when the backend has no web root yet. */
    public void loadFallback() {
        if (fallbackShown) {
            return;
        }
        fallbackShown = true;
        Thread fetch = new Thread(new Runnable() {
            @Override
            public void run() {
                final String health = fetchHealth();
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        String html = LocalAssetServer.statusPage(health);
                        webView.loadDataWithBaseURL(ZCodeConfig.BACKEND_BASE_URL,
                                html, "text/html", "UTF-8", null);
                    }
                });
            }
        }, "ZCodeHealthFetch");
        fetch.setDaemon(true);
        fetch.start();
    }

    private static String fetchHealth() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(ZCodeConfig.HEALTH_URL).openConnection();
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (BufferedInputStream in = new BufferedInputStream(connection.getInputStream())) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":" + org.json.JSONObject.quote(e.getMessage() == null
                    ? e.getClass().getSimpleName() : e.getMessage()) + "}";
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    public void freeMemory() {
        try {
            webView.freeMemory();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onPageFinished(String url) {
        if (listener != null) {
            listener.onPageFinished(url);
        }
    }

    @Override
    public void onMainFrameError(String url) {
        loadFallback();
        if (listener != null) {
            listener.onMainFrameError(url);
        }
    }
}
