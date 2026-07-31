"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
    const root = path.resolve(__dirname, "..");
    const scope = "https://example.test/Choobs/";
    const listeners = new Map();
    const cache_objects = new Map();
    const attempts = new Map();
    let second_sync = false;

    const level_1 = new URL("./levels/level_001.json", scope).href;
    const level_2 = new URL("./levels/level_002.json", scope).href;
    const level_3 = new URL("./levels/level_003.json", scope).href;

    const context = vm.createContext({
        AbortController,
        Request,
        Response,
        URL,
        console,
        setTimeout,
        clearTimeout,
        fetch: async (request) => {
            const url = new Request(request).url;
            attempts.set(url, (attempts.get(url) || 0) + 1);

            if (url === level_2 && attempts.get(url) <= 3) {
                throw new TypeError("temporary network failure");
            }

            if (url === level_3 && !second_sync) {
                throw new TypeError("persistent first-pass failure");
            }

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
            CHOOBS_BUILD_VERSION: "retry-build",
            CHOOBS_SETUP_CONCURRENCY: 3,
            CHOOBS_FINAL_RETRY_CONCURRENCY: 1,
            CHOOBS_SETUP_RETRY_DELAYS_MS: [0, 0],
            CHOOBS_FINAL_RETRY_DELAYS_MS: [0, 0],
            CHOOBS_EXTRA_APP_SHELL: [],
            CHOOBS_CAMPAIGN_FILES: [
                "./levels/level_001.json",
                "./levels/level_002.json",
                "./levels/level_003.json"
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

    assert.equal(vm.runInContext("SETUP_CONCURRENCY", context), 3);
    assert.equal(vm.runInContext("FINAL_RETRY_CONCURRENCY", context), 1);

    const static_cache_name = vm.runInContext("STATIC_CACHE", context);
    const level_cache_name = vm.runInContext("LEVEL_CACHE", context);
    const app_shell = Array.from(vm.runInContext("APP_SHELL", context));
    const static_cache = await context.caches.open(static_cache_name);
    const level_cache = await context.caches.open(level_cache_name);
    await static_cache.addAll(app_shell);

    let first_error = null;
    try {
        await vm.runInContext("refresh_all_offline_files()", context);
    } catch (error) {
        first_error = error;
    }

    assert.ok(first_error);
    assert.equal(first_error.name, "OfflineSyncError");
    assert.equal(first_error.failed_count, 1);
    assert.equal(first_error.message.includes("level_003"), false);

    assert.ok(await level_cache.match(level_1));
    assert.ok(await level_cache.match(level_2));
    assert.equal(await level_cache.match(level_3), undefined);
    assert.equal(attempts.get(level_1), 1);
    assert.equal(attempts.get(level_2), 4);
    assert.equal(attempts.get(level_3), 6);

    const metadata_url = vm.runInContext("LEVEL_METADATA_URL", context);
    const first_metadata = await (await level_cache.match(metadata_url)).json();
    assert.equal(first_metadata.complete, false);
    assert.deepEqual(first_metadata.pending_assets, [
        "./levels/level_003.json"
    ]);

    second_sync = true;
    const attempts_before_second = new Map(attempts);
    const result = await vm.runInContext(
        "refresh_all_offline_files()",
        context
    );

    assert.equal(result.downloaded_count, 1);
    assert.equal(
        attempts.get(level_1),
        attempts_before_second.get(level_1),
        "already refreshed files must not be downloaded again"
    );
    assert.equal(
        attempts.get(level_2),
        attempts_before_second.get(level_2),
        "recovered files must not be downloaded again"
    );
    assert.equal(
        attempts.get(level_3),
        attempts_before_second.get(level_3) + 1,
        "only the pending level should be retried"
    );

    const final_metadata = await (await level_cache.match(metadata_url)).json();
    assert.equal(final_metadata.complete, true);
    assert.deepEqual(final_metadata.pending_assets, []);

    const message_listener = listeners.get("message");
    assert.ok(message_listener);
    const posted = [];
    second_sync = false;
    await level_cache.delete(level_3);
    const wait_tasks = [];
    message_listener({
        data: { type: "CACHE_ALL_OFFLINE_FILES" },
        ports: [{ postMessage(value) { posted.push(value); } }],
        waitUntil(task) { wait_tasks.push(task); }
    });
    await Promise.all(wait_tasks);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].ok, false);
    assert.equal(posted[0].retryable, true);
    assert.equal(posted[0].failed_count, 1);
    assert.equal(posted[0].message.includes("level_003"), false);

    console.log("Resilient offline retry tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
