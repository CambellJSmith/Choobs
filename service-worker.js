---
layout: null
---
"use strict";

{% if site.github.build_revision %}
{% assign build_version = site.github.build_revision %}
{% else %}
{% assign build_version = site.time | date: "%Y%m%d%H%M%S" %}
{% endif %}
const BUILD_VERSION = "{{ build_version }}";
const CACHE_PREFIX = "choobs-pwa-";
const STATIC_CACHE = `${CACHE_PREFIX}static-${BUILD_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD_VERSION}`;
const NAVIGATION_TIMEOUT_MS = 3500;
const RESOURCE_TIMEOUT_MS = 2500;
const SETUP_FETCH_TIMEOUT_MS = 20000;

const APP_SHELL = [
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
    "./creator/js/creator.js"
];

const LEVEL_ASSETS = [
{% assign sorted_static_files = site.static_files | sort: "path" %}
{% for file in sorted_static_files %}
{% if file.path contains "/levels/level_" %}
{% if file.extname == ".json" %}
    ".{{ file.path }}",
{% endif %}
{% endif %}
{% endfor %}
];

const PRECACHE_ASSETS = [...APP_SHELL, ...LEVEL_ASSETS];

self.addEventListener("install", (event) => {
    event.waitUntil(install_offline_cache());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const cache_names = await caches.keys();

        await Promise.all(
            cache_names
                .filter((name) => name.startsWith(CACHE_PREFIX) &&
                    name !== STATIC_CACHE && name !== RUNTIME_CACHE)
                .map((name) => caches.delete(name))
        );

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

    if (message.type === "CACHE_ALL_OFFLINE_FILES") {
        const response_port = event.ports && event.ports[0];
        const cache_task = refresh_all_offline_files()
            .then((asset_count) => {
                response_port?.postMessage({
                    ok: true,
                    asset_count,
                    build_version: BUILD_VERSION
                });
            })
            .catch((error) => {
                response_port?.postMessage({
                    ok: false,
                    message: error.message || "Offline files could not be cached."
                });
                throw error;
            });

        event.waitUntil(cache_task);
    }
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

    if (url.pathname.endsWith(".json")) {
        event.respondWith(cache_first_with_refresh(request));
        return;
    }

    event.respondWith(cache_first_with_refresh(request));
});

async function install_offline_cache() {
    const cache = await caches.open(STATIC_CACHE);

    // The application shell is required. If one of these files is unavailable,
    // the worker should not activate with an incomplete offline application.
    await cache.addAll(APP_SHELL);

    // Individual level files are optional at install time. One temporary level
    // failure must not prevent the already complete application shell from
    // becoming available offline.
    await cache_optional_assets(cache, LEVEL_ASSETS);
}

async function cache_optional_assets(cache, assets) {
    const batch_size = 8;

    for (let index = 0; index < assets.length; index += batch_size) {
        const batch = assets.slice(index, index + batch_size);

        await Promise.allSettled(
            batch.map(async (asset) => {
                const response = await fetch_with_timeout(
                    asset,
                    SETUP_FETCH_TIMEOUT_MS,
                    { cache: "reload" }
                );

                if (!response || !response.ok) {
                    throw new Error(`Could not cache optional asset ${asset}.`);
                }

                await cache.put(asset, response);
            })
        );
    }
}

async function refresh_all_offline_files() {
    const cache = await caches.open(STATIC_CACHE);

    for (const asset of PRECACHE_ASSETS) {
        const response = await fetch_with_timeout(
            asset,
            SETUP_FETCH_TIMEOUT_MS,
            { cache: "reload" }
        );

        if (!response || !response.ok) {
            throw new Error(`Could not save ${asset} for offline use.`);
        }

        await cache.put(asset, response);
    }

    const missing_assets = [];

    for (const asset of PRECACHE_ASSETS) {
        if (!await cache.match(asset)) {
            missing_assets.push(asset);
        }
    }

    if (missing_assets.length > 0) {
        throw new Error(
            `${missing_assets.length} offline file${
                missing_assets.length === 1 ? " is" : "s are"
            } still missing.`
        );
    }

    return PRECACHE_ASSETS.length;
}

async function handle_navigation(request) {
    const cached = await get_cached_navigation(request);

    if (cached) {
        refresh_in_background(request, NAVIGATION_TIMEOUT_MS);
        return cached;
    }

    return fetch_and_store(request, NAVIGATION_TIMEOUT_MS);
}

async function get_cached_navigation(request) {
    const exact_match = await caches.match(request, { ignoreSearch: true });

    if (exact_match) {
        return exact_match;
    }

    const cache = await caches.open(STATIC_CACHE);
    const url = new URL(request.url);
    const creator_path = new URL("./creator/", self.registration.scope).pathname;
    const fallback = url.pathname.startsWith(creator_path) ?
        "./creator/index.html" :
        "./index.html";

    return cache.match(fallback);
}

async function cache_first_with_refresh(request) {
    const cached = await caches.match(request);

    if (cached) {
        refresh_in_background(request, RESOURCE_TIMEOUT_MS);
        return cached;
    }

    return fetch_and_store(request, RESOURCE_TIMEOUT_MS);
}

async function fetch_and_store(request, timeout_ms) {
    const response = await fetch_with_timeout(request, timeout_ms);

    if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
    }

    return response;
}

function refresh_in_background(request, timeout_ms) {
    fetch_with_timeout(request, timeout_ms)
        .then(async (response) => {
            if (!response || !response.ok) {
                return;
            }

            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response);
        })
        .catch(() => {});
}

async function fetch_with_timeout(request, timeout_ms, options = {}) {
    if (self.navigator && self.navigator.onLine === false) {
        throw new TypeError("The device is offline.");
    }

    if (typeof AbortController === "undefined") {
        return Promise.race([
            fetch(request, options),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new TypeError("The network request timed out."));
                }, timeout_ms);
            })
        ]);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeout_ms);

    try {
        return await fetch(request, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new TypeError("The network request timed out.");
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
