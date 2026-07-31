"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

class CacheMock {
    constructor(scope) {
        this.scope = scope;
        this.entries = new Map();
    }

    key(request) {
        return new Request(request, { method: "GET" }).url;
    }

    async match(request) {
        const response = this.entries.get(this.key(request));
        return response ? response.clone() : undefined;
    }

    async put(request, response) {
        this.entries.set(this.key(request), response.clone());
    }

    async delete(request) {
        return this.entries.delete(this.key(request));
    }

    async keys() {
        return Array.from(this.entries.keys(), (url) => new Request(url));
    }

    async addAll(assets) {
        for (const asset of assets) {
            await this.put(
                new Request(new URL(asset, this.scope)),
                new Response("cached", { status: 200 })
            );
        }
    }
}

async function main() {
    const scope = "https://example.test/Choobs/";
    const listeners = new Map();
    const cache_objects = new Map();
    let fetch_count = 0;

    const context = vm.createContext({
        AbortController,
        Request,
        Response,
        URL,
        console,
        setTimeout,
        clearTimeout,
        fetch: async () => {
            fetch_count += 1;
            return new Response("{}", {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        },
        caches: {
            async open(name) {
                if (!cache_objects.has(name)) {
                    cache_objects.set(name, new CacheMock(scope));
                }
                return cache_objects.get(name);
            },
            async keys() {
                return Array.from(cache_objects.keys());
            },
            async delete(name) {
                return cache_objects.delete(name);
            }
        },
        self: {
            CHOOBS_BUILD_VERSION: "test-build",
            CHOOBS_EXTRA_APP_SHELL: [
                "./js/campaign_manifest.js",
                "./js/campaign_manifest.js"
            ],
            CHOOBS_CAMPAIGN_FILES: [
                "./levels/level_001.json",
                "./levels/Animals/campaign.json",
                "./levels/Animals/level_001.json",
                "./levels/Animals/level_001.json"
            ],
            registration: {
                scope,
                navigationPreload: null
            },
            clients: {
                async claim() {}
            },
            location: {
                origin: new URL(scope).origin
            },
            navigator: {
                onLine: true
            },
            addEventListener(type, listener) {
                listeners.set(type, listener);
            },
            async skipWaiting() {}
        }
    });

    const core_path = path.join(root, "service-worker-optimized-core.js");
    const core_source = fs.readFileSync(core_path, "utf8");
    new vm.Script(core_source, { filename: core_path }).runInContext(context);

    assert.deepEqual(
        Array.from(vm.runInContext(
            'unique_assets(["a", "a", "", "b"])',
            context
        )),
        ["a", "b"]
    );
    assert.equal(vm.runInContext("LEVEL_ASSETS.length", context), 3);
    assert.ok(listeners.has("install"));
    assert.ok(listeners.has("message"));
    assert.ok(listeners.has("fetch"));

    const static_cache_name = vm.runInContext("STATIC_CACHE", context);
    const level_cache_name = vm.runInContext("LEVEL_CACHE", context);
    const app_shell = Array.from(vm.runInContext("APP_SHELL", context));
    const level_assets = Array.from(vm.runInContext("LEVEL_ASSETS", context));
    const static_cache = await context.caches.open(static_cache_name);
    const level_cache = await context.caches.open(level_cache_name);

    await static_cache.addAll(app_shell);
    await level_cache.addAll(level_assets);
    await vm.runInContext("write_level_metadata", context)(level_cache);

    const current_result = await vm.runInContext(
        "refresh_all_offline_files()",
        context
    );
    assert.equal(current_result.downloaded_count, 0);
    assert.equal(fetch_count, 0);

    await level_cache.put(
        vm.runInContext("LEVEL_METADATA_URL", context),
        new Response(JSON.stringify({
            build_version: "old-build",
            asset_count: level_assets.length
        }), {
            headers: { "Content-Type": "application/json" }
        })
    );

    const refreshed_result = await vm.runInContext(
        "refresh_all_offline_files()",
        context
    );
    assert.equal(refreshed_result.downloaded_count, level_assets.length);
    assert.equal(fetch_count, level_assets.length);

    const wrapper = fs.readFileSync(
        path.join(root, "service-worker.js"),
        "utf8"
    );
    assert.equal(
        (wrapper.match(/CACHE_ALL_OFFLINE_FILES/g) || []).length,
        0,
        "the wrapper must not register a duplicate cache handler"
    );
    assert.match(wrapper, /campaign_manifest\.js/);
    assert.match(wrapper, /service-worker-optimized-core\.js/);

    console.log("Offline update tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
