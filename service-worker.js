---
layout: null
---
"use strict";

{% if site.github.build_revision %}
{% assign build_version = site.github.build_revision %}
{% else %}
{% assign build_version = site.time | date: "%Y%m%d%H%M%S" %}
{% endif %}
self.CHOOBS_BUILD_VERSION = "{{ build_version }}";
self.CHOOBS_EXTRA_APP_SHELL = Object.freeze([
    "./service-worker-optimized-core.js",
    "./service-worker-corrections.js",
    "./js/campaign_manifest.js",
    "./js/level_revision_manifest.js",
    "./js/campaign_migrations.js",
    "./js/tutorial_bootstrap.js",
    "./js/tutorial.js",
    "./js/campaigns.js",
    "./js/hud_layout.js",
    "./js/logical_flight_pass.js",
    "./js/performance_pass.js",
    "./js/pwa_core.js",
    "./creator/js/unlimited_quantization_core.js",
    "./creator/js/bulk_strict_quantization.js",
    "./creator/js/bulk_creator.js"
]);

importScripts(
    "./js/campaign_manifest.js",
    "./js/level_revision_manifest.js",
    "./service-worker-optimized-core.js",
    "./service-worker-corrections.js"
);

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});
