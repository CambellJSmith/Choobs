(() => {
    "use strict";

    const ROOT_CAMPAIGN_ID = "tutorial-random";
    const TUTORIAL_COUNT = 5;
    const CONTENT_VERSION = "five-step-tutorial-v1";
    const VERSION_KEY = "choobs_tutorial_content_version_v1";
    const TUTORIAL_PATH = /\/levels\/level_00[1-5]\.json$/i;

    function read_json(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "null");
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function write_json(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            // Storage is optional.
        }
    }

    function prepare_storage() {
        try {
            if (localStorage.getItem(VERSION_KEY) === CONTENT_VERSION) {
                return;
            }
        } catch (error) {
            return;
        }

        const raw_progress = read_json("choobs_campaign_progress_v1", {});
        const progress = raw_progress && typeof raw_progress === "object" &&
            !Array.isArray(raw_progress) ? raw_progress : {};
        progress[ROOT_CAMPAIGN_ID] = Array.isArray(progress[ROOT_CAMPAIGN_ID]) ?
            progress[ROOT_CAMPAIGN_ID]
                .map(Number)
                .filter((number) => {
                    return Number.isInteger(number) && number > TUTORIAL_COUNT;
                }) : [];
        write_json("choobs_campaign_progress_v1", progress);

        const names = read_json("choobs_campaign_level_names_v1", {});
        const root_names = names && typeof names === "object" ?
            names[ROOT_CAMPAIGN_ID] : null;
        if (root_names && typeof root_names === "object") {
            for (let number = 1; number <= TUTORIAL_COUNT; number += 1) {
                delete root_names[number];
            }
            write_json("choobs_campaign_level_names_v1", names);
        }

        const legacy_completed = read_json("choobs_completed_levels", []);
        if (Array.isArray(legacy_completed)) {
            write_json(
                "choobs_completed_levels",
                legacy_completed.map(Number).filter((number) => {
                    return Number.isInteger(number) && number > TUTORIAL_COUNT;
                })
            );
        }

        const legacy_names = read_json("choobs_level_name_cache_v1", {});
        if (legacy_names && typeof legacy_names === "object" &&
            !Array.isArray(legacy_names)) {
            for (let number = 1; number <= TUTORIAL_COUNT; number += 1) {
                delete legacy_names[number];
            }
            write_json("choobs_level_name_cache_v1", legacy_names);
        }

        const autosave = read_json("choobs_autosave_v1", null);
        if (autosave && typeof autosave === "object") {
            const campaign_id = autosave.campaign_id || ROOT_CAMPAIGN_ID;
            const level_number = Math.floor(Number(autosave.level_number) || 0);
            if (campaign_id === ROOT_CAMPAIGN_ID &&
                level_number >= 1 && level_number <= TUTORIAL_COUNT) {
                try {
                    localStorage.removeItem("choobs_autosave_v1");
                } catch (error) {
                    // Storage is optional.
                }
            }
        }

        try {
            localStorage.setItem(VERSION_KEY, CONTENT_VERSION);
        } catch (error) {
            // Storage is optional.
        }
    }

    function rebuild_mask(raw_level) {
        const columns = Math.floor(Number(raw_level.columns) || 0);
        const rows = Math.floor(Number(raw_level.rows) || 0);
        const mask = new Array(Math.max(0, columns * rows)).fill(0);

        for (const pipe of Array.isArray(raw_level.pipes) ? raw_level.pipes : []) {
            for (const raw_cell of Array.isArray(pipe.cells) ? pipe.cells : []) {
                const x = Number(Array.isArray(raw_cell) ? raw_cell[0] : raw_cell.x);
                const y = Number(Array.isArray(raw_cell) ? raw_cell[1] : raw_cell.y);
                if (Number.isInteger(x) && Number.isInteger(y) &&
                    x >= 0 && x < columns && y >= 0 && y < rows) {
                    mask[y * columns + x] = 1;
                }
            }
        }

        raw_level.mask = mask;
        return raw_level;
    }

    function install_tutorial_fetch_repair() {
        if (typeof globalThis.fetch !== "function" ||
            globalThis.__choobs_tutorial_fetch_repair) {
            return;
        }

        globalThis.__choobs_tutorial_fetch_repair = true;
        const original_fetch = globalThis.fetch.bind(globalThis);

        globalThis.fetch = async function (input, options) {
            const response = await original_fetch(input, options);
            const raw_url = typeof input === "string" || input instanceof URL ?
                String(input) : input && input.url;
            let url = null;

            try {
                url = new URL(raw_url || response.url, document.baseURI);
            } catch (error) {
                return response;
            }

            if (!response.ok || !TUTORIAL_PATH.test(url.pathname)) {
                return response;
            }

            try {
                const raw_level = rebuild_mask(await response.clone().json());
                return new Response(JSON.stringify(raw_level), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: { "content-type": "application/json" }
                });
            } catch (error) {
                console.warn("Tutorial mask could not be reconstructed.", error);
                return response;
            }
        };
    }

    prepare_storage();
    install_tutorial_fetch_repair();
})();
