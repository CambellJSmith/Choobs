"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class FakeClassList {
    constructor(values = []) {
        this.values = new Set(values);
    }

    add(value) {
        this.values.add(value);
    }

    remove(value) {
        this.values.delete(value);
    }

    contains(value) {
        return this.values.has(value);
    }
}

class FakeElement {
    constructor(id) {
        this.id = id;
        this.removed = false;
        this.textContent = "";
        this.classList = new FakeClassList(["hidden"]);
    }

    remove() {
        this.removed = true;
    }
}

class FakeWorker extends EventTarget {
    constructor(name, service_worker, registration) {
        super();
        this.name = name;
        this.state = "activated";
        this.messages = [];
        this.service_worker = service_worker;
        this.registration = registration;
    }

    postMessage(message, ports = []) {
        this.messages.push(message.type);

        if (message.type === "SKIP_WAITING") {
            this.registration.waiting = null;
            this.registration.active = this;
            this.service_worker.controller = this;
            queueMicrotask(() => {
                this.service_worker.dispatchEvent(
                    new Event("controllerchange")
                );
            });
            return;
        }

        if (message.type === "CACHE_ALL_OFFLINE_FILES") {
            ports[0].postMessage({
                ok: true,
                asset_count: 100,
                downloaded_count: this.name === "new" ? 4 : 0,
                reused_count: this.name === "new" ? 96 : 100
            });
        }
    }
}

async function main() {
    const root = path.resolve(__dirname, "..");
    const elements = new Map([
        ["install_app_button", new FakeElement("install_app_button")],
        ["install_overlay", new FakeElement("install_overlay")],
        ["pwa_update_toast", new FakeElement("pwa_update_toast")],
        ["pwa_connection_toast", new FakeElement("pwa_connection_toast")],
        ["pwa_connection_message", new FakeElement("pwa_connection_message")]
    ]);
    const window_events = new EventTarget();
    const document_events = new EventTarget();
    const service_worker = new EventTarget();
    const registration = new EventTarget();
    let reload_count = 0;

    registration.installing = null;
    registration.waiting = null;
    registration.active = null;
    registration.update = async () => registration;

    const old_worker = new FakeWorker("old", service_worker, registration);
    registration.active = old_worker;
    service_worker.controller = old_worker;
    service_worker.ready = Promise.resolve(registration);
    service_worker.register = async () => registration;

    globalThis.document = {
        visibilityState: "visible",
        getElementById(id) {
            return elements.get(id) || null;
        },
        addEventListener(type, listener, options) {
            document_events.addEventListener(type, listener, options);
        }
    };
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
            onLine: true,
            serviceWorker: service_worker,
            storage: {
                async persist() {
                    return true;
                }
            }
        }
    });
    globalThis.location = { protocol: "https:" };
    globalThis.sessionStorage = {
        values: new Map(),
        getItem(key) {
            return this.values.get(key) ?? null;
        },
        setItem(key, value) {
            this.values.set(key, String(value));
        },
        removeItem(key) {
            this.values.delete(key);
        }
    };
    globalThis.window = {
        location: {
            reload() {
                reload_count += 1;
            }
        },
        addEventListener(type, listener, options) {
            window_events.addEventListener(type, listener, options);
        },
        setTimeout,
        clearTimeout,
        setInterval() {
            return 1;
        }
    };
    globalThis.choobsGame = {
        session: {},
        is_paused: true
    };

    const module_path = path.join(root, "js", "pwa_core.js");
    delete require.cache[module_path];
    require(module_path);

    assert.equal(elements.get("install_app_button").removed, true);
    assert.equal(elements.get("install_overlay").removed, true);
    assert.equal(elements.get("pwa_update_toast").removed, true);

    window_events.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(old_worker.messages, ["CACHE_ALL_OFFLINE_FILES"]);
    assert.equal(reload_count, 0);

    const new_worker = new FakeWorker("new", service_worker, registration);
    new_worker.state = "installed";
    registration.waiting = new_worker;
    registration.installing = new_worker;
    registration.dispatchEvent(new Event("updatefound"));
    new_worker.dispatchEvent(new Event("statechange"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(new_worker.messages.includes("SKIP_WAITING"));
    assert.ok(new_worker.messages.includes("CACHE_ALL_OFFLINE_FILES"));
    assert.equal(reload_count, 1);
    assert.equal(
        sessionStorage.getItem("choobs_offline_update_complete_notice"),
        "1",
        "completion notice must survive the automatic reload"
    );

    const wrapper = fs.readFileSync(
        path.join(root, "service-worker.js"),
        "utf8"
    );
    assert.match(wrapper, /self\.skipWaiting\(\)/);

    console.log("Automatic offline tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
