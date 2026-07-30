(() => {
    "use strict";

    const GAME_SCRIPT_URL = (() => {
        const script = document.currentScript;
        const source = script && script.src ? script.src : "./js/game.js";
        return new URL(source, document.baseURI);
    })();
    const LEVEL_DIRECTORY_URL = new URL("../levels/", GAME_SCRIPT_URL);

    function get_level_file_url(level_number) {
        const file_number = String(level_number).padStart(3, "0");
        return new URL(`level_${file_number}.json`, LEVEL_DIRECTORY_URL);
    }

    class GameApplication {
        constructor(elements) {
            this.elements = elements;
            this.renderer = new ChoobsCanvasRenderer(elements.game_canvas);
            this.levels = [];
            this.imported_levels = [];
            this.manual_levels = new Map();
            this.procedural_levels = new Map();
            this.manual_file_checks = new Map();
            this.level_name_cache = this.load_level_name_cache();
            this.load_request_id = 0;
            this.level_index = -1;
            this.session = null;
            this.last_frame_time = performance.now();
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.hint_until = 0;
            this.blocked_pipe_id = -1;
            this.blocked_until = 0;
            this.blocker_pipe_id = -1;
            this.blocker_until = 0;
            this.needs_render = true;
            this.effects = [];
            this.effect_seed = 1;
            this.activation_metadata = new Map();
            this.intro_started = 0;
            this.completion_started = 0;
            this.completion_overlay_at = 0;
            this.completion_overlay_shown = false;
            this.last_interaction_time = performance.now();
            this.next_hint_time = this.last_interaction_time + 6500;
            this.reduced_motion = window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            this.completed_numbers = this.load_completed_numbers();
            this.game_mode = this.load_game_mode();
            this.invalid_attempts = 0;
            this.penalty_at = 0;
            this.penalty_type = null;
            this.pointer_gesture = null;
            this.active_board_pointers = new Map();
            this.board_touch_gesture = null;
            this.last_two_finger_tap_at = 0;
            this.last_two_finger_tap_point = null;
            this.pending_autosave = this.load_autosave();
            this.autosave_restored = false;
            this.is_paused = false;
            this.pause_started_at = 0;
            this.allow_history_exit = false;
            this.history_guard_ready = false;

            const score_state = this.load_score_state();
            this.run_score = score_state.run_score;
            this.level_score_start = score_state.level_score_start;
            this.score_level_number = score_state.level_number;
            this.best_combo = score_state.best_combo;
            this.combo_count = 0;
            this.combo_deadline = 0;
            this.combo_window_ms = 0;
            this.last_level_points = 0;

            this.install_events();
            this.setup_back_button_intercept();
            this.update_mode_ui();
            this.update_pause_menu();
            this.update_score_ui();

            if (!this.game_mode) {
                this.show_mode_overlay();
            }

            this.load_levels();
            requestAnimationFrame((time) => this.frame(time));
        }

        install_events() {
            for (const button of this.elements.mode_buttons) {
                button.addEventListener("click", () => {
                    this.select_game_mode(button.dataset.mode);
                });
            }

            for (const button of this.elements.pause_mode_buttons) {
                button.addEventListener("click", () => {
                    this.change_game_mode(button.dataset.pauseMode);
                });
            }

            this.elements.menu_button.addEventListener("click", () => {
                this.open_pause_menu();
            });

            this.elements.resume_button.addEventListener("click", () => {
                this.close_pause_menu();
            });

            this.elements.restart_menu_button.addEventListener("click", () => {
                this.close_pause_menu();
                this.restart_level();
            });

            this.elements.reset_game_button.addEventListener("click", () => {
                this.show_reset_confirmation();
            });

            this.elements.cancel_reset_button.addEventListener("click", () => {
                this.hide_reset_confirmation();
            });

            this.elements.confirm_reset_button.addEventListener("click", () => {
                this.reset_game();
            });

            this.elements.close_app_button.addEventListener("click", () => {
                this.close_application();
            });

            this.elements.return_to_game_button.addEventListener("click", () => {
                this.return_from_close_screen();
            });

            this.elements.pause_overlay.addEventListener("pointerdown", (event) => {
                if (event.target === this.elements.pause_overlay) {
                    this.close_pause_menu();
                }
            });

            window.addEventListener("resize", () => {
                this.renderer.resize();
                this.center_board_view();
                this.needs_render = true;
            });

            this.elements.level_select.addEventListener("change", () => {
                this.register_interaction();
                this.load_level_number(Number(this.elements.level_select.value));
            });

            this.elements.continue_button.addEventListener("click", () => {
                this.register_interaction();
                this.hide_win_overlay();
                this.load_next_level();
            });

            this.elements.replay_button.addEventListener("click", () => {
                this.register_interaction();
                this.hide_win_overlay();
                this.restart_level();
            });

            this.elements.level_import_input.addEventListener(
                "change",
                (event) => this.import_level_files(event)
            );

            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();

                    if (!this.elements.close_overlay.classList.contains("hidden")) {
                        this.return_from_close_screen();
                    } else if (!this.elements.reset_confirmation.classList.contains("hidden")) {
                        this.hide_reset_confirmation();
                    } else if (this.is_paused) {
                        this.close_pause_menu();
                    } else {
                        this.open_pause_menu();
                    }

                    return;
                }

                if (event.altKey && event.key.toLowerCase() === "i") {
                    event.preventDefault();
                    this.elements.level_import_input.click();
                }
            });

            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") {
                    this.save_current_progress("visibilitychange");
                }
            });
            window.addEventListener("pagehide", () => {
                this.save_current_progress("pagehide");
            });
            window.addEventListener("beforeunload", () => {
                this.save_current_progress("beforeunload");
            });

            document.addEventListener("dragover", (event) => {
                if (this.has_json_files(event.dataTransfer)) {
                    event.preventDefault();
                }
            });

            document.addEventListener("drop", (event) => {
                if (!this.has_json_files(event.dataTransfer)) {
                    return;
                }

                event.preventDefault();
                this.import_level_files({
                    currentTarget: {
                        files: event.dataTransfer.files,
                        value: ""
                    }
                });
            });

            this.elements.board_stage.addEventListener("pointermove", (event) => {
                this.handle_board_pointer_move(event);
            });

            this.elements.game_canvas.addEventListener("pointerleave", (event) => {
                if (event.pointerType === "mouse") {
                    this.hovered_pipe_id = -1;
                    this.hovered_pipe_is_clear = false;
                    this.elements.game_canvas.style.cursor = "default";
                    this.needs_render = true;
                }
            });

            this.elements.board_stage.addEventListener("pointerdown", (event) => {
                this.handle_board_pointer_start(event);
            });

            this.elements.board_stage.addEventListener("pointerup", (event) => {
                this.handle_board_pointer_end(event, false);
            });

            this.elements.board_stage.addEventListener("pointercancel", (event) => {
                this.handle_board_pointer_end(event, true);
            });

            this.elements.board_stage.addEventListener("lostpointercapture", (event) => {
                if (event.pointerType !== "mouse" &&
                    this.active_board_pointers.has(event.pointerId)) {
                    this.handle_board_pointer_end(event, true);
                }
            });

            this.elements.game_canvas.addEventListener("contextmenu", (event) => {
                event.preventDefault();
            });
        }

        setup_back_button_intercept() {
            window.addEventListener("popstate", () => {
                if (this.allow_history_exit) {
                    return;
                }

                if (this.is_paused) {
                    this.close_pause_menu();
                } else {
                    this.open_pause_menu();
                }

                this.rearm_history_guard();
            });

            try {
                const url = this.get_current_history_url();

                if (history.state && history.state.choobs_pause_guard) {
                    history.replaceState({ choobs_pause_guard: true }, "", url);
                } else {
                    history.replaceState({ choobs_pause_base: true }, "", url);
                    history.pushState({ choobs_pause_guard: true }, "", url);
                }

                this.history_guard_ready = true;
            } catch (error) {
                this.history_guard_ready = false;
            }
        }

        get_current_history_url() {
            const url = new URL(window.location.href);

            if (this.level_index >= 0 && this.levels[this.level_index]) {
                url.searchParams.set(
                    "level",
                    String(this.levels[this.level_index].number)
                );
            }

            return url;
        }

        rearm_history_guard() {
            if (!this.history_guard_ready || this.allow_history_exit ||
                history.state && history.state.choobs_pause_guard) {
                return;
            }

            try {
                history.pushState(
                    { choobs_pause_guard: true },
                    "",
                    this.get_current_history_url()
                );
            } catch (error) {
                this.history_guard_ready = false;
            }
        }

        open_pause_menu() {
            if (!this.game_mode || this.is_paused ||
                !this.elements.mode_overlay.classList.contains("hidden")) {
                return;
            }

            this.save_current_progress("pause_open");
            this.is_paused = true;
            this.pause_started_at = performance.now();
            this.pointer_gesture = null;
            this.hide_reset_confirmation();
            this.update_pause_menu();
            this.elements.pause_overlay.classList.remove("hidden");
            this.elements.pause_overlay.setAttribute("aria-hidden", "false");
            document.body.classList.add("menu_open");
            requestAnimationFrame(() => {
                this.elements.resume_button.focus({ preventScroll: true });
            });
        }

        close_pause_menu() {
            if (!this.is_paused) {
                return;
            }

            const now = performance.now();
            const paused_duration = Math.max(0, now - this.pause_started_at);
            this.shift_timers_for_pause(paused_duration);
            this.is_paused = false;
            this.pause_started_at = 0;
            this.elements.pause_overlay.classList.add("hidden");
            this.elements.pause_overlay.setAttribute("aria-hidden", "true");
            document.body.classList.remove("menu_open");
            this.last_frame_time = now;
            this.register_interaction();
            this.save_current_progress("pause_close");
            requestAnimationFrame(() => {
                this.elements.game_canvas.focus({ preventScroll: true });
            });
        }

        shift_timers_for_pause(duration) {
            if (duration <= 0) {
                return;
            }

            for (const property of [
                "penalty_at",
                "blocked_until",
                "blocker_until",
                "hint_until",
                "next_hint_time",
                "completion_overlay_at",
                "combo_deadline"
            ]) {
                if (this[property] > 0) {
                    this[property] += duration;
                }
            }

            if (this.intro_started > 0) {
                this.intro_started += duration;
            }

            if (this.completion_started > 0) {
                this.completion_started += duration;
            }

            for (const effect of this.effects) {
                effect.started += duration;
            }
        }

        update_pause_menu() {
            const level = this.level_index >= 0 ? this.levels[this.level_index] : null;
            this.elements.pause_level_badge.textContent = level ?
                `Level ${level.number}` :
                "No level";
            this.elements.pause_mode_name.textContent = this.get_mode_name();
            this.elements.pause_score_badge.textContent =
                `${this.format_score(this.run_score)} point${this.run_score === 1 ? "" : "s"}`;

            const descriptions = {
                freeplay: "No penalties. Experiment freely.",
                heartbeat: "Three blocked pipe taps restart the current level.",
                permadeath: "Three blocked pipe taps erase the run and return to level 1."
            };
            this.elements.pause_mode_description.textContent =
                descriptions[this.game_mode] || descriptions.freeplay;

            for (const button of this.elements.pause_mode_buttons) {
                const selected = button.dataset.pauseMode === this.game_mode;
                button.classList.toggle("is_selected", selected);
                button.setAttribute("aria-checked", String(selected));
            }

            this.elements.restart_menu_button.disabled = !this.session;
        }

        show_reset_confirmation() {
            this.elements.reset_confirmation.classList.remove("hidden");
            requestAnimationFrame(() => {
                this.elements.cancel_reset_button.focus({ preventScroll: true });
            });
        }

        hide_reset_confirmation() {
            this.elements.reset_confirmation.classList.add("hidden");
        }

        change_game_mode(mode) {
            if (!["freeplay", "heartbeat", "permadeath"].includes(mode)) {
                return;
            }

            this.game_mode = mode;
            this.reset_invalid_attempts();
            this.save_game_mode();
            this.update_mode_ui();
            this.update_pause_menu();
            this.save_current_progress("mode_change");
            this.set_status(`${this.get_mode_name()} mode selected.`);
        }

        async reset_game() {
            this.clear_autosave();
            this.completed_numbers.clear();
            this.save_completed_numbers();
            this.clear_autosave();
            this.procedural_levels.clear();
            this.game_mode = null;
            this.reset_run_score();
            this.invalid_attempts = 0;
            this.penalty_at = 0;
            this.penalty_type = null;

            try {
                localStorage.removeItem("choobs_game_mode");
            } catch (error) {
                console.warn("Game mode could not be cleared.", error);
            }

            this.is_paused = false;
            this.pause_started_at = 0;
            this.elements.pause_overlay.classList.add("hidden");
            this.elements.pause_overlay.setAttribute("aria-hidden", "true");
            document.body.classList.remove("menu_open");
            this.hide_reset_confirmation();
            this.hide_win_overlay();
            this.session = null;
            this.level_index = -1;
            this.effects.length = 0;
            this.activation_metadata.clear();
            this.update_mode_ui();
            this.update_pause_menu();
            this.elements.loading_overlay.classList.remove("hidden");
            await this.load_levels(1, false);
            this.show_mode_overlay();
            this.set_status("Game reset. Choose a new run.");
        }

        close_application() {
            this.save_current_progress("close_app");
            this.allow_history_exit = true;
            this.elements.pause_overlay.classList.add("hidden");
            this.elements.pause_overlay.setAttribute("aria-hidden", "true");
            this.elements.close_overlay.classList.remove("hidden");
            this.elements.close_overlay.setAttribute("aria-hidden", "false");
            document.body.classList.remove("menu_open");
            this.is_paused = true;

            try {
                window.close();
            } catch (error) {
                // Browsers commonly block closing tabs that were not script-opened.
            }

            window.setTimeout(() => {
                if (!document.hidden && history.length > 2) {
                    try {
                        history.go(-2);
                    } catch (error) {
                        // The saved confirmation remains visible as the fallback.
                    }
                }
            }, 80);
        }

        return_from_close_screen() {
            this.allow_history_exit = false;
            this.elements.close_overlay.classList.add("hidden");
            this.elements.close_overlay.setAttribute("aria-hidden", "true");
            this.is_paused = false;
            this.pause_started_at = 0;
            this.last_frame_time = performance.now();
            this.rearm_history_guard();
            requestAnimationFrame(() => {
                this.elements.game_canvas.focus({ preventScroll: true });
            });
        }

        register_interaction() {
            const time = performance.now();
            this.last_interaction_time = time;
            this.next_hint_time = time + 6500;
            this.hint_pipe_id = -1;
            this.hint_until = 0;
        }

        format_score(value) {
            return new Intl.NumberFormat("en-US", {
                maximumFractionDigits: 0
            }).format(Math.max(0, Math.floor(Number(value) || 0)));
        }

        load_score_state() {
            try {
                const saved = JSON.parse(
                    localStorage.getItem("choobs_score_state_v1") || "null"
                );

                if (!saved || saved.version !== 1) {
                    throw new Error("No compatible score state.");
                }

                return {
                    run_score: Math.max(0, Math.floor(Number(saved.run_score) || 0)),
                    level_score_start: Math.max(
                        0,
                        Math.floor(Number(saved.level_score_start) || 0)
                    ),
                    level_number: Math.max(0, Math.floor(Number(saved.level_number) || 0)),
                    best_combo: Math.max(0, Math.floor(Number(saved.best_combo) || 0))
                };
            } catch (error) {
                return {
                    run_score: 0,
                    level_score_start: 0,
                    level_number: 0,
                    best_combo: 0
                };
            }
        }

        save_score_state() {
            try {
                localStorage.setItem(
                    "choobs_score_state_v1",
                    JSON.stringify({
                        version: 1,
                        run_score: this.run_score,
                        level_score_start: this.level_score_start,
                        level_number: this.score_level_number,
                        best_combo: this.best_combo
                    })
                );
            } catch (error) {
                console.warn("Score could not be saved.", error);
            }
        }

        reset_run_score() {
            this.run_score = 0;
            this.level_score_start = 0;
            this.score_level_number = 0;
            this.best_combo = 0;
            this.last_level_points = 0;
            this.reset_combo(false);

            try {
                localStorage.removeItem("choobs_score_state_v1");
            } catch (error) {
                console.warn("Score could not be cleared.", error);
            }

            this.update_score_ui();
        }

        reset_combo(announce = false) {
            const had_combo = this.combo_count > 1;
            this.combo_count = 0;
            this.combo_deadline = 0;
            this.combo_window_ms = 0;
            this.update_combo_ui(performance.now());

            if (announce && had_combo) {
                this.set_status("Combo ended.");
            }
        }

        get_combo_window(combo) {
            return Math.max(760, 2400 - Math.max(0, combo - 1) * 80);
        }

        award_pipe_points(pipe, time, client_x, client_y) {
            if (!pipe || !Array.isArray(pipe.cells)) {
                return 0;
            }

            if (this.combo_count > 0 && time <= this.combo_deadline) {
                this.combo_count += 1;
            } else {
                this.combo_count = 1;
            }

            this.combo_window_ms = this.get_combo_window(this.combo_count);
            this.combo_deadline = time + this.combo_window_ms;
            this.best_combo = Math.max(this.best_combo, this.combo_count);

            const base_points = Math.max(1, pipe.cells.length);
            const awarded_points = base_points * this.combo_count;
            this.run_score += awarded_points;
            this.score_level_number = this.level_index >= 0 && this.levels[this.level_index] ?
                this.levels[this.level_index].number :
                this.score_level_number;

            this.update_score_ui(time);
            this.show_score_burst(
                awarded_points,
                this.combo_count,
                client_x,
                client_y
            );
            this.save_score_state();
            return awarded_points;
        }

        update_score_ui(time = performance.now()) {
            if (!this.elements.score_value) {
                return;
            }

            this.elements.score_value.textContent = this.format_score(this.run_score);
            this.elements.score_value.parentElement.classList.remove("is_bumping");
            void this.elements.score_value.parentElement.offsetWidth;
            this.elements.score_value.parentElement.classList.add("is_bumping");
            this.update_combo_ui(time);
            this.update_pause_menu();
        }

        update_combo_ui(time = performance.now()) {
            if (!this.elements.combo_hud) {
                return;
            }

            const active = this.combo_count > 1 && this.combo_deadline > time;
            this.elements.combo_hud.classList.toggle("hidden", !active);
            this.elements.combo_value.textContent = `×${Math.max(1, this.combo_count)}`;

            const remaining = active ? Math.max(0, this.combo_deadline - time) : 0;
            const progress = this.combo_window_ms > 0 ?
                Math.max(0, Math.min(1, remaining / this.combo_window_ms)) :
                0;
            this.elements.combo_fill.style.transform = `scaleX(${progress})`;
        }

        update_combo_timer(time) {
            if (this.combo_count <= 0) {
                return;
            }

            if (time >= this.combo_deadline) {
                this.reset_combo(false);
                return;
            }

            if (this.combo_count > 1) {
                this.update_combo_ui(time);
            }
        }

        show_score_burst(points, combo, client_x, client_y) {
            if (!this.elements.score_effects_layer ||
                !Number.isFinite(client_x) || !Number.isFinite(client_y)) {
                return;
            }

            const burst = document.createElement("div");
            burst.className = "score_burst";
            burst.style.left = `${client_x}px`;
            burst.style.top = `${client_y}px`;

            const amount = document.createElement("span");
            amount.textContent = `+${this.format_score(points)}`;
            burst.appendChild(amount);

            if (combo > 1) {
                const multiplier = document.createElement("small");
                multiplier.textContent = `×${combo} combo`;
                burst.appendChild(multiplier);
            }

            this.elements.score_effects_layer.appendChild(burst);
            window.setTimeout(() => burst.remove(), this.reduced_motion ? 80 : 820);
        }

        load_game_mode() {
            try {
                const mode = localStorage.getItem("choobs_game_mode");

                if (["freeplay", "heartbeat", "permadeath"].includes(mode)) {
                    return mode;
                }
            } catch (error) {
                console.warn("Game mode could not be loaded.", error);
            }

            return null;
        }

        save_game_mode() {
            try {
                localStorage.setItem("choobs_game_mode", this.game_mode);
            } catch (error) {
                console.warn("Game mode could not be saved.", error);
            }
        }

        select_game_mode(mode) {
            if (!["freeplay", "heartbeat", "permadeath"].includes(mode)) {
                return;
            }

            this.game_mode = mode;
            this.invalid_attempts = 0;
            this.penalty_at = 0;
            this.penalty_type = null;
            this.save_game_mode();
            this.update_mode_ui();
            this.update_pause_menu();
            this.hide_mode_overlay();
            this.register_interaction();
            this.save_current_progress("mode_selected");
            this.set_status(`${this.get_mode_name()} mode selected.`);
            requestAnimationFrame(() => {
                this.elements.game_canvas.focus({ preventScroll: true });
            });
        }

        get_mode_name() {
            if (this.game_mode === "heartbeat") {
                return "Heartbeat";
            }

            if (this.game_mode === "permadeath") {
                return "Permadeath";
            }

            return "Freeplay";
        }

        show_mode_overlay() {
            this.elements.mode_overlay.classList.remove("hidden");
            requestAnimationFrame(() => {
                const first_button = this.elements.mode_buttons[0];

                if (first_button) {
                    first_button.focus({ preventScroll: true });
                }
            });
        }

        hide_mode_overlay() {
            this.elements.mode_overlay.classList.add("hidden");
        }

        reset_invalid_attempts() {
            this.invalid_attempts = 0;
            this.penalty_at = 0;
            this.penalty_type = null;
            this.elements.canvas_frame.classList.remove("is-failing");
            this.update_mode_ui();
        }

        update_mode_ui() {
            const uses_attempts =
                this.game_mode === "heartbeat" ||
                this.game_mode === "permadeath";
            const remaining = Math.max(0, 3 - this.invalid_attempts);

            this.elements.heartbeat_meter.classList.toggle(
                "hidden",
                !uses_attempts
            );
            const consequence = this.game_mode === "permadeath" ?
                "run reset" :
                "level reset";

            this.elements.heartbeat_meter.setAttribute(
                "aria-label",
                `${remaining} blocked pipe tap${remaining === 1 ? "" : "s"} remaining before ${consequence}`
            );

            for (let index = 0; index < this.elements.hearts.length; index += 1) {
                this.elements.hearts[index].classList.toggle(
                    "is_lost",
                    index < this.invalid_attempts
                );
            }
        }

        register_invalid_activation(time) {
            if (this.game_mode === "freeplay" || !this.game_mode) {
                this.set_status("That pipe cannot move yet.");
                return;
            }

            this.invalid_attempts = Math.min(3, this.invalid_attempts + 1);
            this.update_mode_ui();
            this.elements.heartbeat_meter.classList.remove("is_hit");
            void this.elements.heartbeat_meter.offsetWidth;
            this.elements.heartbeat_meter.classList.add("is_hit");

            if (this.invalid_attempts < 3) {
                const remaining = 3 - this.invalid_attempts;
                this.set_status(
                    `${remaining} safe attempt${remaining === 1 ? "" : "s"} remaining.`
                );
                return;
            }

            this.penalty_type = this.game_mode;
            this.penalty_at = time + (this.reduced_motion ? 0 : 620);
            this.elements.canvas_frame.classList.add("is-failing");
            this.vibrate([30, 35, 30, 35, 60]);
            this.set_status(
                this.game_mode === "permadeath" ?
                    "Run lost. Returning to level 1." :
                    "Heartbeat lost. Resetting the level."
            );
        }

        apply_failure_penalty() {
            const penalty_type = this.penalty_type;
            this.penalty_at = 0;
            this.penalty_type = null;

            if (penalty_type === "heartbeat") {
                this.restart_level("Level reset after three blocked pipes.");
                return;
            }

            if (penalty_type !== "permadeath") {
                this.reset_invalid_attempts();
                return;
            }

            this.completed_numbers.clear();
            this.save_completed_numbers();
            this.reset_run_score();
            this.procedural_levels.clear();
            this.session = null;
            this.level_index = -1;
            this.effects.length = 0;
            this.activation_metadata.clear();
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hide_win_overlay();
            this.reset_invalid_attempts();
            this.elements.loading_overlay.classList.remove("hidden");
            this.load_levels(1, false);
            this.set_status("Permadeath run restarted from level 1.");
        }

        has_json_files(data_transfer) {
            if (!data_transfer || !data_transfer.files) {
                return false;
            }

            return Array.from(data_transfer.files).some((file) => {
                return file.name.toLowerCase().endsWith(".json");
            });
        }

        async load_levels(preferred_number = null, reload_imported = true) {
            const bundled_levels = Array.from(window.CHOOBS_LEVELS || []);
            this.manual_file_checks.clear();

            if (reload_imported) {
                this.imported_levels = this.load_imported_levels();
            }

            try {
                const merged = new Map();

                for (const raw_level of bundled_levels) {
                    const level = Choobs.normalize_level(raw_level);
                    merged.set(level.number, level);
                }

                for (const raw_level of this.imported_levels) {
                    const level = Choobs.normalize_level(raw_level);
                    merged.set(level.number, level);
                }

                this.manual_levels = merged;
            } catch (error) {
                console.error(error);
                this.set_status("The level library could not be loaded.");
                return;
            }

            const query_value = Number(
                new URLSearchParams(window.location.search).get("level")
            );
            const autosave_value = Number(
                this.pending_autosave && this.pending_autosave.level_number
            );
            const preferred_value = Number(preferred_number);
            const requested_number = Number.isInteger(preferred_value) &&
                preferred_value >= 1 ?
                    preferred_value :
                    Number.isInteger(autosave_value) && autosave_value >= 1 ?
                        autosave_value :
                        Number.isInteger(query_value) && query_value >= 1 ?
                            query_value :
                            null;
            const resume_number = this.get_resume_level_number();
            const manual_numbers = Array.from(this.manual_levels.keys());
            const highest_manual_number = manual_numbers.length > 0 ?
                Math.max(...manual_numbers) :
                1;
            const frontier = Math.max(
                1,
                highest_manual_number,
                resume_number,
                requested_number || 1
            );

            this.rebuild_level_entries(frontier);
            this.populate_level_select();
            this.elements.loading_overlay.classList.add("hidden");

            const target_number = requested_number !== null &&
                this.is_level_number_unlocked(requested_number) ?
                    requested_number :
                    resume_number;

            const name_prefetch = this.preload_level_names(target_number);
            await this.load_level_number(target_number);
            void name_prefetch;
        }

        get_resume_level_number() {
            let level_number = 1;

            while (this.completed_numbers.has(level_number)) {
                level_number += 1;
            }

            return level_number;
        }

        is_level_number_unlocked(level_number) {
            return level_number >= 1 &&
                level_number <= this.get_resume_level_number();
        }

        create_level_entry(level_number) {
            const manual_level = this.manual_levels.get(level_number);

            if (manual_level) {
                return manual_level;
            }

            const procedural_level = this.procedural_levels.get(level_number);

            if (procedural_level) {
                return procedural_level;
            }

            return {
                number: level_number,
                name: this.level_name_cache.get(level_number) ||
                    `Level ${level_number}`,
                procedural_placeholder: true
            };
        }

        rebuild_level_entries(frontier) {
            const maximum_number = Math.max(1, Math.floor(Number(frontier) || 1));
            this.levels = [];

            for (let level_number = 1; level_number <= maximum_number; level_number += 1) {
                this.levels.push(this.create_level_entry(level_number));
            }
        }

        ensure_level_entry(level_number) {
            const normalized_number = Math.max(
                1,
                Math.floor(Number(level_number) || 1)
            );

            while (this.levels.length < normalized_number) {
                this.levels.push(
                    this.create_level_entry(this.levels.length + 1)
                );
            }

            const index = normalized_number - 1;
            const manual_level = this.manual_levels.get(normalized_number);

            if (manual_level) {
                this.levels[index] = manual_level;
            } else if (this.procedural_levels.has(normalized_number)) {
                this.levels[index] = this.procedural_levels.get(normalized_number);
            }

            return index;
        }

        async try_load_manual_level_file(level_number) {
            if (this.manual_file_checks.has(level_number)) {
                return this.manual_file_checks.get(level_number);
            }

            if (window.location.protocol === "file:") {
                this.manual_file_checks.set(level_number, Promise.resolve(null));
                return null;
            }

            const request = (async () => {
                const file_number = String(level_number).padStart(3, "0");
                const level_url = get_level_file_url(level_number);
                const response = await fetch(level_url.href, {
                    cache: "no-store"
                });

                if (!response.ok) {
                    return null;
                }

                const level = Choobs.normalize_level(await response.json());

                if (level.number !== level_number) {
                    throw new Error(
                        `Level file ${file_number} contains level ${level.number}.`
                    );
                }

                this.manual_levels.set(level_number, level);
                this.remember_level_name(level);
                return level;
            })().catch((error) => {
                if (!(error instanceof TypeError)) {
                    console.warn(
                        `Manual level ${level_number} could not be loaded from ` +
                        `${get_level_file_url(level_number).href}.`,
                        error
                    );
                }

                return null;
            });

            this.manual_file_checks.set(level_number, request);
            return request;
        }

        async preload_level_names(preferred_number = null) {
            const preferred = Math.max(
                1,
                Math.floor(Number(preferred_number) || 1)
            );
            const candidates = this.levels
                .filter((entry) => {
                    return entry && entry.procedural_placeholder &&
                        this.is_level_number_unlocked(entry.number) &&
                        !this.level_name_cache.has(entry.number);
                })
                .map((entry) => entry.number);
            const preferred_index = candidates.indexOf(preferred);

            if (preferred_index > 0) {
                candidates.splice(preferred_index, 1);
                candidates.unshift(preferred);
            }

            if (candidates.length === 0) {
                return;
            }

            let next_candidate = 0;
            const worker = async () => {
                while (next_candidate < candidates.length) {
                    const level_number = candidates[next_candidate];
                    next_candidate += 1;
                    const level = await this.try_load_manual_level_file(
                        level_number
                    );

                    if (!level) {
                        continue;
                    }

                    const index = level_number - 1;

                    if (this.levels[index] &&
                        this.levels[index].number === level_number) {
                        this.levels[index] = level;
                    }

                    this.populate_level_select();
                }
            };
            const worker_count = Math.min(4, candidates.length);

            await Promise.all(
                Array.from({ length: worker_count }, () => worker())
            );
        }

        async resolve_level(index) {
            const entry = this.levels[index];

            if (!entry) {
                throw new Error("The requested level does not exist.");
            }

            const level_number = entry.number;
            const imported_level = this.imported_levels.find((level) => {
                return level.number === level_number;
            });

            if (imported_level) {
                this.levels[index] = imported_level;
                return imported_level;
            }

            const folder_level = await this.try_load_manual_level_file(level_number);

            if (folder_level) {
                this.levels[index] = folder_level;
                return folder_level;
            }

            const bundled_level = this.manual_levels.get(level_number);

            if (bundled_level) {
                this.levels[index] = bundled_level;
                return bundled_level;
            }

            const cached_level = this.procedural_levels.get(level_number);

            if (cached_level) {
                this.levels[index] = cached_level;
                return cached_level;
            }

            await new Promise((resolve) => requestAnimationFrame(resolve));
            const generated_level = ChoobsProceduralLevels.generate(level_number);
            this.procedural_levels.set(level_number, generated_level);
            this.levels[index] = generated_level;
            return generated_level;
        }

        load_level_name_cache() {
            try {
                const raw = JSON.parse(
                    localStorage.getItem("choobs_level_name_cache_v1") || "{}"
                );
                const cache = new Map();

                if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                    return cache;
                }

                for (const [number_text, name_value] of Object.entries(raw)) {
                    const level_number = Number(number_text);
                    const level_name = String(name_value || "").trim();

                    if (Number.isInteger(level_number) && level_number >= 1 &&
                        level_name && level_name !== `Level ${level_number}`) {
                        cache.set(level_number, level_name);
                    }
                }

                return cache;
            } catch (error) {
                console.warn("Cached level names could not be loaded.", error);
                return new Map();
            }
        }

        save_level_name_cache() {
            try {
                localStorage.setItem(
                    "choobs_level_name_cache_v1",
                    JSON.stringify(Object.fromEntries(this.level_name_cache))
                );
            } catch (error) {
                console.warn("Level names could not be cached.", error);
            }
        }

        remember_level_name(level) {
            const level_number = Math.floor(Number(level && level.number) || 0);
            const level_name = String(level && level.name || "").trim();

            if (level_number < 1 || !level_name) {
                return;
            }

            if (level_name === `Level ${level_number}`) {
                if (this.level_name_cache.delete(level_number)) {
                    this.save_level_name_cache();
                }

                return;
            }

            if (this.level_name_cache.get(level_number) === level_name) {
                return;
            }

            this.level_name_cache.set(level_number, level_name);
            this.save_level_name_cache();
        }

        load_imported_levels() {
            try {
                const raw = JSON.parse(
                    localStorage.getItem("choobs_imported_levels_v1") || "[]"
                );

                if (!Array.isArray(raw)) {
                    return [];
                }

                const valid = [];

                for (const item of raw) {
                    try {
                        valid.push(Choobs.serialize_level(item));
                    } catch (error) {
                        console.warn("Skipped an invalid imported level.", error);
                    }
                }

                return valid;
            } catch (error) {
                console.warn("Imported levels could not be loaded.", error);
                return [];
            }
        }

        save_imported_levels() {
            try {
                localStorage.setItem(
                    "choobs_imported_levels_v1",
                    JSON.stringify(this.imported_levels)
                );
            } catch (error) {
                console.warn("Imported levels could not be saved.", error);
            }
        }

        async import_level_files(event) {
            const files = Array.from(event.currentTarget.files || []).filter((file) => {
                return file.name.toLowerCase().endsWith(".json");
            });
            event.currentTarget.value = "";

            if (files.length === 0) {
                return;
            }

            const imported_by_number = new Map(
                this.imported_levels.map((level) => [level.number, level])
            );
            const accepted_numbers = [];

            for (const file of files) {
                try {
                    const raw_level = JSON.parse(await file.text());
                    const level = Choobs.serialize_level(raw_level);
                    imported_by_number.set(level.number, level);
                    accepted_numbers.push(level.number);
                } catch (error) {
                    console.error(`Rejected ${file.name}:`, error);
                }
            }

            if (accepted_numbers.length === 0) {
                this.set_status("The dropped level file was invalid.");
                return;
            }

            this.imported_levels = Array.from(imported_by_number.values()).sort(
                (left, right) => left.number - right.number
            );
            this.save_imported_levels();
            await this.load_levels(
                accepted_numbers[accepted_numbers.length - 1],
                false
            );
            this.set_status("Level added.");
        }

        is_level_unlocked(index) {
            const level = this.levels[index];
            return Boolean(level) &&
                this.is_level_number_unlocked(level.number);
        }

        get_resume_level_index() {
            const resume_number = this.get_resume_level_number();
            return this.ensure_level_entry(resume_number);
        }

        get_level_option_label(level) {
            if (level.procedural_placeholder) {
                const cached_name = this.level_name_cache.get(level.number);
                return cached_name ?
                    `${level.number}. ${cached_name}` :
                    `Level ${level.number}`;
            }

            if (level.settings && level.settings.procedural) {
                return `Level ${level.number}`;
            }

            return `${level.number}. ${level.name}`;
        }

        populate_level_select() {
            const selected_number =
                this.level_index >= 0 && this.levels[this.level_index] ?
                    this.levels[this.level_index].number :
                    null;

            this.elements.level_select.replaceChildren();

            for (let index = 0; index < this.levels.length; index += 1) {
                const level = this.levels[index];
                const option = document.createElement("option");
                const completed = this.completed_numbers.has(level.number);
                const unlocked = this.is_level_unlocked(index);
                const label = this.get_level_option_label(level);

                option.value = String(level.number);
                option.disabled = !unlocked;
                option.textContent = completed ?
                    `${label}  ✓` :
                    unlocked ?
                        label :
                        `${label}  🔒`;
                this.elements.level_select.append(option);
            }

            if (selected_number !== null) {
                this.elements.level_select.value = String(selected_number);
            }
        }

        async load_level_number(level_number) {
            const normalized_number = Math.max(
                1,
                Math.floor(Number(level_number) || 1)
            );

            if (!this.is_level_number_unlocked(normalized_number)) {
                this.populate_level_select();

                if (this.level_index >= 0) {
                    this.elements.level_select.value = String(
                        this.levels[this.level_index].number
                    );
                }

                return;
            }

            const index = this.ensure_level_entry(normalized_number);
            await this.load_level_by_index(index);
        }

        async load_level_by_index(index) {
            if (index < 0 || index >= this.levels.length) {
                return;
            }

            if (!this.is_level_unlocked(index)) {
                return;
            }

            const request_id = ++this.load_request_id;
            const entry = this.levels[index];
            const needs_generation = Boolean(entry.procedural_placeholder);

            if (needs_generation) {
                this.elements.loading_overlay.classList.remove("hidden");
                this.elements.level_select.disabled = true;
                this.set_status(`Preparing level ${entry.number}.`);
            }

            let level = null;

            try {
                level = await this.resolve_level(index);
            } catch (error) {
                console.error(error);
                this.set_status("The level could not be prepared.");
                return;
            } finally {
                if (request_id === this.load_request_id) {
                    this.elements.loading_overlay.classList.add("hidden");
                    this.elements.level_select.disabled = false;
                }
            }

            if (request_id !== this.load_request_id || !level) {
                return;
            }

            this.level_index = index;
            this.session = new Choobs.PuzzleSession(level);
            const autosave = this.pending_autosave;
            const restored = Boolean(
                autosave &&
                autosave.level_number === level.number &&
                this.restore_session_snapshot(autosave)
            );
            this.pending_autosave = null;
            this.autosave_restored = restored;

            if (restored) {
                this.invalid_attempts = this.game_mode === "freeplay" ?
                    0 :
                    Math.max(0, Math.min(3, Number(autosave.invalid_attempts) || 0));
                this.penalty_type = null;
                this.penalty_at = 0;
                this.elements.canvas_frame.classList.remove("is-failing");

                if (this.invalid_attempts >= 3 &&
                    (this.game_mode === "heartbeat" || this.game_mode === "permadeath")) {
                    this.penalty_type = this.game_mode;
                    this.penalty_at = performance.now() +
                        (this.reduced_motion ? 0 : 420);
                    this.elements.canvas_frame.classList.add("is-failing");
                }

                this.update_mode_ui();
            } else {
                this.reset_invalid_attempts();
            }

            if (restored && Number.isFinite(Number(autosave.run_score))) {
                this.run_score = Math.max(0, Math.floor(Number(autosave.run_score) || 0));
                this.level_score_start = Math.max(
                    0,
                    Math.min(
                        this.run_score,
                        Math.floor(Number(autosave.level_score_start) || 0)
                    )
                );
                this.best_combo = Math.max(
                    this.best_combo,
                    Math.floor(Number(autosave.best_combo) || 0)
                );
            } else {
                this.level_score_start = this.run_score;
            }
            this.score_level_number = level.number;
            this.last_level_points = 0;
            this.reset_combo(false);
            this.update_score_ui();
            this.save_score_state();

            this.renderer.display_scale = this.renderer.clamp_display_scale(
                restored ? Number(autosave.board_zoom) || 1 : 1
            );
            this.renderer.set_level(level);
            this.renderer.show_mask = true;
            this.center_board_view();

            if (restored && autosave.board_scroll) {
                requestAnimationFrame(() => {
                    this.elements.board_stage.scrollLeft = Math.max(
                        0,
                        Number(autosave.board_scroll.left) || 0
                    );
                    this.elements.board_stage.scrollTop = Math.max(
                        0,
                        Number(autosave.board_scroll.top) || 0
                    );
                });
            }
            this.needs_render = true;
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.blocked_pipe_id = -1;
            this.blocker_pipe_id = -1;
            this.effects.length = 0;
            this.activation_metadata.clear();
            this.completion_started = 0;
            this.completion_overlay_at = 0;
            this.completion_overlay_shown = false;
            this.intro_started = this.reduced_motion ? 0 : performance.now();
            this.register_interaction();
            this.hide_win_overlay();
            this.elements.canvas_frame.classList.remove("is-celebrating");

            this.populate_level_select();
            this.elements.level_select.value = String(level.number);

            try {
                const url = new URL(window.location.href);
                url.searchParams.set("level", String(level.number));
                history.replaceState(
                    this.history_guard_ready ?
                        { choobs_pause_guard: true } :
                        history.state,
                    "",
                    url
                );
            } catch (error) {
                // File URLs and privacy modes may not allow history changes.
            }

            this.update_pause_menu();
            this.save_current_progress(restored ? "autosave_restored" : "level_loaded");
            this.set_status(
                restored ?
                    `Level ${level.number} restored.` :
                    `Level ${level.number}.`
            );
        }

        async load_next_level() {
            if (this.level_index < 0 || !this.levels[this.level_index]) {
                return;
            }

            const next_number = this.levels[this.level_index].number + 1;
            const next_index = this.ensure_level_entry(next_number);
            this.populate_level_select();
            await this.load_level_by_index(next_index);
        }

        restart_level(status_message = "Level restarted.") {
            if (!this.session) {
                return;
            }

            this.session.reset();
            this.run_score = this.level_score_start;
            this.reset_combo(false);
            this.update_score_ui();
            this.save_score_state();
            this.reset_invalid_attempts();
            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.hint_pipe_id = -1;
            this.blocked_pipe_id = -1;
            this.blocker_pipe_id = -1;
            this.effects.length = 0;
            this.activation_metadata.clear();
            this.completion_started = 0;
            this.completion_overlay_at = 0;
            this.completion_overlay_shown = false;
            this.intro_started = this.reduced_motion ? 0 : performance.now();
            this.needs_render = true;
            this.hide_win_overlay();
            this.elements.canvas_frame.classList.remove("is-celebrating");
            this.register_interaction();
            this.save_current_progress("level_restart");
            this.set_status(status_message);
        }

        handle_board_pointer_start(event) {
            if (event.button !== undefined && event.button !== 0) {
                return;
            }

            if (event.pointerType === "mouse") {
                if (event.target === this.elements.game_canvas) {
                    this.begin_pointer_gesture(event);
                }
                return;
            }

            event.preventDefault();

            try {
                this.elements.board_stage.setPointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture may be unavailable in older embedded browsers.
            }

            this.active_board_pointers.set(event.pointerId, {
                pointer_id: event.pointerId,
                client_x: event.clientX,
                client_y: event.clientY,
                start_x: event.clientX,
                start_y: event.clientY,
                started_on_canvas: event.target === this.elements.game_canvas,
                moved: false
            });

            if (this.active_board_pointers.size >= 2) {
                this.begin_pinch_gesture();
                return;
            }

            this.board_touch_gesture = {
                mode: "pan",
                pointer_id: event.pointerId,
                start_scroll_left: this.elements.board_stage.scrollLeft,
                start_scroll_top: this.elements.board_stage.scrollTop,
                moved: false,
                suppress_tap: false
            };
        }

        handle_board_pointer_move(event) {
            if (event.pointerType === "mouse") {
                this.track_pointer_gesture(event);

                if (event.target === this.elements.game_canvas) {
                    this.handle_pointer_move(event);
                }

                return;
            }

            const pointer = this.active_board_pointers.get(event.pointerId);

            if (!pointer) {
                return;
            }

            event.preventDefault();
            pointer.client_x = event.clientX;
            pointer.client_y = event.clientY;

            if (Math.hypot(
                pointer.client_x - pointer.start_x,
                pointer.client_y - pointer.start_y
            ) >= 8) {
                pointer.moved = true;
            }

            if (this.active_board_pointers.size >= 2) {
                if (!this.board_touch_gesture ||
                    this.board_touch_gesture.mode !== "pinch") {
                    this.begin_pinch_gesture();
                }

                this.update_pinch_gesture();
                return;
            }

            const gesture = this.board_touch_gesture;

            if (!gesture || gesture.mode !== "pan" ||
                gesture.pointer_id !== event.pointerId) {
                return;
            }

            if (pointer.moved) {
                gesture.moved = true;
                this.elements.board_stage.scrollLeft =
                    gesture.start_scroll_left -
                    (event.clientX - pointer.start_x);
                this.elements.board_stage.scrollTop =
                    gesture.start_scroll_top -
                    (event.clientY - pointer.start_y);
            }
        }

        handle_board_pointer_end(event, cancelled) {
            if (event.pointerType === "mouse") {
                if (cancelled) {
                    this.pointer_gesture = null;
                } else {
                    this.finish_pointer_gesture(event);
                }
                return;
            }

            const pointer = this.active_board_pointers.get(event.pointerId);

            if (!pointer) {
                return;
            }

            event.preventDefault();
            const previous_gesture = this.board_touch_gesture;
            const was_pinching = previous_gesture &&
                previous_gesture.mode === "pinch";

            if (was_pinching && previous_gesture.two_finger_tap_candidate &&
                performance.now() - previous_gesture.started_at <= 280) {
                this.register_two_finger_tap(
                    previous_gesture.start_midpoint_x,
                    previous_gesture.start_midpoint_y
                );
            }

            this.active_board_pointers.delete(event.pointerId);

            try {
                this.elements.board_stage.releasePointerCapture(event.pointerId);
            } catch (error) {
                // The pointer may already have released capture.
            }

            if (this.active_board_pointers.size >= 2) {
                this.begin_pinch_gesture();
                return;
            }

            if (this.active_board_pointers.size === 1) {
                const remaining = this.active_board_pointers.values().next().value;

                remaining.start_x = remaining.client_x;
                remaining.start_y = remaining.client_y;
                remaining.moved = true;
                this.board_touch_gesture = {
                    mode: "pan",
                    pointer_id: remaining.pointer_id,
                    start_scroll_left: this.elements.board_stage.scrollLeft,
                    start_scroll_top: this.elements.board_stage.scrollTop,
                    moved: true,
                    suppress_tap: true
                };
                return;
            }

            this.board_touch_gesture = null;

            if (was_pinching || pointer.moved ||
                (previous_gesture && previous_gesture.moved)) {
                this.save_current_progress(
                    was_pinching ? "pinch_zoom" : "board_pan"
                );
                return;
            }

            if (!cancelled && pointer.started_on_canvas &&
                !(previous_gesture && previous_gesture.suppress_tap)) {
                this.handle_pointer_down(event);
            }
        }

        begin_pinch_gesture() {
            const pointers = Array.from(this.active_board_pointers.values())
                .slice(0, 2);

            if (pointers.length < 2) {
                return;
            }

            for (const pointer of this.active_board_pointers.values()) {
                pointer.moved = true;
            }

            const midpoint = this.get_pointer_midpoint(pointers[0], pointers[1]);
            const canvas_rect = this.elements.game_canvas.getBoundingClientRect();
            const scale_x = canvas_rect.width / Math.max(1, this.renderer.css_width);
            const scale_y = canvas_rect.height / Math.max(1, this.renderer.css_height);

            const start_distance = Math.max(1, this.get_pointer_distance(
                pointers[0], pointers[1]
            ));

            this.board_touch_gesture = {
                mode: "pinch",
                start_distance,
                start_scale: this.renderer.get_display_scale(),
                start_midpoint_x: midpoint.x,
                start_midpoint_y: midpoint.y,
                started_at: performance.now(),
                two_finger_tap_candidate: true,
                anchor_x: (midpoint.x - canvas_rect.left) /
                    Math.max(0.0001, scale_x),
                anchor_y: (midpoint.y - canvas_rect.top) /
                    Math.max(0.0001, scale_y),
                moved: true
            };
        }

        update_pinch_gesture() {
            const gesture = this.board_touch_gesture;
            const pointers = Array.from(this.active_board_pointers.values())
                .slice(0, 2);

            if (!gesture || gesture.mode !== "pinch" || pointers.length < 2) {
                return;
            }

            const distance = Math.max(1, this.get_pointer_distance(
                pointers[0], pointers[1]
            ));
            const midpoint = this.get_pointer_midpoint(pointers[0], pointers[1]);
            const distance_ratio = distance / gesture.start_distance;
            const midpoint_travel = Math.hypot(
                midpoint.x - gesture.start_midpoint_x,
                midpoint.y - gesture.start_midpoint_y
            );

            if (Math.abs(Math.log(Math.max(0.0001, distance_ratio))) > 0.055 ||
                midpoint_travel > 12) {
                gesture.two_finger_tap_candidate = false;
            }

            const next_scale = gesture.start_scale * distance_ratio;

            this.set_zoom_around_point(
                next_scale,
                midpoint.x,
                midpoint.y,
                gesture.anchor_x,
                gesture.anchor_y
            );
        }

        register_two_finger_tap(client_x, client_y) {
            const now = performance.now();
            const previous = this.last_two_finger_tap_point;
            const close_in_time = now - this.last_two_finger_tap_at <= 460;
            const close_in_space = previous && Math.hypot(
                client_x - previous.x,
                client_y - previous.y
            ) <= 72;

            if (close_in_time && close_in_space) {
                this.last_two_finger_tap_at = 0;
                this.last_two_finger_tap_point = null;
                this.reset_board_zoom();
                return;
            }

            this.last_two_finger_tap_at = now;
            this.last_two_finger_tap_point = { x: client_x, y: client_y };
        }

        reset_board_zoom() {
            const changed = this.renderer.set_display_scale(1);

            if (changed) {
                this.needs_render = true;
            }

            this.center_board_view();
            requestAnimationFrame(() => {
                this.save_current_progress("two_finger_zoom_reset");
            });
            this.set_status("Zoom reset to 100%.");
            this.vibrate(12);
        }

        set_zoom_around_point(
            scale,
            client_x,
            client_y,
            anchor_x = null,
            anchor_y = null
        ) {
            const canvas = this.elements.game_canvas;
            const before_rect = canvas.getBoundingClientRect();
            const before_scale_x = before_rect.width /
                Math.max(1, this.renderer.css_width);
            const before_scale_y = before_rect.height /
                Math.max(1, this.renderer.css_height);
            const logical_x = Number.isFinite(anchor_x) ? anchor_x :
                (client_x - before_rect.left) / Math.max(0.0001, before_scale_x);
            const logical_y = Number.isFinite(anchor_y) ? anchor_y :
                (client_y - before_rect.top) / Math.max(0.0001, before_scale_y);

            // A two-finger gesture must be able to translate the board even
            // when the distance between the fingers does not change. Previously,
            // an unchanged scale returned early here, which made a pure two-finger
            // drag appear to do nothing. Always run the anchor correction; resize
            // the canvas only when the zoom value actually changed.
            const scale_changed = this.renderer.set_display_scale(scale);
            const after_rect = canvas.getBoundingClientRect();
            const after_scale_x = after_rect.width /
                Math.max(1, this.renderer.css_width);
            const after_scale_y = after_rect.height /
                Math.max(1, this.renderer.css_height);
            const anchored_client_x = after_rect.left + logical_x * after_scale_x;
            const anchored_client_y = after_rect.top + logical_y * after_scale_y;

            this.elements.board_stage.scrollLeft +=
                anchored_client_x - client_x;
            this.elements.board_stage.scrollTop +=
                anchored_client_y - client_y;

            if (scale_changed) {
                this.needs_render = true;
            }
        }

        get_pointer_distance(first, second) {
            return Math.hypot(
                second.client_x - first.client_x,
                second.client_y - first.client_y
            );
        }

        get_pointer_midpoint(first, second) {
            return {
                x: (first.client_x + second.client_x) / 2,
                y: (first.client_y + second.client_y) / 2
            };
        }

        begin_pointer_gesture(event) {
            if (event.button !== undefined && event.button !== 0) {
                return;
            }

            this.pointer_gesture = {
                pointer_id: event.pointerId,
                start_x: event.clientX,
                start_y: event.clientY,
                moved: false
            };
        }

        track_pointer_gesture(event) {
            const gesture = this.pointer_gesture;

            if (!gesture || gesture.pointer_id !== event.pointerId) {
                return;
            }

            const distance = Math.hypot(
                event.clientX - gesture.start_x,
                event.clientY - gesture.start_y
            );

            if (distance >= 9) {
                gesture.moved = true;
            }
        }

        finish_pointer_gesture(event) {
            const gesture = this.pointer_gesture;
            this.pointer_gesture = null;

            if (
                !gesture ||
                gesture.pointer_id !== event.pointerId ||
                gesture.moved
            ) {
                return;
            }

            this.handle_pointer_down(event);
        }

        center_board_view() {
            const stage = this.elements.board_stage;

            if (!stage) {
                return;
            }

            requestAnimationFrame(() => {
                stage.scrollLeft = Math.max(
                    0,
                    (stage.scrollWidth - stage.clientWidth) / 2
                );
                stage.scrollTop = Math.max(
                    0,
                    (stage.scrollHeight - stage.clientHeight) / 2
                );
            });
        }

        handle_pointer_move(event) {
            if (!this.session || this.session.is_complete()) {
                return;
            }

            const cell = this.renderer.pointer_to_cell(event);
            const pipe_id = cell ?
                this.session.grid.get_occupant(cell.x, cell.y) :
                -1;

            if (pipe_id !== this.hovered_pipe_id) {
                this.hovered_pipe_id = pipe_id;
                this.hovered_pipe_is_clear = pipe_id >= 0 &&
                    this.session.can_activate(pipe_id).ok;
                this.needs_render = true;
            }

            this.elements.game_canvas.style.cursor =
                pipe_id >= 0 ? "pointer" : "default";
        }

        handle_pointer_down(event) {
            if (
                !this.game_mode ||
                !this.session ||
                this.is_paused ||
                this.session.is_complete() ||
                this.penalty_at > 0
            ) {
                return;
            }

            this.register_interaction();
            const cell = this.renderer.pointer_to_cell(event);

            if (!cell) {
                return;
            }

            const pipe_id = this.session.grid.get_occupant(cell.x, cell.y);

            if (pipe_id < 0) {
                return;
            }

            const pipe = this.session.get_pipe(pipe_id);
            const result = this.session.activate(pipe_id);
            const time = performance.now();

            if (!result.ok) {
                this.reset_combo(false);
                this.save_score_state();
                this.blocked_pipe_id = pipe_id;
                this.blocked_until = time + (this.reduced_motion ? 1 : 520);
                this.blocker_pipe_id = Number.isInteger(result.blocker) ?
                    result.blocker :
                    -1;
                this.blocker_until = time + (this.reduced_motion ? 1 : 720);
                this.add_effect({
                    type: "impact",
                    x: cell.x,
                    y: cell.y,
                    color: "#ff7d8f",
                    started: time,
                    duration: this.reduced_motion ? 1 : 430
                });
                this.vibrate([16, 28, 16]);
                this.needs_render = true;

                if (result.reason === "occupied" || result.reason === "collision") {
                    this.register_invalid_activation(time);
                } else {
                    this.set_status("That pipe is already moving.");
                }

                this.save_current_progress("line_click_invalid");
                return;
            }

            let awarded_points = 0;

            if (pipe) {
                awarded_points = this.award_pipe_points(
                    pipe,
                    time,
                    event.clientX,
                    event.clientY
                );
                this.record_activation(pipe, cell, time);
            }

            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.vibrate(8);
            this.needs_render = true;
            this.save_current_progress("line_click_valid");
            this.set_status(
                `+${this.format_score(awarded_points)} points${
                    this.combo_count > 1 ? ` · ×${this.combo_count} combo` : ""
                }.`
            );
        }

        record_activation(pipe, selected_cell, time) {
            const palette = this.session.level.palette || Choobs.PIPE_COLORS;
            const color = palette[pipe.color_index % palette.length];
            const head = pipe.cells[pipe.cells.length - 1];
            let exit_x = head.x;
            let exit_y = head.y;

            while (
                this.session.grid.is_inside(
                    exit_x + pipe.direction.x,
                    exit_y + pipe.direction.y
                )
            ) {
                exit_x += pipe.direction.x;
                exit_y += pipe.direction.y;
            }

            this.activation_metadata.set(pipe.id, {
                x: exit_x + pipe.direction.x * 0.55,
                y: exit_y + pipe.direction.y * 0.55,
                color,
                direction: { ...pipe.direction }
            });

            this.add_effect({
                type: "ripple",
                x: selected_cell.x,
                y: selected_cell.y,
                color,
                strength: this.session.get_moving_count() > 1 ? 1.35 : 1,
                started: time,
                duration: this.reduced_motion ? 1 : 330
            });
            this.add_effect({
                type: "launch",
                x: head.x,
                y: head.y,
                direction: { ...pipe.direction },
                color,
                started: time,
                duration: this.reduced_motion ? 1 : 310
            });
        }

        add_effect(effect) {
            if (this.reduced_motion && effect.type !== "impact") {
                return;
            }

            this.effects.push({
                ...effect,
                seed: effect.seed || this.effect_seed++
            });

            if (this.effects.length > 120) {
                this.effects.splice(0, this.effects.length - 120);
            }
        }

        prune_effects(time) {
            const previous_length = this.effects.length;
            this.effects = this.effects.filter((effect) => {
                return time < effect.started + effect.duration;
            });

            if (this.effects.length !== previous_length) {
                this.needs_render = true;
            }
        }

        spawn_completed_pipe_effects(pipe_ids, time) {
            for (const pipe_id of pipe_ids) {
                const metadata = this.activation_metadata.get(pipe_id);

                if (!metadata) {
                    continue;
                }

                this.add_effect({
                    type: "burst",
                    x: metadata.x,
                    y: metadata.y,
                    color: metadata.color,
                    count: pipe_ids.length > 1 ? 12 : 9,
                    started: time,
                    duration: this.reduced_motion ? 1 : 440
                });
                this.activation_metadata.delete(pipe_id);
            }
        }

        update_automatic_hint(time) {
            if (
                !this.session ||
                this.session.is_complete() ||
                this.session.get_moving_count() > 0 ||
                this.hovered_pipe_id >= 0 ||
                this.blocked_pipe_id >= 0 ||
                this.completion_started > 0
            ) {
                return;
            }

            if (this.hint_pipe_id >= 0 && time >= this.hint_until) {
                this.hint_pipe_id = -1;
                this.needs_render = true;
            }

            if (this.hint_pipe_id >= 0 || time < this.next_hint_time) {
                return;
            }

            const removable = this.session.get_removable_pipe_ids();

            if (removable.length === 0) {
                this.next_hint_time = time + 6500;
                return;
            }

            const index = Math.floor(time / 1000) % removable.length;
            this.hint_pipe_id = removable[index];
            this.hint_until = time + (this.reduced_motion ? 700 : 1700);
            this.next_hint_time = this.hint_until + 6500;
            this.needs_render = true;
        }

        frame(time) {
            if (this.is_paused) {
                this.last_frame_time = time;
                requestAnimationFrame((next_time) => this.frame(next_time));
                return;
            }

            const delta = Math.min(100, time - this.last_frame_time);
            this.last_frame_time = time;

            if (this.penalty_at > 0 && time >= this.penalty_at) {
                this.apply_failure_penalty();
            }

            this.update_combo_timer(time);

            if (this.session) {
                const update_result = this.session.update(delta);

                if (update_result.state_changed) {
                    this.needs_render = true;
                }

                if (update_result.completed_pipe_ids.length > 0) {
                    this.spawn_completed_pipe_effects(
                        update_result.completed_pipe_ids,
                        time
                    );
                    this.needs_render = true;

                    if (this.session.is_complete()) {
                        this.begin_level_completion(time);
                    } else {
                        this.save_current_progress("pipe_completed");
                    }
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

                this.update_automatic_hint(time);
                this.prune_effects(time);

                if (
                    this.completion_started > 0 &&
                    !this.completion_overlay_shown &&
                    time >= this.completion_overlay_at
                ) {
                    this.show_win_overlay();
                }

                const intro_active =
                    this.intro_started > 0 &&
                    time < this.intro_started + 360;
                const should_render =
                    this.needs_render ||
                    this.session.get_moving_count() > 0 ||
                    this.blocked_pipe_id >= 0 ||
                    this.blocker_pipe_id >= 0 ||
                    this.hint_pipe_id >= 0 ||
                    this.effects.length > 0 ||
                    intro_active ||
                    (
                        this.completion_started > 0 &&
                        !this.completion_overlay_shown
                    );

                if (should_render) {
                    this.renderer.render(this.session, {
                        time,
                        hovered_pipe_id: this.hovered_pipe_id,
                        hovered_pipe_is_clear: this.hovered_pipe_is_clear,
                        hint_pipe_id: this.hint_pipe_id,
                        blocked_pipe_id: this.blocked_pipe_id,
                        blocker_pipe_id: this.blocker_pipe_id,
                        intro_started: this.intro_started,
                        effects: this.effects
                    });
                    this.needs_render = false;
                }
            }

            requestAnimationFrame((next_time) => this.frame(next_time));
        }

        begin_level_completion(time) {
            if (this.completion_started > 0) {
                return;
            }

            const level = this.levels[this.level_index];
            this.last_level_points = Math.max(0, this.run_score - this.level_score_start);
            this.level_score_start = this.run_score;
            this.score_level_number = level.number;
            this.reset_combo(false);
            this.save_score_state();
            this.elements.win_score.textContent = this.format_score(this.run_score);
            this.elements.win_level_points.textContent = `+${this.format_score(this.last_level_points)}`;
            this.elements.win_best_combo.textContent = `×${Math.max(1, this.best_combo)}`;
            this.reset_invalid_attempts();
            this.completed_numbers.add(level.number);
            this.save_completed_numbers();
            this.clear_autosave();
            this.ensure_level_entry(level.number + 1);
            this.populate_level_select();
            this.elements.level_select.value = String(level.number);
            this.elements.win_title.textContent = level.name;
            this.elements.continue_button_label.textContent = "Next level";
            this.completion_started = time;
            this.completion_overlay_at = time + (this.reduced_motion ? 0 : 650);
            this.completion_overlay_shown = false;
            this.elements.canvas_frame.classList.add("is-celebrating");
            this.add_effect({
                type: "celebration",
                x: (level.columns - 1) * 0.5,
                y: (level.rows - 1) * 0.5,
                color: "#7ee3c5",
                count: 34,
                started: time,
                duration: this.reduced_motion ? 1 : 700
            });
            this.needs_render = true;
            this.set_status(`Level ${level.number} complete.`);
        }

        show_win_overlay() {
            if (this.completion_overlay_shown) {
                return;
            }

            this.completion_overlay_shown = true;
            this.elements.win_overlay.classList.remove("hidden");
            requestAnimationFrame(() => {
                this.elements.continue_button.focus({ preventScroll: true });
            });
        }

        hide_win_overlay() {
            this.elements.win_overlay.classList.add("hidden");
            this.completion_overlay_shown = false;
        }

        vibrate(pattern) {
            if (
                typeof navigator !== "undefined" &&
                typeof navigator.vibrate === "function"
            ) {
                navigator.vibrate(pattern);
            }
        }

        load_autosave() {
            try {
                const saved = JSON.parse(
                    localStorage.getItem("choobs_autosave_v1") || "null"
                );

                if (!saved || saved.version !== 1 ||
                    !Number.isInteger(Number(saved.level_number)) ||
                    Number(saved.level_number) < 1 ||
                    !saved.session) {
                    return null;
                }

                saved.level_number = Number(saved.level_number);
                return saved;
            } catch (error) {
                console.warn("Autosave could not be loaded.", error);
                return null;
            }
        }

        clear_autosave() {
            try {
                localStorage.removeItem("choobs_autosave_v1");
            } catch (error) {
                console.warn("Autosave could not be cleared.", error);
            }
        }

        create_session_snapshot() {
            if (!this.session) {
                return null;
            }

            return {
                move_count: this.session.move_count,
                completed_pipe_count: this.session.completed_pipe_count,
                pipes: this.session.pipes.map((pipe) => ({
                    id: pipe.id,
                    color_index: pipe.color_index,
                    active: pipe.active,
                    direction: { ...pipe.direction },
                    cells: pipe.cells.map((cell) => ({
                        x: cell.x,
                        y: cell.y
                    }))
                })),
                moving_pipes: Array.from(this.session.moving_pipes, ([id, movement]) => ({
                    id,
                    progress: Math.max(0, Math.min(.999999, movement.progress))
                }))
            };
        }

        restore_session_snapshot(autosave) {
            const snapshot = autosave && autosave.session;

            if (!this.session || !snapshot || !Array.isArray(snapshot.pipes) ||
                snapshot.pipes.length !== this.session.pipes.length) {
                return false;
            }

            const original_by_id = new Map(
                this.session.pipes.map((pipe) => [pipe.id, pipe])
            );
            const restored_pipes = [];
            const seen_ids = new Set();
            const occupied_cells = new Set();

            for (const saved_pipe of snapshot.pipes) {
                const original = original_by_id.get(saved_pipe.id);

                if (!original || seen_ids.has(saved_pipe.id) ||
                    !Array.isArray(saved_pipe.cells) ||
                    saved_pipe.cells.length !== original.cells.length ||
                    !saved_pipe.direction ||
                    saved_pipe.direction.x !== original.direction.x ||
                    saved_pipe.direction.y !== original.direction.y) {
                    return false;
                }

                const cells = [];

                for (const cell of saved_pipe.cells) {
                    const x = Number(cell.x);
                    const y = Number(cell.y);

                    if (!Number.isInteger(x) || !Number.isInteger(y)) {
                        return false;
                    }

                    if (saved_pipe.active && this.session.grid.is_inside(x, y)) {
                        const key = `${x},${y}`;

                        if (occupied_cells.has(key)) {
                            return false;
                        }

                        occupied_cells.add(key);
                    }

                    cells.push({ x, y });
                }

                seen_ids.add(saved_pipe.id);
                restored_pipes.push({
                    id: original.id,
                    color_index: original.color_index,
                    cells,
                    direction: { ...original.direction },
                    active: Boolean(saved_pipe.active)
                });
            }

            if (restored_pipes.every((pipe) => !pipe.active)) {
                return false;
            }

            const restored_by_id = new Map(
                restored_pipes.map((pipe) => [pipe.id, pipe])
            );
            const moving_pipes = new Map();

            for (const movement of Array.isArray(snapshot.moving_pipes) ?
                snapshot.moving_pipes : []) {
                const pipe = restored_by_id.get(movement.id);
                const progress = Number(movement.progress);

                if (!pipe || !pipe.active || moving_pipes.has(pipe.id) ||
                    !Number.isFinite(progress) || progress < 0 || progress >= 1) {
                    return false;
                }

                moving_pipes.set(pipe.id, { progress });
            }

            this.session.pipes = restored_pipes;
            this.session.pipe_by_id = restored_by_id;
            this.session.moving_pipes = moving_pipes;
            this.session.move_count = Math.max(
                0,
                Math.floor(Number(snapshot.move_count) || 0)
            );
            this.session.completed_pipe_count = restored_pipes.reduce(
                (count, pipe) => count + (pipe.active ? 0 : 1),
                0
            );
            this.session.rebuild_occupancy();
            this.session.mark_state_changed();
            return !this.session.is_complete();
        }

        save_current_progress(reason = "autosave") {
            this.save_score_state();

            if (!this.session || this.level_index < 0 ||
                !this.levels[this.level_index]) {
                return;
            }

            if (this.session.is_complete()) {
                this.clear_autosave();
                return;
            }

            try {
                localStorage.setItem(
                    "choobs_autosave_v1",
                    JSON.stringify({
                        version: 1,
                        saved_at: Date.now(),
                        reason,
                        level_number: this.levels[this.level_index].number,
                        game_mode: this.game_mode,
                        invalid_attempts: this.invalid_attempts,
                        pending_penalty: this.penalty_type,
                        run_score: this.run_score,
                        level_score_start: this.level_score_start,
                        best_combo: this.best_combo,
                        board_zoom: this.renderer.get_display_scale(),
                        board_scroll: {
                            left: this.elements.board_stage.scrollLeft,
                            top: this.elements.board_stage.scrollTop
                        },
                        session: this.create_session_snapshot()
                    })
                );
            } catch (error) {
                console.warn("Progress could not be autosaved.", error);
            }
        }

        load_completed_numbers() {
            try {
                const values = JSON.parse(
                    localStorage.getItem("choobs_completed_levels") || "[]"
                );

                if (!Array.isArray(values)) {
                    return new Set();
                }

                return new Set(values.map(Number));
            } catch (error) {
                return new Set();
            }
        }

        save_completed_numbers() {
            try {
                localStorage.setItem(
                    "choobs_completed_levels",
                    JSON.stringify(Array.from(this.completed_numbers))
                );
            } catch (error) {
                console.warn("Progress could not be saved.", error);
            }
        }

        set_status(message) {
            this.elements.status_text.textContent = message;
        }
    }

    const elements = {
        game_canvas: document.getElementById("game_canvas"),
        board_stage: document.getElementById("board_stage"),
        canvas_frame: document.getElementById("canvas_frame"),
        loading_overlay: document.getElementById("loading_overlay"),
        win_overlay: document.getElementById("win_overlay"),
        win_title: document.getElementById("win_title"),
        continue_button: document.getElementById("continue_button"),
        continue_button_label: document.getElementById("continue_button_label"),
        replay_button: document.getElementById("replay_button"),
        level_select: document.getElementById("level_select"),
        level_import_input: document.getElementById("level_import_input"),
        status_text: document.getElementById("status_text"),
        score_value: document.getElementById("score_value"),
        combo_hud: document.getElementById("combo_hud"),
        combo_value: document.getElementById("combo_value"),
        combo_fill: document.getElementById("combo_fill"),
        score_effects_layer: document.getElementById("score_effects_layer"),
        win_score: document.getElementById("win_score"),
        win_level_points: document.getElementById("win_level_points"),
        win_best_combo: document.getElementById("win_best_combo"),
        mode_overlay: document.getElementById("mode_overlay"),
        mode_buttons: Array.from(document.querySelectorAll("[data-mode]")),
        heartbeat_meter: document.getElementById("heartbeat_meter"),
        hearts: Array.from(document.querySelectorAll(".heart")),
        menu_button: document.getElementById("menu_button"),
        pause_overlay: document.getElementById("pause_overlay"),
        pause_level_badge: document.getElementById("pause_level_badge"),
        pause_score_badge: document.getElementById("pause_score_badge"),
        pause_mode_name: document.getElementById("pause_mode_name"),
        pause_mode_description: document.getElementById("pause_mode_description"),
        pause_mode_buttons: Array.from(document.querySelectorAll("[data-pause-mode]")),
        resume_button: document.getElementById("resume_button"),
        restart_menu_button: document.getElementById("restart_menu_button"),
        reset_game_button: document.getElementById("reset_game_button"),
        reset_confirmation: document.getElementById("reset_confirmation"),
        cancel_reset_button: document.getElementById("cancel_reset_button"),
        confirm_reset_button: document.getElementById("confirm_reset_button"),
        close_app_button: document.getElementById("close_app_button"),
        close_overlay: document.getElementById("close_overlay"),
        return_to_game_button: document.getElementById("return_to_game_button")
    };

    window.choobsGame = new GameApplication(elements);
})();
