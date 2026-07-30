(() => {
    "use strict";

    const LENGTH_LABELS = Object.freeze(["Short", "Medium", "Long"]);
    const NESTING_LABELS = Object.freeze([
        "Relaxed",
        "Natural",
        "Nested",
        "Dense nest"
    ]);


    const GRID_SIZE = 50;
    const EMPTY_COLOR_INDEX = 255;
    const EMPTY_TARGET_TOKEN = "__empty__";
    const VISIBLE_ALPHA_THRESHOLD = 128;
    const DEFAULT_PALETTE = Object.freeze([
        "#ff5c7a", "#ffd166", "#4dd6a8", "#5b9dff", "#b983ff"
    ]);

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

    function is_visible_alpha(alpha) {
        return alpha >= VISIBLE_ALPHA_THRESHOLD;
    }

    function choose_background_color(pixels) {
        const histogram = new Map();
        let border_count = 0;

        for (let y = 0; y < GRID_SIZE; y += 1) {
            for (let x = 0; x < GRID_SIZE; x += 1) {
                if (x !== 0 && y !== 0 && x !== GRID_SIZE - 1 && y !== GRID_SIZE - 1) {
                    continue;
                }

                border_count += 1;
                const pixel_index = (y * GRID_SIZE + x) * 4;
                const alpha = pixels[pixel_index + 3];
                if (!is_visible_alpha(alpha)) continue;
                const red = pixels[pixel_index];
                const green = pixels[pixel_index + 1];
                const blue = pixels[pixel_index + 2];
                const key = `${red >> 4},${green >> 4},${blue >> 4}`;
                const entry = histogram.get(key) || {
                    count: 0, r: 0, g: 0, b: 0
                };
                entry.count += 1;
                entry.r += red;
                entry.g += green;
                entry.b += blue;
                histogram.set(key, entry);
            }
        }

        const dominant = Array.from(histogram.values())
            .sort((left, right) => right.count - left.count)[0];
        if (!dominant || dominant.count / Math.max(1, border_count) < 0.28) {
            return null;
        }

        const color = {
            r: dominant.r / dominant.count,
            g: dominant.g / dominant.count,
            b: dominant.b / dominant.count
        };
        const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        return luminance <= 64 ? color : null;
    }

    function analyze_source_pixels(pixels) {
        const background = choose_background_color(pixels);
        const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
        const visible = [];
        const histogram = new Map();

        for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
            const pixel_index = index * 4;
            const alpha = pixels[pixel_index + 3];
            if (alpha < 64) continue;

            const color = {
                r: pixels[pixel_index],
                g: pixels[pixel_index + 1],
                b: pixels[pixel_index + 2]
            };

            if (background && color_distance_squared(color, background) <= 34 * 34) {
                continue;
            }

            mask[index] = 1;
            visible.push({ index, ...color });
            const key = `${color.r >> 3},${color.g >> 3},${color.b >> 3}`;
            const entry = histogram.get(key) || {
                count: 0, r: 0, g: 0, b: 0
            };
            entry.count += 1;
            entry.r += color.r;
            entry.g += color.g;
            entry.b += color.b;
            histogram.set(key, entry);
        }

        if (visible.length === 0) {
            throw new Error("The processed image contains no visible subject pixels.");
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

    function choose_automatic_palette(analysis, maximum_colors = 5) {
        const buckets = analysis.buckets;
        const maximum = Math.max(1, Math.min(5, Math.floor(maximum_colors) || 5));
        const centroids = [
            { r: buckets[0].r, g: buckets[0].g, b: buckets[0].b }
        ];
        const minimum_new_color_distance = 34 * 34;
        const minimum_bucket_share = 0.008;

        while (centroids.length < Math.min(maximum, buckets.length)) {
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

            centroids.push({ r: selected.r, g: selected.g, b: selected.b });
        }

        for (let iteration = 0; iteration < 12; iteration += 1) {
            const totals = centroids.map(() => ({ count: 0, r: 0, g: 0, b: 0 }));

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

            if (selected.some((color) => color_distance_squared(color, entry.color) < merge_distance)) {
                continue;
            }

            selected.push(entry.color);
            if (selected.length >= maximum) break;
        }

        if (selected.length === 0) selected.push(ordered[0].color);
        return selected.map(rgb_to_hex);
    }

    function normalize_target_palette(raw_palette) {
        const palette = [];

        for (const raw_color of Array.isArray(raw_palette) ? raw_palette : []) {
            const color = String(raw_color || "").trim().toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(color) && !palette.includes(color)) {
                palette.push(color);
            }
            if (palette.length >= 5) break;
        }

        return palette.length > 0 ? palette : [DEFAULT_PALETTE[0]];
    }

    function normalize_quantization_targets(raw_targets) {
        const targets = [];

        for (const raw_target of Array.isArray(raw_targets) ? raw_targets : []) {
            const is_object = raw_target && typeof raw_target === "object";
            const color = String(
                is_object ? raw_target.color : raw_target || ""
            ).trim().toLowerCase();
            const is_empty = is_object && Boolean(raw_target.is_empty);

            if (!/^#[0-9a-f]{6}$/.test(color)) {
                continue;
            }

            const duplicate = targets.some((target) => {
                return target.color === color && target.is_empty === is_empty;
            });

            if (!duplicate) {
                targets.push({ color, is_empty });
            }

            if (targets.length >= 5) break;
        }

        return targets.length > 0 ? targets : [{
            color: DEFAULT_PALETTE[0],
            is_empty: false
        }];
    }

    function quantize_pixels_to_palette(pixels, raw_targets, analysis = null) {
        const source = analysis || analyze_source_pixels(pixels);
        const targets = normalize_quantization_targets(raw_targets);
        const target_rgb = targets.map((target) => hex_to_rgb(target.color));
        const target_to_palette = new Int16Array(targets.length);
        target_to_palette.fill(-1);
        const palette = [];

        for (let index = 0; index < targets.length; index += 1) {
            if (targets[index].is_empty) {
                continue;
            }

            target_to_palette[index] = palette.length;
            palette.push(targets[index].color);
        }

        const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
        const color_map = new Uint8Array(GRID_SIZE * GRID_SIZE);
        color_map.fill(EMPTY_COLOR_INDEX);
        let occupied_count = 0;

        for (const pixel of source.visible) {
            let best_index = 0;
            let best_distance = Number.POSITIVE_INFINITY;

            for (let index = 0; index < target_rgb.length; index += 1) {
                const distance = color_distance_squared(pixel, target_rgb[index]);
                if (distance < best_distance) {
                    best_distance = distance;
                    best_index = index;
                }
            }

            const target = targets[best_index];
            if (target.is_empty) {
                continue;
            }

            mask[pixel.index] = 1;
            color_map[pixel.index] = target_to_palette[best_index];
            occupied_count += 1;
        }

        return {
            mask,
            color_map,
            palette,
            targets,
            occupied_count
        };
    }

    class LevelEditorApplication {
        constructor(elements) {
            this.elements = elements;
            this.renderer = new ChoobsCanvasRenderer(
                elements.editor_canvas
            );
            this.source_context =
                elements.source_canvas.getContext("2d", {
                    alpha: true,
                    willReadFrequently: true
                });
            this.source_image = null;
            this.source_name = "built-in source";
            this.current_mask = null;
            this.current_color_map = null;
            this.current_palette = Array.from(DEFAULT_PALETTE);
            this.mask_columns = 0;
            this.mask_rows = 0;
            this.current_level = null;
            this.session = null;
            this.levels = [];
            this.server_online = false;
            this.last_frame_time = performance.now();
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.hint_until = 0;
            this.blocked_pipe_id = -1;
            this.blocked_until = 0;
            this.blocker_pipe_id = -1;
            this.blocker_until = 0;
            this.intro_started = 0;
            this.image_revision = 0;
            this.mask_revision = -1;
            this.using_stored_mask = false;
            this.needs_render = true;
            this.last_stats_time = 0;
            this.pending_image_pixels = null;
            this.pending_image_analysis = null;
            this.pending_auto_palette = [];
            this.pending_quantization_resolve = null;

            this.install_events();
            this.draw_default_source();
            this.generate_preview();
            requestAnimationFrame((time) => this.frame(time));
        }

        install_events() {
            window.addEventListener("resize", () => {
                this.renderer.resize();
                this.needs_render = true;
            });

            this.elements.grid_size.addEventListener("input", () => {
                const size = Number(this.elements.grid_size.value);
                this.elements.grid_size_output.value =
                    `${size} × ${size}`;
            });

            this.elements.white_majority.addEventListener("input", () => {
                this.elements.white_majority_output.value =
                    `${this.elements.white_majority.value}%`;
                this.image_revision += 1;
            });

            this.elements.pipe_length.addEventListener("input", () => {
                this.elements.pipe_length_output.value =
                    LENGTH_LABELS[
                        Number(this.elements.pipe_length.value)
                    ];
            });

            this.elements.nesting.addEventListener("input", () => {
                this.elements.nesting_output.value =
                    NESTING_LABELS[
                        Number(this.elements.nesting.value)
                    ];
            });

            this.elements.level_number_input.addEventListener(
                "input",
                () => {
                    this.update_overwrite_notice();
                    this.update_library_selection();
                }
            );

            this.elements.image_input.addEventListener(
                "change",
                async (event) => {
                    const file =
                        event.currentTarget.files &&
                        event.currentTarget.files[0];

                    if (!file) {
                        return;
                    }

                    try {
                        const applied = await this.load_source_image(file);
                        if (applied) {
                            this.set_status(
                                "Image quantised. Generate a preview to create the level."
                            );
                        }
                    } catch (error) {
                        this.set_status(
                            `Image load failed: ${error.message}`
                        );
                    }
                }
            );

            this.elements.quantization_auto_button.addEventListener(
                "click",
                () => {
                    this.apply_palette_to_quantization_controls(
                        this.pending_auto_palette,
                        true
                    );
                }
            );

            this.elements.quantization_color_count.addEventListener(
                "change",
                () => {
                    this.update_quantization_color_rows();
                    this.render_quantization_preview();
                }
            );

            for (const input of this.elements.quantization_color_inputs) {
                input.addEventListener("input", () => {
                    const text_input = this.elements.quantization_hex_inputs[
                        Number(input.dataset.quantIndex)
                    ];
                    text_input.value = input.value.toLowerCase();
                    this.elements.quantization_mode_badge.textContent = "Custom palette";
                    this.render_quantization_preview();
                });
            }

            for (const input of this.elements.quantization_hex_inputs) {
                input.addEventListener("change", () => {
                    const normalized = String(input.value || "").trim().toLowerCase();
                    const color_input = this.elements.quantization_color_inputs[
                        Number(input.dataset.quantIndex)
                    ];
                    if (/^#[0-9a-f]{6}$/.test(normalized)) {
                        input.value = normalized;
                        color_input.value = normalized;
                        this.elements.quantization_mode_badge.textContent = "Custom palette";
                        this.render_quantization_preview();
                    } else {
                        input.value = color_input.value;
                    }
                });
            }

            for (const input of this.elements.quantization_empty_inputs) {
                input.addEventListener("change", () => {
                    this.elements.quantization_mode_badge.textContent = "Custom palette";
                    this.update_quantization_color_rows();
                    this.render_quantization_preview();
                });
            }

            this.elements.quantization_apply_button.addEventListener(
                "click",
                () => this.finish_quantization_dialog(true)
            );
            this.elements.quantization_cancel_button.addEventListener(
                "click",
                () => this.finish_quantization_dialog(false)
            );
            this.elements.quantization_overlay.addEventListener(
                "pointerdown",
                (event) => {
                    if (event.target === this.elements.quantization_overlay) {
                        this.finish_quantization_dialog(false);
                    }
                }
            );
            window.addEventListener("keydown", (event) => {
                if (
                    event.key === "Escape" &&
                    !this.elements.quantization_overlay.classList.contains("hidden")
                ) {
                    event.preventDefault();
                    this.finish_quantization_dialog(false);
                }
            });

            this.elements.default_image_button.addEventListener(
                "click",
                () => {
                    this.source_image = null;
                    this.source_name = "built-in source";
                    this.elements.image_input.value = "";
                    this.draw_default_source();
                    this.set_status("Default 50 × 50 mask restored.");
                }
            );

            this.elements.random_seed_button.addEventListener(
                "click",
                () => {
                    this.elements.seed_input.value = String(
                        Choobs.create_seed()
                    );
                }
            );

            this.elements.generate_button.addEventListener(
                "click",
                () => {
                    this.generate_preview();
                }
            );

            this.elements.reset_test_button.addEventListener(
                "click",
                () => {
                    this.reset_test();
                }
            );

            this.elements.hint_button.addEventListener("click", () => {
                this.show_hint();
            });

            this.elements.show_mask.addEventListener("change", () => {
                this.renderer.show_mask =
                    this.elements.show_mask.checked;
                this.needs_render = true;
            });

            this.elements.export_button.addEventListener("click", () => {
                this.export_level();
            });

            this.elements.import_input.addEventListener(
                "change",
                (event) => {
                    this.import_level_file(event);
                }
            );

            this.elements.delete_button.addEventListener("click", () => {
                this.delete_level();
            });

            this.elements.refresh_library_button.addEventListener(
                "click",
                () => {
                    this.refresh_library();
                }
            );

            this.elements.editor_canvas.addEventListener(
                "pointermove",
                (event) => {
                    this.handle_pointer_move(event);
                }
            );

            this.elements.editor_canvas.addEventListener(
                "pointerleave",
                () => {
                    this.hovered_pipe_id = -1;
                    this.elements.editor_canvas.style.cursor =
                        "default";
                    this.needs_render = true;
                }
            );

            this.elements.editor_canvas.addEventListener(
                "pointerdown",
                (event) => {
                    event.preventDefault();
                    this.handle_pointer_down(event);
                }
            );

            this.elements.editor_canvas.addEventListener(
                "contextmenu",
                (event) => {
                    event.preventDefault();
                }
            );
        }

        async refresh_library() {
            this.server_online = false;
            this.levels = [];
            this.elements.server_badge.textContent = "standalone export mode";
            this.render_library();
            this.update_overwrite_notice();
        }

        render_library() {
            this.elements.level_library_list.replaceChildren();

            if (this.levels.length === 0) {
                const empty = document.createElement("p");
                empty.className = "library_empty";
                empty.textContent = "No levels have been saved.";
                this.elements.level_library_list.append(empty);
                return;
            }

            for (const level of this.levels) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "library_item";
                button.dataset.levelNumber =
                    String(level.number);

                const number = document.createElement("span");
                number.className = "library_number";
                number.textContent = String(level.number);

                const details = document.createElement("span");
                const name = document.createElement("span");
                name.className = "library_name";
                name.textContent = level.name;

                const meta = document.createElement("span");
                meta.className = "library_meta";
                meta.textContent =
                    `${level.pipes.length} pipes · ` +
                    `depth ${level.difficulty.dependency_depth}`;

                details.append(name, meta);
                button.append(number, details);
                button.addEventListener("click", () => {
                    this.load_existing_level(level.number);
                });
                this.elements.level_library_list.append(button);
            }

            this.update_library_selection();
        }

        update_library_selection() {
            const selected_number = Number(
                this.elements.level_number_input.value
            );

            for (
                const item of
                    this.elements.level_library_list.querySelectorAll(
                        ".library_item"
                    )
            ) {
                item.classList.toggle(
                    "selected",
                    Number(item.dataset.levelNumber) ===
                        selected_number
                );
            }
        }

        update_overwrite_notice() {
            const number = Math.max(
                1,
                Number(
                    this.elements.level_number_input.value
                ) || 1
            );
            const existing = this.levels.some((level) => {
                return level.number === number;
            });

            this.elements.overwrite_notice.textContent =
                existing ?
                    `Level ${number} already exists and will be replaced.` :
                    `Level ${number} is currently unused.`;
            this.elements.delete_button.disabled =
                !existing || !this.server_online;
        }

        async load_source_image(file) {
            let bitmap = null;

            if ("createImageBitmap" in window) {
                bitmap = await createImageBitmap(file);
            } else {
                bitmap = await new Promise((resolve, reject) => {
                    const image = new Image();
                    const url = URL.createObjectURL(file);

                    image.onload = () => {
                        URL.revokeObjectURL(url);
                        resolve(image);
                    };
                    image.onerror = () => {
                        URL.revokeObjectURL(url);
                        reject(new Error("Image decode failed."));
                    };
                    image.src = url;
                });
            }

            const image_width = bitmap.width || bitmap.naturalWidth;
            const image_height = bitmap.height || bitmap.naturalHeight;
            const crop_size = Math.min(image_width, image_height);
            const crop_x = Math.floor((image_width - crop_size) * 0.5);
            const crop_y = Math.floor((image_height - crop_size) * 0.5);
            const sample_canvas = document.createElement("canvas");
            sample_canvas.width = GRID_SIZE;
            sample_canvas.height = GRID_SIZE;
            const sample_context = sample_canvas.getContext("2d", {
                alpha: true,
                willReadFrequently: true
            });
            sample_context.imageSmoothingEnabled = false;
            sample_context.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
            sample_context.drawImage(
                bitmap,
                crop_x,
                crop_y,
                crop_size,
                crop_size,
                0,
                0,
                GRID_SIZE,
                GRID_SIZE
            );

            if (typeof bitmap.close === "function") bitmap.close();

            const pixels = new Uint8ClampedArray(
                sample_context.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data
            );
            const analysis = analyze_source_pixels(pixels);
            const automatic_palette = choose_automatic_palette(analysis, 5);
            const chosen_targets = await this.open_quantization_dialog(
                pixels,
                analysis,
                automatic_palette,
                file.name
            );

            if (!chosen_targets) {
                this.elements.image_input.value = "";
                this.set_status("Image import cancelled; the previous source remains active.");
                return false;
            }

            const quantized = quantize_pixels_to_palette(
                pixels,
                chosen_targets,
                analysis
            );

            if (quantized.occupied_count === 0) {
                throw new Error(
                    "The chosen quantisation targets left no occupied cells. " +
                    "Choose at least one non-empty target colour."
                );
            }

            this.source_image = null;
            this.source_name = file.name;
            this.current_mask = quantized.mask;
            this.current_color_map = quantized.color_map;
            this.current_palette = quantized.palette;
            this.mask_columns = GRID_SIZE;
            this.mask_rows = GRID_SIZE;
            this.using_stored_mask = true;
            this.image_revision += 1;
            this.mask_revision = this.image_revision;
            this.draw_quantized_source();
            this.update_palette_preview();
            const colour_word = quantized.palette.length === 1 ? "colour" : "colours";
            this.elements.source_name_text.textContent =
                `${this.source_name} · cropped and quantised to ${quantized.palette.length} ` +
                `${colour_word} at ${GRID_SIZE} × ${GRID_SIZE} · ` +
                `${quantized.occupied_count.toLocaleString()} occupied pixels`;
            return true;
        }

        open_quantization_dialog(pixels, analysis, automatic_palette, file_name) {
            if (this.pending_quantization_resolve) {
                this.finish_quantization_dialog(false);
            }

            this.pending_image_pixels = pixels;
            this.pending_image_analysis = analysis;
            this.pending_auto_palette = Array.from(automatic_palette);
            this.elements.quantization_source_name.textContent = file_name;
            this.elements.quantization_auto_summary.textContent =
                `Auto detected ${automatic_palette.length} meaningful ` +
                `${automatic_palette.length === 1 ? "colour" : "colours"}.`;
            this.apply_palette_to_quantization_controls(automatic_palette, true);
            this.elements.quantization_overlay.classList.remove("hidden");
            this.elements.quantization_overlay.setAttribute("aria-hidden", "false");
            document.body.classList.add("quantization_dialog_open");

            requestAnimationFrame(() => {
                this.elements.quantization_auto_button.focus();
            });

            return new Promise((resolve) => {
                this.pending_quantization_resolve = resolve;
            });
        }

        apply_palette_to_quantization_controls(raw_targets, mark_auto = false) {
            const targets = normalize_quantization_targets(raw_targets);
            const count = Math.max(1, Math.min(5, targets.length));
            this.elements.quantization_color_count.value = String(count);

            for (let index = 0; index < 5; index += 1) {
                const target = targets[index] || {
                    color: this.pending_auto_palette[index] || DEFAULT_PALETTE[index],
                    is_empty: false
                };
                this.elements.quantization_color_inputs[index].value = target.color;
                this.elements.quantization_hex_inputs[index].value = target.color;
                this.elements.quantization_empty_inputs[index].checked = Boolean(target.is_empty);
            }

            this.elements.quantization_mode_badge.textContent = mark_auto ?
                "Automatic palette" : "Custom palette";
            this.update_quantization_color_rows();
            this.render_quantization_preview();
        }

        get_quantization_targets_from_controls() {
            const count = Math.max(
                1,
                Math.min(5, Number(this.elements.quantization_color_count.value) || 1)
            );
            return normalize_quantization_targets(
                this.elements.quantization_color_inputs
                    .slice(0, count)
                    .map((input, index) => ({
                        color: input.value,
                        is_empty: Boolean(this.elements.quantization_empty_inputs[index].checked)
                    }))
            );
        }

        update_quantization_color_rows() {
            const count = Math.max(
                1,
                Math.min(5, Number(this.elements.quantization_color_count.value) || 1)
            );

            for (let index = 0; index < this.elements.quantization_color_rows.length; index += 1) {
                const hidden = index >= count;
                this.elements.quantization_color_rows[index].classList.toggle(
                    "hidden",
                    hidden
                );
                this.elements.quantization_color_rows[index].classList.toggle(
                    "quantization_color_row_empty",
                    !hidden && this.elements.quantization_empty_inputs[index].checked
                );
            }

            const targets = this.get_quantization_targets_from_controls();
            const auto_matches =
                targets.length === this.pending_auto_palette.length &&
                targets.every((target, index) => {
                    return !target.is_empty && target.color === this.pending_auto_palette[index];
                });
            this.elements.quantization_mode_badge.textContent = auto_matches ?
                "Automatic palette" : "Custom palette";
        }

        render_quantization_preview() {
            if (!this.pending_image_pixels || !this.pending_image_analysis) return;
            const targets = this.get_quantization_targets_from_controls();
            const quantized = quantize_pixels_to_palette(
                this.pending_image_pixels,
                targets,
                this.pending_image_analysis
            );
            const canvas = this.elements.quantization_preview_canvas;
            const context = canvas.getContext("2d", { alpha: true });
            const image_data = context.createImageData(GRID_SIZE, GRID_SIZE);
            const palette_rgb = quantized.palette.map(hex_to_rgb);

            for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
                const pixel_index = index * 4;
                const color_index = quantized.color_map[index];
                const is_filled = quantized.mask[index] && color_index !== EMPTY_COLOR_INDEX;
                const color = is_filled ? palette_rgb[color_index] : { r: 0, g: 0, b: 0 };
                image_data.data[pixel_index] = color.r;
                image_data.data[pixel_index + 1] = color.g;
                image_data.data[pixel_index + 2] = color.b;
                image_data.data[pixel_index + 3] = is_filled ? 255 : 0;
            }

            context.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
            context.putImageData(image_data, 0, 0);
            const empty_target_count = targets.filter((target) => target.is_empty).length;
            const color_text = `${quantized.palette.length} ${quantized.palette.length === 1 ? "colour" : "colours"}`;
            this.elements.quantization_effective_count.textContent = empty_target_count > 0 ?
                `${color_text} + ${empty_target_count} empty target${empty_target_count === 1 ? "" : "s"}` :
                color_text;
        }

        finish_quantization_dialog(apply) {
            if (!this.pending_quantization_resolve) return;
            const resolve = this.pending_quantization_resolve;
            const targets = apply ? this.get_quantization_targets_from_controls() : null;
            this.pending_quantization_resolve = null;
            this.pending_image_pixels = null;
            this.pending_image_analysis = null;
            this.pending_auto_palette = [];
            this.elements.quantization_overlay.classList.add("hidden");
            this.elements.quantization_overlay.setAttribute("aria-hidden", "true");
            document.body.classList.remove("quantization_dialog_open");
            resolve(targets);
        }

        draw_default_source() {
            const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
            const color_map = new Uint8Array(GRID_SIZE * GRID_SIZE);
            color_map.fill(EMPTY_COLOR_INDEX);

            for (let y = 0; y < GRID_SIZE; y += 1) {
                for (let x = 0; x < GRID_SIZE; x += 1) {
                    const dx = (x - 24.5) / 21.5;
                    const dy = (y - 24.5) / 20;
                    const wobble =
                        Math.sin(y * 0.21) * 0.055 +
                        Math.sin(x * 0.17 + 1.4) * 0.045;
                    const outer = dx * dx + dy * dy < 1 + wobble;
                    const first_hole =
                        (x - 17) * (x - 17) +
                        (y - 17) * (y - 17) < 20;
                    const second_hole =
                        (x - 32) * (x - 32) +
                        (y - 29) * (y - 29) < 30;

                    if (outer && !first_hole && !second_hole) {
                        const index = y * GRID_SIZE + x;
                        mask[index] = 1;
                        const angle = Math.atan2(y - 24.5, x - 24.5);
                        const radius = Math.hypot(x - 24.5, y - 24.5);
                        color_map[index] = Math.abs(
                            Math.floor((angle + Math.PI) / (Math.PI * 2) * 5) +
                            Math.floor(radius / 7)
                        ) % 5;
                    }
                }
            }

            this.current_mask = mask;
            this.current_color_map = color_map;
            this.current_palette = Array.from(DEFAULT_PALETTE);
            this.mask_columns = GRID_SIZE;
            this.mask_rows = GRID_SIZE;
            this.using_stored_mask = true;
            this.image_revision += 1;
            this.mask_revision = this.image_revision;
            this.draw_quantized_source();
            this.update_palette_preview();
            this.elements.source_name_text.textContent =
                "built-in 50 × 50 five-colour mask";
        }

        draw_quantized_source() {
            const image_data = this.source_context.createImageData(
                GRID_SIZE,
                GRID_SIZE
            );
            const palette_rgb = this.current_palette.map(hex_to_rgb);

            for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
                const pixel_index = index * 4;
                const color_index = this.current_color_map ?
                    this.current_color_map[index] : EMPTY_COLOR_INDEX;
                const color = this.current_mask && this.current_mask[index] &&
                    color_index !== EMPTY_COLOR_INDEX ?
                    palette_rgb[color_index % palette_rgb.length] :
                    { r: 0, g: 0, b: 0 };
                image_data.data[pixel_index] = color.r;
                image_data.data[pixel_index + 1] = color.g;
                image_data.data[pixel_index + 2] = color.b;
                image_data.data[pixel_index + 3] = 255;
            }

            this.source_context.putImageData(image_data, 0, 0);
        }

        draw_mask_to_source_canvas(mask) {
            this.current_mask = Uint8Array.from(mask);
            if (!this.current_color_map || this.current_color_map.length !== mask.length) {
                this.current_color_map = new Uint8Array(mask.length);
                for (let index = 0; index < mask.length; index += 1) {
                    this.current_color_map[index] = mask[index] ? 0 : EMPTY_COLOR_INDEX;
                }
            }
            this.draw_quantized_source();
        }

        draw_source_image() {
            if (this.current_mask && this.current_mask.length === GRID_SIZE * GRID_SIZE) {
                this.draw_quantized_source();
            }
        }

        update_palette_preview() {
            if (!this.elements.palette_preview) return;
            this.elements.palette_preview.replaceChildren();
            this.elements.palette_preview.style.gridTemplateColumns =
                `repeat(${Math.max(1, this.current_palette.length)}, minmax(0, 1fr))`;
            for (const color of this.current_palette) {
                const swatch = document.createElement("span");
                swatch.className = "palette_swatch";
                swatch.style.backgroundColor = color;
                swatch.title = color;
                swatch.setAttribute("aria-label", color);
                this.elements.palette_preview.appendChild(swatch);
            }
        }

        create_valid_mask(columns, rows) {
            if (columns !== 50 || rows !== 50) {
                throw new Error("Pixel-perfect image generation requires a 50 × 50 grid.");
            }

            if (!this.current_mask || this.current_mask.length !== 2500) {
                throw new Error("Load and quantise a valid source image first.");
            }

            return Uint8Array.from(this.current_mask);
        }

        get_generation_mask(columns, rows) {
            return this.create_valid_mask(columns, rows);
        }

        generate_level_off_thread(options) {
            const worker_source =
                globalThis.ChoobsGenerationWorkerSource;

            if (
                typeof Worker !== "function" ||
                typeof worker_source !== "string" ||
                worker_source.length === 0
            ) {
                return Promise.resolve(
                    Choobs.generate_level(options)
                );
            }

            return new Promise((resolve, reject) => {
                const blob = new Blob(
                    [worker_source],
                    { type: "text/javascript" }
                );
                const worker_url = URL.createObjectURL(blob);
                let worker = null;

                try {
                    worker = new Worker(worker_url);
                } catch (error) {
                    URL.revokeObjectURL(worker_url);
                    resolve(Choobs.generate_level(options));
                    return;
                }

                const finish = () => {
                    worker.terminate();
                    URL.revokeObjectURL(worker_url);
                };

                worker.addEventListener("message", (event) => {
                    const message = event.data || {};

                    if (message.type === "progress") {
                        const progress = message.progress || {};

                        if (progress.phase === "cleaning_mask") {
                            this.set_status("Reading the exact 50 × 50 mask…");
                        } else if (progress.phase === "generating") {
                            this.set_status(
                                `Building pipe paths — attempt ${progress.attempt} of ${progress.maximum_attempts}…`
                            );
                        } else if (progress.phase === "orienting") {
                            this.set_status(
                                `Validating ${progress.pipe_count || 0} collision-safe pipes…`
                            );
                        } else if (progress.phase === "scoring") {
                            this.set_status("Calculating level difficulty…");
                        }

                        return;
                    }

                    finish();

                    if (message.type === "complete") {
                        resolve(message.level);
                    } else {
                        reject(new Error(
                            message.message || "Level generation failed."
                        ));
                    }
                });

                worker.addEventListener("error", (event) => {
                    finish();
                    reject(new Error(
                        event.message || "The generation worker failed."
                    ));
                });

                const worker_mask = Uint8Array.from(options.mask);
                const worker_color_map = Uint8Array.from(options.color_map || []);
                const worker_options = {
                    ...options,
                    mask: worker_mask,
                    color_map: worker_color_map
                };

                worker.postMessage(
                    { type: "generate", options: worker_options },
                    [worker_mask.buffer, worker_color_map.buffer]
                );
            });
        }

        async generate_preview() {
            this.elements.loading_overlay.classList.remove(
                "hidden"
            );
            this.set_controls_disabled(true);
            this.set_status(
                "Generating and validating a solvable level…"
            );
            await new Promise((resolve) => {
                requestAnimationFrame(resolve);
            });

            try {
                const columns = Number(
                    this.elements.grid_size.value
                );
                const rows = columns;
                const mask = this.get_generation_mask(
                    columns,
                    rows
                );

                if (!mask) {
                    throw new Error(
                        "No source mask is available."
                    );
                }

                const level = await this.generate_level_off_thread({
                    number: Number(
                        this.elements.level_number_input.value
                    ),
                    name:
                        this.elements.level_name_input
                            .value
                            .trim() ||
                        "custom level",
                    source_name: this.source_name,
                    columns,
                    rows,
                    mask,
                    color_map: Uint8Array.from(this.current_color_map),
                    palette: Array.from(this.current_palette),
                    seed: Number(
                        this.elements.seed_input.value
                    ),
                    white_majority: 1,
                    preserve_exact_mask: true,
                    length_setting: Number(
                        this.elements.pipe_length.value
                    ),
                    nesting: Number(
                        this.elements.nesting.value
                    )
                });

                this.current_level =
                    Choobs.serialize_level(level);
                this.elements.seed_input.value = String(
                    this.current_level.settings
                        .requested_seed
                );
                this.start_test_session();
                this.set_status(
                    `Generated level ${this.current_level.number} with every valid tile filled. ` +
                    "Play-test it, then export its numbered JSON file."
                );
            } catch (error) {
                console.error(error);
                this.set_status(
                    `Generation failed: ${error.message}`
                );
            } finally {
                this.elements.loading_overlay.classList.add(
                    "hidden"
                );
                this.set_controls_disabled(false);
            }
        }

        start_test_session() {
            if (!this.current_level) {
                return;
            }

            this.session =
                new Choobs.PuzzleSession(
                    this.current_level
                );
            this.renderer.set_level(this.current_level);
            this.renderer.show_mask =
                this.elements.show_mask.checked;
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.blocked_pipe_id = -1;
            this.blocker_pipe_id = -1;
            this.intro_started = performance.now();
            this.needs_render = true;
            this.update_stats();
        }

        reset_test() {
            if (!this.session) {
                return;
            }

            this.session.reset();
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.blocked_pipe_id = -1;
            this.blocker_pipe_id = -1;
            this.intro_started = performance.now();
            this.needs_render = true;
            this.update_stats();
            this.set_status(
                "Play-test reset to the generated layout."
            );
        }

        handle_pointer_move(event) {
            if (!this.session) {
                return;
            }

            const cell =
                this.renderer.pointer_to_cell(event);
            const pipe_id = cell ?
                this.session.grid.get_occupant(
                    cell.x,
                    cell.y
                ) :
                -1;
            if (pipe_id !== this.hovered_pipe_id) {
                this.hovered_pipe_id = pipe_id;
                this.hovered_pipe_is_clear =
                    pipe_id >= 0 &&
                    this.session.can_activate(pipe_id).ok;
                this.needs_render = true;
            }

            this.elements.editor_canvas.style.cursor =
                pipe_id >= 0 ? "pointer" : "default";
        }

        handle_pointer_down(event) {
            if (
                !this.session ||
                this.session.is_complete()
            ) {
                return;
            }

            const cell =
                this.renderer.pointer_to_cell(event);

            if (!cell) {
                return;
            }

            const pipe_id =
                this.session.grid.get_occupant(
                    cell.x,
                    cell.y
                );

            if (pipe_id < 0) {
                return;
            }

            const result =
                this.session.activate(pipe_id);

            if (!result.ok) {
                this.blocked_pipe_id = pipe_id;
                this.blocked_until =
                    performance.now() + 520;
                this.blocker_pipe_id =
                    Number.isInteger(result.blocker) ?
                        result.blocker :
                        -1;
                this.blocker_until =
                    performance.now() + 720;
                this.needs_render = true;
                this.set_status(
                    result.reason === "collision" ?
                        "Those simultaneous pipe movements would collide." :
                        "That pipe is blocked by a stationary pipe ahead."
                );
                return;
            }

            this.hint_pipe_id = -1;
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.needs_render = true;
            this.set_status(
                "Play-test pipe activated."
            );
            this.update_stats();
        }

        show_hint() {
            if (
                !this.session ||
                this.session.is_complete()
            ) {
                return;
            }

            const removable =
                this.session.get_removable_pipe_ids();

            if (removable.length === 0) {
                this.set_status(
                    "No additional pipe is currently clear."
                );
                return;
            }

            const random =
                new Choobs.SeededRandom(
                    Date.now() >>> 0
                );
            this.hint_pipe_id =
                random.choice(removable);
            this.hint_until =
                performance.now() + 1800;
            this.needs_render = true;
            this.set_status(
                "Highlighted a currently valid move."
            );
        }

        frame(time) {
            const delta = Math.min(
                100,
                time - this.last_frame_time
            );
            this.last_frame_time = time;

            if (this.session) {
                const update_result =
                    this.session.update(delta);
                const completed =
                    update_result.completed_pipe_ids;

                if (update_result.state_changed) {
                    this.needs_render = true;

                    if (time - this.last_stats_time >= 250) {
                        this.last_stats_time = time;
                        this.update_stats();
                    }
                }

                if (completed.length > 0) {
                    this.update_stats();

                    if (this.session.is_complete()) {
                        this.set_status(
                            `Play-test complete in ${this.session.move_count} moves. ` +
                            "The generated level remains ready to export."
                        );
                    }
                }

                if (
                    this.hint_pipe_id >= 0 &&
                    time >= this.hint_until
                ) {
                    this.hint_pipe_id = -1;
                    this.needs_render = true;
                }

                if (
                    this.blocked_pipe_id >= 0 &&
                    time >= this.blocked_until
                ) {
                    this.blocked_pipe_id = -1;
                    this.needs_render = true;
                }

                if (
                    this.blocker_pipe_id >= 0 &&
                    time >= this.blocker_until
                ) {
                    this.blocker_pipe_id = -1;
                    this.needs_render = true;
                }

                const should_render =
                    this.needs_render ||
                    this.session.get_moving_count() > 0 ||
                    this.hint_pipe_id >= 0 ||
                    this.blocked_pipe_id >= 0 ||
                    this.blocker_pipe_id >= 0 ||
                    (
                        this.intro_started > 0 &&
                        time < this.intro_started + 360
                    );

                if (should_render) {
                    this.renderer.render(this.session, {
                        time,
                        hovered_pipe_id:
                            this.hovered_pipe_id,
                        hovered_pipe_is_clear:
                            this.hovered_pipe_is_clear,
                        hint_pipe_id:
                            this.hint_pipe_id,
                        blocked_pipe_id:
                            this.blocked_pipe_id,
                        blocker_pipe_id:
                            this.blocker_pipe_id,
                        intro_started:
                            this.intro_started
                    });
                    this.needs_render = false;
                }
            }

            requestAnimationFrame((next_time) => {
                this.frame(next_time);
            });
        }

        update_stats() {
            if (!this.current_level || !this.session) {
                return;
            }

            const valid_cells =
                this.current_level.mask.reduce(
                    (total, value) => total + value,
                    0
                );
            this.elements.valid_cell_count.textContent =
                String(valid_cells);
            this.elements.pipe_count.textContent =
                String(this.current_level.pipes.length);
            this.elements.open_count.textContent =
                String(
                    this.session
                        .get_removable_pipe_ids()
                        .length
                );
            this.elements.depth_count.textContent =
                String(
                    this.current_level.difficulty
                        .dependency_depth
                );
        }

        sync_level_metadata() {
            if (!this.current_level) {
                return null;
            }

            const copy = JSON.parse(
                JSON.stringify(this.current_level)
            );
            copy.number = Math.max(
                1,
                Number(
                    this.elements.level_number_input.value
                ) || 1
            );
            copy.name =
                this.elements.level_name_input
                    .value
                    .trim() ||
                `level_${copy.number}`;
            copy.source_name = this.source_name;
            copy.created_at = new Date().toISOString();
            Choobs.validate_level(
                Choobs.normalize_level(copy)
            );
            this.current_level = copy;
            return copy;
        }

        export_level() {
            const level = this.sync_level_metadata();

            if (!level) {
                this.set_status(
                    "Generate or import a level before exporting."
                );
                return;
            }

            this.export_json_file(level);
            this.set_status(
                `Exported level_${String(level.number).padStart(3, "0")}.json.`
            );
        }

        export_json_file(level) {
            const blob = new Blob(
                [JSON.stringify(level, null, 2)],
                { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download =
                `level_${String(level.number).padStart(3, "0")}.json`;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        }

        async import_level_file(event) {
            const file =
                event.currentTarget.files &&
                event.currentTarget.files[0];

            if (!file) {
                return;
            }

            try {
                const parsed = JSON.parse(
                    await file.text()
                );
                this.apply_loaded_level(parsed);
                this.set_status(
                    `Imported ${file.name}.`
                );
            } catch (error) {
                this.set_status(
                    `Import failed: ${error.message}`
                );
            } finally {
                event.currentTarget.value = "";
            }
        }

        load_existing_level(level_number) {
            const level = this.levels.find((item) => {
                return item.number === level_number;
            });

            if (!level) {
                return;
            }

            this.apply_loaded_level(level);
            this.set_status(
                `Loaded level ${level.number}. ` +
                "You can test it, renumber it, or regenerate its stored mask."
            );
        }

        apply_loaded_level(raw_level) {
            const level =
                Choobs.serialize_level(raw_level);

            if (level.columns !== 50 || level.rows !== 50) {
                throw new Error(
                    "This exact-pixel creator only accepts 50 × 50 level files."
                );
            }

            this.current_level = level;
            this.current_mask =
                Uint8Array.from(level.mask);
            this.current_palette = Array.from(level.palette || DEFAULT_PALETTE);
            this.current_color_map = new Uint8Array(level.columns * level.rows);
            this.current_color_map.fill(EMPTY_COLOR_INDEX);
            for (const pipe of level.pipes) {
                for (const cell of pipe.cells) {
                    this.current_color_map[cell.y * level.columns + cell.x] =
                        pipe.color_index % this.current_palette.length;
                }
            }
            this.mask_columns = level.columns;
            this.mask_rows = level.rows;
            this.mask_revision = this.image_revision;
            this.source_image = null;
            this.source_name = level.source_name;
            this.using_stored_mask = true;

            this.elements.level_number_input.value =
                String(level.number);
            this.elements.level_name_input.value =
                level.name;
            this.elements.grid_size.value =
                String(level.columns);
            this.elements.grid_size_output.value =
                `${level.columns} × ${level.rows}`;
            this.elements.white_majority.value =
                String(
                    Math.round(
                        (
                            Number(
                                level.settings
                                    .white_majority
                            ) || 0.5
                        ) * 100
                    )
                );
            this.elements.white_majority_output.value =
                `${this.elements.white_majority.value}%`;
            this.elements.pipe_length.value =
                String(
                    Number(
                        level.settings
                            .length_setting
                    ) || 0
                );
            this.elements.pipe_length_output.value =
                LENGTH_LABELS[
                    Number(
                        this.elements.pipe_length.value
                    )
                ];
            this.elements.nesting.value =
                String(
                    Math.max(
                        0,
                        Math.min(
                            3,
                            Number(level.settings.nesting) || 0
                        )
                    )
                );
            this.elements.nesting_output.value =
                NESTING_LABELS[
                    Number(this.elements.nesting.value)
                ];
            this.elements.seed_input.value =
                String(
                    Number(
                        level.settings
                            .requested_seed ??
                        level.settings.seed
                    ) || 1
                );
            this.draw_quantized_source();
            this.update_palette_preview();
            this.elements.source_name_text.textContent =
                `${this.source_name} · ${level.mask.reduce((total, value) => total + value, 0).toLocaleString()} occupied pixels · ${this.current_palette.length}-colour palette restored`;

            this.start_test_session();
            this.update_overwrite_notice();
            this.update_library_selection();
        }

        async delete_level() {
            this.set_status(
                "This standalone creator does not maintain a level library."
            );
        }

        set_controls_disabled(disabled) {
            this.elements.generate_button.disabled =
                disabled;
            this.elements.export_button.disabled =
                disabled;
            this.elements.grid_size.disabled =
                disabled;
            this.elements.white_majority.disabled =
                disabled;
            this.elements.pipe_length.disabled =
                disabled;
            this.elements.nesting.disabled =
                disabled;
            this.elements.seed_input.disabled =
                disabled;
            this.elements.image_input.disabled =
                disabled;
        }

        set_status(message) {
            this.elements.editor_status.textContent =
                message;
        }
    }

    const elements = {
        editor_canvas:
            document.getElementById("editor_canvas"),
        source_canvas:
            document.getElementById("source_canvas"),
        image_input:
            document.getElementById("image_input"),
        import_input:
            document.getElementById("import_input"),
        default_image_button:
            document.getElementById(
                "default_image_button"
            ),
        source_name_text:
            document.getElementById(
                "source_name_text"
            ),
        palette_preview:
            document.getElementById(
                "palette_preview"
            ),
        quantization_overlay:
            document.getElementById("quantization_overlay"),
        quantization_source_name:
            document.getElementById("quantization_source_name"),
        quantization_auto_summary:
            document.getElementById("quantization_auto_summary"),
        quantization_auto_button:
            document.getElementById("quantization_auto_button"),
        quantization_color_count:
            document.getElementById("quantization_color_count"),
        quantization_color_rows:
            Array.from(document.querySelectorAll(".quantization_color_row")),
        quantization_color_inputs:
            Array.from(document.querySelectorAll(".quantization_color_input")),
        quantization_hex_inputs:
            Array.from(document.querySelectorAll(".quantization_hex_input")),
        quantization_empty_inputs:
            Array.from(document.querySelectorAll(".quantization_empty_input")),
        quantization_preview_canvas:
            document.getElementById("quantization_preview_canvas"),
        quantization_effective_count:
            document.getElementById("quantization_effective_count"),
        quantization_mode_badge:
            document.getElementById("quantization_mode_badge"),
        quantization_apply_button:
            document.getElementById("quantization_apply_button"),
        quantization_cancel_button:
            document.getElementById("quantization_cancel_button"),
        level_number_input:
            document.getElementById(
                "level_number_input"
            ),
        level_name_input:
            document.getElementById(
                "level_name_input"
            ),
        overwrite_notice:
            document.getElementById(
                "overwrite_notice"
            ),
        grid_size:
            document.getElementById("grid_size"),
        grid_size_output:
            document.getElementById(
                "grid_size_output"
            ),
        white_majority:
            document.getElementById(
                "white_majority"
            ),
        white_majority_output:
            document.getElementById(
                "white_majority_output"
            ),
        pipe_length:
            document.getElementById(
                "pipe_length"
            ),
        pipe_length_output:
            document.getElementById(
                "pipe_length_output"
            ),
        nesting:
            document.getElementById("nesting"),
        nesting_output:
            document.getElementById(
                "nesting_output"
            ),
        seed_input:
            document.getElementById("seed_input"),
        random_seed_button:
            document.getElementById(
                "random_seed_button"
            ),
        generate_button:
            document.getElementById(
                "generate_button"
            ),
        export_button:
            document.getElementById(
                "export_button"
            ),
        delete_button:
            document.getElementById(
                "delete_button"
            ),
        reset_test_button:
            document.getElementById(
                "reset_test_button"
            ),
        hint_button:
            document.getElementById("hint_button"),
        show_mask:
            document.getElementById("show_mask"),
        loading_overlay:
            document.getElementById(
                "loading_overlay"
            ),
        editor_status:
            document.getElementById(
                "editor_status"
            ),
        server_badge:
            document.getElementById(
                "server_badge"
            ),
        level_library_list:
            document.getElementById(
                "level_library_list"
            ),
        refresh_library_button:
            document.getElementById(
                "refresh_library_button"
            ),
        valid_cell_count:
            document.getElementById(
                "valid_cell_count"
            ),
        pipe_count:
            document.getElementById("pipe_count"),
        open_count:
            document.getElementById("open_count"),
        depth_count:
            document.getElementById("depth_count")
    };

    new LevelEditorApplication(elements);
})();
