(() => {
    "use strict";

    const script = document.currentScript;
    const base_url = new URL("./", script && script.src ? script.src : document.baseURI);

    function load_script(file_name) {
        return new Promise((resolve, reject) => {
            const element = document.createElement("script");
            element.src = new URL(file_name, base_url).href;
            element.async = false;
            element.addEventListener("load", resolve, { once: true });
            element.addEventListener("error", () => {
                reject(new Error(`Could not load ${file_name}.`));
            }, { once: true });
            document.body.appendChild(element);
        });
    }

    (async () => {
        try {
            await load_script("hud_layout.js");
            await load_script("campaign_manifest.js");
            await load_script("campaign_migrations.js");
            await load_script("tutorial_bootstrap.js");
            await load_script("tutorial.js");
            await load_script("campaigns.js");
            await load_script("campaign_race_guard.js");
        } catch (error) {
            console.error("Campaign support could not be loaded.", error);
        }

        try {
            await load_script("logical_flight_pass.js");
        } catch (error) {
            console.error("Logical flight optimizations could not be loaded.", error);
        }

        try {
            await load_script("performance_pass.js");
        } catch (error) {
            console.error("Performance optimizations could not be loaded.", error);
        }

        try {
            await load_script("pwa_core.js");
        } catch (error) {
            console.error("PWA support could not be loaded.", error);
        }
    })();
})();
