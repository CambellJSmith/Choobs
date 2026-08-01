"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto").webcrypto;
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class CacheMock {
    constructor(scope) {
        this.scope = scope;
        this.entries = new Map();
    }

    key(request) {
        const url = new URL(new Request(request).url);
        url.search = "";
        return url.href;
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
                new Response("cached")
            );
        }
    }
}

async function sha256(value) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
    );
    return Buffer.from(digest).toString("hex");
}

async function main() {
    const root = path.resolve(__dirname, "..");
    const scope = "https://example.test/Choobs/";
    const cache_objects = new Map();
    const fetches = [];
    const bodies = {
        "./levels/level_001.json": '{"number":1}\n',
        "./levels/level_002.json": '{"number":2,"changed":true}\n',
        "./levels/level_003.json": '{"number":3}\n'
    };
    const revisions = {};
    for (const [asset, body] of Object.entries(bodies)) {
        revisions[asset] = await sha256(body);
    }

    const context = vm.createContext({
        AbortController,
        Request,
        Response,
        TextEncoder,
        Uint8Array,
        URL,
        console,
        crypto,
        setTimeout,
        clearTimeout,
        fetch: async (request) => {
            const url = new URL(new Request(request).url);
            const asset = `.${url.pathname.slice("/Choobs".length)}`;
            fetches.push(asset);
            return new Response(bodies[asset], { status: 200 });
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
            crypto,
            CHOOBS_BUILD_VERSION: "new-build",
            CHOOBS_SETUP_RETRY_DELAYS_MS: [],
            CHOOBS_FINAL_RETRY_DELAYS_MS: [],
            CHOOBS_EXTRA_APP_SHELL: [],
            CHOOBS_CAMPAIGN_FILES: Object.keys(bodies),
            CHOOBS_LEVEL_REVISIONS: revisions,
            CHOOBS_LEVEL_REVISION_ALGORITHM: "sha256",
            CHOOBS_LEVEL_MANIFEST_REVISION: "sha256:new-manifest",
            registration: { scope, navigationPreload: null },
            clients: { async claim() {} },
            location: { origin: new URL(scope).origin },
            navigator: { onLine: true },
            addEventListener() {},
            async skipWaiting() {}
        }
    });

    const source = fs.readFileSync(
        path.join(root, "service-worker-optimized-core.js"),
        "utf8"
    );
    new vm.Script(source).runInContext(context);

    const level_cache = await context.caches.open(
        vm.runInContext("LEVEL_CACHE", context)
    );
    for (const [asset, body] of Object.entries(bodies)) {
        await level_cache.put(
            new Request(new URL(asset, scope)),
            new Response(body)
        );
    }
    const metadata_url = vm.runInContext("LEVEL_METADATA_URL", context);
    await level_cache.put(
        metadata_url,
        new Response(JSON.stringify({
            build_version: "old-build",
            manifest_revision: "sha256:old-manifest",
            asset_count: 3,
            complete: true,
            pending_assets: [],
            asset_revisions: {
                "./levels/level_001.json": revisions["./levels/level_001.json"],
                "./levels/level_002.json": "old-revision",
                "./levels/level_003.json": revisions["./levels/level_003.json"]
            }
        }))
    );

    const static_cache = await context.caches.open(
        vm.runInContext("STATIC_CACHE", context)
    );
    await static_cache.addAll(
        Array.from(vm.runInContext("APP_SHELL", context))
    );

    const result = await vm.runInContext(
        "refresh_all_offline_files()",
        context
    );
    assert.equal(result.downloaded_count, 1);
    assert.deepEqual(fetches, ["./levels/level_002.json"]);

    const metadata = await (await level_cache.match(metadata_url)).json();
    assert.equal(metadata.manifest_revision, "sha256:new-manifest");
    assert.deepEqual(metadata.asset_revisions, revisions);

    fetches.length = 0;
    const second = await vm.runInContext(
        "refresh_all_offline_files()",
        context
    );
    assert.equal(second.downloaded_count, 0);
    assert.deepEqual(fetches, []);

    console.log("Level revision sync tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
