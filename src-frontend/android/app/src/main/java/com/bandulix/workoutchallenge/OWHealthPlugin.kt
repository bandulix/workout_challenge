package com.bandulix.workoutchallenge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.openwearables.health.sdk.OpenWearablesHealthSDK
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// Bridge between the web app and the Open Wearables Android SDK: the
// Health settings section drives the whole Health Connect onboarding
// (configure -> sign in -> permissions -> background sync) with one tap.
@CapacitorPlugin(name = "OWHealth")
class OWHealthPlugin : Plugin() {

    private val pluginScope = CoroutineScope(Dispatchers.Main)

    // Data types we ask Health Connect for - covers every metric the
    // workout sync consumes (sessions, plus steps/energy for dailies).
    private val healthTypes = listOf("steps", "heartRate", "workout", "activeEnergy", "sleep")

    override fun load() {
        // One-time init against the application context.
        OpenWearablesHealthSDK.initialize(context.applicationContext)
    }

    private fun sdk(): OpenWearablesHealthSDK = OpenWearablesHealthSDK.getInstance()

    @PluginMethod
    fun configure(call: PluginCall) {
        val host = call.getString("host")
        if (host.isNullOrBlank()) {
            call.reject("host is required")
            return
        }
        // configure() returns false for a malformed URL.
        if (!sdk().configure(host = host)) {
            call.reject("invalid host URL")
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val userId = call.getString("userId")
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")
        if (userId.isNullOrBlank() || accessToken.isNullOrBlank()) {
            call.reject("userId and accessToken are required")
            return
        }
        pluginScope.launch {
            try {
                sdk().signIn(userId = userId, accessToken = accessToken, refreshToken = refreshToken, apiKey = null)
                call.resolve()
            } catch (e: Exception) {
                call.reject("signIn failed: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun requestHealthAuthorization(call: PluginCall) {
        if (!sdk().setProvider("google")) {
            call.reject("Health Connect is not available on this device")
            return
        }
        // The permission dialog needs the current Activity as context.
        sdk().setActivity(activity)
        pluginScope.launch {
            try {
                val granted = sdk().requestAuthorization(healthTypes)
                val ret = JSObject()
                ret.put("granted", granted)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("requestAuthorization failed: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun startSync(call: PluginCall) {
        val daysBack = call.getInt("daysBack")
        pluginScope.launch {
            try {
                if (daysBack != null) {
                    sdk().startBackgroundSync(syncDaysBack = daysBack)
                } else {
                    sdk().startBackgroundSync()
                }
                call.resolve()
            } catch (e: Exception) {
                call.reject("startBackgroundSync failed: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("sessionValid", sdk().isSessionValid())
        ret.put("syncActive", sdk().isSyncActive())
        call.resolve(ret)
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        pluginScope.launch {
            try {
                sdk().signOut()
                call.resolve()
            } catch (e: Exception) {
                call.reject("signOut failed: ${e.message}", e)
            }
        }
    }
}
