(() => {
    "use strict";

    const GRID_SIZE = 50;
    const EMPTY_COLOR_INDEX = 65535;
    const MAXIMUM_AUTO_COLORS = 5;
    const DEFAULT_COLOR = "#ff5c7a";

    function wait_for_app() {
        return new Promise((resolve) => {
            const started = performance.now();
            const check = () => {
                if (globalThis.ChoobsCreatorApp) {
                    resolve(globalThis.ChoobsCreatorApp);
                } else if (performance.now() - started > 5000) {
                    resolve(null);
                } else {
                    window.setTimeout(check, 20);
                }
            };
            check();
        });
    }

    function color_distance_squared(left, right) {
        const red = left.r - right.r;
        const green = left.g - right.g;
        const blue = left.b - right.b;
        return red * red + green * green + blue * blue;
    }

    function rgb_to_hex(color) {
        const channel = (value) => Math.max(0, Math.min(255, Math.round(value)))
            .toString(16)
            .padStart(2, "0");
        return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
    }

    function hex_to_rgb(value) {
        const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
        if (!match) return { r: 255, g: 255, b: 255 };
        const number = Number.parseInt(match[1], 16);
        return {
            r: (number >>> 16) & 255,
            g: (number >>> 8) & 255,
            b: number & 255
        };
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

    async function read_grid_pixels(file) {
        const image = await decode_image(file);
        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        if (!width || !height) {
            if (typeof image.close === "function") image.close();
            throw new Error(`${file.name} has no usable dimensions.`);
        }

        const canvas = document.createElement("canvas");
        canvas.width = GRID_SIZE;
        canvas.height = GRID_SIZE;
        const context = canvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true
        });
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
        context.drawImage(image, 0, 0, width, height, 0, 0, GRID_SIZE, GRID_SIZE);

        if (typeof image.close === "function") image.close();

        return new Uint8ClampedArray(
            context.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data
        );
    }

    function analyze_visible_pixels(pixels) {
        const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
        const visible = [];
        const histogram = new Map();

        for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
            const pixel_index = index * 4;
            if (pixels[pixel_index + 3] === 0) continue;

            const color = {
                r: pixels[pixel_index],
                g: pixels[pixel_index + 1],
                b: pixels[pixel_index + 2]
            };
            mask[index] = 1;
            visible.push({ index, ...color });
            const key = `${color.r >> 3},${color.g >> 3},${color.b >> 3}`;
            const entry = histogram.get(key) || {
                count: 0,
                r: 0,
                g: 0,
                b: 0
            };
            entry.count += 1;
            entry.r += color.r;
            entry.g += color.g;
            entry.b += color.b;
            histogram.set(key, entry);
        }

        if (visible.length === 0) {
            throw new Error("The processed image contains no non-transparent pixels.");
        }

        const buckets = Array.from(histogram.values()).map((entry) => ({
            count: entry.count,
            r: entry.r / entry.count,
            g: entry.g / entry.count,
            b: entry.b / entry.count
        })).sort((left, right) => right.count - left.count);

        return {
            mask,
            visible,
            buckets,
            visible_count: visible.length
        };
    }

    function choose_automatic_palette(analysis) {
        const buckets = analysis.buckets;
        const centroids = [{
            r: buckets[0].r,
            g: buckets[0].g,
            b: buckets[0].b
        }];
        const minimum_new_color_distance = 34 * 34;
        const minimum_bucket_share = 0.008;

        while (centroids.length < Math.min(MAXIMUM_AUTO_COLORS, buckets.length)) {
            let selected = null;
            let selected_distance = -1;
            let selected_score = -1;

            for (const bucket of buckets) {
                const minimum_distance = Math.min(
                    ...centroids.map((centroid) => color_distance_squared(bucket, centroid))
                );
                const score = minimum_distance * Math.sqrt(bucket.count);

                if (score > selected_score) {
                    selected_score = score;
                    selected_distance = minimum_distance;
                    selected = bucket;
                }
            }

            if (
                !selected ||
                selected_distance < minimum_new_color_distance ||
                selected.count / analysis.visible_count < minimum_bucket_share
            ) {
                break;
            }

            centroids.push({
                r: selected.r,
                g: selected.g,
                b: selected.b
            });
        }

        for (let iteration = 0; iteration < 12; iteration += 1) {
            const totals = centroids.map(() => ({
                count: 0,
                r: 0,
                g: 0,
                b: 0
            }));

            for (const bucket of buckets) {
                let best_index = 0;
                let best_distance = Number.POSITIVE_INFINITY;

                for (let index = 0; index < centroids.length; index += 1) {
                    const distance = color_distance_squared(bucket, centroids[index]);
                    if (distance < best_distance) {
                        best_distance = distance;
                        best_index = index;
                    }
                }

                const total = totals[best_index];
                total.count += bucket.count;
                total.r += bucket.r * bucket.count;
                total.g += bucket.g * bucket.count;
                total.b += bucket.b * bucket.count;
            }

            for (let index = 0; index < centroids.length; index += 1) {
                const total = totals[index];
                if (total.count > 0) {
                    centroids[index] = {
                        r: total.r / total.count,
                        g: total.g / total.count,
                        b: total.b / total.count
                    };
                }
            }
        }

        const counts = centroids.map(() => 0);
        for (const pixel of analysis.visible) {
            let best_index = 0;
            let best_distance = Number.POSITIVE_INFINITY;

            for (let index = 0; index < centroids.length; index += 1) {
                const distance = color_distance_squared(pixel, centroids[index]);
                if (distance < best_distance) {
                    best_distance = distance;
                    best_index = index;
                }
            }

            counts[best_index] += 1;
        }

        const ordered = centroids.map((color, index) => ({
            color,
            count: counts[index]
        })).sort((left, right) => right.count - left.count);
        const selected = [];
        const minimum_cluster_share = 0.012;
        const merge_distance = 26 * 26;

        for (const entry of ordered) {
            if (
                selected.length > 0 &&
                entry.count / analysis.visible_count < minimum_cluster_share
            ) {
                continue;
            }

            if (selected.some((color) => {
                return color_distance_squared(color, entry.color) < merge_distance;
            })) {
                continue;
            }

            selected.push(entry.color);
            if (selected.length >= MAXIMUM_AUTO_COLORS) break;
        }

        if (selected.length === 0) selected.push(ordered[0].color);
        return selected.map(rgb_to_hex);
    }

    function normalize_target_colors(raw_targets) {
        const colors = [];

        for (const raw_target of Array.isArray(raw_targets) ? raw_targets : []) {
            const color = String(
                raw_target && typeof raw_target === "object" ?
                    raw_target.color : raw_target || ""
            ).trim().toLowerCase();

            if (/^#[0-9a-f]{6}$/.test(color) && !colors.includes(color)) {
                colors.push(color);
            }
        }

        return colors.length > 0 ? colors : [DEFAULT_COLOR];
    }

    function quantize_all_visible_pixels(pixels, raw_targets) {
        const palette = normalize_target_colors(raw_targets);
        const palette_rgb = palette.map(hex_to_rgb);
        const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
        const color_map = new Uint16Array(GRID_SIZE * GRID_SIZE);
        color_map.fill(EMPTY_COLOR_INDEX);
        let occupied_count = 0;

        for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
            const pixel_index = index * 4;
            if (pixels[pixel_index + 3] === 0) continue;

            const pixel = {
                r: pixels[pixel_index],
                g: pixels[pixel_index + 1],
                b: pixels[pixel_index + 2]
            };
            let best_index = 0;
            let best_distance = Number.POSITIVE_INFINITY;

            for (let palette_index = 0; palette_index < palette_rgb.length; palette_index += 1) {
                const distance = color_distance_squared(pixel, palette_rgb[palette_index]);
                if (distance < best_distance) {
                    best_distance = distance;
                    best_index = palette_index;
                }
            }

            mask[index] = 1;
            color_map[index] = best_index;
            occupied_count += 1;
        }

        return {
            mask,
            color_map,
            palette,
            occupied_count
        };
    }

    async function load_strict_bulk_source(app, file) {
        const pixels = await read_grid_pixels(file);
        const analysis = analyze_visible_pixels(pixels);
        const automatic_palette = choose_automatic_palette(analysis);
        const chosen_targets = await app.open_quantization_dialog(
            pixels,
            analysis,
            automatic_palette,
            file.name
        );

        if (!chosen_targets) return false;

        const quantized = quantize_all_visible_pixels(pixels, chosen_targets);
        app.source_image = null;
        app.source_name = file.name;
        app.current_mask = quantized.mask;
        app.current_color_map = quantized.color_map;
        app.current_palette = quantized.palette;
        app.mask_columns = GRID_SIZE;
        app.mask_rows = GRID_SIZE;
        app.using_stored_mask = true;
        app.image_revision += 1;
        app.mask_revision = app.image_revision;
        app.draw_quantized_source();
        app.update_palette_preview();
        const colour_word = quantized.palette.length === 1 ? "colour" : "colours";
        app.elements.source_name_text.textContent =
            `${app.source_name} · padded and quantised to ${quantized.palette.length} ` +
            `${colour_word} at ${GRID_SIZE} × ${GRID_SIZE} · ` +
            `${quantized.occupied_count.toLocaleString()} occupied pixels`;
        return true;
    }

    function install(app) {
        if (!app || app.__choobs_bulk_strict_quantization_installed) return;
        app.__choobs_bulk_strict_quantization_installed = true;
        const original_load_source_image = app.load_source_image.bind(app);

        app.load_source_image = async function (file) {
            if (!document.body.classList.contains("bulk_quantizing")) {
                return original_load_source_image(file);
            }
            return load_strict_bulk_source(this, file);
        };
    }

    globalThis.ChoobsBulkStrictQuantizationReady = wait_for_app().then((app) => {
        if (!app) {
            throw new Error("The creator application was not available.");
        }
        install(app);
    });
})();
