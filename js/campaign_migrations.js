(() => {
    "use strict";

    const PROGRESS_KEY = "choobs_campaign_progress_v1";
    const LEGACY_KEY = "choobs_completed_levels";
    const AUTOSAVE_KEY = "choobs_autosave_v1";
    const LEGACY_CAMPAIGN_LEVELS = Object.freeze({
        Flags: Object.freeze({
            15: 1,
            25: 2,
            26: 3,
            27: 4,
            28: 5
        }),
        Other: Object.freeze({
            18: 1,
            19: 2,
            22: 3,
            23: 4,
            24: 5,
            29: 6
        }),
        Superheroes: Object.freeze({
            12: 1,
            13: 2,
            14: 3,
            16: 4,
            17: 5,
            20: 6,
            21: 7
        })
    });

    function read_json(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (_error) {
            return fallback;
        }
    }

    function write_json(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function migrate_autosave(autosave) {
        if (!autosave || typeof autosave !== "object" ||
            autosave.campaign_id) {
            return false;
        }

        const legacy_number = Number(autosave.level_number);

        for (const [campaign_id, mapping] of Object.entries(
            LEGACY_CAMPAIGN_LEVELS
        )) {
            if (!Object.prototype.hasOwnProperty.call(
                mapping,
                legacy_number
            )) {
                continue;
            }

            autosave.campaign_id = campaign_id;
            autosave.level_number = mapping[legacy_number];
            return true;
        }

        return false;
    }

    try {
        const raw_progress = read_json(PROGRESS_KEY, {});
        const progress = raw_progress && typeof raw_progress === "object" &&
            !Array.isArray(raw_progress) ? raw_progress : {};
        const raw_legacy = read_json(LEGACY_KEY, []);
        const legacy = new Set(
            Array.isArray(raw_legacy) ? raw_legacy.map(Number) : []
        );
        let progress_changed = false;

        for (const [campaign_id, mapping] of Object.entries(
            LEGACY_CAMPAIGN_LEVELS
        )) {
            if (Object.prototype.hasOwnProperty.call(progress, campaign_id)) {
                continue;
            }

            progress[campaign_id] = Object.entries(mapping)
                .filter(([legacy_number]) => {
                    return legacy.has(Number(legacy_number));
                })
                .map(([, campaign_number]) => campaign_number)
                .sort((left, right) => left - right);
            progress_changed = true;
        }

        if (progress_changed) {
            write_json(PROGRESS_KEY, progress);
        }

        const stored_autosave = read_json(AUTOSAVE_KEY, null);
        if (migrate_autosave(stored_autosave)) {
            write_json(AUTOSAVE_KEY, stored_autosave);
        }

        const application = globalThis.choobsGame;
        if (application) {
            migrate_autosave(application.pending_autosave);
        }
    } catch (error) {
        console.warn("Campaign progress could not be migrated.", error);
    }
})();
