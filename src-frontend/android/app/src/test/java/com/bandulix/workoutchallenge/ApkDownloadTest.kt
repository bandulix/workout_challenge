package com.bandulix.workoutchallenge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkDownloadTest {
    @Test
    fun httpsApkIsAllowedWhenOriginPinned() {
        CachedMedia.allowedOrigin = "https://challenge.example.com"
        assertTrue(ApkDownload.isAllowed("https://challenge.example.com/download/workout-challenge.apk"))
        CachedMedia.allowedOrigin = null
    }

    @Test
    fun httpLoopbackApkIsAllowedWhenOriginPinned() {
        CachedMedia.allowedOrigin = "http://127.0.0.1"
        assertTrue(ApkDownload.isAllowed("http://127.0.0.1/download/workout-challenge.apk"))
        CachedMedia.allowedOrigin = null
    }

    @Test
    fun rejectsOtherHostEvenWithDownloadPath() {
        CachedMedia.allowedOrigin = "https://challenge.example.com"
        assertFalse(ApkDownload.isAllowed("https://evil.example/download/malware.apk"))
        CachedMedia.allowedOrigin = null
    }

    @Test
    fun rejectsWhenOriginNotPinned() {
        CachedMedia.allowedOrigin = null
        assertFalse(ApkDownload.isAllowed("https://challenge.example.com/download/workout-challenge.apk"))
    }

    @Test
    fun rejectsNonApkAndUnsafe() {
        CachedMedia.allowedOrigin = "https://challenge.example.com"
        assertFalse(ApkDownload.isAllowed(null))
        assertFalse(ApkDownload.isAllowed(""))
        assertFalse(ApkDownload.isAllowed("https://challenge.example.com/download/apk-version.json"))
        assertFalse(ApkDownload.isAllowed("https://challenge.example.com/"))
        assertFalse(ApkDownload.isAllowed("javascript:alert(1)"))
        assertFalse(ApkDownload.isAllowed("file:///sdcard/app.apk"))
        assertFalse(ApkDownload.isAllowed("https://user:pass@evil.example/x.apk"))
        assertFalse(ApkDownload.isAllowed("https://evil.example/other/app.apk"))
        CachedMedia.allowedOrigin = null
    }
}
