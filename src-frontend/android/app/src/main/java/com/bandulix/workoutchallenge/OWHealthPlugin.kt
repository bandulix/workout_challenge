package com.bandulix.workoutchallenge

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
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

    override fun handleOnResume() {
        super.handleOnResume()
        try {
            activity?.let { sdk().setActivity(it) }
            // Resumes an interrupted upload; without this, a process
            // kill left Health Connect data sitting on the phone.
            sdk().onForeground()
        } catch (e: Exception) {
            Log.w(TAG, "onForeground failed", e)
        }
    }

    override fun handleOnPause() {
        try {
            // Schedules an expedited WorkManager run when the app
            // backgrounds - the SDK will not do this on its own.
            sdk().onBackground()
        } catch (e: Exception) {
            Log.w(TAG, "onBackground failed", e)
        }
        super.handleOnPause()
    }

    override fun handleOnDestroy() {
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    private fun sdk(): OpenWearablesHealthSDK = OpenWearablesHealthSDK.getInstance()

    // WorkManager's HealthSyncWorker defaults to Samsung Health when no
    // provider is stored. Always pin Google so a restore after process
    // death does not silently read the wrong store.
    private fun ensureGoogleProvider() {
        if (!sdk().setProvider("google")) {
            Log.w(TAG, "Health Connect is not available on this device")
        }
    }

    // Android 13+: the SDK's WorkManager worker is a foreground service
    // and needs POST_NOTIFICATIONS. Without it, setForeground throws and
    // background Health Connect reads often never run.
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val act = activity ?: return
        if (ContextCompat.checkSelfPermission(act, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return
        act.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIF_REQ)
    }

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
        ensureGoogleProvider()
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
        requestNotificationPermission()
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

    private fun clampedDaysBack(call: PluginCall): Int? {
        val raw = call.getInt("daysBack") ?: return null
        return raw.coerceIn(1, 43)
    }

    @PluginMethod
    fun startSync(call: PluginCall) {
        val daysBack = clampedDaysBack(call)
        ensureGoogleProvider()
        requestNotificationPermission()
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

    // Foreground, in-process upload. startBackgroundSync only *schedules*
    // WorkManager and returns immediately, so a manual Re-Sync that then
    // polls the server would always race an empty Open Wearables store.
    @PluginMethod
    fun syncNow(call: PluginCall) {
        val daysBack = clampedDaysBack(call)
        ensureGoogleProvider()
        requestNotificationPermission()
        pluginScope.launch {
            try {
                if (daysBack != null) {
                    sdk().startBackgroundSync(syncDaysBack = daysBack)
                }
                sdk().syncNow()
                call.resolve()
            } catch (e: Exception) {
                Log.w(TAG, "syncNow failed", e)
                call.reject("syncNow failed")
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
        private const val NOTIF_REQ = 48021
    }
}
