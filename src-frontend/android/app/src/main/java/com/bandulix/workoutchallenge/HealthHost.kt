package com.bandulix.workoutchallenge

import java.net.URI

/** Open Wearables host the native SDK is allowed to talk to. */
internal object HealthHost {
    fun isAllowed(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        return try {
            val uri = URI(host.trim())
            val scheme = uri.scheme?.lowercase()
            (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
        } catch (_: Exception) {
            false
        }
    }
}
