(function (global_scope) {
    "use strict";

    const SESSION_FLAG = "__choobs_performance_session_installed";
    const RENDERER_FLAG = "__choobs_performance_renderer_installed";
    const QUEUE_RULES_FLAG = "__choobs_queue_rules_installed";
    const STRICT_RULES_FLAG = "__choobs_strict_trajectory_rules_installed";
    const QUEUE_RECHECK_INTERVAL_MS = 40;
    const LARGE_LEVEL_CELL_THRESHOLD = 900;
    const LARGE_LEVEL_PIPE_THRESHOLD = 180;

    function now() {
        if (global_scope.performance &&
            typeof global_scope.performance.now === "function") {
            return global_scope.performance.now();
        }

        return Date.now();
    }

    function empty_singleton_result() {
        return {
            started_pipe_ids: [],
            queued_pipe_ids: []
        };
    }

    function install_session_optimizations() {
        const Choobs = global_scope.Choobs;
        const Session = Choobs && Choobs.PuzzleSession;

        if (!Session || !Session.prototype) {
            return false;
        }

        const prototype = Session.prototype;

        if (prototype[SESSION_FLAG]) {
            return true;
        }

        if (!prototype[QUEUE_RULES_FLAG] || !prototype[STRICT_RULES_FLAG]) {
            return false;
        }

        Object.defineProperty(prototype, SESSION_FLAG, { value: true });

        const original_request_ready_singletons =
            prototype.request_ready_singletons;
        const original_start_ready_queued_pipes =
            prototype.start_ready_queued_pipes;

        if (typeof original_request_ready_singletons === "function") {
            prototype.request_ready_singletons = function () {
                const revision = Number(this.state_revision) || 0;

                if (this.__choobs_singleton_scan_revision === revision) {
                    return empty_singleton_result();
                }

                const result = original_request_ready_singletons.apply(
                    this,
                    arguments
                );
                this.__choobs_singleton_scan_revision =
                    Number(this.state_revision) || revision;
                return result;
            };
        }

        if (typeof original_start_ready_queued_pipes === "function") {
            prototype.start_ready_queued_pipes = function () {
                const revision = Number(this.state_revision) || 0;
                const current_time = now();
                const same_revision =
                    this.__choobs_queue_scan_revision === revision;
                const moving_count = this.moving_pipes instanceof Map ?
                    this.moving_pipes.size :
                    0;
                const queued_count = this.queued_pipes instanceof Map ?
                    this.queued_pipes.size :
                    0;
                const needs_continuous_recheck =
                    moving_count > 0 && queued_count > 0;
                const checked_recently =
                    current_time -
                    (Number(this.__choobs_queue_scan_time) || 0) <
                    QUEUE_RECHECK_INTERVAL_MS;

                if (same_revision &&
                    (!needs_continuous_recheck || checked_recently)) {
                    return [];
                }

                const result = original_start_ready_queued_pipes.apply(
                    this,
                    arguments
                );
                this.__choobs_queue_scan_revision =
                    Number(this.state_revision) || revision;
                this.__choobs_queue_scan_time = current_time;
                return result;
            };
        }

        prototype.update = function (delta_milliseconds) {
            const completed_pipe_ids = [];
            const safe_delta = Math.max(
                0,
                Math.min(100, Number(delta_milliseconds) || 0)
            );
            let state_changed = false;

            for (const [pipe_id, movement] of Array.from(this.moving_pipes)) {
                movement.progress += safe_delta / this.move_duration;

                while (
                    movement.progress >= 1 &&
                    this.moving_pipes.has(pipe_id)
                ) {
                    movement.progress -= 1;
                    const pipe = this.get_pipe(pipe_id);

                    if (!pipe || !pipe.active || pipe.cells.length === 0) {
                        this.moving_pipes.delete(pipe_id);
                        break;
                    }

                    const departing_tail = pipe.cells[0];
                    const completed = this.advance_pipe_step(pipe_id);
                    const tail_index = this.grid.is_inside(
                        departing_tail.x,
                        departing_tail.y
                    ) ?
                        this.grid.index(departing_tail.x, departing_tail.y) :
                        -1;

                    if (tail_index >= 0 &&
                        this.grid.occupancy[tail_index] === pipe_id) {
                        this.grid.occupancy[tail_index] = -1;
                    }

                    const updated_pipe = this.get_pipe(pipe_id);

                    if (updated_pipe && updated_pipe.active &&
                        updated_pipe.cells.length > 0) {
                        const new_head =
                            updated_pipe.cells[updated_pipe.cells.length - 1];

                        if (this.grid.is_inside(new_head.x, new_head.y)) {
                            this.grid.set_occupant(
                                new_head.x,
                                new_head.y,
                                pipe_id
                            );
                        }
                    }

                    state_changed = true;

                    if (completed) {
                        completed_pipe_ids.push(pipe_id);
                    }
                }
            }

            if (state_changed) {
                this.mark_state_changed();
            }

            return {
                completed_pipe_ids,
                state_changed
            };
        };

        return true;
    }

    function pipe_ids(values) {
        if (!(values instanceof Map) && !(values instanceof Set)) {
            return "";
        }

        return Array.from(values.keys()).join(",");
    }

    function queued_pipe_ids(session) {
        return session && session.queued_pipes instanceof Map ?
            pipe_ids(session.queued_pipes) :
            "";
    }

    function intro_is_active(visual_state, time) {
        const started = Number(visual_state && visual_state.intro_started);
        return Number.isFinite(started) &&
            started > 0 &&
            Number(time) < started + 360;
    }

    function visual_id(value) {
        const numeric_value = Number(value);
        return Number.isInteger(numeric_value) ? numeric_value : -1;
    }

    function render_signature(session, visual_state, time) {
        return [
            session ? Number(session.state_revision) || 0 : -1,
            session ? pipe_ids(session.moving_pipes) : "",
            session ? queued_pipe_ids(session) : "",
            visual_id(visual_state.hovered_pipe_id),
            visual_id(visual_state.hint_pipe_id),
            visual_id(visual_state.blocked_pipe_id),
            visual_id(visual_state.blocker_pipe_id),
            Array.isArray(visual_state.effects) ?
                visual_state.effects.length :
                0,
            intro_is_active(visual_state, time) ? 1 : 0
        ].join("|");
    }

    function has_continuous_visuals(session, visual_state, time) {
        return Boolean(
            session && session.moving_pipes &&
                session.moving_pipes.size > 0 ||
            Number(visual_state.hovered_pipe_id) >= 0 ||
            Number(visual_state.hint_pipe_id) >= 0 ||
            Number(visual_state.blocked_pipe_id) >= 0 ||
            Number(visual_state.blocker_pipe_id) >= 0 ||
            Array.isArray(visual_state.effects) &&
                visual_state.effects.length > 0 ||
            intro_is_active(visual_state, time)
        );
    }

    function static_cache_signature(session, intro_active) {
        if (!session) {
            return "none";
        }

        return [
            Number(session.completed_pipe_count) || 0,
            pipe_ids(session.moving_pipes),
            intro_active ? 1 : 0
        ].join("|");
    }

    function pipe_needs_live_draw(session, pipe, visual_state, time) {
        if (intro_is_active(visual_state, time)) {
            return true;
        }

        if (session.moving_pipes && session.moving_pipes.has(pipe.id)) {
            return true;
        }

        if (session.queued_pipes && session.queued_pipes.has(pipe.id)) {
            return true;
        }

        return pipe.id === visual_state.hovered_pipe_id ||
            pipe.id === visual_state.hint_pipe_id ||
            pipe.id === visual_state.blocked_pipe_id ||
            pipe.id === visual_state.blocker_pipe_id;
    }

    function should_cache_static_pipes(renderer, session) {
        const level = renderer && renderer.level || session && session.level;
        const columns = Number(level && level.columns) || 0;
        const rows = Number(level && level.rows) || 0;
        const pipe_count = session && Array.isArray(session.pipes) ?
            session.pipes.length :
            0;

        return columns * rows >= LARGE_LEVEL_CELL_THRESHOLD ||
            pipe_count >= LARGE_LEVEL_PIPE_THRESHOLD;
    }

    function install_renderer_optimizations() {
        const Renderer = global_scope.ChoobsCanvasRenderer;

        if (!Renderer || !Renderer.prototype) {
            return false;
        }

        const prototype = Renderer.prototype;

        if (prototype[RENDERER_FLAG]) {
            return true;
        }

        const original_render = prototype.render;
        const original_ensure_background_cache =
            prototype.ensure_background_cache;
        const original_draw_pipe = prototype.draw_pipe;
        const parent_prototype = Object.getPrototypeOf(prototype);
        const base_draw_pipe = parent_prototype &&
            typeof parent_prototype.draw_pipe === "function" ?
                parent_prototype.draw_pipe :
                original_draw_pipe;

        if (typeof original_render !== "function" ||
            typeof original_ensure_background_cache !== "function" ||
            typeof original_draw_pipe !== "function") {
            return false;
        }

        Object.defineProperty(prototype, RENDERER_FLAG, { value: true });

        prototype.render = function (session, visual_state = {}) {
            const time = Number(visual_state.time) || now();
            const cache_enabled = should_cache_static_pipes(this, session);

            if (this.__choobs_static_cache_enabled !== cache_enabled) {
                this.__choobs_static_cache_enabled = cache_enabled;
                this.background_dirty = true;
                this.__choobs_static_cache_session = null;
                this.__choobs_static_cache_signature = null;
            }

            this.__choobs_performance_session = session;
            this.__choobs_performance_visual_state = visual_state;
            this.__choobs_performance_time = time;

            if (!cache_enabled) {
                return original_render.call(this, session, visual_state);
            }

            const signature = render_signature(session, visual_state, time);
            const continuous = has_continuous_visuals(
                session,
                visual_state,
                time
            );

            if (!continuous &&
                !this.background_dirty &&
                this.__choobs_last_render_session === session &&
                this.__choobs_last_render_signature === signature) {
                return;
            }

            const result = original_render.call(this, session, visual_state);
            this.__choobs_last_render_session = session;
            this.__choobs_last_render_signature = signature;
            return result;
        };

        prototype.ensure_background_cache = function () {
            if (!this.__choobs_static_cache_enabled) {
                original_ensure_background_cache.call(this);
                return;
            }

            const session = this.__choobs_performance_session;
            const visual_state =
                this.__choobs_performance_visual_state || {};
            const time = Number(this.__choobs_performance_time) || now();
            const intro_active = intro_is_active(visual_state, time);
            const signature = static_cache_signature(session, intro_active);
            const signature_changed =
                this.__choobs_static_cache_session !== session ||
                this.__choobs_static_cache_signature !== signature;
            const rebuild_static_cache =
                Boolean(this.background_dirty) || signature_changed;

            if (signature_changed) {
                this.background_dirty = true;
            }

            original_ensure_background_cache.call(this);

            if (!rebuild_static_cache) {
                return;
            }

            this.__choobs_static_cache_session = session;
            this.__choobs_static_cache_signature = signature;

            if (!session || intro_active ||
                !this.background_context || !this.background_canvas) {
                return;
            }

            const context = this.background_context;
            const render_scale = this.background_canvas.width /
                Math.max(1, this.css_width);
            const static_state = {
                time: 1,
                hovered_pipe_id: -1,
                hovered_pipe_is_clear: false,
                hint_pipe_id: -1,
                blocked_pipe_id: -1,
                blocker_pipe_id: -1,
                intro_started: 0,
                effects: []
            };

            context.save();
            context.setTransform(
                render_scale,
                0,
                0,
                render_scale,
                0,
                0
            );
            this.__choobs_drawing_static_pipes = true;

            try {
                for (const pipe of session.pipes) {
                    if (!pipe.active ||
                        session.moving_pipes.has(pipe.id)) {
                        continue;
                    }

                    base_draw_pipe.call(
                        this,
                        context,
                        session,
                        pipe,
                        static_state,
                        1
                    );
                }
            } finally {
                this.__choobs_drawing_static_pipes = false;
                context.restore();
            }
        };

        prototype.draw_pipe = function (
            context,
            session,
            pipe,
            visual_state,
            time
        ) {
            if (!this.__choobs_static_cache_enabled ||
                this.__choobs_drawing_static_pipes ||
                pipe_needs_live_draw(
                    session,
                    pipe,
                    visual_state || {},
                    time
                )) {
                return original_draw_pipe.call(
                    this,
                    context,
                    session,
                    pipe,
                    visual_state,
                    time
                );
            }
        };

        return true;
    }

    function install_runtime() {
        const session_ready = install_session_optimizations();
        const renderer_ready = install_renderer_optimizations();
        return session_ready && renderer_ready;
    }

    const api = Object.freeze({
        install_runtime,
        install_renderer_optimizations,
        install_session_optimizations
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    if (!install_runtime() && typeof global_scope.setTimeout === "function") {
        let attempts = 0;

        const wait_for_runtime = () => {
            if (install_runtime()) {
                return;
            }

            attempts += 1;

            if (attempts < 240) {
                global_scope.setTimeout(wait_for_runtime, 25);
            }
        };

        global_scope.setTimeout(wait_for_runtime, 0);
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
