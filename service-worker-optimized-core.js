"use strict";

const BUILD_VERSION = String(self.CHOOBS_BUILD_VERSION || "development");
const CACHE_PREFIX = "choobs-pwa-";
const STATIC_CACHE = `${CACHE_PREFIX}static-${BUILD_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD_VERSION}`;
const LEVEL_CACHE = `${CACHE_PREFIX}levels-v1`;
const LEVEL_METADATA_URL = new URL(
    "./__choobs_level_cache_metadata__",
    self.registration.scope
).href;
const NAVIGATION_TIMEOUT_MS = 3500;
const RESOURCE_TIMEOUT_MS = 2500;
const SETUP_FETCH_TIMEOUT_MS = 20000;
const SETUP_CONCURRENCY = positive_integer(
    self.CHOOBS_SETUP_CONCURRENCY,
    8
);
const FINAL_RETRY_CONCURRENCY = positive_integer(
    self.CHOOBS_FINAL_RETRY_CONCURRENCY,
    2
);
const SETUP_FAILURE_CIRCUIT = positive_integer(
    self.CHOOBS_SETUP_FAILURE_CIRCUIT,
    8
);
const FINAL_RETRY_MAX_ASSETS = positive_integer(
    self.CHOOBS_FINAL_RETRY_MAX_ASSETS,
    12
);
const CACHE_CHECK_BATCH_SIZE = 64;
const SETUP_RETRY_DELAYS_MS = retry_delays(
    self.CHOOBS_SETUP_RETRY_DELAYS_MS,
    [300, 1200]
);
const FINAL_RETRY_DELAYS_MS = retry_delays(
    self.CHOOBS_FINAL_RETRY_DELAYS_MS,
    [2500, 5000]
);

const BASE_APP_SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./manifest.webmanifest",
    "./icon.svg",
    "./icon-180.png",
    "./icon-192.png",
    "./icon-512.png",
    "./js/levels.js",
    "./js/engine.js",
    "./js/procedural_levels.js",
    "./js/canvas_renderer.js",
    "./js/pipe_only_renderer.js",
    "./js/strict_collision_rules.js",
    "./js/game.js",
    "./js/pwa.js",
    "./creator/",
    "./creator/index.html",
    "./creator/styles.css",
    "./creator/creator.css",
    "./creator/js/levels.js",
    "./creator/js/engine.js",
    "./creator/js/generation_worker_source.js",
    "./creator/js/canvas_renderer.js",
    "./creator/js/creator.js",
    "./creator/js/unlimited_quantization.js"
];

function positive_integer(value, fallback) {
    const numeric_value = Math.floor(Number(value));
    return Number.isFinite(numeric_value) && numeric_value > 0 ?
        numeric_value :
        fallback;
}

function retry_delays(value, fallback) {
    if (!Array.isArray(value)) {
        return Object.freeze(fallback.slice());
    }

    return Object.freeze(value
        .map((delay) => Math.max(0, Number(delay) || 0))
        .filter(Number.isFinite));
}

function unique_assets(values) {
    return Array.from(new Set((values || []).map(String).filter(Boolean)));
}

function normalize_revision_map(value) {
    const revisions = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return revisions;
    }

    for (const [asset, revision] of Object.entries(value)) {
        if (typeof asset !== "string" || !asset ||
            typeof revision !== "string" || !revision) {
            continue;
        }
        revisions[asset] = revision.toLowerCase();
    }
    return revisions;
}

const APP_SHELL = unique_assets([
    ...BASE_APP_SHELL,
    ...(Array.isArray(self.CHOOBS_EXTRA_APP_SHELL) ?
        self.CHOOBS_EXTRA_APP_SHELL :
        [])
]);
const LEVEL_ASSETS = unique_assets(
    Array.isArray(self.CHOOBS_CAMPAIGN_FILES) ?
        self.CHOOBS_CAMPAIGN_FILES :
        []
);
const LEVEL_REVISIONS = normalize_revision_map(
    self.CHOOBS_LEVEL_REVISIONS
);
const LEVEL_REVISION_ALGORITHM = String(
    self.CHOOBS_LEVEL_REVISION_ALGORITHM || "sha256"
).toLowerCase();
const LEVEL_MANIFEST_REVISION = String(
    self.CHOOBS_LEVEL_MANIFEST_REVISION || "legacy"
);
const LEVEL_URLS = new Set(
    LEVEL_ASSETS.map((asset) => new URL(asset, self.registration.scope).href)
);

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(APP_SHELL);
    }));
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith(CACHE_PREFIX) &&
                name !== STATIC_CACHE &&
                name !== RUNTIME_CACHE &&
                name !== LEVEL_CACHE)
            .map((name) => caches.delete(name)));

        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.disable();
        }
        await self.clients.claim();
    })());
});

