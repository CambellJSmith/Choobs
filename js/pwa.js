(() => {
    "use strict";

    const elements = {
        install_button: document.getElementById("install_app_button"),
        install_overlay: document.getElementById("install_overlay"),
        close_install_button: document.getElementById("close_install_button"),
        dismiss_install_button: document.getElementById("dismiss_install_button"),
        update_toast: document.getElementById("pwa_update_toast"),
        apply_update_button: document.getElementById("apply_update_button"),
        connection_toast: document.getElementById("pwa_connection_toast"),
        connection_message: document.getElementById("pwa_connection_message")
    };

    let deferred_install_prompt = null;
    let waiting_worker = null;
    let reload_started = false;
    let update_activation_requested = false;
    let connection_timer = 0;
    let setup_busy = false;
    let registration_promise = null;
    const watched_registrations = new WeakSet();

    function is_standalone() {
        return window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;
    }

    function is_ios() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function update_install_button() {
        if (!elements.install_button) {
            return;
        }

        const title = elements.install_button.querySelector("strong");
        const description = elements.install_button.querySelector("small");

        elements.install_button.classList.remove("hidden");
        elements.install_button.disabled = setup_busy;
        elements.install_button.setAttribute("aria-busy", String(setup_busy));

        if (setup_busy) {
            if (title) {
                title.textContent = "Preparing Choobs…";
            }

            if (description) {
                description.textContent = "Saving the app and every level for offline play";
            }

            return;
        }

        if (is_standalone()) {
            if (title) {
                title.textContent = "Refresh offline files";
            }

            if (description) {
                description.textContent = "Download the latest app files and levels";
            }

            return;
        }

        if (title) {
            title.textContent = "Install and prepare offline";
        }

        if (description) {
            description.textContent = is_ios()
                ? "Download everything, then add Choobs to your Home Screen"
                : "Download everything and open the app installation prompt";
        }
    }

    function open_install_overlay() {
        if (!elements.install_overlay) {
            return;
        }

        elements.install_overlay.classList.remove("hidden");
        elements.install_overlay.setAttribute("aria-hidden", "false");
        elements.dismiss_install_button?.focus();
    }

    function close_install_overlay() {
        if (!elements.install_overlay) {
            return;
        }

        elements.install_overlay.classList.add("hidden");
        elements.install_overlay.setAttribute("aria-hidden", "true");
        elements.install_button?.focus();
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

    function show_update(worker) {
        if (!worker || !elements.update_toast || setup_busy) {
            return;
        }

        waiting_worker = worker;
        elements.update_toast.classList.remove("hidden");
    }

    function watch_installing_worker(registration) {
        const worker = registration.installing;

        if (!worker) {
            return;
        }

        worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
                show_update(registration.waiting || worker);
            }
        });
    }

    function watch_registration(registration) {
        if (watched_registrations.has(registration)) {
            return;
        }

        watched_registrations.add(registration);

        if (registration.waiting && navigator.serviceWorker.controller) {
            show_update(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
            watch_installing_worker(registration);
        });
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

    function wait_for_worker_installation(worker) {
        if (!worker || ["installed", "activated"].includes(worker.state)) {
            return Promise.resolve();
        }

        if (worker.state === "redundant") {
            return Promise.reject(new Error("The Choobs update was replaced before it finished."));
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

    function wait_for_controller_change(timeout_ms = 5000) {
        return new Promise((resolve) => {
            let settled = false;

            const finish = () => {
                if (settled) {
                    return;
                }

                settled = true;
                window.clearTimeout(timeout);
                navigator.serviceWorker.removeEventListener("controllerchange", finish);
                resolve();
            };

            const timeout = window.setTimeout(finish, timeout_ms);
            navigator.serviceWorker.addEventListener("controllerchange", finish);
        });
    }

    async function activate_waiting_worker(registration) {
        const worker = registration.waiting;

        if (!worker) {
            return;
        }

        waiting_worker = null;
        elements.update_toast?.classList.add("hidden");

        const controller_change = wait_for_controller_change();
        worker.postMessage({ type: "SKIP_WAITING" });
        await controller_change;
    }

    function send_worker_message(worker, message) {
        return new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => {
                channel.port1.close();
                reject(new Error("Choobs could not verify the offline download."));
            }, 45000);

            channel.port1.onmessage = (event) => {
                window.clearTimeout(timeout);
                channel.port1.close();

                if (event.data && event.data.ok) {
                    resolve(event.data);
                    return;
                }

                reject(new Error(
                    event.data?.message || "Choobs could not prepare its offline files."
                ));
            };

            worker.postMessage(message, [channel.port2]);
        });
    }

    async function request_persistent_storage() {
        if (!navigator.storage || typeof navigator.storage.persist !== "function") {
            return null;
        }

        try {
            return await navigator.storage.persist();
        } catch (error) {
            console.warn("Persistent storage could not be requested.", error);
            return null;
        }
    }

    async function prepare_offline_files() {
        const registration = await ensure_service_worker();

        await registration.update();

        if (registration.installing) {
            await wait_for_worker_installation(registration.installing);
        }

        if (registration.waiting) {
            await activate_waiting_worker(registration);
        }

        const ready_registration = await navigator.serviceWorker.ready;
        const worker = navigator.serviceWorker.controller ||
            ready_registration.active ||
            registration.active;

        if (!worker) {
            throw new Error("Choobs could not start its offline worker.");
        }

        const cache_result = await send_worker_message(worker, {
            type: "CACHE_ALL_OFFLINE_FILES"
        });
        const storage_persisted = await request_persistent_storage();

        return {
            asset_count: Number(cache_result.asset_count) || 0,
            storage_persisted
        };
    }

    async function request_install_after_preparation() {
        if (is_standalone()) {
            return "standalone";
        }

        if (deferred_install_prompt) {
            const prompt = deferred_install_prompt;
            deferred_install_prompt = null;
            update_install_button();

            await prompt.prompt();
            const choice = await prompt.userChoice;
            return choice.outcome === "accepted" ? "installed" : "dismissed";
        }

        if (is_ios()) {
            open_install_overlay();
            return "ios-instructions";
        }

        return "manual-install";
    }

    async function handle_install_and_offline_setup() {
        if (setup_busy) {
            return;
        }

        if (!navigator.onLine) {
            show_connection_message("Connect to the internet once to prepare Choobs offline");
            return;
        }

        setup_busy = true;
        update_install_button();

        try {
            const result = await prepare_offline_files();
            const install_result = await request_install_after_preparation();
            const file_copy = result.asset_count > 0
                ? `${result.asset_count} files saved`
                : "offline files saved";

            if (install_result === "installed") {
                show_connection_message(`Choobs installed — ${file_copy}`);
            } else if (install_result === "dismissed") {
                show_connection_message(`Installation cancelled — ${file_copy}`);
            } else if (install_result === "ios-instructions") {
                show_connection_message(`Choobs is offline ready — ${file_copy}`);
            } else if (install_result === "manual-install") {
                show_connection_message("Offline ready — use your browser menu to install Choobs");
            } else if (result.storage_persisted === false) {
                show_connection_message(`Offline ready — ${file_copy}; storage is not protected`);
            } else {
                show_connection_message(`Choobs is offline ready — ${file_copy}`);
            }
        } catch (error) {
            console.warn("Choobs setup could not be completed.", error);
            show_connection_message(error.message || "Choobs setup could not be completed");
        } finally {
            setup_busy = false;
            update_install_button();
        }
    }

    function check_for_update() {
        ensure_service_worker()
            .then((registration) => registration.update())
            .catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferred_install_prompt = event;
        update_install_button();
    });

    window.addEventListener("appinstalled", () => {
        deferred_install_prompt = null;
        update_install_button();
        show_connection_message("Choobs installed and ready offline");
    });

    window.addEventListener("offline", () => {
        show_connection_message("Offline mode — progress still saves");
    });

    window.addEventListener("online", () => {
        show_connection_message("Back online");
    });

    elements.install_button?.addEventListener(
        "click",
        handle_install_and_offline_setup
    );
    elements.close_install_button?.addEventListener("click", close_install_overlay);
    elements.dismiss_install_button?.addEventListener("click", close_install_overlay);
    elements.install_overlay?.addEventListener("pointerdown", (event) => {
        if (event.target === elements.install_overlay) {
            close_install_overlay();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" &&
            elements.install_overlay &&
            !elements.install_overlay.classList.contains("hidden")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            close_install_overlay();
        }
    }, true);

    elements.apply_update_button?.addEventListener("click", () => {
        if (!waiting_worker) {
            return;
        }

        elements.apply_update_button.disabled = true;
        update_activation_requested = true;
        waiting_worker.postMessage({ type: "SKIP_WAITING" });
    });

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!update_activation_requested || reload_started) {
                return;
            }

            reload_started = true;
            window.location.reload();
        });
    }

    update_install_button();

    if (!navigator.onLine) {
        window.setTimeout(() => {
            show_connection_message("Offline mode — progress still saves");
        }, 500);
    }

    window.addEventListener("load", () => {
        ensure_service_worker().catch((error) => {
            console.warn("Offline support could not be enabled.", error);
        });
    }, { once: true });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            check_for_update();
        }
    });

    window.setInterval(check_for_update, 60 * 60 * 1000);
})();
