package com.zcodemobile.ui.webview;

import android.net.Uri;
import android.webkit.WebResourceResponse;

import com.zcodemobile.ZCodeConfig;

import org.json.JSONObject;

/** Serves the local fallback status page when the backend has no web root yet. */
public final class LocalAssetServer {

    private LocalAssetServer() {
    }

    /** Reserved hook for future local asset interception; backend serves the real UI. */
    public static WebResourceResponse intercept(Uri uri) {
        return null;
    }

    public static String statusPage(String healthJson) {
        String quoted = JSONObject.quote(healthJson == null ? "{}" : healthJson)
                .replace("<", "\\u003c").replace(">", "\\u003e");
        return "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<title>ZCode Mobile</title><style>"
                + "*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0f1115;color:#e6e6e6;"
                + "font:14px/1.6 system-ui,-apple-system,sans-serif;display:flex;align-items:center;"
                + "justify-content:center}.card{max-width:560px;padding:28px;border:1px solid #2a2f3a;"
                + "border-radius:14px;background:#171a21}h1{margin:0 0 6px;font-size:20px}"
                + ".ok{color:#4ade80}.bad{color:#f87171}pre{white-space:pre-wrap;word-break:break-all;"
                + "background:#0b0d12;padding:12px;border-radius:8px;color:#9ca3af;font-size:12px}"
                + "button{margin-top:16px;padding:9px 16px;border:0;border-radius:8px;background:#3b82f6;"
                + "color:#fff;cursor:pointer}</style></head><body><div class='card'>"
                + "<h1>ZCode Mobile</h1><p id='s'>Backend bridge status</p><pre id='h'>" + quoted + "</pre>"
                + "<button onclick='location.reload()'>Reload</button></div><script>"
                + "var initial=" + quoted + ";document.getElementById('h').textContent=JSON.stringify(JSON.parse(initial),null,2);"
                + "function refresh(){fetch('/health').then(function(r){return r.json()}).then(function(j){"
                + "document.getElementById('s').innerHTML='Bridge <span class=\"ok\">online</span>';"
                + "document.getElementById('h').textContent=JSON.stringify(j,null,2);"
                + "if(window.Android&&window.Android.notifyReady)window.Android.notifyReady();"
                + "}).catch(function(e){document.getElementById('s').innerHTML='Bridge <span class=\"bad\">offline</span>';});}"
                + "refresh();setInterval(refresh,2000);</script></body></html>";
    }
}
