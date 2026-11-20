package com.zcodemobile.ui.webview;

import android.content.Context;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;

import com.zcodemobile.bridge.AndroidBridge;

/** Creates and hardware-configures the host WebView. */
public final class WebViewFactory {

    private WebViewFactory() {
    }

    public static WebView create(Context context, AndroidBridge bridge) {
        WebView view = new WebView(context);
        view.setBackgroundColor(0xFF0F1115);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocus(View.FOCUS_DOWN);
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        view.addJavascriptInterface(bridge, "Android");
        view.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_DOWN) {
                    ((WebView) v).requestFocus(View.FOCUS_DOWN);
                }
                return false;
            }
        });
        WebSettingsFactory.configure(view);
        return view;
    }
}
