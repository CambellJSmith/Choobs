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
        const value = request instanceof Request ? request.url : String(request);
        return new URL(value, this.scope).href;
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
    const caches_by_name = new Map();
    const fetch_counts = new Map();
    const level_url = new URL("./levels/level_001.json", scope).href;

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
            fetch_counts.set(url, (fetch_counts.get(url) || 0) + 1);

            if (new URL(url).pathname.endsWith("/levels/level_001.json")) {
                return new Response('{"fresh":true}', {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response("network navigation", { status: 200 });
        },
        caches: {
            async open(name) {
                if (!caches_by_name.has(name)) {
                    caches_by_name.set(name, new CacheMock(scope));
                }
                return caches_by_name.get(name);
            },
            async keys() {
                return Array.from(caches_by_name.keys());
            },
            async delete(name) {
                return caches_by_name.delete(name);
            }
        },
        self: {
            CHOOBS_BUILD_VERSION: "cleanup-test",
            CHOOBS_SETUP_RETRY_DELAYS_MS: [],
            CHOOBS_FINAL_RETRY_DELAYS_MS: [],
            CHOOBS_EXTRA_APP_SHELL: [],
            CHOOBS_CAMPAIGN_FILES: ["./levels/level_001.json"],
            CHOOBS_LEVEL_REVISIONS: {
                "./levels/level_001.json": "expected-revision"
            },
            CHOOBS_LEVEL_MANIFEST_REVISION: "manifest-test",
            registration: {
                scope,
                navigationPreload: null
            },
            clients: { async claim() {} },
            location: { origin: new URL(scope).origin },
            navigator: { onLine: true },
            addEventListener() {},
            async skipWaiting() {}
        }
    });

    for (const relative_path of [
        "service-worker-optimized-core.js",
        "service-worker-corrections.js"
    ]) {
        const source_path = path.join(root, relative_path);
        new vm.Script(fs.readFileSync(source_path, "utf8"), {
            filename: source_path
        }).runInContext(context);
    }

    const navigation = await vm.runInContext(
        `handle_navigation(new Request("${scope}uncached-route"))`,
        context
    );
    assert.equal(
        await navigation.text(),
        "network navigation",
        "an absent navigation fallback must reach the network"
    );

    const level_cache_name = vm.runInContext("LEVEL_CACHE", context);
    const metadata_url = vm.runInContext("LEVEL_METADATA_URL", context);
    const level_cache = await context.caches.open(level_cache_name);

    await level_cache.put(level_url, new Response('{"stale":true}'));
    await level_cache.put(metadata_url, new Response(JSON.stringify({
        manifest_revision: "old-manifest",
        asset_count: 1,
        pending_assets: [],
        asset_revisions: {
            "./levels/level_001.json": "old-revision"
        }
    }), {
        headers: { "Content-Type": "application/json" }
    }));

    const first_level_response = await vm.runInContext(
        `handle_level_asset(new Request("${level_url}"))`,
        context
    );
    assert.equal(await first_level_response.text(), '{"fresh":true}');

    const level_fetch_count = () => Array.from(fetch_counts.entries())
        .filter(([url]) => {
            return new URL(url).pathname.endsWith("/levels/level_001.json");
        })
        .reduce((total, [, count]) => total + count, 0);

    assert.equal(level_fetch_count(), 1);

    const second_level_response = await vm.runInContext(
        `handle_level_asset(new Request("${level_url}"))`,
        context
    );
    assert.equal(await second_level_response.text(), '{"fresh":true}');
    assert.equal(
        level_fetch_count(),
        1,
        "a verified cached level must not be refreshed again"
    );

    const metadata = await (await level_cache.match(metadata_url)).json();
    assert.equal(
        metadata.asset_revisions["./levels/level_001.json"],
        "expected-revision"
    );
    assert.deepEqual(metadata.pending_assets, []);

    const wrapper = fs.readFileSync(
        path.join(root, "service-worker.js"),
        "utf8"
    );
    assert.match(
        wrapper,
        /"\.\/service-worker-corrections\.js"/
    );
    assert.ok(
        wrapper.indexOf('"./service-worker-corrections.js"') >
        wrapper.indexOf('"./service-worker-optimized-core.js"'),
        "corrections must load after the core"
    );

    const pwa_source = fs.readFileSync(
        path.join(root, "js/pwa_core.js"),
        "utf8"
    );
    assert.match(pwa_source, /synchronization_promises = new WeakMap/);
    assert.doesNotMatch(pwa_source, /synchronized_workers/);
    assert.match(
        pwa_source,
        /synchronization_promises\.delete\(worker\)/
    );

    const workflow = fs.readFileSync(
        path.join(root, ".github/workflows/update-level-manifests.yml"),
        "utf8"
    );
    assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/);
    assert.doesNotMatch(
        workflow.split("workflow_dispatch:")[0],
        /js\/(campaign_manifest|level_revision_manifest)\.js/
    );

    console.log("Audited cleanup tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
