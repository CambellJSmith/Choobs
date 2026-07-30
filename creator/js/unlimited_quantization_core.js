(() => {
    "use strict";

    const MAX_TARGETS = 2500;
    const DEFAULT_COLORS = [
        "#ff5c7a", "#ffd166", "#4dd6a8", "#5b9dff", "#b983ff"
    ];

    function normalize_color(value, fallback = DEFAULT_COLORS[0]) {
        const color = String(value || "").trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
    }

    function normalize_targets(raw_targets) {
        const targets = [];
        const source = Array.isArray(raw_targets) ? raw_targets : [];

        for (const raw_target of source) {
            const object_target =
                raw_target && typeof raw_target === "object";
            const color = normalize_color(
                object_target ? raw_target.color : raw_target
            );
            const is_empty =
                object_target && Boolean(raw_target.is_empty);

            if (!targets.some((target) =>
                target.color === color &&
                target.is_empty === is_empty
            )) {
                targets.push({ color, is_empty });
            }

            if (targets.length >= MAX_TARGETS) {
                break;
            }
        }

        return targets.length > 0 ? targets : [{
            color: DEFAULT_COLORS[0],
            is_empty: false
        }];
    }

    function color_distance_squared(left, right) {
        const red = left.r - right.r;
        const green = left.g - right.g;
        const blue = left.b - right.b;
        return red * red + green * green + blue * blue;
    }

    function rgb_to_hex(color) {
        const channel = (value) =>
            Math.max(0, Math.min(255, Math.round(value)))
                .toString(16)
                .padStart(2, "0");
        return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
    }

    function detect_palette(analysis, requested_count) {
        const buckets =
            analysis && Array.isArray(analysis.buckets) ?
                analysis.buckets :
                [];
        const maximum = Math.max(
            1,
            Math.min(
                MAX_TARGETS,
                Math.floor(Number(requested_count) || 5),
                buckets.length || 1
            )
        );

        if (buckets.length === 0) {
            return DEFAULT_COLORS.slice(0, maximum);
        }

        const selected = [];
        const minimum_distance = 12 * 12;

        for (const bucket of buckets) {
            if (!selected.some((color) =>
                color_distance_squared(color, bucket) < minimum_distance
            )) {
                selected.push({
                    r: bucket.r,
                    g: bucket.g,
                    b: bucket.b
                });
            }

            if (selected.length >= maximum) {
                break;
            }
        }

        if (selected.length < maximum) {
            for (const bucket of buckets) {
                if (!selected.some((color) =>
                    color_distance_squared(color, bucket) < 1
                )) {
                    selected.push({
                        r: bucket.r,
                        g: bucket.g,
                        b: bucket.b
                    });
                }

                if (selected.length >= maximum) {
                    break;
                }
            }
        }

        return selected.map(rgb_to_hex);
    }

    function build_dynamic_controls(app) {
        const controls = document.querySelector(".quantization_controls");

        if (!controls) {
            return false;
        }

        controls.replaceChildren();

        const auto_row = document.createElement("div");
        auto_row.className = "quantization_auto_row";

        const auto_copy = document.createElement("div");
        const auto_title = document.createElement("strong");
        auto_title.textContent = "Automatic selection";
        const auto_summary = document.createElement("p");
        auto_summary.id = "quantization_auto_summary";
        auto_summary.textContent = "Auto detected five meaningful colours.";
        auto_copy.append(auto_title, auto_summary);

        const auto_controls = document.createElement("div");
        auto_controls.className = "quantization_auto_controls";
        const auto_label = document.createElement("label");
        auto_label.htmlFor = "quantization_auto_count";
        auto_label.textContent = "colours";
        const auto_count = document.createElement("input");
        auto_count.id = "quantization_auto_count";
        auto_count.type = "number";
        auto_count.min = "1";
        auto_count.max = String(MAX_TARGETS);
        auto_count.value = "5";
        auto_count.inputMode = "numeric";
        const auto_button = document.createElement("button");
        auto_button.id = "quantization_auto_button";
        auto_button.className = "secondary_button";
        auto_button.type = "button";
        auto_button.textContent = "Detect colours";
        auto_controls.append(auto_label, auto_count, auto_button);
        auto_row.append(auto_copy, auto_controls);

        const color_list = document.createElement("div");
        color_list.id = "quantization_color_list";
        color_list.className = "quantization_color_list";
        color_list.setAttribute("aria-label", "Target colours");

        const list_actions = document.createElement("div");
        list_actions.className = "quantization_list_actions";
        const add_button = document.createElement("button");
        add_button.id = "quantization_add_button";
        add_button.className = "secondary_button";
        add_button.type = "button";
        add_button.textContent = "Add target colour";
        const count_text = document.createElement("span");
        count_text.id = "quantization_target_count";
        count_text.className = "quantization_target_count";
        count_text.textContent = "0 targets";
        list_actions.append(add_button, count_text);

        const help = document.createElement("p");
        help.className = "field_help";
        help.textContent =
            "Each row is an exact target. Reorder rows to control " +
            "tie-breaking, mark colours as empty to remove those pixels, " +
            "or add up to one target per source pixel.";

        controls.append(auto_row, color_list, list_actions, help);

        app.elements.quantization_auto_summary = auto_summary;
        app.elements.quantization_auto_button = auto_button;
        app.elements.quantization_auto_count = auto_count;
        app.elements.quantization_color_list = color_list;
        app.elements.quantization_add_button = add_button;
        app.elements.quantization_target_count = count_text;
        return true;
    }

    function install(app) {
        if (!build_dynamic_controls(app)) {
            return false;
        }

        app.create_quantization_color_row = function (
            raw_target,
            index
        ) {
            const target = normalize_targets([raw_target])[0];
            const row = document.createElement("div");
            row.className = "quantization_color_row";

            const target_label = document.createElement("label");
            target_label.className = "quantization_target_label";

            const color_input = document.createElement("input");
            color_input.className = "quantization_color_input";
            color_input.type = "color";
            color_input.value = target.color;

            const hex_input = document.createElement("input");
            hex_input.className = "quantization_hex_input";
            hex_input.type = "text";
            hex_input.maxLength = 7;
            hex_input.value = target.color;

            const empty_label = document.createElement("label");
            empty_label.className = "quantization_empty_toggle";
            const empty_input = document.createElement("input");
            empty_input.className = "quantization_empty_input";
            empty_input.type = "checkbox";
            empty_input.checked = Boolean(target.is_empty);
            empty_label.append(
                empty_input,
                document.createTextNode(" empty")
            );

            const actions = document.createElement("div");
            actions.className = "quantization_row_actions";

            for (const [action, text, label] of [
                ["up", "↑", "Move target up"],
                ["down", "↓", "Move target down"],
                ["remove", "remove", "Remove target"]
            ]) {
                const button = document.createElement("button");
                button.type = "button";
                button.className =
                    "secondary_button compact_button";
                button.dataset.quantAction = action;
                button.textContent = text;
                button.setAttribute("aria-label", label);
                actions.append(button);
            }

            row.append(
                target_label,
                color_input,
                hex_input,
                empty_label,
                actions
            );
            this.configure_quantization_color_row(row, index);
            return row;
        };

        app.configure_quantization_color_row = function (
            row,
            index
        ) {
            const number = index + 1;
            const target_label = row.querySelector(
                ".quantization_target_label"
            );
            const color_input = row.querySelector(
                ".quantization_color_input"
            );
            const hex_input = row.querySelector(
                ".quantization_hex_input"
            );
            const color_id = `quantization_color_${number}`;

            target_label.textContent = `Target ${number}`;
            target_label.htmlFor = color_id;
            color_input.id = color_id;
            color_input.dataset.quantIndex = String(index);
            hex_input.dataset.quantIndex = String(index);
            hex_input.setAttribute(
                "aria-label",
                `Target ${number} hexadecimal value`
            );
            row.dataset.quantIndex = String(index);
        };

        app.apply_palette_to_quantization_controls = function (
            raw_targets,
            mark_auto = false
        ) {
            const targets = normalize_targets(raw_targets);
            const fragment = document.createDocumentFragment();

            targets.forEach((target, index) => {
                fragment.append(
                    this.create_quantization_color_row(
                        target,
                        index
                    )
                );
            });

            this.elements.quantization_color_list.replaceChildren(
                fragment
            );
            this.elements.quantization_mode_badge.textContent =
                mark_auto ?
                    "Automatic palette" :
                    "Custom palette";
            this.update_quantization_color_rows();
            this.render_quantization_preview();
        };

        app.get_quantization_targets_from_controls = function () {
            return normalize_targets(
                Array.from(
                    this.elements.quantization_color_list
                        .querySelectorAll(
                            ".quantization_color_row"
                        )
                ).map((row) => ({
                    color: row.querySelector(
                        ".quantization_color_input"
                    ).value,
                    is_empty: Boolean(
                        row.querySelector(
                            ".quantization_empty_input"
                        ).checked
                    )
                }))
            );
        };

        app.add_quantization_target = function (
            raw_target = null
        ) {
            const rows =
                this.elements.quantization_color_list
                    .querySelectorAll(
                        ".quantization_color_row"
                    );

            if (rows.length >= MAX_TARGETS) {
                return;
            }

            const target = raw_target || {
                color: DEFAULT_COLORS[
                    rows.length % DEFAULT_COLORS.length
                ],
                is_empty: false
            };
            const row = this.create_quantization_color_row(
                target,
                rows.length
            );
            this.elements.quantization_color_list.append(row);
            this.update_quantization_color_rows();
            this.render_quantization_preview();
            row.querySelector(
                ".quantization_hex_input"
            ).focus();
        };

        app.update_quantization_color_rows = function () {
            const rows = Array.from(
                this.elements.quantization_color_list
                    .querySelectorAll(
                        ".quantization_color_row"
                    )
            );

            rows.forEach((row, index) => {
                this.configure_quantization_color_row(
                    row,
                    index
                );
                const empty = row.querySelector(
                    ".quantization_empty_input"
                ).checked;
                row.classList.toggle(
                    "quantization_color_row_empty",
                    empty
                );
                row.querySelector(
                    '[data-quant-action="up"]'
                ).disabled = index === 0;
                row.querySelector(
                    '[data-quant-action="down"]'
                ).disabled = index === rows.length - 1;
                row.querySelector(
                    '[data-quant-action="remove"]'
                ).disabled = rows.length === 1;
            });

            this.elements.quantization_add_button.disabled =
                rows.length >= MAX_TARGETS;
            this.elements.quantization_target_count.textContent =
                `${rows.length.toLocaleString()} ` +
                `${rows.length === 1 ? "target" : "targets"}`;

            const targets =
                this.get_quantization_targets_from_controls();
            const auto_matches =
                targets.length ===
                    this.pending_auto_palette.length &&
                targets.every((target, index) =>
                    !target.is_empty &&
                    target.color ===
                        this.pending_auto_palette[index]
                );
            this.elements.quantization_mode_badge.textContent =
                auto_matches ?
                    "Automatic palette" :
                    "Custom palette";
        };

        app.elements.quantization_auto_button.addEventListener(
            "click",
            () => {
                if (!app.pending_image_analysis) {
                    return;
                }

                const requested_count = Math.max(
                    1,
                    Math.min(
                        MAX_TARGETS,
                        Math.floor(
                            Number(
                                app.elements
                                    .quantization_auto_count
                                    .value
                            ) || 5
                        )
                    )
                );
                app.elements.quantization_auto_count.value =
                    String(requested_count);
                app.pending_auto_palette = detect_palette(
                    app.pending_image_analysis,
                    requested_count
                );
                app.elements.quantization_auto_summary.textContent =
                    `Auto detected ` +
                    `${app.pending_auto_palette.length} meaningful ` +
                    `${app.pending_auto_palette.length === 1 ?
                        "colour" :
                        "colours"}.`;
                app.apply_palette_to_quantization_controls(
                    app.pending_auto_palette,
                    true
                );
            }
        );

        app.elements.quantization_add_button.addEventListener(
            "click",
            () => app.add_quantization_target()
        );

        app.elements.quantization_color_list.addEventListener(
            "input",
            (event) => {
                const input = event.target;

                if (input.classList.contains(
                    "quantization_color_input"
                )) {
                    const row = input.closest(
                        ".quantization_color_row"
                    );
                    row.querySelector(
                        ".quantization_hex_input"
                    ).value = input.value.toLowerCase();
                    app.update_quantization_color_rows();
                    app.render_quantization_preview();
                }
            }
        );

        app.elements.quantization_color_list.addEventListener(
            "change",
            (event) => {
                const input = event.target;
                const row = input.closest(
                    ".quantization_color_row"
                );

                if (!row) {
                    return;
                }

                if (input.classList.contains(
                    "quantization_hex_input"
                )) {
                    const color_input = row.querySelector(
                        ".quantization_color_input"
                    );
                    const normalized = normalize_color(
                        input.value,
                        color_input.value
                    );
                    input.value = normalized;
                    color_input.value = normalized;
                }

                if (
                    input.classList.contains(
                        "quantization_hex_input"
                    ) ||
                    input.classList.contains(
                        "quantization_empty_input"
                    )
                ) {
                    app.update_quantization_color_rows();
                    app.render_quantization_preview();
                }
            }
        );

        app.elements.quantization_color_list.addEventListener(
            "click",
            (event) => {
                const button = event.target.closest(
                    "[data-quant-action]"
                );

                if (!button) {
                    return;
                }

                const row = button.closest(
                    ".quantization_color_row"
                );
                const action = button.dataset.quantAction;

                if (
                    action === "up" &&
                    row.previousElementSibling
                ) {
                    row.parentElement.insertBefore(
                        row,
                        row.previousElementSibling
                    );
                } else if (
                    action === "down" &&
                    row.nextElementSibling
                ) {
                    row.parentElement.insertBefore(
                        row.nextElementSibling,
                        row
                    );
                } else if (
                    action === "remove" &&
                    row.parentElement.children.length > 1
                ) {
                    row.remove();
                } else {
                    return;
                }

                app.update_quantization_color_rows();
                app.render_quantization_preview();
            }
        );

        return true;
    }

    let attempts = 0;
    const wait_for_creator = () => {
        const app = globalThis.ChoobsCreatorApp;

        if (app && install(app)) {
            return;
        }

        attempts += 1;

        if (attempts < 200) {
            setTimeout(wait_for_creator, 25);
        }
    };

    wait_for_creator();
})();