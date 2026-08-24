package com.bandulix.workoutchallenge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthHostTest {
    @Test
    fun httpsHostIsAllowed() {
        assertTrue(HealthHost.isAllowed("https://challenge.example.com/health"))
    }

    @Test
    fun httpLoopbackIsAllowed() {
        assertTrue(HealthHost.isAllowed("http://127.0.0.1:8001"))
    }

    @Test
    fun rejectsBlankAndNonHttp() {
        assertFalse(HealthHost.isAllowed(null))
        assertFalse(HealthHost.isAllowed(""))
        assertFalse(HealthHost.isAllowed("   "))
        assertFalse(HealthHost.isAllowed("javascript:alert(1)"))
        assertFalse(HealthHost.isAllowed("file:///data/data"))
        assertFalse(HealthHost.isAllowed("not a url"))
        assertFalse(HealthHost.isAllowed("https://user:pass@evil.example/health"))
    }
}
