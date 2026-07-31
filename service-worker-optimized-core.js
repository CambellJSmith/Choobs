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
const SETUP_CONCURRENCY = 16;
const CACHE_CHECK_BATCH_SIZE = 64;

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

function unique_assets(values) {
    return Array.from(new Set((values || []).map(String).filter(Boolean)));
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
                message: error.message || "Offline files could not be cached."
            });
            throw error;
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

async function cache_assets(cache, assets, cache_mode) {
    let cursor = 0;
    let completed = 0;
    let first_error = null;
    const worker_count = Math.min(SETUP_CONCURRENCY, assets.length);

    await Promise.all(Array.from({ length: worker_count }, async () => {
        while (!first_error) {
            const index = cursor++;
            if (index >= assets.length) {
                return;
            }

            const asset = assets[index];
            try {
                const request = request_for(asset);
                const response = await fetch_with_timeout(
                    request,
                    SETUP_FETCH_TIMEOUT_MS,
                    { cache: cache_mode }
                );
                if (!response || !response.ok) {
                    throw new Error(`Could not save ${asset} for offline use.`);
                }
                await cache.put(request, response);
                completed += 1;
            } catch (error) {
                first_error = error;
            }
        }
    }));

    if (first_error) {
        throw first_error;
    }
    return completed;
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

async function write_level_metadata(cache) {
    await cache.put(LEVEL_METADATA_URL, new Response(JSON.stringify({
        build_version: BUILD_VERSION,
        asset_count: LEVEL_ASSETS.length,
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

async function refresh_all_offline_files() {
    const static_cache = await caches.open(STATIC_CACHE);
    const level_cache = await caches.open(LEVEL_CACHE);
    const missing_shell = await find_missing(static_cache, APP_SHELL);
    const shell_downloads = await cache_assets(
        static_cache,
        missing_shell,
        "reload"
    );

    const metadata = await read_level_metadata(level_cache);
    const missing_levels = await find_missing(level_cache, LEVEL_ASSETS);
    const current = metadata &&
        metadata.build_version === BUILD_VERSION &&
        Number(metadata.asset_count) === LEVEL_ASSETS.length;
    const levels_to_fetch = current ? missing_levels : LEVEL_ASSETS;
    const level_downloads = await cache_assets(
        level_cache,
        levels_to_fetch,
        "no-cache"
    );

    await remove_obsolete_levels(level_cache);
    await write_level_metadata(level_cache);

    const still_missing = (await find_missing(static_cache, APP_SHELL)).length +
        (await find_missing(level_cache, LEVEL_ASSETS)).length;
    if (still_missing > 0) {
        throw new Error(`${still_missing} offline files are still missing.`);
    }

    const asset_count = APP_SHELL.length + LEVEL_ASSETS.length;
    const downloaded_count = shell_downloads + level_downloads;
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
