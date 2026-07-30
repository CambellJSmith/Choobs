---
layout: null
---
"use strict";

importScripts("./service-worker-core.js");

const CAMPAIGN_EXTENSION_ASSETS = [
    "./service-worker-core.js",
    "./js/campaign_manifest.js",
    "./js/campaign_migrations.js",
    "./js/tutorial.js",
    "./js/campaigns.js",
    "./js/pwa_core.js",
    "./creator/js/unlimited_quantization_core.js",
    "./creator/js/bulk_creator.js",
{% assign sorted_campaign_assets = site.static_files | sort: "path" %}
{% for file in sorted_campaign_assets %}
{% if file.path contains "/levels/" %}
{% if file.extname == ".json" %}
    ".{{ file.path }}",
{% endif %}
{% endif %}
{% endfor %}
];

async function cache_campaign_extension_assets() {
    const cache = await caches.open(STATIC_CACHE);
    await cache_optional_assets(cache, CAMPAIGN_EXTENSION_ASSETS);
}

self.addEventListener("install", (event) => {
    event.waitUntil(cache_campaign_extension_assets());
});

self.addEventListener("message", (event) => {
    const message = event.data || {};

    if (message.type === "CACHE_ALL_OFFLINE_FILES") {
        event.waitUntil(cache_campaign_extension_assets());
    }
});
