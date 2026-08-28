package com.bandulix.workoutchallenge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "CachedMedia")
class CachedMediaPlugin : Plugin() {

    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val url = call.getString("url")
        val origin = call.getString("origin")
        val token = call.getString("token") ?: ""
        if (!CachedMedia.isAllowed(url, origin)) {
            call.reject("blocked")
            return
        }
        pluginScope.launch {
            try {
                val file = CachedMedia.fetch(context, url!!, token)
                val obj = JSObject()
                obj.put("src", "file://${file.absolutePath}")
                call.resolve(obj)
            } catch (e: Exception) {
                call.reject(e.message ?: "fetch failed")
            }
        }
    }

    @PluginMethod
    fun invalidate(call: PluginCall) {
        val url = call.getString("url")
        val origin = call.getString("origin")
        if (!CachedMedia.isAllowed(url, origin)) {
            call.resolve()
            return
        }
        CachedMedia.invalidate(context, url!!)
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        CachedMedia.clear(context)
        call.resolve()
    }

    @PluginMethod
    fun setOrigin(call: PluginCall) {
        val origin = call.getString("origin")
        if (!origin.isNullOrBlank() && CachedMedia.isAllowed("$origin/", origin)) {
            CachedMedia.allowedOrigin = origin
        }
        call.resolve()
    }
}
