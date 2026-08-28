package com.bandulix.workoutchallenge

import android.content.Context
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

/** Disk cache for authenticated pictures. First fetch hits the network;
 *  later opens reuse the file until max-age (or a 304). */
internal object CachedMedia {
    private const val MAX_AGE_MS = 86_400_000L
    private const val MAX_CACHE_BYTES = 80L * 1024 * 1024
    private const val MAX_FILE_BYTES = 6L * 1024 * 1024

    @Volatile
    @JvmStatic
    var allowedOrigin: String? = null

    @JvmStatic
    fun isAllowed(url: String?, origin: String?): Boolean {
        if (url.isNullOrBlank() || origin.isNullOrBlank()) return false
        return try {
            val u = URI(url.trim())
            val o = URI(origin.trim())
            val us = u.scheme?.lowercase()
            val os = o.scheme?.lowercase()
            if (us != "http" && us != "https") return false
            if (os != "http" && os != "https") return false
            if (u.host.isNullOrBlank() || o.host.isNullOrBlank()) return false
            if (!u.userInfo.isNullOrBlank()) return false
            us == os && u.host.equals(o.host, ignoreCase = true) && u.port == o.port
        } catch (_: Exception) {
            false
        }
    }

    fun invalidate(context: Context, url: String) {
        val dir = File(context.cacheDir, "wc-media")
        val key = sha256(url)
        File(dir, key).delete()
        File(dir, "$key.etag").delete()
    }

    fun clear(context: Context) {
        val dir = File(context.cacheDir, "wc-media")
        if (!dir.exists()) return
        dir.listFiles()?.forEach { it.delete() }
    }

    fun fetch(context: Context, url: String, token: String): File {
        val dir = File(context.cacheDir, "wc-media")
        if (!dir.exists()) dir.mkdirs()
        val key = sha256(url)
        val file = File(dir, key)
        val etagFile = File(dir, "$key.etag")
        val now = System.currentTimeMillis()
        if (file.exists() && file.length() > 0 && now - file.lastModified() < MAX_AGE_MS) {
            return file
        }
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", "WorkoutChallenge/1.0 (Android)")
            if (token.isNotEmpty()) setRequestProperty("Authorization", "Bearer $token")
            if (etagFile.exists()) {
                val etag = etagFile.readText().trim()
                if (etag.isNotEmpty()) setRequestProperty("If-None-Match", etag)
            }
        }
        try {
            conn.connect()
            val code = conn.responseCode
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED && file.exists()) {
                file.setLastModified(now)
                return file
            }
            if (code !in 200..299) {
                if (code == HttpURLConnection.HTTP_UNAUTHORIZED || code == HttpURLConnection.HTTP_FORBIDDEN) {
                    file.delete()
                    etagFile.delete()
                    throw IOException("HTTP $code")
                }
                if (file.exists()) return file
                throw IOException("HTTP $code")
            }
            val etag = conn.getHeaderField("ETag") ?: ""
            val tmp = File(dir, "$key.tmp")
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(16 * 1024)
                    var total = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_FILE_BYTES) {
                            tmp.delete()
                            throw IOException("too large")
                        }
                        out.write(buf, 0, n)
                    }
                }
            }
            if (file.exists()) file.delete()
            if (!tmp.renameTo(file)) {
                tmp.copyTo(file, overwrite = true)
                tmp.delete()
            }
            etagFile.writeText(etag)
            prune(dir)
            return file
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return digest.joinToString("") { b -> "%02x".format(b) }
    }

    private fun prune(dir: File) {
        val files = dir.listFiles() ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_CACHE_BYTES) return
        files.filter { it.extension != "tmp" }
            .sortedBy { it.lastModified() }
            .forEach { f ->
                if (total <= MAX_CACHE_BYTES) return
                total -= f.length()
                f.delete()
            }
    }
}
