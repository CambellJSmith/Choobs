(function (global_scope) {
    "use strict";

    class PipeOnlyCanvasRenderer extends global_scope.ChoobsCanvasRenderer {
        draw_board_background(_context) {}

        draw_grid(_context) {}
    }

    global_scope.ChoobsCanvasRenderer = PipeOnlyCanvasRenderer;

    const Choobs = global_scope.Choobs;

    if (!Choobs || !Choobs.PuzzleSession) {
        return;
    }

    const session_prototype = Choobs.PuzzleSession.prototype;

    function ensure_queue_state(session) {
        if (!(session.queued_pipes instanceof Map)) {
            session.queued_pipes = new Map();
        }

        if (!Number.isInteger(session.queue_sequence)) {
            session.queue_sequence = 0;
        }
    }

    if (!session_prototype.__choobs_queue_rules_installed) {
        Object.defineProperty(
            session_prototype,
            "__choobs_queue_rules_installed",
            { value: true }
        );

        const original_reset = session_prototype.reset;
        const original_activate = session_prototype.activate;
        const original_get_moving_collision =
            session_prototype.get_moving_collision;

        session_prototype.reset = function () {
            ensure_queue_state(this);
            const result = original_reset.apply(this, arguments);
            this.queued_pipes.clear();
            this.queue_sequence = 0;
            return result;
        };

        session_prototype.get_queued_count = function () {
            ensure_queue_state(this);
            return this.queued_pipes.size;
        };

        session_prototype.is_queued = function (pipe_id) {
            ensure_queue_state(this);
            return this.queued_pipes.has(pipe_id);
        };

        session_prototype.get_activation_state = function (
            pipe_id,
            allow_queue_dependencies = true
        ) {
            ensure_queue_state(this);
            const pipe = this.get_pipe(pipe_id);

            if (!pipe || !pipe.active) {
                return { ok: false, reason: "inactive" };
            }

            if (this.moving_pipes.has(pipe_id)) {
                return { ok: false, reason: "already_moving" };
            }

            if (this.queued_pipes.has(pipe_id)) {
                return { ok: false, reason: "already_queued" };
            }

            const stationary_blockers = new Set();
            const queued_blockers = new Set();
            const head = pipe.cells[pipe.cells.length - 1];
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;

            while (this.grid.is_inside(x, y)) {
                const occupant = this.grid.get_occupant(x, y);

                if (occupant !== -1 && occupant !== pipe.id) {
                    if (this.moving_pipes.has(occupant)) {
                        // Moving pipes are handled by the continuous collision test.
                    } else if (this.queued_pipes.has(occupant)) {
                        queued_blockers.add(occupant);
                    } else {
                        stationary_blockers.add(occupant);
                    }
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            if (stationary_blockers.size > 0) {
                const blockers = Array.from(stationary_blockers);
                return {
                    ok: false,
                    reason: "occupied",
                    blocker: blockers[0],
                    blockers
                };
            }

            const moving_collision = original_get_moving_collision.call(
                this,
                pipe
            );
            const transient_blockers = Array.from(queued_blockers);

            if (moving_collision !== -1 &&
                !transient_blockers.includes(moving_collision)) {
                transient_blockers.push(moving_collision);
            }

            if (transient_blockers.length > 0) {
                if (allow_queue_dependencies) {
                    return {
                        ok: true,
                        reason: "queueable",
                        queueable: true,
                        blocker: transient_blockers[0],
                        blockers: transient_blockers
                    };
                }

                return {
                    ok: false,
                    reason: "collision",
                    blocker: transient_blockers[0],
                    blockers: transient_blockers
                };
            }

            return { ok: true, reason: "clear", queueable: false };
        };

        session_prototype.can_activate = function (pipe_id) {
            return this.get_activation_state(pipe_id, true);
        };

        session_prototype.request_activation = function (pipe_id) {
            ensure_queue_state(this);
            const check = this.get_activation_state(pipe_id, true);

            if (!check.ok) {
                return check;
            }

            if (check.queueable) {
                this.queue_sequence += 1;
                this.queued_pipes.set(pipe_id, {
                    order: this.queue_sequence,
                    blockers: Array.from(check.blockers || [])
                });
                this.mark_state_changed();
                return {
                    ok: true,
                    reason: "queued",
                    queued: true,
                    blocker: check.blocker,
                    blockers: Array.from(check.blockers || [])
                };
            }

            return original_activate.call(this, pipe_id);
        };

        session_prototype.activate = function (pipe_id) {
            return this.request_activation(pipe_id);
        };

        session_prototype.start_ready_queued_pipes = function () {
            ensure_queue_state(this);
            const started_pipe_ids = [];
            let changed = true;
            let safety = this.queued_pipes.size + 1;

            while (changed && safety > 0) {
                changed = false;
                safety -= 1;

                for (const pipe_id of Array.from(this.queued_pipes.keys())) {
                    const pipe = this.get_pipe(pipe_id);

                    if (!pipe || !pipe.active) {
                        this.queued_pipes.delete(pipe_id);
                        changed = true;
                        continue;
                    }

                    const check = this.get_activation_state(pipe_id, false);

                    if (check.reason === "already_queued") {
                        // Temporarily remove this pipe so the strict check can
                        // evaluate its blockers rather than its queue membership.
                        const queue_data = this.queued_pipes.get(pipe_id);
                        this.queued_pipes.delete(pipe_id);
                        const strict_check = this.get_activation_state(
                            pipe_id,
                            false
                        );

                        if (!strict_check.ok) {
                            this.queued_pipes.set(pipe_id, queue_data);
                            continue;
                        }

                        const activation = original_activate.call(this, pipe_id);

                        if (activation.ok) {
                            started_pipe_ids.push(pipe_id);
                            changed = true;
                        } else {
                            this.queued_pipes.set(pipe_id, queue_data);
                        }
                    }
                }
            }

            if (started_pipe_ids.length > 0) {
                this.mark_state_changed();
            }

            return started_pipe_ids;
        };

        session_prototype.request_ready_singletons = function () {
            ensure_queue_state(this);
            const started_pipe_ids = [];
            const queued_pipe_ids = [];

            for (const pipe of this.pipes) {
                if (!pipe.active || pipe.cells.length !== 1 ||
                    this.moving_pipes.has(pipe.id) ||
                    this.queued_pipes.has(pipe.id)) {
                    continue;
                }

                const check = this.get_activation_state(pipe.id, true);

                if (!check.ok) {
                    continue;
                }

                const result = this.request_activation(pipe.id);

                if (!result.ok) {
                    continue;
                }

                if (result.queued) {
                    queued_pipe_ids.push(pipe.id);
                } else {
                    started_pipe_ids.push(pipe.id);
                }
            }

            return { started_pipe_ids, queued_pipe_ids };
        };

        session_prototype.get_removable_pipe_ids = function () {
            ensure_queue_state(this);
            const removable = [];

            for (const pipe of this.pipes) {
                if (pipe.cells.length === 1 ||
                    this.moving_pipes.has(pipe.id) ||
                    this.queued_pipes.has(pipe.id)) {
                    continue;
                }

                if (this.can_activate(pipe.id).ok) {
                    removable.push(pipe.id);
                }
            }

            return removable;
        };
    }

    function add_queued_pipe_visual(renderer) {
        if (!renderer || renderer.__choobs_queued_visual_installed) {
            return;
        }

        renderer.__choobs_queued_visual_installed = true;
        const original_draw_pipe = renderer.draw_pipe;

        renderer.draw_pipe = function (
            context,
            session,
            pipe,
            visual_state,
            time
        ) {
            original_draw_pipe.call(
                this,
                context,
                session,
                pipe,
                visual_state,
                time
            );

            if (!session.queued_pipes ||
                !session.queued_pipes.has(pipe.id) ||
                session.moving_pipes.has(pipe.id) ||
                !pipe.active) {
                return;
            }

            const render_cells = session.get_render_cells(pipe.id);

            if (render_cells.length === 0) {
                return;
            }

            const head = render_cells[render_cells.length - 1];
            const center = this.cell_center(head.x, head.y);
            const cell_size = this.board_bounds.cell_size;

            context.save();
            context.globalAlpha = 0.9;
            context.strokeStyle = "#ffb45f";
            context.lineWidth = Math.max(1, cell_size * 0.075);
            context.setLineDash([
                Math.max(1.5, cell_size * 0.12),
                Math.max(1.5, cell_size * 0.1)
            ]);
            context.beginPath();
            context.arc(
                center.x,
                center.y,
                Math.max(2.5, cell_size * 0.38),
                0,
                Math.PI * 2
            );
            context.stroke();
            context.restore();
        };
    }

    function get_pipe_selection_cell(pipe) {
        if (!pipe || !Array.isArray(pipe.cells) || pipe.cells.length === 0) {
            return { x: 0, y: 0 };
        }

        return {
            x: pipe.cells[0].x,
            y: pipe.cells[0].y
        };
    }

    function record_started_pipes(application, pipe_ids, time) {
        if (!application.session || pipe_ids.length === 0) {
            return;
        }

        const unique_ids = Array.from(new Set(pipe_ids));

        for (const pipe_id of unique_ids) {
            const pipe = application.session.get_pipe(pipe_id);

            if (!pipe) {
                continue;
            }

            const selected_cell =
                application.__choobs_queued_activation_cells.get(pipe_id) ||
                get_pipe_selection_cell(pipe);
            application.__choobs_queued_activation_cells.delete(pipe_id);
            application.record_activation(pipe, selected_cell, time);
        }
    }

    function process_automatic_rules(application, time) {
        if (!application.game_mode || !application.session ||
            application.is_paused || application.penalty_at > 0 ||
            application.session.is_complete()) {
            return;
        }

        if (application.__choobs_rule_session !== application.session) {
            application.__choobs_rule_session = application.session;
            application.__choobs_queued_activation_cells.clear();
            ensure_queue_state(application.session);
        }

        const singleton_result =
            application.session.request_ready_singletons();

        for (const pipe_id of singleton_result.queued_pipe_ids) {
            const pipe = application.session.get_pipe(pipe_id);
            application.__choobs_queued_activation_cells.set(
                pipe_id,
                get_pipe_selection_cell(pipe)
            );
        }

        const started_from_queue =
            application.session.start_ready_queued_pipes();
        const started_pipe_ids = [
            ...singleton_result.started_pipe_ids,
            ...started_from_queue
        ];

        if (started_pipe_ids.length > 0) {
            record_started_pipes(application, started_pipe_ids, time);
        }

        if (started_pipe_ids.length > 0 ||
            singleton_result.queued_pipe_ids.length > 0) {
            application.hovered_pipe_id = -1;
            application.hovered_pipe_is_clear = false;
            application.needs_render = true;
            application.save_current_progress("automatic_pipe_activation");
        }
    }

    function install_game_rules(application) {
        if (!application || application.__choobs_queue_rules_installed) {
            return;
        }

        application.__choobs_queue_rules_installed = true;
        application.__choobs_rule_session = null;
        application.__choobs_queued_activation_cells = new Map();
        add_queued_pipe_visual(application.renderer);

        const original_frame = application.frame.bind(application);
        const original_handle_pointer_move =
            application.handle_pointer_move.bind(application);
        const original_create_session_snapshot =
            application.create_session_snapshot.bind(application);
        const original_restore_session_snapshot =
            application.restore_session_snapshot.bind(application);

        application.frame = function (time) {
            process_automatic_rules(this, time);
            return original_frame(time);
        };

        application.handle_pointer_move = function (event) {
            original_handle_pointer_move(event);

            if (!this.session || this.hovered_pipe_id < 0) {
                return;
            }

            const pipe = this.session.get_pipe(this.hovered_pipe_id);

            if (pipe && pipe.cells.length === 1) {
                this.hovered_pipe_id = -1;
                this.hovered_pipe_is_clear = false;
                this.elements.game_canvas.style.cursor = "default";
                this.needs_render = true;
            }
        };

        application.handle_pointer_down = function (event) {
            if (!this.game_mode || !this.session || this.is_paused ||
                this.session.is_complete() || this.penalty_at > 0) {
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
            const time = performance.now();

            if (pipe && pipe.cells.length === 1) {
                process_automatic_rules(this, time);
                this.set_status("Single-cell pipes move automatically.");
                return;
            }

            const result = this.session.request_activation(pipe_id);

            if (!result.ok) {
                if (result.reason === "already_queued") {
                    this.set_status("That pipe is already queued.");
                    return;
                }

                if (result.reason === "already_moving") {
                    this.set_status("That pipe is already moving.");
                    return;
                }

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

                if (result.reason === "occupied" ||
                    result.reason === "collision") {
                    this.register_invalid_activation(time);
                } else {
                    this.set_status("That pipe cannot move yet.");
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

                if (result.queued) {
                    this.__choobs_queued_activation_cells.set(
                        pipe.id,
                        { x: cell.x, y: cell.y }
                    );
                    this.add_effect({
                        type: "ripple",
                        x: cell.x,
                        y: cell.y,
                        color: "#ffb45f",
                        strength: 1.1,
                        started: time,
                        duration: this.reduced_motion ? 1 : 330
                    });
                } else {
                    this.record_activation(pipe, cell, time);
                }
            }

            this.hovered_pipe_id = -1;
            this.hovered_pipe_is_clear = false;
            this.vibrate(result.queued ? 5 : 8);
            this.needs_render = true;
            this.save_current_progress(
                result.queued ? "line_click_queued" : "line_click_valid"
            );
            this.set_status(
                `${result.queued ? "Queued · " : ""}+${
                    this.format_score(awarded_points)
                } points${
                    this.combo_count > 1 ? ` · ×${this.combo_count} combo` : ""
                }.`
            );
        };

        application.create_session_snapshot = function () {
            const snapshot = original_create_session_snapshot();

            if (snapshot && this.session) {
                ensure_queue_state(this.session);
                snapshot.queued_pipes = Array.from(
                    this.session.queued_pipes.keys()
                );
            }

            return snapshot;
        };

        application.restore_session_snapshot = function (autosave) {
            const snapshot = autosave && autosave.session;
            const queued_ids = snapshot && Array.isArray(snapshot.queued_pipes) ?
                snapshot.queued_pipes.map(Number) :
                [];
            const unique_ids = new Set(queued_ids);

            if (unique_ids.size !== queued_ids.length ||
                queued_ids.some((pipe_id) => !Number.isInteger(pipe_id))) {
                return false;
            }

            const restored = original_restore_session_snapshot(autosave);

            if (!restored || !this.session) {
                return restored;
            }

            ensure_queue_state(this.session);
            this.session.queued_pipes.clear();

            for (const pipe_id of queued_ids) {
                const pipe = this.session.get_pipe(pipe_id);

                if (!pipe || !pipe.active ||
                    this.session.moving_pipes.has(pipe_id)) {
                    this.session.reset();
                    return false;
                }

                this.session.queue_sequence += 1;
                this.session.queued_pipes.set(pipe_id, {
                    order: this.session.queue_sequence,
                    blockers: []
                });
            }

            this.session.mark_state_changed();
            return true;
        };

        process_automatic_rules(application, performance.now());
    }

    if (typeof document !== "undefined" &&
        typeof global_scope.setTimeout === "function") {
        let attempts = 0;

        const wait_for_game = () => {
            if (global_scope.choobsGame) {
                install_game_rules(global_scope.choobsGame);
                return;
            }

            attempts += 1;

            if (attempts < 240) {
                global_scope.setTimeout(wait_for_game, 25);
            }
        };

        global_scope.setTimeout(wait_for_game, 0);
    }
})(globalThis);
