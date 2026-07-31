(() => {
    "use strict";

    const PENDING_RELOAD_KEY = "choobs_pending_automatic_reload";
    const elements = {
        connection_toast: document.getElementById("pwa_connection_toast"),
        connection_message: document.getElementById("pwa_connection_message")
    };

    let connection_timer = 0;
    let registration_promise = null;
    let automatic_setup_promise = null;
    let pending_sync = false;
    let reload_pending = read_reload_pending();
    let reload_started = false;
    let controller_seen = Boolean(
        "serviceWorker" in navigator && navigator.serviceWorker.controller
    );
    const watched_registrations = new WeakSet();
    const activation_promises = new WeakMap();
    const synchronized_workers = new WeakSet();

    remove_manual_controls();

    function remove_manual_controls() {
        for (const id of [
            "install_app_button",
            "install_overlay",
            "pwa_update_toast"
        ]) {
            document.getElementById(id)?.remove();
        }
    }

    function read_reload_pending() {
        try {
            return sessionStorage.getItem(PENDING_RELOAD_KEY) === "1";
        } catch (_error) {
            return false;
        }
    }

    function write_reload_pending(value) {
        reload_pending = Boolean(value);

        try {
            if (reload_pending) {
                sessionStorage.setItem(PENDING_RELOAD_KEY, "1");
            } else {
                sessionStorage.removeItem(PENDING_RELOAD_KEY);
            }
        } catch (_error) {
            // Session storage is optional; the in-memory flag remains authoritative.
        }
    }

    function show_connection_message(message) {
        if (!elements.connection_toast || !elements.connection_message) {
            return;
        }

        clearTimeout(connection_timer);
        elements.connection_message.textContent = message;
        elements.connection_toast.classList.remove("hidden");
        connection_timer = window.setTimeout(() => {
            elements.connection_toast.classList.add("hidden");
        }, 4200);
    }

    function wait_for_worker_installation(worker) {
        if (!worker || ["installed", "activated"].includes(worker.state)) {
            return Promise.resolve();
        }

        if (worker.state === "redundant") {
            return Promise.reject(new Error(
                "The Choobs update was replaced before it finished."
            ));
        }

        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error("The Choobs update took too long to install."));
            }, 30000);

            const on_state_change = () => {
                if (["installed", "activated"].includes(worker.state)) {
                    cleanup();
                    resolve();
                } else if (worker.state === "redundant") {
                    cleanup();
                    reject(new Error("The Choobs update could not be installed."));
                }
            };

            const cleanup = () => {
                window.clearTimeout(timeout);
                worker.removeEventListener("statechange", on_state_change);
            };

            worker.addEventListener("statechange", on_state_change);
        });
    }

    function wait_for_controller_change(timeout_ms = 10000) {
        return new Promise((resolve) => {
            let settled = false;

            const finish = () => {
                if (settled) {
                    return;
                }

                settled = true;
                window.clearTimeout(timeout);
                navigator.serviceWorker.removeEventListener(
                    "controllerchange",
                    finish
                );
                resolve();
            };

            const timeout = window.setTimeout(finish, timeout_ms);
            navigator.serviceWorker.addEventListener("controllerchange", finish);
        });
    }

    function send_worker_message(worker, message) {
        return new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => {
                channel.port1.close();
                reject(new Error(
                    "Choobs could not verify its automatic offline update."
                ));
            }, 120000);

            channel.port1.onmessage = (event) => {
                window.clearTimeout(timeout);
                channel.port1.close();

                if (event.data && event.data.ok) {
                    resolve(event.data);
                    return;
                }

                reject(new Error(
                    event.data?.message ||
                    "Choobs could not prepare its offline files."
                ));
            };

            worker.postMessage(message, [channel.port2]);
        });
    }

    async function request_persistent_storage() {
        if (!navigator.storage ||
            typeof navigator.storage.persist !== "function") {
            return null;
        }

        try {
            return await navigator.storage.persist();
        } catch (error) {
            console.warn("Persistent storage could not be requested.", error);
            return null;
        }
    }

    async function activate_waiting_worker(registration) {
        const worker = registration && registration.waiting;

        if (!worker) {
            return false;
        }

        if (activation_promises.has(registration)) {
            return activation_promises.get(registration);
        }

        const activation = (async () => {
            const had_controller = Boolean(navigator.serviceWorker.controller);
            const controller_change = had_controller
                ? wait_for_controller_change()
                : Promise.resolve();

            if (had_controller) {
                write_reload_pending(true);
            }

            worker.postMessage({ type: "SKIP_WAITING" });
            await controller_change;
            return true;
        })().finally(() => {
            activation_promises.delete(registration);
        });

        activation_promises.set(registration, activation);
        return activation;
    }

    function watch_installing_worker(registration) {
        const worker = registration.installing;

        if (!worker) {
            return;
        }

        const on_state_change = () => {
            if (worker.state === "installed") {
                worker.removeEventListener("statechange", on_state_change);

                if (navigator.serviceWorker.controller) {
                    activate_waiting_worker(registration)
                        .then(() => start_automatic_setup({ announce: true }))
                        .catch((error) => {
                            console.warn(
                                "The Choobs update could not be activated.",
                                error
                            );
                        });
                } else {
                    start_automatic_setup({ announce: true });
                }
            } else if (worker.state === "redundant") {
                worker.removeEventListener("statechange", on_state_change);
            }
        };

        worker.addEventListener("statechange", on_state_change);
        on_state_change();
    }

    function watch_registration(registration) {
        if (watched_registrations.has(registration)) {
            return;
        }

        watched_registrations.add(registration);

        if (registration.waiting && navigator.serviceWorker.controller) {
            activate_waiting_worker(registration)
                .then(() => start_automatic_setup({ announce: true }))
                .catch((error) => {
                    console.warn(
                        "The waiting Choobs update could not be activated.",
                        error
                    );
                });
        }

        registration.addEventListener("updatefound", () => {
            watch_installing_worker(registration);
        });

        watch_installing_worker(registration);
    }

    async function ensure_service_worker() {
        if (!("serviceWorker" in navigator) || location.protocol === "file:") {
            throw new Error("This browser cannot enable Choobs offline support.");
        }

        if (!registration_promise) {
            registration_promise = navigator.serviceWorker.register(
                "service-worker.js",
                {
                    scope: "./",
                    updateViaCache: "none"
                }
            ).then((registration) => {
                watch_registration(registration);
                return registration;
            }).catch((error) => {
                registration_promise = null;
                throw error;
            });
        }

        return registration_promise;
    }

    async function current_worker(registration) {
        const ready_registration = await navigator.serviceWorker.ready;
        return navigator.serviceWorker.controller ||
            ready_registration.active ||
            registration.active ||
            null;
    }

    async function synchronize_worker(worker, announce) {
        if (!worker) {
            throw new Error("Choobs could not start its offline worker.");
        }

        if (synchronized_workers.has(worker)) {
            return null;
        }

        if (!navigator.onLine) {
            pending_sync = true;
            return null;
        }

        const result = await send_worker_message(worker, {
            type: "CACHE_ALL_OFFLINE_FILES"
        });

        synchronized_workers.add(worker);
        pending_sync = false;
        void request_persistent_storage();

        const downloaded_count = Number(result.downloaded_count) || 0;

        if (announce && downloaded_count > 0) {
            show_connection_message(
                `Choobs updated automatically — ${downloaded_count} file${
                    downloaded_count === 1 ? "" : "s"
                } downloaded`
            );
        }

        return result;
    }

    function app_can_reload_safely() {
        const app = globalThis.choobsGame;
        return !app || !app.session || app.is_paused;
    }

    function schedule_safe_reload() {
        if (!reload_pending || reload_started) {
            return;
        }

        if (document.visibilityState === "hidden") {
            return;
        }

        if (!app_can_reload_safely()) {
            window.setTimeout(schedule_safe_reload, 750);
            return;
        }

        reload_started = true;
        write_reload_pending(false);
        window.location.reload();
    }

    async function run_automatic_setup(announce) {
        const registration = await ensure_service_worker();

        try {
            await registration.update();
        } catch (error) {
            console.warn("Choobs could not check for an update.", error);
        }

        if (registration.installing) {
            await wait_for_worker_installation(registration.installing);
        }

        if (registration.waiting && navigator.serviceWorker.controller) {
            await activate_waiting_worker(registration);
        }

        const worker = await current_worker(registration);
        const result = await synchronize_worker(worker, announce);
        schedule_safe_reload();
        return result;
    }

    function start_automatic_setup({ announce = false } = {}) {
        if (automatic_setup_promise) {
            return automatic_setup_promise;
        }

        automatic_setup_promise = run_automatic_setup(announce)
            .catch((error) => {
                pending_sync = true;
                console.warn("Automatic offline setup could not be completed.", error);

                if (navigator.onLine) {
                    show_connection_message(
                        error.message ||
                        "Choobs could not update its offline files automatically"
                    );
                }

                return null;
            })
            .finally(() => {
                automatic_setup_promise = null;
            });

        return automatic_setup_promise;
    }

    function check_for_update() {
        ensure_service_worker()
            .then((registration) => registration.update())
            .catch(() => {});
    }

    window.addEventListener("offline", () => {
        show_connection_message("Offline mode — progress still saves");
    });

    window.addEventListener("online", () => {
        show_connection_message("Back online — updating offline files");
        start_automatic_setup({ announce: true });
    });

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            const was_controlled = controller_seen;
            controller_seen = true;

            if (was_controlled) {
                write_reload_pending(true);
            }

            start_automatic_setup({ announce: true });
        });
    }

    if (!navigator.onLine) {
        pending_sync = true;
        window.setTimeout(() => {
            show_connection_message("Offline mode — progress still saves");
        }, 500);
    }

    window.addEventListener("load", () => {
        start_automatic_setup();
    }, { once: true });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") {
            return;
        }

        if (reload_pending) {
            schedule_safe_reload();
            return;
        }

        if (pending_sync) {
            start_automatic_setup({ announce: true });
        } else {
            check_for_update();
        }
    });

    window.setInterval(check_for_update, 60 * 60 * 1000);
})();
