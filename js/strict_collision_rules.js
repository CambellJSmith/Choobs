(() => {
    "use strict";

    const INSTALL_FLAG = "__choobs_strict_trajectory_rules_installed";
    const PIPE_BREATH_RENDERER_FLAG =
        "__choobs_pipe_breath_renderer_clock_installed";
    const PIPE_BREATH_APPLICATION_FLAG =
        "__choobs_pipe_breath_render_loop_installed";
    const COLLISION_DISTANCE = 0.5;
    const SIMULATION_STEP = 0.025;
    const PIPE_BREATH_IDLE_MS = 5000;
    const PIPE_BREATH_DURATION_MS = 1000;
    const PIPE_BREATH_PERIOD_MS =
        PIPE_BREATH_IDLE_MS + PIPE_BREATH_DURATION_MS;

    function current_time() {
        return globalThis.performance &&
            typeof globalThis.performance.now === "function" ?
                globalThis.performance.now() :
                0;
    }

    function pipe_breath_is_active(elapsed) {
        const numeric_elapsed = Math.max(0, Number(elapsed) || 0);
        const phase = numeric_elapsed % PIPE_BREATH_PERIOD_MS;
        return phase > PIPE_BREATH_IDLE_MS &&
            phase < PIPE_BREATH_PERIOD_MS;
    }

    function install_pipe_breath_renderer_clock() {
        const Renderer = globalThis.ChoobsCanvasRenderer;

        if (!Renderer || !Renderer.prototype) {
            return false;
        }

        const prototype = Renderer.prototype;

        if (prototype[PIPE_BREATH_RENDERER_FLAG]) {
            return true;
        }

        Object.defineProperty(
            prototype,
            PIPE_BREATH_RENDERER_FLAG,
            { value: true }
        );

        const original_set_level = prototype.set_level;
        const original_render = prototype.render;

        prototype.set_level = function () {
            const result = original_set_level.apply(this, arguments);
            this.__choobs_pipe_breath_started_at = current_time();
            this.__choobs_pipe_breath_was_active = false;
            return result;
        };

        prototype.render = function (session, visual_state = {}) {
            const absolute_time = Number(visual_state.time) || current_time();

            if (!Number.isFinite(this.__choobs_pipe_breath_started_at)) {
                this.__choobs_pipe_breath_started_at = absolute_time;
            }

            const epoch = this.__choobs_pipe_breath_started_at;
            const relative_time = Math.max(0.001, absolute_time - epoch);
            const shifted_state = {
                ...visual_state,
                time: relative_time
            };
            const intro_started = Number(visual_state.intro_started);

            if (Number.isFinite(intro_started) && intro_started > 0) {
                shifted_state.intro_started = Math.max(
                    0.001,
                    intro_started - epoch
                );
            }

            if (Array.isArray(visual_state.effects)) {
                shifted_state.effects = visual_state.effects.map((effect) => {
                    const started = Number(effect && effect.started);

                    if (!effect || typeof effect !== "object" ||
                        !Number.isFinite(started)) {
                        return effect;
                    }

                    return {
                        ...effect,
                        started: started - epoch
                    };
                });
            }

            return original_render.call(this, session, shifted_state);
        };

        return true;
    }

    function install_pipe_breath_render_loop(application) {
        if (!application || application[PIPE_BREATH_APPLICATION_FLAG]) {
            return Boolean(application);
        }

        application[PIPE_BREATH_APPLICATION_FLAG] = true;
        const original_frame = application.frame.bind(application);

        application.frame = function (time) {
            const renderer = this.renderer;
            const epoch = Number(
                renderer && renderer.__choobs_pipe_breath_started_at
            );

            if (Number.isFinite(epoch)) {
                const active = pipe_breath_is_active(time - epoch);
                const was_active = Boolean(
                    renderer.__choobs_pipe_breath_was_active
                );

                if (active || was_active) {
                    this.needs_render = true;
                }

                renderer.__choobs_pipe_breath_was_active = active;
            }

            return original_frame(time);
        };

        return true;
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

    function queue_order(queue_data, fallback) {
        return queue_data && Number.isFinite(Number(queue_data.order)) ?
            Number(queue_data.order) :
            fallback;
    }

    function install_strict_trajectory_rules() {
        const Choobs = globalThis.Choobs;

        if (!Choobs || !Choobs.PuzzleSession) {
            return false;
        }

        const prototype = Choobs.PuzzleSession.prototype;

        if (prototype[INSTALL_FLAG]) {
            return true;
        }

        Object.defineProperty(prototype, INSTALL_FLAG, { value: true });

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
            const candidate_state =
                this.create_simulation_state(candidate_pipe, 0);
            const moving_state =
                this.create_simulation_state(moving_pipe, moving_progress);
            const estimated_steps = Math.ceil((
                this.grid.columns +
                this.grid.rows +
                candidate_pipe.cells.length +
                moving_pipe.cells.length +
                8
            ) / SIMULATION_STEP);
            let safety = Math.max(512, estimated_steps);

            if (this.simulation_states_collide(
                candidate_state,
                moving_state
            )) {
                return true;
            }

            while (
                candidate_state.active &&
                moving_state.active &&
                safety > 0
            ) {
                this.advance_simulation_state(
                    candidate_state,
                    SIMULATION_STEP
                );
                this.advance_simulation_state(
                    moving_state,
                    SIMULATION_STEP
                );

                if (
                    candidate_state.active &&
                    moving_state.active &&
                    this.simulation_states_collide(
                        candidate_state,
                        moving_state
                    )
                ) {
                    return true;
                }

                safety -= 1;
            }

            return false;
        };

        prototype.start_ready_queued_pipes = function () {
            if (!(this.queued_pipes instanceof Map) ||
                this.queued_pipes.size === 0) {
                return [];
            }

            const started_pipe_ids = [];
            let queue_changed = false;
            let repeat = true;
            let safety = this.queued_pipes.size + 1;

            while (repeat && safety > 0) {
                repeat = false;
                safety -= 1;

                const ordered_entries = Array.from(
                    this.queued_pipes.entries()
                ).sort((left, right) => {
                    return queue_order(left[1], left[0]) -
                        queue_order(right[1], right[0]);
                });

                for (const [pipe_id, queue_data] of ordered_entries) {
                    const pipe = this.get_pipe(pipe_id);

                    if (!pipe || !pipe.active) {
                        this.queued_pipes.delete(pipe_id);
                        queue_changed = true;
                        repeat = true;
                        continue;
                    }

                    const strict_check = this.get_activation_state(
                        pipe_id,
                        false,
                        true
                    );

                    if (!strict_check.ok) {
                        continue;
                    }

                    this.queued_pipes.delete(pipe_id);
                    const activation = this.request_activation(pipe_id);

                    if (activation.ok && !activation.queued) {
                        started_pipe_ids.push(pipe_id);
                        queue_changed = true;
                        repeat = true;
                    } else {
                        this.queued_pipes.set(pipe_id, queue_data);
                    }
                }
            }

            if (queue_changed) {
                this.mark_state_changed();
            }

            return started_pipe_ids;
        };

        return true;
    }

    install_pipe_breath_renderer_clock();

    if (!install_strict_trajectory_rules()) {
        let attempts = 0;
        const wait_for_engine = () => {
            const rules_ready = install_strict_trajectory_rules();
            const renderer_ready = install_pipe_breath_renderer_clock();

            if (rules_ready && renderer_ready) {
                return;
            }

            attempts += 1;

            if (attempts < 240) {
                globalThis.setTimeout(wait_for_engine, 25);
            }
        };

        globalThis.setTimeout(wait_for_engine, 0);
    }

    if (typeof globalThis.setTimeout === "function") {
        let game_attempts = 0;
        const wait_for_game = () => {
            if (install_pipe_breath_render_loop(globalThis.choobsGame)) {
                return;
            }

            game_attempts += 1;

            if (game_attempts < 240) {
                globalThis.setTimeout(wait_for_game, 25);
            }
        };

        globalThis.setTimeout(wait_for_game, 0);
    }
})();
