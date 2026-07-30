(() => {
    "use strict";

    const INSTALL_FLAG = "__choobs_strict_trajectory_rules_installed";
    const COLLISION_DISTANCE = 0.5;
    const SIMULATION_STEP = 0.025;

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

    if (!install_strict_trajectory_rules()) {
        let attempts = 0;
        const wait_for_engine = () => {
            if (install_strict_trajectory_rules()) {
                return;
            }

            attempts += 1;

            if (attempts < 240) {
                globalThis.setTimeout(wait_for_engine, 25);
            }
        };

        globalThis.setTimeout(wait_for_engine, 0);
    }
})();
