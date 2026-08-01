"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { MessageChannel } = require("node:worker_threads");

class StorageMock {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

class FakeElement {
    constructor() {
        this.textContent = "";
        this.classList = {
            add() {},
            remove() {}
        };
    }

    remove() {}
}

class FakeWorker extends EventTarget {
    constructor() {
        super();
        this.state = "activated";
        this.messages = [];
    }

    postMessage(message, ports = []) {
        this.messages.push(message.type);

        if (message.type === "CACHE_ALL_OFFLINE_FILES") {
            ports[0].postMessage({
                ok: true,
                asset_count: 10,
                downloaded_count: 0,
                reused_count: 10
            });
        }
    }
}

async function main() {
    const window_events = new EventTarget();
    const document_events = new EventTarget();
    const service_worker = new EventTarget();
    const registration = new EventTarget();
    const worker = new FakeWorker();
    const elements = new Map([
        ["pwa_connection_toast", new FakeElement()],
        ["pwa_connection_message", new FakeElement()]
    ]);

    registration.installing = null;
    registration.waiting = null;
    registration.active = worker;
    registration.update = async () => registration;

    service_worker.controller = worker;
    service_worker.ready = Promise.resolve(registration);
    service_worker.register = async () => registration;

    globalThis.MessageChannel = MessageChannel;
    globalThis.sessionStorage = new StorageMock();
    globalThis.location = { protocol: "https:" };
    globalThis.document = {
        visibilityState: "visible",
        getElementById(id) {
            return elements.get(id) || null;
        },
        addEventListener(type, listener, options) {
            document_events.addEventListener(type, listener, options);
        }
    };
    globalThis.window = {
        location: { reload() {} },
        setTimeout,
        clearTimeout,
        setInterval() {
            return 1;
        },
        addEventListener(type, listener, options) {
            window_events.addEventListener(type, listener, options);
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
    globalThis.choobsGame = {
        session: {},
        is_paused: false
    };

    const module_path = path.resolve(__dirname, "../js/pwa_core.js");
    delete require.cache[module_path];
    require(module_path);

    window_events.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(worker.messages, ["CACHE_ALL_OFFLINE_FILES"]);

    window_events.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(worker.messages, [
        "CACHE_ALL_OFFLINE_FILES",
        "CACHE_ALL_OFFLINE_FILES"
    ]);

    console.log("PWA reconnect synchronization tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
