(() => {
    "use strict";

    const GRID_SIZE = 50;
    const NEAR_BLACK_CHANNEL_THRESHOLD = 48;

    function wait_for_app() {
        return new Promise((resolve) => {
            const started = performance.now();
            const check = () => {
                if (globalThis.ChoobsCreatorApp) {
                    resolve(globalThis.ChoobsCreatorApp);
                    return;
                }
                if (performance.now() - started > 5000) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 20);
            };
            check();
        });
    }

    async function decode_image(file) {
        if ("createImageBitmap" in window) {
            return createImageBitmap(file);
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            const url = URL.createObjectURL(file);
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Could not decode ${file.name}.`));
            };
            image.src = url;
        });
    }

    async function remove_near_black_pixels(file) {
        const image = await decode_image(file);
        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        if (typeof image.close === "function") image.close();

        const image_data = context.getImageData(0, 0, width, height);
        const pixels = image_data.data;
        for (let index = 0; index < pixels.length; index += 4) {
            const is_near_black =
                pixels[index] <= NEAR_BLACK_CHANNEL_THRESHOLD &&
                pixels[index + 1] <= NEAR_BLACK_CHANNEL_THRESHOLD &&
                pixels[index + 2] <= NEAR_BLACK_CHANNEL_THRESHOLD;
            if (is_near_black) pixels[index + 3] = 0;
        }
        context.putImageData(image_data, 0, 0);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
                if (result) resolve(result);
                else reject(new Error(`Could not process ${file.name}.`));
            }, "image/png");
        });

        return new File([blob], file.name, {
            type: "image/png",
            lastModified: file.lastModified || Date.now()
        });
    }

    (async () => {
        const app = await wait_for_app();
        if (!app || app.__choobs_black_to_transparency_installed) return;
        app.__choobs_black_to_transparency_installed = true;

        const original_load_source_image = app.load_source_image.bind(app);
        app.load_source_image = async function (file) {
            const processed_file = await remove_near_black_pixels(file);
            return original_load_source_image(processed_file);
        };

        app.remove_near_black_pixels = remove_near_black_pixels;
        app.black_transparency_grid_size = GRID_SIZE;
    })();
})();
