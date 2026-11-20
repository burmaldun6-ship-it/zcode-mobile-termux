package com.zcodemobile.ui;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import com.zcodemobile.ZCodeConfig;
import com.zcodemobile.bridge.AndroidBridge;
import com.zcodemobile.core.CoreRuntimeState;
import com.zcodemobile.core.CoreServiceLauncher;
import com.zcodemobile.oauth.OAuthManager;
import com.zcodemobile.ui.webview.WebViewHost;

import java.util.ArrayList;
import java.util.List;

/** WebView host: loading screen, backend readiness polling, permissions, deep links. */
public class MainActivity extends Activity implements WebViewHost.Listener {

    private static final String TAG = "MainActivity";
    private static final int REQUEST_PERMISSIONS = 100;
    private static final int REQUEST_FILE_CHOOSER = 1002;
    private static final long SPLASH_TIMEOUT_MS = 60000;
    private static final long POLL_STARTUP_MS = 50;
    private static final long POLL_READY_MS = 1000;

    public static volatile MainActivity activeActivity;

    private WebViewHost webViewHost;
    private AndroidBridge androidBridge;
    private OAuthManager oauthManager;

    private FrameLayout root;
    private LinearLayout splash;
    private TextView splashStatus;
    private ProgressBar splashProgress;
    private Button retryButton;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean activityResumed;
    private boolean appLoaded;
    private int loadedGeneration = -1;
    private long splashDeadline;
    private ValueCallback<Uri[]> filePathCallback;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            watchBackend();
            if (activityResumed) {
                handler.postDelayed(this, appLoaded ? POLL_READY_MS : POLL_STARTUP_MS);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeActivity = this;
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0F1115);

