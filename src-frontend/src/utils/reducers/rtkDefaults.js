// Stale-while-revalidate for every live query, the way native apps work:
// paint the last snapshot (Redux persist / in-memory cache) immediately,
// revalidate on mount if the snapshot is older than 60s, and always on
// app resume / reconnect.
//
// refetchOnFocus needs setupListeners() in store.js. On Android that is
// not enough by itself — the WebView skips visibilitychange — so store.js
// also dispatches the RTK focus action from Capacitor's appStateChange.

export const liveQueryDefaults = {
    keepUnusedDataFor: 60 * 5,
    refetchOnMountOrArgChange: 60,
    refetchOnFocus: true,
    refetchOnReconnect: true,
};
