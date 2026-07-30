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

    function is_standalone() {
        return window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;
    }

    function is_ios() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function can_offer_install() {
        return !is_standalone() && (Boolean(deferred_install_prompt) || is_ios());
    }

    function update_install_button() {
        if (!elements.install_button) {
            return;
        }

        elements.install_button.classList.toggle("hidden", !can_offer_install());
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

    async function request_install() {
        if (deferred_install_prompt) {
            const prompt = deferred_install_prompt;
            deferred_install_prompt = null;
            update_install_button();

            try {
                await prompt.prompt();
                await prompt.userChoice;
            } catch (error) {
                console.warn("The install prompt could not be shown.", error);
            }

            return;
        }

        if (is_ios() && !is_standalone()) {
            open_install_overlay();
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
        }, 2800);
    }

    function show_update(worker) {
        if (!worker || !elements.update_toast) {
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

    async function register_service_worker() {
        if (!("serviceWorker" in navigator) || location.protocol === "file:") {
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register(
                "service-worker.js",
                {
                    scope: "./",
                    updateViaCache: "none"
                }
            );

            if (registration.waiting && navigator.serviceWorker.controller) {
                show_update(registration.waiting);
            }

            registration.addEventListener("updatefound", () => {
                watch_installing_worker(registration);
            });

            const check_for_update = () => {
                registration.update().catch(() => {});
            };

            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") {
                    check_for_update();
                }
            });

            window.setInterval(check_for_update, 60 * 60 * 1000);
        } catch (error) {
            console.warn("Offline support could not be enabled.", error);
        }
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferred_install_prompt = event;
        update_install_button();
    });

    window.addEventListener("appinstalled", () => {
        deferred_install_prompt = null;
        update_install_button();
        show_connection_message("Choobs installed");
    });

    window.addEventListener("offline", () => {
        show_connection_message("Offline mode — progress still saves");
    });

    window.addEventListener("online", () => {
        show_connection_message("Back online");
    });

    elements.install_button?.addEventListener("click", request_install);
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

    window.addEventListener("load", register_service_worker, { once: true });
})();
