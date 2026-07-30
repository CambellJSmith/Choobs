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
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
    );
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
            await self.registration.navigationPreload.enable();
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
        event.respondWith(handle_navigation(event));
        return;
    }

    if (url.pathname.endsWith(".json")) {
        event.respondWith(network_first(request));
        return;
    }

    event.respondWith(cache_first_with_refresh(request));
});

async function refresh_all_offline_files() {
    const cache = await caches.open(STATIC_CACHE);

    for (const asset of PRECACHE_ASSETS) {
        const response = await fetch(asset, { cache: "reload" });

        if (!response || !response.ok) {
            throw new Error(`Could not save ${asset} for offline use.`);
        }

        await cache.put(asset, response);
    }

    return PRECACHE_ASSETS.length;
}

async function handle_navigation(event) {
    const request = event.request;

    try {
        const preload = await event.preloadResponse;
        const response = preload || await fetch(request);

        if (response && response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone()).catch(() => {});
        }

        return response;
    } catch (error) {
        const exact_match = await caches.match(request);

        if (exact_match) {
            return exact_match;
        }

        return caches.match("./index.html", { cacheName: STATIC_CACHE });
    }
}

async function network_first(request) {
    try {
        const response = await fetch(request);

        if (response && response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        const cached = await caches.match(request);

        if (cached) {
            return cached;
        }

        throw error;
    }
}

async function cache_first_with_refresh(request) {
    const cached = await caches.match(request);

    if (cached) {
        refresh_in_background(request);
        return cached;
    }

    const response = await fetch(request);

    if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
    }

    return response;
}

function refresh_in_background(request) {
    fetch(request).then(async (response) => {
        if (!response || !response.ok) {
            return;
        }

        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response);
    }).catch(() => {});
}
