"use strict";

// Audited corrections layered after service-worker-optimized-core.js.
// These functions replace the original handlers used by the fetch listener.

const CHOOBS_LEVEL_ASSET_BY_URL = new Map(
    LEVEL_ASSETS.map((asset) => [request_for(asset).url, asset])
);

handle_navigation = async function (request) {
    const runtime = await caches.open(RUNTIME_CACHE);
    const runtime_match = await runtime.match(request, { ignoreSearch: true });
    if (runtime_match) {
        refresh_in_background(request, NAVIGATION_TIMEOUT_MS, runtime);
        return runtime_match;
    }

    const static_cache = await caches.open(STATIC_CACHE);
    const static_match = await static_cache.match(request, {
        ignoreSearch: true
    });
    if (static_match) {
        refresh_in_background(request, NAVIGATION_TIMEOUT_MS, runtime);
        return static_match;
    }

    const url = new URL(request.url);
    const creator_path = new URL(
        "./creator/",
        self.registration.scope
    ).pathname;
    const fallback = url.pathname.startsWith(creator_path) ?
        "./creator/index.html" :
        "./index.html";
    const fallback_match = await static_cache.match(fallback);

    return fallback_match ||
        fetch_and_store(request, NAVIGATION_TIMEOUT_MS, runtime);
};

handle_level_asset = async function (request) {
    const cache = await caches.open(LEVEL_CACHE);
    const asset = CHOOBS_LEVEL_ASSET_BY_URL.get(request.url);

    if (!asset) {
        return fetch_and_store(request, RESOURCE_TIMEOUT_MS, cache);
    }

    const metadata = await read_level_metadata(cache);
    const stored_revisions = stored_level_revisions(metadata);
    const expected_revision = expected_level_revision(asset);
    const cached = await cache.match(request);

    if (cached &&
        (!expected_revision || stored_revisions[asset] === expected_revision)) {
        return cached;
    }

    const result = await cache_asset_with_retries(
        cache,
        asset,
        "no-cache",
        SETUP_RETRY_DELAYS_MS
    );

    if (!result.ok) {
        throw result.error || new Error(
            "The requested level could not be cached."
        );
    }

    const next_revisions = current_level_revisions(
        metadata,
        { [asset]: result.revision }
    );
    const previous_pending = Array.isArray(
        metadata && metadata.pending_assets
    ) ? metadata.pending_assets : [];
    const unresolved_revisions = LEVEL_ASSETS.filter((candidate) => {
        const expected = expected_level_revision(candidate);
        return !expected || next_revisions[candidate] !== expected;
    });
    const pending_assets = unique_assets([
        ...previous_pending.filter((candidate) => candidate !== asset),
        ...unresolved_revisions
    ]);

    await write_level_metadata(
        cache,
        pending_assets,
        next_revisions
    );

    const updated = await cache.match(request);
    if (!updated) {
        throw new Error("The requested level was not stored.");
    }

    return updated;
};
