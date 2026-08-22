package com.bandulix.workoutchallenge

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.openwearables.health.sdk.OpenWearablesHealthSDK
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// Bridge between the web app and the Open Wearables Android SDK: the
// Health settings section drives the whole Health Connect onboarding
// (configure -> sign in -> permissions -> background sync) with one tap.
@CapacitorPlugin(name = "OWHealth")
class OWHealthPlugin : Plugin() {

    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // Data types we ask Health Connect for - covers every metric the
    // workout sync consumes (sessions, plus steps/energy for dailies).
    private val healthTypes = listOf("steps", "heartRate", "workout", "activeEnergy", "sleep")

    override fun load() {
        // One-time init against the application context.
        OpenWearablesHealthSDK.initialize(context.applicationContext)
        // Register the Health Connect permission launcher while the
        // Activity is still in onCreate (plugin load happens during
        // Bridge creation) - the SDK documents this as the reliable
        // window for ActivityResult registration; doing it lazily on
        // button tap risks a dead callback after process recreation.
        activity?.let { sdk().setActivity(it) }
    }

    override fun handleOnDestroy() {
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    private fun sdk(): OpenWearablesHealthSDK = OpenWearablesHealthSDK.getInstance()

    @PluginMethod
    fun configure(call: PluginCall) {
        val host = call.getString("host")
        if (host.isNullOrBlank()) {
            call.reject("host is required")
            return
        }
        // The SDK's configure() return value is NOT a validation result -
        // it reports whether a previous background sync was auto-restored
        // (always false on a fresh connect). Validate the URL shape
        // ourselves instead of rejecting on that flag.
        if (!HealthHost.isAllowed(host)) {
            call.reject("invalid host URL")
            return
        }
        sdk().configure(host = host)
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
                Log.w(TAG, "signIn failed", e)
                call.reject("signIn failed")
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
                Log.w(TAG, "requestAuthorization failed", e)
                call.reject("requestAuthorization failed")
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
                Log.w(TAG, "startBackgroundSync failed", e)
                call.reject("startBackgroundSync failed")
            }
        }
    }

    @PluginMethod
    fun stopSync(call: PluginCall) {
        pluginScope.launch {
            try {
                sdk().stopBackgroundSync()
                call.resolve()
            } catch (e: Exception) {
                Log.w(TAG, "stopBackgroundSync failed", e)
                call.reject("stopBackgroundSync failed")
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
                Log.w(TAG, "signOut failed", e)
                call.reject("signOut failed")
            }
        }
    }

    companion object {
        private const val TAG = "OWHealth"
    }
}
