"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

class StorageMock {
    constructor(values) {
        this.values = new Map(Object.entries(values));
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

const storage = new StorageMock({
    choobs_campaign_progress_v1: JSON.stringify({ Flags: [99] }),
    choobs_completed_levels: JSON.stringify([12, 18, 25]),
    choobs_autosave_v1: JSON.stringify({ level_number: 19 })
});

globalThis.localStorage = storage;
globalThis.choobsGame = {
    pending_autosave: { level_number: 18 }
};

const module_path = path.resolve(
    __dirname,
    "../js/campaign_migrations.js"
);

delete require.cache[module_path];
require(module_path);

const progress = JSON.parse(
    storage.getItem("choobs_campaign_progress_v1")
);
assert.deepEqual(
    progress.Flags,
    [99],
    "existing campaign progress must be preserved"
);
assert.deepEqual(progress.Other, [1]);
assert.deepEqual(progress.Superheroes, [1]);

const stored_autosave = JSON.parse(
    storage.getItem("choobs_autosave_v1")
);
assert.equal(stored_autosave.campaign_id, "Other");
assert.equal(stored_autosave.level_number, 2);
assert.equal(globalThis.choobsGame.pending_autosave.campaign_id, "Other");
assert.equal(globalThis.choobsGame.pending_autosave.level_number, 1);

const progress_after_first_run = storage.getItem(
    "choobs_campaign_progress_v1"
);
delete require.cache[module_path];
require(module_path);

assert.equal(
    storage.getItem("choobs_campaign_progress_v1"),
    progress_after_first_run,
    "migration must be idempotent"
);

console.log("Campaign migration tests passed.");
