// Stale-while-revalidate for every live query, the way native apps work:
// paint the last snapshot (Redux persist / in-memory cache) immediately,
// then always revalidate on mount, app resume, and reconnect.
//
// refetchOnFocus needs setupListeners() in store.js. On Android that is
// not enough by itself — the WebView skips visibilitychange — so store.js
// also dispatches the RTK focus action from Capacitor's appStateChange.

export const liveQueryDefaults = {
    keepUnusedDataFor: 60 * 5,
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
};
