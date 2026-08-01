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

async function main() {
    const root = path.resolve(__dirname, "..");
    const window_events = new EventTarget();
    const document_events = new EventTarget();
    const service_worker = new EventTarget();
    const toast = new FakeElement();
    const message = new FakeElement();
    const values = new Map([
        ["choobs_offline_update_complete_notice", "1"]
    ]);

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
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
    globalThis.window = {
        location: { reload() {} },
        addEventListener(type, listener, options) {
            window_events.addEventListener(type, listener, options);
        },
        setTimeout,
        clearTimeout,
        setInterval() {
            return 1;
        }
    };

    const module_path = path.join(root, "js", "pwa_core.js");
    delete require.cache[module_path];
    require(module_path);

    assert.equal(
        message.textContent,
        "Choobs update complete — all offline files are ready"
    );
    assert.equal(toast.classList.values.has("hidden"), false);
    assert.equal(
        sessionStorage.getItem("choobs_offline_update_complete_notice"),
        null,
        "completion notice must be consumed exactly once"
    );

    console.log("Offline completion popup tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
