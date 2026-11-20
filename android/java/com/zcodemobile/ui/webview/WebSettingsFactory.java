package com.zcodemobile.ui.webview;

import android.os.Build;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.zcodemobile.ZCodeConfig;

/** WebView settings profile for the loopback backend UI. */
public final class WebSettingsFactory {

    private static final String TAG = "WebViewHost";
    public static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/130.0.0.0 Safari/537.36 ZCode/" + ZCodeConfig.CORE_VERSION;

    private static String defaultUserAgent;

    private WebSettingsFactory() {
    }

    public static void configure(WebView view) {
        WebSettings settings = view.getSettings();
        if (defaultUserAgent == null) {
            defaultUserAgent = settings.getUserAgentString();
        }
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(DESKTOP_UA);

        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                settings.setOffscreenPreRaster(true);
            } catch (Exception e) {
                Log.w(TAG, "setOffscreenPreRaster failed", e);
            }
        }
    }
}
