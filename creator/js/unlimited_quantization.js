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
            await load_script("unlimited_quantization_core.js");
            await load_script("bulk_creator.js");
        } catch (error) {
            console.error("Extended creator tools could not be loaded.", error);
        }
    })();
})();
