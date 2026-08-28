package com.bandulix.workoutchallenge;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register BEFORE super.onCreate(): BridgeActivity.onCreate builds
        // the Bridge and consumes the plugin list in that call - anything
        // registered afterwards never reaches the Bridge ("plugin is not
        // implemented on android").
        registerPlugin(OWHealthPlugin.class);
        registerPlugin(CachedMediaPlugin.class);
        // Theme.SplashScreen only hands off to AppTheme.NoActionBar if the
        // SplashScreen API is installed; otherwise the dark splash window
        // stays and shows as a black strip above the WebView.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        // Posted so it runs after Capacitor SystemBars paints the decor
        // view from windowBackground on the next main-thread turn.
        Window window = getWindow();
        if (window != null) {
            window.getDecorView().post(this::applySystemChrome);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemChrome();
    }

    // /download/*.apk is served with Content-Disposition: attachment, so
    // Chromium fires the download listener instead of navigating. Hand
    // http(s) APK URLs to the system (Chrome / Files) which can save and
    // install; the WebView itself cannot.
    private void attachApkDownloadListener(WebView webView) {
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (!ApkDownload.isAllowed(url)) return;
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(intent);
            } catch (Exception ignored) {
                // no browser
            }
        });
    }

    // API JSON must never come from Chromium's HTTP disk cache. Capacitor
    // still serves the bundled app from the APK (not this cache). Without
    // this, some WebView versions ignore fetch({cache:"no-store"}) and
    // replay yesterday's GETs — which looked like "the server never answers".
    private void applyWebViewCachePolicy(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
    }

    private boolean systemNightMode() {
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night == Configuration.UI_MODE_NIGHT_YES;
    }

    // WebView only reports prefers-color-scheme from the app's DayNight
    // theme if we tell it to. Without this, "Match device" stays light.
    @SuppressWarnings("deprecation")
    private void syncWebViewColorScheme() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        boolean dark = systemNightMode();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            settings.setForceDark(dark ? WebSettings.FORCE_DARK_ON : WebSettings.FORCE_DARK_OFF);
        }
    }

    // The WebView parent is padded for the status bar on Android 15
    // (Capacitor SystemBars) and on older versions the status bar is a
    // separate strip. In both cases the gap used to show the splash
    // window's black. Paint it with the page canvas instead.
    private void applySystemChrome() {
        Window window = getWindow();
        if (window == null) return;
        int canvas = ContextCompat.getColor(this, R.color.canvas);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        } else {
            window.setStatusBarColor(canvas);
            window.setNavigationBarColor(canvas);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        window.getDecorView().setBackgroundColor(canvas);
        syncWebViewColorScheme();

        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(canvas);
        applyWebViewCachePolicy(webView);
        attachApkDownloadListener(webView);
        View parent = (View) webView.getParent();
        if (parent != null) {
            parent.setBackgroundColor(canvas);
        }
    }
}