        oauthManager = new OAuthManager();
        oauthManager.setListener(new OAuthManager.CallbackListener() {
            @Override
            public void onOAuthResult(String token, String code) {
                if (token == null && code != null) {
                    oauthManager.exchangeBackendCallback(null, code, null);
                }
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (webViewHost != null) {
                            webViewHost.reload();
                        }
                    }
                });
            }
        });

        androidBridge = new AndroidBridge(this, oauthManager);
        androidBridge.setActivity(this);
        webViewHost = new WebViewHost(this, androidBridge, oauthManager,
                new com.zcodemobile.ui.webview.ZWebChromeClient.FileChooserCallback() {
                    @Override
                    public boolean onShowFileChooser(WebView webView,
                                                     ValueCallback<Uri[]> callback,
                                                     WebChromeClient.FileChooserParams params) {
                        return showFileChooser(callback, params);
                    }
                });
        webViewHost.setListener(this);

        WebView webView = webViewHost.getWebView();
        webView.setVisibility(View.GONE);
        root.addView(webView, FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);

        buildSplash();
        setContentView(root);

        splashDeadline = System.currentTimeMillis() + SPLASH_TIMEOUT_MS;
        requestPermissions();
        startBackend();
        handleDeepLink(getIntent());
    }

    private void buildSplash() {
        splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(0xFF0F1115);
        int pad = dp(28);
        splash.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(ZCodeConfig.APP_NAME);
        title.setTextColor(0xFFE6E6E6);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);

        splashStatus = new TextView(this);
        splashStatus.setText("Starting backend…");
        splashStatus.setTextColor(0xFF9CA3AF);
        splashStatus.setTextSize(14);
        splashStatus.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = dp(14);

        splashProgress = new ProgressBar(this);
        splashProgress.setIndeterminate(true);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(180),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        progressParams.topMargin = dp(18);
        progressParams.gravity = Gravity.CENTER;

        retryButton = new Button(this);
        retryButton.setText("Retry");
        retryButton.setVisibility(View.GONE);
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = dp(18);
        retryParams.gravity = Gravity.CENTER;
        retryButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                retryBackend();
            }
        });

        splash.addView(title);
        splash.addView(splashStatus, statusParams);
        splash.addView(splashProgress, progressParams);
        splash.addView(retryButton, retryParams);
        root.addView(splash, FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void requestPermissions() {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (needed.isEmpty()) {
            return;
        }
        List<String> toRequest = new ArrayList<>();
        for (String permission : needed) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                toRequest.add(permission);
            }
        }
        if (!toRequest.isEmpty()) {
            requestPermissions(toRequest.toArray(new String[0]), REQUEST_PERMISSIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQUEST_PERMISSIONS) {
            startBackend();
        }
    }

    private void startBackend() {
        try {
            CoreServiceLauncher.start(this);
        } catch (Exception e) {
            showFatalError("Cannot start backend service: "
                    + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    private void retryBackend() {
        splashStatus.setText("Restarting backend…");
        splashProgress.setVisibility(View.VISIBLE);
        retryButton.setVisibility(View.GONE);
        appLoaded = false;
        loadedGeneration = -1;
        splashDeadline = System.currentTimeMillis() + SPLASH_TIMEOUT_MS;
        CoreServiceLauncher.stop(this);
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                startBackend();
            }
        }, 400);
    }

    private void watchBackend() {
        String error = CoreRuntimeState.lastError;
        if (error != null) {
            if (!CoreRuntimeState.restarting) {
                showFatalError(error);
            } else {
                splashStatus.setText(error);
            }
            return;
        }
        if (CoreRuntimeState.backendUrl != null) {
            int generation = CoreRuntimeState.readyGeneration;
            if (!appLoaded || generation != loadedGeneration) {
                appLoaded = true;
                loadedGeneration = generation;
                splashStatus.setText("Loading UI…");
                webViewHost.getWebView().setVisibility(View.VISIBLE);
                webViewHost.loadApp();
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (appLoaded) {
                            dismissSplash();
                        }
                    }
                }, 3000);
            }
            return;
        }
        if (!appLoaded && System.currentTimeMillis() > splashDeadline) {
            showFatalError("Backend did not start within " + (SPLASH_TIMEOUT_MS / 1000) + "s");
        }
    }

    public void showFatalError(String message) {
        splashStatus.setText(message);
        splashProgress.setVisibility(View.GONE);
        retryButton.setVisibility(View.VISIBLE);
    }

    /** Idempotent; called by AndroidBridge.notifyReady() or the watchdog. */
    public void dismissSplash() {
        if (splash == null || splash.getVisibility() == View.GONE) {
            return;
        }
        splash.animate().alpha(0f).setDuration(220).withEndAction(new Runnable() {
            @Override
            public void run() {
                splash.setVisibility(View.GONE);
            }
        });
    }

    public void evaluateJavascript(String script) {
        if (webViewHost != null) {
            webViewHost.evaluateJavascript(script);
        }
    }

    private void handleDeepLink(Intent intent) {
        if (oauthManager != null && oauthManager.handleDeepLink(this, intent)) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLink(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityResumed = true;
        activeActivity = this;
        if (webViewHost != null) {
            webViewHost.getWebView().onResume();
        }
        handler.removeCallbacks(poll);
        handler.post(poll);
    }

    @Override
    protected void onPause() {
        activityResumed = false;
        handler.removeCallbacks(poll);
        if (webViewHost != null) {
            webViewHost.getWebView().onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        activityResumed = false;
        if (activeActivity == this) {
            activeActivity = null;
        }
        handler.removeCallbacksAndMessages(null);
        if (androidBridge != null) {
            androidBridge.setActivity(null);
        }
        if (webViewHost != null) {
            WebView wv = webViewHost.getWebView();
            wv.stopLoading();
            wv.setWebChromeClient(null);
            wv.setWebViewClient(null);
            wv.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webViewHost != null && webViewHost.canGoBack() && appLoaded) {
            webViewHost.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onPageFinished(String url) {
        Log.i(TAG, "page finished: " + url);
    }

    @Override
    public void onMainFrameError(String url) {
        Log.i(TAG, "main frame error: " + url);
    }

    private boolean showFileChooser(ValueCallback<Uri[]> callback,
                                    WebChromeClient.FileChooserParams params) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
        }
        filePathCallback = callback;
        Intent intent;
        try {
            intent = params != null ? params.createIntent() : null;
        } catch (Exception e) {
            intent = null;
        }
        if (intent == null) {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "Select file"), REQUEST_FILE_CHOOSER);
            return true;
        } catch (ActivityNotFoundException e) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
            Toast.makeText(this, "No file picker available", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE_CHOOSER || filePathCallback == null) {
            return;
        }
        Uri[] results = null;
        try {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        } catch (Exception ignored) {
        }
        if (results == null && resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                results = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) {
                    results[i] = clip.getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }
}
