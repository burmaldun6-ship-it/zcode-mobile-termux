package com.zcodemobile.ui.webview;

import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.oauth.OAuthManager;

/** Keeps navigation on the trusted backend origin; delegates everything else out. */
public final class ZWebViewClient extends WebViewClient {

    public interface Listener {
        void onPageFinished(String url);
        void onMainFrameError(String url);
    }

    private final Context context;
    private final OAuthManager oauth;
    private final Listener listener;

    public ZWebViewClient(Context context, OAuthManager oauth, Listener listener) {
        this.context = context;
        this.oauth = oauth;
        this.listener = listener;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) {
            return true;
        }
        return handleNavigation(view, request.getUrl().toString(), request.isForMainFrame());
    }

    @Override
    @SuppressWarnings("deprecation")
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return handleNavigation(view, url, true);
    }

    private boolean handleNavigation(WebView view, String url, boolean mainFrame) {
        if (url == null || url.isEmpty() || url.startsWith("about:")) {
            return false;
        }
        if (!mainFrame) {
            return false;
        }
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (ZCodeConfig.OAUTH_SCHEME.equalsIgnoreCase(scheme)) {
                oauth.exchangeBackendCallback(url,
                        uri.getQueryParameter("code"), uri.getQueryParameter("state"));
                if (context instanceof android.app.Activity) {
                    oauth.handleDeepLink((android.app.Activity) context,
                            new android.content.Intent(android.content.Intent.ACTION_VIEW, uri));
                }
                view.reload();
                return true;
            }
            if (isBackendUri(uri)) {
                return false;
            }
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                oauth.openInBrowser(context, url);
            }
        } catch (Exception ignored) {
        }
        return true;
    }

    private static boolean isBackendUri(Uri uri) {
        return ZCodeConfig.HOST.equalsIgnoreCase(uri.getHost())
                && ZCodeConfig.PORT == uri.getPort();
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame() && listener != null) {
            listener.onMainFrameError(request.getUrl() == null ? "" : request.getUrl().toString());
        }
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                    WebResourceResponse errorResponse) {
        if (request != null && request.isForMainFrame() && errorResponse != null
                && errorResponse.getStatusCode() >= 400 && listener != null) {
            listener.onMainFrameError(request.getUrl() == null ? "" : request.getUrl().toString());
        }
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        if (url != null && !url.startsWith(ZCodeConfig.BACKEND_BASE_URL)
                && !url.startsWith("about:")) {
            try {
                Uri uri = Uri.parse(url);
                if (!isBackendUri(uri)) {
                    view.stopLoading();
                    oauth.openInBrowser(context, url);
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        if (listener != null) {
            listener.onPageFinished(url);
        }
    }
}
