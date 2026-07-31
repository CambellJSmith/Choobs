"use strict";

const assert = require("node:assert/strict");
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
}

class FakeElement {
    constructor() {
        this.textContent = "";
        this.classList = new FakeClassList(["hidden"]);
    }

    remove() {}
}

class FakePort {
    constructor() {
        this.peer = null;
        this.onmessage = null;
    }

    postMessage(value) {
        queueMicrotask(() => {
            this.peer?.onmessage?.({ data: value });
        });
    }

    close() {}
}

class FakeMessageChannel {
    constructor() {
        this.port1 = new FakePort();
        this.port2 = new FakePort();
        this.port1.peer = this.port2;
        this.port2.peer = this.port1;
    }
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
    const root = path.resolve(__dirname, "..");
    const window_events = new EventTarget();
    const document_events = new EventTarget();
    const service_worker = new EventTarget();
    const registration = new EventTarget();
    const toast = new FakeElement();
    const message = new FakeElement();
    const timers = new Map();
    const scheduled_delays = [];
    let next_timer_id = 1;
    let response_index = 0;

    function fake_set_timeout(callback, delay) {
        const id = next_timer_id++;
        timers.set(id, { callback, delay });
        scheduled_delays.push(delay);
        return id;
    }

    function fake_clear_timeout(id) {
        timers.delete(id);
    }

    async function run_retry(delay) {
        const entry = Array.from(timers.entries())
            .find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `expected a ${delay}ms retry timer`);
        timers.delete(entry[0]);
        entry[1].callback();
        await flush();
    }

    const worker = {
        messages: [],
        postMessage(payload, ports) {
            this.messages.push(payload.type);

            if (payload.type !== "CACHE_ALL_OFFLINE_FILES") {
                return;
            }

            const failures = [
                "Could not save ./levels/level_017.json for offline use.",
                "Could not save ./levels/level_017.json for offline use.",
                "Could not save ./levels/level_017.json for offline use."
            ];
            const raw_message = failures[response_index];
            response_index += 1;

            if (raw_message) {
                ports[0].postMessage({
                    ok: false,
                    retryable: true,
                    failed_count: 1,
                    message: raw_message
                });
            } else {
                ports[0].postMessage({
                    ok: true,
                    asset_count: 100,
                    downloaded_count: 1,
                    reused_count: 99
                });
            }
        }
    };

    registration.installing = null;
    registration.waiting = null;
    registration.active = worker;
    registration.update = async () => registration;
    service_worker.controller = worker;
    service_worker.ready = Promise.resolve(registration);
    service_worker.register = async () => registration;

    globalThis.document = {
        visibilityState: "visible",
        getElementById(id) {
            if (id === "pwa_connection_toast") return toast;
            if (id === "pwa_connection_message") return message;
            return null;
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
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    globalThis.MessageChannel = FakeMessageChannel;
    globalThis.window = {
        location: { reload() {} },
        addEventListener(type, listener, options) {
            window_events.addEventListener(type, listener, options);
        },
        setTimeout: fake_set_timeout,
        clearTimeout: fake_clear_timeout,
        setInterval() { return 1; }
    };
    globalThis.choobsGame = {
        session: {},
        is_paused: true
    };

    const original_warn = console.warn;
    console.warn = () => {};

    try {
        const module_path = path.join(root, "js", "pwa_core.js");
        delete require.cache[module_path];
        require(module_path);

        window_events.dispatchEvent(new Event("load"));
        await flush();

        assert.equal(worker.messages.length, 1);
        assert.equal(message.textContent, "");
        assert.ok(scheduled_delays.includes(15000));

        await run_retry(15000);
        assert.equal(worker.messages.length, 2);
        assert.equal(message.textContent, "");
        assert.ok(scheduled_delays.includes(60000));

        await run_retry(60000);
        assert.equal(worker.messages.length, 3);
        assert.equal(
            message.textContent,
            "Choobs is still finishing its offline update automatically"
        );
        assert.equal(message.textContent.includes("level_017"), false);
        assert.ok(scheduled_delays.includes(300000));

        await run_retry(300000);
        assert.equal(worker.messages.length, 4);
        assert.equal(response_index, 4);
    } finally {
        console.warn = original_warn;
    }

    console.log("Offline retry client tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