self.addEventListener("message", (event) => {
    const message = event.data || {};

    if (message.type === "SKIP_WAITING") {
        event.waitUntil(self.skipWaiting());
        return;
    }
    if (message.type !== "CACHE_ALL_OFFLINE_FILES") {
        return;
    }

    const port = event.ports && event.ports[0];
    const task = refresh_all_offline_files()
        .then((result) => port?.postMessage({
            ok: true,
            ...result,
            build_version: BUILD_VERSION
        }))
        .catch((error) => {
            port?.postMessage({
                ok: false,
                retryable: error && error.retryable !== false,
                failed_count: Number(error && error.failed_count) || 0,
                message: "Some offline files are still being retried."
            });
        });
    event.waitUntil(task);
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }
    if (request.mode === "navigate") {
        event.respondWith(handle_navigation(request));
        return;
    }

    url.search = "";
    url.hash = "";
    if (LEVEL_URLS.has(url.href)) {
        event.respondWith(handle_level_asset(new Request(url.href)));
        return;
    }
    event.respondWith(cache_first_with_refresh(request));
});

function request_for(asset) {
    return new Request(new URL(asset, self.registration.scope).href);
}

function expected_level_revision(asset) {
    return LEVEL_REVISIONS[asset] || null;
}

function fetch_request_for(asset) {
    const request = request_for(asset);
    const revision = expected_level_revision(asset);
    if (!revision) {
        return request;
    }

    const url = new URL(request.url);
    url.searchParams.set("choobs_revision", revision.slice(0, 24));
    return new Request(url.href);
}

