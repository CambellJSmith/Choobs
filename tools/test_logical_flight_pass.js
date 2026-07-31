"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const BREATH_RENDERER_FLAG =
    "__choobs_pipe_breath_renderer_clock_installed";
const STRICT_RULES_FLAG =
    "__choobs_strict_trajectory_rules_installed";
const PERFORMANCE_RENDERER_FLAG =
    "__choobs_performance_renderer_installed";
const PERFORMANCE_SESSION_FLAG =
    "__choobs_performance_session_installed";

let strict_render_calls = 0;
let performance_render_calls = 0;
let strict_static_cache_value = null;
let strict_background_dirty_value = null;
let strict_pair_calls = 0;

class Renderer {
    constructor() {
        this.__choobs_static_cache_enabled = true;
        this.__choobs_pipe_breath_started_at = 100;
        this.background_dirty = false;
    }
}

const draw_pipe_reference = function () {};
const speed_streak_reference = function () {};
const motion_tip_reference = function () {};

Renderer.prototype[BREATH_RENDERER_FLAG] = true;
Renderer.prototype.draw_pipe = draw_pipe_reference;
Renderer.prototype.draw_speed_streaks = speed_streak_reference;
Renderer.prototype.draw_motion_tip = motion_tip_reference;
Renderer.prototype.render = function () {
    strict_render_calls += 1;
    strict_static_cache_value = this.__choobs_static_cache_enabled;
    strict_background_dirty_value = this.background_dirty;
    this.background_dirty = false;
    return "strict-render";
};

class PuzzleSession {
    constructor() {
        this.grid = { columns: 20, rows: 20 };
        this.state_revision = 7;
        this.__test_candidate = null;
        this.__test_moving = null;
    }

    get_simulation_render_cells(state) {
        return state.points;
    }

    point_segment_distance_squared() {
        return Number.POSITIVE_INFINITY;
    }

    segment_distance_squared() {
        return Number.POSITIVE_INFINITY;
    }
}

PuzzleSession.prototype[STRICT_RULES_FLAG] = true;
PuzzleSession.prototype.simulation_states_collide = function () {
    return true;
};
PuzzleSession.prototype.simulate_pair_collision = function () {
    strict_pair_calls += 1;
    return true;
};
PuzzleSession.prototype.start_ready_queued_pipes = function () {
    return [];
};

globalThis.performance = { now: () => 0 };
globalThis.ChoobsCanvasRenderer = Renderer;
globalThis.Choobs = { PuzzleSession };

const module_path = path.resolve(__dirname, "../js/logical_flight_pass.js");
delete require.cache[module_path];
const pass = require(module_path);

Renderer.prototype[PERFORMANCE_RENDERER_FLAG] = true;
Renderer.prototype.render = function () {
    performance_render_calls += 1;
    return "performance-render";
};

PuzzleSession.prototype[PERFORMANCE_SESSION_FLAG] = true;
PuzzleSession.prototype.start_ready_queued_pipes = function () {
    const first = this.simulate_pair_collision(
        this.__test_candidate,
        this.__test_moving,
        0.25
    );
    const second = this.simulate_pair_collision(
        this.__test_candidate,
        this.__test_moving,
        0.25
    );
    return [first, second];
};

assert.equal(pass.install_runtime(), true);

const renderer = new Renderer();
assert.equal(renderer.render({}, { time: 5101 }), "strict-render");
assert.equal(strict_render_calls, 1);
assert.equal(performance_render_calls, 0);
assert.equal(strict_static_cache_value, false);
assert.equal(strict_background_dirty_value, true);
assert.equal(renderer.__choobs_static_cache_enabled, true);

assert.equal(renderer.render({}, { time: 6100 }), "performance-render");
assert.equal(performance_render_calls, 1);
assert.equal(renderer.background_dirty, true);

assert.equal(Renderer.prototype.draw_pipe, draw_pipe_reference);
assert.equal(Renderer.prototype.draw_speed_streaks, speed_streak_reference);
assert.equal(Renderer.prototype.draw_motion_tip, motion_tip_reference);

const session = new PuzzleSession();
const overlapping_candidate = {
    id: 1,
    cells: [{ x: 1, y: 2 }, { x: 2, y: 2 }],
    direction: { x: 1, y: 0 }
};
const overlapping_moving = {
    id: 2,
    cells: [{ x: 5, y: 2 }, { x: 6, y: 2 }],
    direction: { x: 1, y: 0 }
};
session.__test_candidate = overlapping_candidate;
session.__test_moving = overlapping_moving;

assert.deepEqual(session.start_ready_queued_pipes(), [true, true]);
assert.equal(strict_pair_calls, 1);
assert.equal(session.__choobs_pair_collision_scan_cache, null);

const far_candidate = {
    id: 3,
    cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    direction: { x: 1, y: 0 }
};
const far_moving = {
    id: 4,
    cells: [{ x: 1, y: 15 }, { x: 2, y: 15 }],
    direction: { x: 1, y: 0 }
};
session.__test_candidate = far_candidate;
session.__test_moving = far_moving;

assert.deepEqual(session.start_ready_queued_pipes(), [false, false]);
assert.equal(strict_pair_calls, 1);

assert.equal(
    pass.pipe_breath_is_active(
        { __choobs_pipe_breath_started_at: 100 },
        { time: 5100 }
    ),
    false
);
assert.equal(
    pass.pipe_breath_is_active(
        { __choobs_pipe_breath_started_at: 100 },
        { time: 5101 }
    ),
    true
);
assert.equal(
    pass.pipe_breath_is_active(
        { __choobs_pipe_breath_started_at: 100 },
        { time: 6100 }
    ),
    false
);

console.log("logical flight pass tests passed");
