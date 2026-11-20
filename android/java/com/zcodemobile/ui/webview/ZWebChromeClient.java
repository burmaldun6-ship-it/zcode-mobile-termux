package com.zcodemobile.ui.webview;

import android.net.Uri;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** Routes console output to logcat, progress + file chooser to the host activity. */
public final class ZWebChromeClient extends WebChromeClient {

    public interface FileChooserCallback {
        boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                  FileChooserParams params);
    }

    private final FileChooserCallback fileChooserCallback;

    public ZWebChromeClient(FileChooserCallback fileChooserCallback) {
        this.fileChooserCallback = fileChooserCallback;
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage cm) {
        if (cm != null) {
            String msg = cm.message();
            if (msg != null && msg.length() > 2000) {
                msg = msg.substring(0, 2000);
            }
            String line = "[" + cm.sourceId() + ":" + cm.lineNumber() + "] " + msg;
            ConsoleMessage.MessageLevel level = cm.messageLevel();
            if (level == ConsoleMessage.MessageLevel.ERROR) {
                Log.e("ZCode_JS", line);
            } else if (level == ConsoleMessage.MessageLevel.WARNING) {
                Log.w("ZCode_JS", line);
            } else {
                Log.i("ZCode_JS", line);
            }
        }
        return true;
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                     FileChooserParams params) {
        if (fileChooserCallback != null) {
            return fileChooserCallback.onShowFileChooser(webView, filePathCallback, params);
        }
        return super.onShowFileChooser(webView, filePathCallback, params);
    }
}
