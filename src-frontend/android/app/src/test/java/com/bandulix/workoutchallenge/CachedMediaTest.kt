package com.bandulix.workoutchallenge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CachedMediaTest {
    @Test
    fun noContentIsNotACachedImage() {
        assertTrue(CachedMedia.isEmptyBody(204))
        assertTrue(CachedMedia.isEmptyBody(403))
        assertTrue(CachedMedia.isEmptyBody(404))
        assertFalse(CachedMedia.isEmptyBody(200))
        assertFalse(CachedMedia.isEmptyBody(304))
    }

    @Test
    fun sameOriginHttpsIsAllowed() {
        assertTrue(
            CachedMedia.isAllowed(
                "https://challenge.example.com/api/user/1/picture/",
                "https://challenge.example.com",
            ),
        )
    }

    @Test
    fun rejectsOtherHostAndSchemes() {
        assertFalse(CachedMedia.isAllowed(null, "https://challenge.example.com"))
        assertFalse(CachedMedia.isAllowed("https://evil.example/x", "https://challenge.example.com"))
        assertFalse(CachedMedia.isAllowed("javascript:alert(1)", "https://challenge.example.com"))
        assertFalse(
            CachedMedia.isAllowed(
                "https://user:pass@challenge.example.com/x",
                "https://challenge.example.com",
            ),
        )
        assertFalse(
            CachedMedia.isAllowed(
                "http://challenge.example.com/x",
                "https://challenge.example.com",
            ),
        )
    }
}
