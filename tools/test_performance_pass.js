"use strict";

const assert = require("node:assert/strict");

let clock = 1000;
globalThis.performance = { now: () => clock };

class Grid {
    constructor(columns, rows) {
        this.columns = columns;
        this.rows = rows;
        this.occupancy = new Int32Array(columns * rows);
        this.occupancy.fill(-1);
    }

    index(x, y) {
        return y * this.columns + x;
    }

    is_inside(x, y) {
        return x >= 0 && x < this.columns && y >= 0 && y < this.rows;
    }

    set_occupant(x, y, pipe_id) {
        if (this.is_inside(x, y)) {
            this.occupancy[this.index(x, y)] = pipe_id;
        }
    }
}

class FakeSession {
    constructor() {
        this.state_revision = 1;
        this.moving_pipes = new Map();
        this.queued_pipes = new Map();
        this.move_duration = 50;
        this.completed_pipe_count = 0;
        this.level = { columns: 50, rows: 50 };
        this.grid = new Grid(6, 1);
        this.pipes = [{
            id: 0,
            active: true,
            cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
            direction: { x: 1, y: 0 }
        }];
        this.pipe_by_id = new Map([[0, this.pipes[0]]]);
        this.singleton_scans = 0;
        this.queue_scans = 0;
        this.rebuilds = 0;
        this.grid.set_occupant(0, 0, 0);
        this.grid.set_occupant(1, 0, 0);
    }

    request_ready_singletons() {
        this.singleton_scans += 1;
        return { started_pipe_ids: [], queued_pipe_ids: [] };
    }

    start_ready_queued_pipes() {
        this.queue_scans += 1;
        return [];
    }

    get_pipe(pipe_id) {
        return this.pipe_by_id.get(pipe_id) || null;
    }

    mark_state_changed() {
        this.state_revision += 1;
    }

    rebuild_occupancy() {
        this.rebuilds += 1;
    }

    advance_pipe_step(pipe_id) {
        const pipe = this.get_pipe(pipe_id);
        const head = pipe.cells[pipe.cells.length - 1];
        pipe.cells.shift();
        pipe.cells.push({
            x: head.x + pipe.direction.x,
            y: head.y + pipe.direction.y
        });
        return false;
    }
}

Object.defineProperty(
    FakeSession.prototype,
    "__choobs_queue_rules_installed",
    { value: true }
);
Object.defineProperty(
    FakeSession.prototype,
    "__choobs_strict_trajectory_rules_installed",
    { value: true }
);

function make_context() {
    return {
        save() {},
        restore() {},
        setTransform() {}
    };
}

class BaseRenderer {
    draw_pipe() {
        this.base_pipe_draws += 1;
    }
}

class FakeRenderer extends BaseRenderer {
    constructor() {
        super();
        this.background_dirty = true;
        this.background_canvas = { width: 100, height: 100 };
        this.background_context = make_context();
        this.css_width = 100;
        this.base_renders = 0;
        this.base_pipe_draws = 0;
        this.live_pipe_draws = 0;
    }

    ensure_background_cache() {
        this.background_dirty = false;
    }

    draw_pipe() {
        this.live_pipe_draws += 1;
    }

    render(session, visual_state) {
        this.base_renders += 1;
        this.ensure_background_cache();

        for (const pipe of session.pipes) {
            if (pipe.active) {
                this.draw_pipe(
                    this.background_context,
                    session,
                    pipe,
                    visual_state,
                    visual_state.time
                );
            }
        }
    }
}

globalThis.Choobs = { PuzzleSession: FakeSession };
globalThis.ChoobsCanvasRenderer = FakeRenderer;

const performance_pass = require("../js/performance_pass.js");
assert.equal(performance_pass.install_runtime(), true);

const session = new FakeSession();
for (let frame = 0; frame < 600; frame += 1) {
    session.request_ready_singletons();
}
assert.equal(session.singleton_scans, 1);
session.mark_state_changed();
session.request_ready_singletons();
assert.equal(session.singleton_scans, 2);

session.start_ready_queued_pipes();
session.start_ready_queued_pipes();
assert.equal(session.queue_scans, 1);
session.moving_pipes.set(0, { progress: 0 });
session.queued_pipes.set(4, {});
clock += 41;
session.start_ready_queued_pipes();
assert.equal(session.queue_scans, 2);

session.queued_pipes.clear();
session.moving_pipes.set(0, { progress: 0 });
const before_revision = session.state_revision;
const update = session.update(50);
assert.equal(update.state_changed, true);
assert.equal(session.state_revision, before_revision + 1);
assert.equal(session.rebuilds, 0);
assert.equal(session.grid.occupancy[0], -1);
assert.equal(session.grid.occupancy[1], 0);
assert.equal(session.grid.occupancy[2], 0);

session.moving_pipes.clear();
const renderer = new FakeRenderer();
const idle_state = {
    time: 2000,
    hovered_pipe_id: -1,
    hint_pipe_id: -1,
    blocked_pipe_id: -1,
    blocker_pipe_id: -1,
    effects: [],
    intro_started: 0
};
for (let frame = 0; frame < 600; frame += 1) {
    renderer.render(session, { ...idle_state, time: 2000 + frame * 16 });
}
assert.equal(renderer.base_renders, 1);
assert.equal(renderer.base_pipe_draws, 1);
assert.equal(renderer.live_pipe_draws, 0);

renderer.render(session, { ...idle_state, hovered_pipe_id: 0, time: 2200 });
assert.equal(renderer.base_renders, 2);
assert.equal(renderer.live_pipe_draws, 1);
renderer.render(session, { ...idle_state, time: 2300 });
assert.equal(renderer.base_renders, 3);

const small_session = new FakeSession();
small_session.level = { columns: 10, rows: 10 };
small_session.moving_pipes.clear();
const small_renderer = new FakeRenderer();
small_renderer.render(small_session, idle_state);
small_renderer.render(small_session, { ...idle_state, time: 2100 });
assert.equal(small_renderer.base_renders, 2);
assert.equal(small_renderer.live_pipe_draws, 2);

console.log("performance pass tests passed");
