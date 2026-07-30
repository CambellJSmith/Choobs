(() => {
    "use strict";

    const PROGRESS_KEY = "choobs_campaign_progress_v1";
    const LEGACY_KEY = "choobs_completed_levels";
    const AUTOSAVE_KEY = "choobs_autosave_v1";
    const OTHER_LEVELS = Object.freeze({
        18: 1,
        19: 2,
        22: 3,
        23: 4,
        24: 5,
        29: 6
    });

    try {
        const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");

        if (!progress || typeof progress !== "object" || Array.isArray(progress) ||
            Object.prototype.hasOwnProperty.call(progress, "Other")) {
            return;
        }

        const legacy = new Set(
            JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]").map(Number)
        );
        progress.Other = Object.entries(OTHER_LEVELS)
            .filter(([legacy_number]) => legacy.has(Number(legacy_number)))
            .map(([, campaign_number]) => campaign_number);
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));

        const autosave = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null");
        const legacy_number = Number(autosave && autosave.level_number);

        if (autosave && !autosave.campaign_id &&
            Object.prototype.hasOwnProperty.call(OTHER_LEVELS, legacy_number)) {
            autosave.campaign_id = "Other";
            autosave.level_number = OTHER_LEVELS[legacy_number];
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autosave));
        }
    } catch (error) {
        console.warn("Other campaign progress could not be migrated.", error);
    }
})();
