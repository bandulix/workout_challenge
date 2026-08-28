package com.bandulix.workoutchallenge

import java.net.URI

/** URLs the WebView is allowed to hand off as an APK download. */
internal object ApkDownload {
    @JvmStatic
    fun isAllowed(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val uri = URI(url.trim())
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return false
            if (uri.host.isNullOrBlank()) return false
            if (!uri.userInfo.isNullOrBlank()) return false
            val path = (uri.path ?: "").lowercase()
            if (!(path.endsWith(".apk") && path.startsWith("/download/"))) return false
            val origin = CachedMedia.allowedOrigin
            if (origin.isNullOrBlank()) return false
            return CachedMedia.isAllowed(url, origin)
        } catch (_: Exception) {
            false
        }
    }
}
