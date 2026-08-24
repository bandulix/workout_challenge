package com.bandulix.workoutchallenge;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register BEFORE super.onCreate(): BridgeActivity.onCreate builds
        // the Bridge and consumes the plugin list in that call - anything
        // registered afterwards never reaches the Bridge ("plugin is not
        // implemented on android").
        registerPlugin(OWHealthPlugin.class);
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

        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(canvas);
        View parent = (View) webView.getParent();
        if (parent != null) {
            parent.setBackgroundColor(canvas);
        }
    }
}
