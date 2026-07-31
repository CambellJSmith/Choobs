(function (global_scope) {
    "use strict";

    const INSTALL_FLAG = "__choobs_logical_flight_pass_installed";
    const PERFORMANCE_RENDERER_FLAG =
        "__choobs_performance_renderer_installed";
    const PERFORMANCE_SESSION_FLAG =
        "__choobs_performance_session_installed";
    const STRICT_RULES_FLAG =
        "__choobs_strict_trajectory_rules_installed";
    const BREATH_RENDERER_FLAG =
        "__choobs_pipe_breath_renderer_clock_installed";
    const PIPE_BREATH_IDLE_MS = 5000;
    const PIPE_BREATH_DURATION_MS = 1000;
    const PIPE_BREATH_PERIOD_MS =
        PIPE_BREATH_IDLE_MS + PIPE_BREATH_DURATION_MS;
    const COLLISION_DISTANCE = 0.5;

    const object_ids = new WeakMap();
    let next_object_id = 1;
    let captured_runtime = null;

    function now() {
        if (global_scope.performance &&
            typeof global_scope.performance.now === "function") {
            return global_scope.performance.now();
        }

        return Date.now();
    }

    function pipe_breath_is_active(renderer, visual_state) {
        const epoch = Number(
            renderer && renderer.__choobs_pipe_breath_started_at
        );

        if (!Number.isFinite(epoch)) {
            return false;
        }

        const absolute_time = Number(visual_state && visual_state.time) || now();
        const elapsed = Math.max(0, absolute_time - epoch);
        const phase = elapsed % PIPE_BREATH_PERIOD_MS;
        return phase > PIPE_BREATH_IDLE_MS &&
            phase < PIPE_BREATH_PERIOD_MS;
    }

    function object_id(value) {
        if (!value || typeof value !== "object") {
            return String(value);
        }

        if (!object_ids.has(value)) {
            object_ids.set(value, next_object_id);
            next_object_id += 1;
        }

        return object_ids.get(value);
    }

    function pipe_key(pipe) {
        const id = Number(pipe && pipe.id);
        return Number.isInteger(id) ? String(id) : String(object_id(pipe));
    }

    function geometry_bounds(points) {
        if (!Array.isArray(points) || points.length === 0) {
            return null;
        }

        let minimum_x = Number.POSITIVE_INFINITY;
        let minimum_y = Number.POSITIVE_INFINITY;
        let maximum_x = Number.NEGATIVE_INFINITY;
        let maximum_y = Number.NEGATIVE_INFINITY;

        for (const point of points) {
            const x = Number(point && point.x);
            const y = Number(point && point.y);

            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }

            minimum_x = Math.min(minimum_x, x);
            minimum_y = Math.min(minimum_y, y);
            maximum_x = Math.max(maximum_x, x);
            maximum_y = Math.max(maximum_y, y);
        }

        if (!Number.isFinite(minimum_x)) {
            return null;
        }

        return {
            minimum_x,
            minimum_y,
            maximum_x,
            maximum_y
        };
    }

    function trajectory_bounds(session, pipe) {
        if (!session || !pipe || !Array.isArray(pipe.cells) ||
            pipe.cells.length === 0) {
            return null;
        }

        const bounds = geometry_bounds(pipe.cells);

        if (!bounds) {
            return null;
        }

        const head = pipe.cells[pipe.cells.length - 1];
        const direction_x = Number(pipe.direction && pipe.direction.x) || 0;
        const direction_y = Number(pipe.direction && pipe.direction.y) || 0;
        const columns = Number(session.grid && session.grid.columns) || 0;
        const rows = Number(session.grid && session.grid.rows) || 0;
        let exit_x = Number(head.x);
        let exit_y = Number(head.y);

        if (direction_x > 0) {
            exit_x = columns;
        } else if (direction_x < 0) {
            exit_x = -1;
        }

        if (direction_y > 0) {
            exit_y = rows;
        } else if (direction_y < 0) {
            exit_y = -1;
        }

        bounds.minimum_x = Math.min(bounds.minimum_x, exit_x);
        bounds.minimum_y = Math.min(bounds.minimum_y, exit_y);
        bounds.maximum_x = Math.max(bounds.maximum_x, exit_x);
        bounds.maximum_y = Math.max(bounds.maximum_y, exit_y);
        return bounds;
    }

    function bounds_can_collide(left, right) {
        if (!left || !right) {
            return true;
        }

        return left.maximum_x + COLLISION_DISTANCE > right.minimum_x &&
            right.maximum_x + COLLISION_DISTANCE > left.minimum_x &&
            left.maximum_y + COLLISION_DISTANCE > right.minimum_y &&
            right.maximum_y + COLLISION_DISTANCE > left.minimum_y;
    }

    function point_distance_squared(left, right) {
        const difference_x = left.x - right.x;
        const difference_y = left.y - right.y;
        return difference_x * difference_x + difference_y * difference_y;
    }

    function geometries_collide(session, left_points, right_points) {
        if (left_points.length === 0 || right_points.length === 0) {
            return false;
        }

        if (!bounds_can_collide(
            geometry_bounds(left_points),
            geometry_bounds(right_points)
        )) {
            return false;
        }

        const minimum_distance_squared =
            COLLISION_DISTANCE * COLLISION_DISTANCE;

        if (left_points.length === 1 && right_points.length === 1) {
            return point_distance_squared(
                left_points[0],
                right_points[0]
            ) < minimum_distance_squared;
        }

        if (left_points.length === 1) {
            for (let index = 0; index < right_points.length - 1; index += 1) {
                if (session.point_segment_distance_squared(
                    left_points[0],
                    right_points[index],
                    right_points[index + 1]
                ) < minimum_distance_squared) {
                    return true;
                }
            }

            return false;
        }

        if (right_points.length === 1) {
            for (let index = 0; index < left_points.length - 1; index += 1) {
                if (session.point_segment_distance_squared(
                    right_points[0],
                    left_points[index],
                    left_points[index + 1]
                ) < minimum_distance_squared) {
                    return true;
                }
            }

            return false;
        }

        for (
            let left_index = 0;
            left_index < left_points.length - 1;
            left_index += 1
        ) {
            for (
                let right_index = 0;
                right_index < right_points.length - 1;
                right_index += 1
            ) {
                if (session.segment_distance_squared(
                    left_points[left_index],
                    left_points[left_index + 1],
                    right_points[right_index],
                    right_points[right_index + 1]
                ) < minimum_distance_squared) {
                    return true;
                }
            }
        }

        return false;
    }

    function pair_cache_key(session, candidate_pipe, moving_pipe, progress) {
        return [
            Number(session && session.state_revision) || 0,
            pipe_key(candidate_pipe),
            pipe_key(moving_pipe),
            String(Number(progress) || 0)
        ].join("|");
    }

    function capture_runtime() {
        const Renderer = global_scope.ChoobsCanvasRenderer;
        const Session = global_scope.Choobs &&
            global_scope.Choobs.PuzzleSession;

        if (!Renderer || !Renderer.prototype ||
            !Session || !Session.prototype) {
            return null;
        }

        const renderer_prototype = Renderer.prototype;
        const session_prototype = Session.prototype;

        if (!renderer_prototype[BREATH_RENDERER_FLAG] ||
            !session_prototype[STRICT_RULES_FLAG] ||
            typeof renderer_prototype.render !== "function" ||
            typeof session_prototype.simulate_pair_collision !== "function") {
            return null;
        }

        return {
            renderer_prototype,
            session_prototype,
            render_before_performance: renderer_prototype.render,
            simulate_pair_collision: session_prototype.simulate_pair_collision
        };
    }

    function install_renderer_restore(runtime) {
        const prototype = runtime.renderer_prototype;

        if (prototype[INSTALL_FLAG]) {
            return true;
        }

        if (!prototype[PERFORMANCE_RENDERER_FLAG]) {
            return false;
        }

        const performance_render = prototype.render;
        const render_before_performance = runtime.render_before_performance;

        prototype.render = function (session, visual_state = {}) {
            const breath_active = pipe_breath_is_active(this, visual_state);
            const static_cache_enabled = Boolean(
                this.__choobs_static_cache_enabled
            );

            if (breath_active && static_cache_enabled) {
                if (!this.__choobs_breath_restore_active) {
                    this.__choobs_breath_restore_active = true;
                    this.background_dirty = true;
                }

                this.__choobs_static_cache_enabled = false;

                try {
                    return render_before_performance.call(
                        this,
                        session,
                        visual_state
                    );
                } finally {
                    this.__choobs_static_cache_enabled = true;
                }
            }

            if (this.__choobs_breath_restore_active) {
                this.__choobs_breath_restore_active = false;
                this.background_dirty = true;
            }

            return performance_render.call(this, session, visual_state);
        };

        Object.defineProperty(prototype, INSTALL_FLAG, { value: true });
        return true;
    }

    function install_session_optimizations(runtime) {
        const prototype = runtime.session_prototype;

        if (prototype[INSTALL_FLAG]) {
            return true;
        }

        if (!prototype[PERFORMANCE_SESSION_FLAG] ||
            typeof prototype.start_ready_queued_pipes !== "function") {
            return false;
        }

        const performance_start_ready_queued_pipes =
            prototype.start_ready_queued_pipes;
        const strict_simulate_pair_collision =
            runtime.simulate_pair_collision;

        prototype.simulation_states_collide = function (
            left_state,
            right_state
        ) {
            return geometries_collide(
                this,
                this.get_simulation_render_cells(left_state),
                this.get_simulation_render_cells(right_state)
            );
        };

        prototype.simulate_pair_collision = function (
            candidate_pipe,
            moving_pipe,
            moving_progress
        ) {
            if (!bounds_can_collide(
                trajectory_bounds(this, candidate_pipe),
                trajectory_bounds(this, moving_pipe)
            )) {
                return false;
            }

            const scan_cache = this.__choobs_pair_collision_scan_cache;
            const cache_key = scan_cache ? pair_cache_key(
                this,
                candidate_pipe,
                moving_pipe,
                moving_progress
            ) : null;

            if (scan_cache && scan_cache.has(cache_key)) {
                return scan_cache.get(cache_key);
            }

            const result = strict_simulate_pair_collision.call(
                this,
                candidate_pipe,
                moving_pipe,
                moving_progress
            );

            if (scan_cache) {
                scan_cache.set(cache_key, result);
            }

            return result;
        };

        prototype.start_ready_queued_pipes = function () {
            if (this.__choobs_pair_collision_scan_cache) {
                return performance_start_ready_queued_pipes.apply(
                    this,
                    arguments
                );
            }

            this.__choobs_pair_collision_scan_cache = new Map();

            try {
                return performance_start_ready_queued_pipes.apply(
                    this,
                    arguments
                );
            } finally {
                this.__choobs_pair_collision_scan_cache = null;
            }
        };

        Object.defineProperty(prototype, INSTALL_FLAG, { value: true });
        return true;
    }

    function install_runtime() {
        if (!captured_runtime) {
            captured_runtime = capture_runtime();
        }

        if (!captured_runtime) {
            return false;
        }

        const renderer_ready = install_renderer_restore(captured_runtime);
        const session_ready = install_session_optimizations(captured_runtime);
        return renderer_ready && session_ready;
    }

    const api = Object.freeze({
        bounds_can_collide,
        capture_runtime,
        geometries_collide,
        install_runtime,
        pipe_breath_is_active,
        trajectory_bounds
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    captured_runtime = capture_runtime();

    if (!install_runtime() && typeof global_scope.setTimeout === "function") {
        let attempts = 0;

        const wait_for_performance_pass = () => {
            if (install_runtime()) {
                return;
            }

            attempts += 1;

            if (attempts < 240) {
                global_scope.setTimeout(wait_for_performance_pass, 25);
            }
        };

        global_scope.setTimeout(wait_for_performance_pass, 0);
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