function delay(milliseconds) {
    if (!(milliseconds > 0)) {
        return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function response_sha256(response) {
    const crypto_api = self.crypto || globalThis.crypto;
    if (!crypto_api || !crypto_api.subtle ||
        typeof crypto_api.subtle.digest !== "function") {
        return null;
    }

    const bytes = await response.arrayBuffer();
    const digest = await crypto_api.subtle.digest("SHA-256", bytes);
    return Array.from(
        new Uint8Array(digest),
        (value) => value.toString(16).padStart(2, "0")
    ).join("");
}

async function find_missing(cache, assets) {
    const missing = [];
    for (let index = 0; index < assets.length; index += CACHE_CHECK_BATCH_SIZE) {
        const batch = assets.slice(index, index + CACHE_CHECK_BATCH_SIZE);
        const matches = await Promise.all(
            batch.map((asset) => cache.match(request_for(asset)))
        );
        matches.forEach((response, offset) => {
            if (!response) {
                missing.push(batch[offset]);
            }
        });
    }
    return missing;
}

async function cache_asset_with_retries(
    cache,
    asset,
    cache_mode,
    retry_schedule
) {
    const cache_request = request_for(asset);
    const fetch_request = fetch_request_for(asset);
    const expected_revision = expected_level_revision(asset);
    let last_error = null;

    for (let attempt = 0; attempt <= retry_schedule.length; attempt += 1) {
        if (attempt > 0) {
            await delay(retry_schedule[attempt - 1]);
        }

        try {
            const response = await fetch_with_timeout(
                fetch_request,
                SETUP_FETCH_TIMEOUT_MS,
                { cache: cache_mode }
            );

            if (!response || !response.ok) {
                const status = response ? response.status : 0;
                throw new Error(
                    `Offline fetch returned ${status || "no response"}.`
                );
            }

            const actual_revision = await response_sha256(response.clone());
            if (expected_revision && actual_revision &&
                actual_revision !== expected_revision) {
                throw new Error(
                    "Offline fetch did not match the generated revision."
                );
            }

            await cache.put(cache_request, response);
            return {
                ok: true,
                asset,
                revision: actual_revision || expected_revision || null
            };
        } catch (error) {
            last_error = error;
        }
    }

    return {
        ok: false,
        asset,
        error: last_error
    };
}

async function cache_assets(
    cache,
    assets,
    cache_mode,
    {
        concurrency = SETUP_CONCURRENCY,
        retry_schedule = SETUP_RETRY_DELAYS_MS,
        failure_circuit = SETUP_FAILURE_CIRCUIT
    } = {}
) {
    const values = unique_assets(assets);
    let cursor = 0;
    let completed_count = 0;
    let consecutive_failures = 0;
    let circuit_open = false;
    const failed_assets = [];
    const asset_revisions = Object.create(null);
    const worker_count = Math.min(concurrency, values.length);

    await Promise.all(Array.from({ length: worker_count }, async () => {
        while (!circuit_open) {
            const index = cursor++;
            if (index >= values.length) {
                return;
            }

            const result = await cache_asset_with_retries(
                cache,
                values[index],
                cache_mode,
                retry_schedule
            );

            if (result.ok) {
                completed_count += 1;
                consecutive_failures = 0;
                if (result.revision) {
                    asset_revisions[result.asset] = result.revision;
                }
            } else {
                failed_assets.push(result.asset);
                consecutive_failures += 1;

                if (consecutive_failures >= failure_circuit) {
                    circuit_open = true;
                }
            }
        }
    }));

    if (cursor < values.length) {
        failed_assets.push(...values.slice(cursor));
    }

    return {
        completed_count,
        failed_assets: unique_assets(failed_assets),
        asset_revisions,
        circuit_open
    };
}

async function cache_assets_resilient(cache, assets, cache_mode) {
    const initial = await cache_assets(cache, assets, cache_mode);

    if (initial.failed_assets.length === 0 ||
        initial.failed_assets.length > FINAL_RETRY_MAX_ASSETS) {
        return initial;
    }

    const final_pass = await cache_assets(
        cache,
        initial.failed_assets,
        cache_mode,
        {
            concurrency: FINAL_RETRY_CONCURRENCY,
            retry_schedule: FINAL_RETRY_DELAYS_MS,
            failure_circuit: FINAL_RETRY_MAX_ASSETS
        }
    );

    return {
        completed_count:
            initial.completed_count + final_pass.completed_count,
        failed_assets: final_pass.failed_assets,
        asset_revisions: {
            ...initial.asset_revisions,
            ...final_pass.asset_revisions
        },
        circuit_open: initial.circuit_open || final_pass.circuit_open
    };
}

async function read_level_metadata(cache) {
    const response = await cache.match(LEVEL_METADATA_URL);
    if (!response) {
        return null;
    }
    try {
        return await response.json();
    } catch (_error) {
        return null;
    }
}

function stored_level_revisions(metadata) {
    return normalize_revision_map(metadata && metadata.asset_revisions);
}

function current_level_revisions(metadata, downloaded_revisions) {
    const revisions = stored_level_revisions(metadata);
    for (const [asset, revision] of Object.entries(downloaded_revisions || {})) {
        if (LEVEL_URLS.has(request_for(asset).url)) {
            revisions[asset] = revision;
        }
    }

    const expected_assets = new Set(LEVEL_ASSETS);
    for (const asset of Object.keys(revisions)) {
        if (!expected_assets.has(asset)) {
            delete revisions[asset];
        }
    }
    return revisions;
}

async function write_level_metadata(
    cache,
    pending_assets = [],
    asset_revisions = Object.create(null)
) {
    const pending = unique_assets(pending_assets);
    await cache.put(LEVEL_METADATA_URL, new Response(JSON.stringify({
        build_version: BUILD_VERSION,
        manifest_revision: LEVEL_MANIFEST_REVISION,
        revision_algorithm: LEVEL_REVISION_ALGORITHM,
        asset_count: LEVEL_ASSETS.length,
        complete: pending.length === 0,
        pending_assets: pending,
        asset_revisions,
        saved_at: Date.now()
    }), {
        headers: { "Content-Type": "application/json" }
    }));
}

async function remove_obsolete_levels(cache) {
    const expected = new Set(LEVEL_ASSETS.map((asset) => request_for(asset).url));
    const keys = await cache.keys();
    await Promise.all(keys
        .filter((request) => request.url !== LEVEL_METADATA_URL &&
            !expected.has(request.url))
        .map((request) => cache.delete(request)));
}

function pending_level_assets(metadata, missing_levels) {
    const pending = Array.isArray(metadata && metadata.pending_assets) ?
        metadata.pending_assets :
        [];
    const missing = new Set(missing_levels);
    const current_manifest = metadata &&
        metadata.manifest_revision === LEVEL_MANIFEST_REVISION &&
        Number(metadata.asset_count) === LEVEL_ASSETS.length;

    if (current_manifest) {
        return unique_assets([...pending, ...missing_levels]);
    }

    const revision_entries = Object.keys(LEVEL_REVISIONS);
    if (revision_entries.length === 0) {
        return LEVEL_ASSETS;
    }

    const stored_revisions = stored_level_revisions(metadata);
    const pending_set = new Set(pending);
    return LEVEL_ASSETS.filter((asset) => {
        const expected_revision = expected_level_revision(asset);
        return missing.has(asset) ||
            pending_set.has(asset) ||
            !expected_revision ||
            stored_revisions[asset] !== expected_revision;
    });
}

class OfflineSyncError extends Error {
    constructor(failed_count) {
        super("Some offline files are still being retried.");
        this.name = "OfflineSyncError";
        this.failed_count = failed_count;
        this.retryable = true;
    }
}

async function refresh_all_offline_files() {
    const static_cache = await caches.open(STATIC_CACHE);
    const level_cache = await caches.open(LEVEL_CACHE);
    const missing_shell = await find_missing(static_cache, APP_SHELL);
    const shell_result = await cache_assets_resilient(
        static_cache,
        missing_shell,
        "reload"
    );

    const metadata = await read_level_metadata(level_cache);
    const missing_levels = await find_missing(level_cache, LEVEL_ASSETS);
    const levels_to_fetch = pending_level_assets(metadata, missing_levels);
    const level_result = await cache_assets_resilient(
        level_cache,
        levels_to_fetch,
        "no-cache"
    );

    await remove_obsolete_levels(level_cache);
    const next_revisions = current_level_revisions(
        metadata,
        level_result.asset_revisions
    );
    await write_level_metadata(
        level_cache,
        level_result.failed_assets,
        next_revisions
    );

    const missing_after_sync = unique_assets([
        ...(await find_missing(static_cache, APP_SHELL)),
        ...(await find_missing(level_cache, LEVEL_ASSETS))
    ]);
    const failed_assets = unique_assets([
        ...shell_result.failed_assets,
        ...level_result.failed_assets,
        ...missing_after_sync
    ]);

    if (failed_assets.length > 0) {
        throw new OfflineSyncError(failed_assets.length);
    }

    const asset_count = APP_SHELL.length + LEVEL_ASSETS.length;
    const downloaded_count =
        shell_result.completed_count + level_result.completed_count;
    return {
        asset_count,
        downloaded_count,
        reused_count: Math.max(0, asset_count - downloaded_count)
    };
}

async function handle_navigation(request) {
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
    const creator_path = new URL("./creator/", self.registration.scope).pathname;
    const fallback = url.pathname.startsWith(creator_path) ?
        "./creator/index.html" :
        "./index.html";
    return static_cache.match(fallback) ||
        fetch_and_store(request, NAVIGATION_TIMEOUT_MS, runtime);
}

async function handle_level_asset(request) {
    const cache = await caches.open(LEVEL_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        refresh_in_background(request, RESOURCE_TIMEOUT_MS, cache);
        return cached;
    }
    return fetch_and_store(request, RESOURCE_TIMEOUT_MS, cache);
}

async function cache_first_with_refresh(request) {
    const runtime = await caches.open(RUNTIME_CACHE);
    const runtime_match = await runtime.match(request);
    if (runtime_match) {
        refresh_in_background(request, RESOURCE_TIMEOUT_MS, runtime);
        return runtime_match;
    }

    const static_cache = await caches.open(STATIC_CACHE);
    const static_match = await static_cache.match(request);
    if (static_match) {
        refresh_in_background(request, RESOURCE_TIMEOUT_MS, runtime);
        return static_match;
    }
    return fetch_and_store(request, RESOURCE_TIMEOUT_MS, runtime);
}

async function fetch_and_store(request, timeout_ms, cache) {
    const response = await fetch_with_timeout(request, timeout_ms);
    if (response && response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}

function refresh_in_background(request, timeout_ms, cache) {
    fetch_with_timeout(request, timeout_ms, { cache: "no-cache" })
        .then((response) => {
            if (response && response.ok) {
                return cache.put(request, response);
            }
        })
        .catch(() => {});
}

async function fetch_with_timeout(request, timeout_ms, options = {}) {
    if (self.navigator && self.navigator.onLine === false) {
        throw new TypeError("The device is offline.");
    }

    const controller = typeof AbortController === "undefined" ? null :
        new AbortController();
    const timeout = setTimeout(() => controller?.abort(), timeout_ms);
    try {
        return await fetch(request, controller ? {
            ...options,
            signal: controller.signal
        } : options);
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new TypeError("The network request timed out.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
