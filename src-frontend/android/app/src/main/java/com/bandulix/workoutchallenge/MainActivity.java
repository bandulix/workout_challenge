package com.bandulix.workoutchallenge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register BEFORE super.onCreate(): BridgeActivity.onCreate builds
        // the Bridge and consumes the plugin list in that call - anything
        // registered afterwards never reaches the Bridge ("plugin is not
        // implemented on android").
        registerPlugin(OWHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
