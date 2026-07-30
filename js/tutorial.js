(() => {
    "use strict";

    const ROOT_CAMPAIGN_ID = "tutorial-random";
    const TUTORIAL_COUNT = 5;
    const TUTORIAL_CONTENT_VERSION = "five-step-tutorial-v1";
    const VERSION_KEY = "choobs_tutorial_content_version_v1";
    const PROGRESS_KEY = "choobs_campaign_progress_v1";
    const NAMES_KEY = "choobs_campaign_level_names_v1";
    const AUTOSAVE_KEY = "choobs_autosave_v1";
    const INSTALL_FLAG = "__choobs_five_step_tutorial_installed";
    const LOADER_FLAG = "__choobs_tutorial_loader_installed";

    function storage_get(key, fallback = null) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function storage_set(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function install_tutorial_loader(application) {
        if (!application || application[LOADER_FLAG]) {
            return Boolean(application);
        }

        application[LOADER_FLAG] = true;
        let assigned_loader =
            application.try_load_manual_level_file.bind(application);
        const tutorial_requests = new Map();

        async function load_tutorial_level(level_number) {
            if (tutorial_requests.has(level_number)) {
                return tutorial_requests.get(level_number);
            }

            const request = (async () => {
                const file_number = String(level_number).padStart(3, "0");
                const level_url = new URL(
                    `./levels/level_${file_number}.json`,
                    document.baseURI
                );
                const response = await fetch(level_url.href, {
                    cache: "no-store"
                });

                if (!response.ok) {
                    return null;
                }

                const raw_level = await response.json();
                raw_level.number = level_number;
                raw_level.settings = {
                    ...(raw_level.settings || {}),
                    campaign_id: ROOT_CAMPAIGN_ID,
                    tutorial: true
                };
                const level = Choobs.normalize_level(raw_level);
                application.manual_levels.set(level_number, level);

                if (typeof application.remember_level_name === "function") {
                    application.remember_level_name(level);
                }

                const index = level_number - 1;
                if (
                    application.levels[index] &&
                    application.levels[index].number === level_number
                ) {
                    application.levels[index] = level;
                }

                return level;
            })().catch((error) => {
                console.warn(
                    `Tutorial level ${level_number} could not be loaded.`,
                    error
                );
                return null;
            });

            tutorial_requests.set(level_number, request);
            return request;
        }

        const dispatch_loader = function (level_number) {
            const normalized = Math.floor(Number(level_number) || 0);
            const campaign_id =
                application.__campaign_state &&
                application.__campaign_state.active ?
                    application.__campaign_state.active.id :
                    ROOT_CAMPAIGN_ID;

            if (
                campaign_id === ROOT_CAMPAIGN_ID &&
                normalized >= 1 &&
                normalized <= TUTORIAL_COUNT
            ) {
                return load_tutorial_level(normalized);
            }

            return assigned_loader.call(application, level_number);
        };

        Object.defineProperty(application, "try_load_manual_level_file", {
            configurable: true,
            enumerable: false,
            get() {
                return dispatch_loader;
            },
            set(value) {
                if (
                    typeof value === "function" &&
                    value !== dispatch_loader
                ) {
                    assigned_loader = value;
                }
            }
        });

        return true;
    }

    function migrate_tutorial_progress(application) {
        const state = application && application.__campaign_state;

        if (!state || storage_get(VERSION_KEY) === TUTORIAL_CONTENT_VERSION) {
            return false;
        }

        const previous_progress = Array.isArray(state.progress[ROOT_CAMPAIGN_ID]) ?
            state.progress[ROOT_CAMPAIGN_ID] :
            [];
        state.progress[ROOT_CAMPAIGN_ID] = previous_progress
            .map(Number)
            .filter((number) => {
                return Number.isInteger(number) && number > TUTORIAL_COUNT;
            });

        if (
            state.names[ROOT_CAMPAIGN_ID] &&
            typeof state.names[ROOT_CAMPAIGN_ID] === "object"
        ) {
            for (let number = 1; number <= TUTORIAL_COUNT; number += 1) {
                delete state.names[ROOT_CAMPAIGN_ID][number];
            }
        }

        storage_set(PROGRESS_KEY, JSON.stringify(state.progress));
        storage_set(NAMES_KEY, JSON.stringify(state.names));

        const raw_autosave = storage_get(AUTOSAVE_KEY);
        if (raw_autosave) {
            try {
                const autosave = JSON.parse(raw_autosave);
                const campaign_id =
                    autosave.campaign_id || ROOT_CAMPAIGN_ID;
                const level_number = Math.floor(
                    Number(autosave.level_number) || 0
                );

                if (
                    campaign_id === ROOT_CAMPAIGN_ID &&
                    level_number >= 1 &&
                    level_number <= TUTORIAL_COUNT
                ) {
                    localStorage.removeItem(AUTOSAVE_KEY);
                    application.pending_autosave = null;
                }
            } catch (error) {
                // A malformed autosave is handled by the normal loader.
            }
        }

        if (
            !state.active ||
            state.active.id === ROOT_CAMPAIGN_ID
        ) {
            application.completed_numbers = new Set(
                state.progress[ROOT_CAMPAIGN_ID]
            );

            for (let number = 1; number <= TUTORIAL_COUNT; number += 1) {
                application.level_name_cache.delete(number);
            }
        }

        storage_set(VERSION_KEY, TUTORIAL_CONTENT_VERSION);
        return true;
    }

    function inject_styles() {
        if (document.getElementById("tutorial_lesson_styles")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "tutorial_lesson_styles";
        style.textContent = `
            .tutorial_lesson_card{
                position:fixed;
                left:50%;
                bottom:max(1rem,env(safe-area-inset-bottom));
                z-index:850;
                width:min(34rem,calc(100vw - 1.5rem));
                transform:translateX(-50%);
                padding:1rem;
                border:1px solid rgba(255,255,255,.16);
                border-radius:1.1rem;
                background:rgba(12,16,25,.94);
                box-shadow:0 1rem 3.5rem rgba(0,0,0,.48);
                backdrop-filter:blur(16px);
                color:#fff;
            }
            .tutorial_lesson_card.hidden,
            .tutorial_lesson_reopen.hidden{display:none}
            .tutorial_lesson_header{
                display:flex;
                align-items:flex-start;
                justify-content:space-between;
                gap:1rem;
            }
            .tutorial_lesson_step{
                margin:0 0 .25rem;
                color:#7ee3c5;
                font-size:.7rem;
                font-weight:700;
                letter-spacing:.13em;
                text-transform:uppercase;
            }
            .tutorial_lesson_card h2{
                margin:0;
                font-size:clamp(1.15rem,4vw,1.55rem);
            }
            .tutorial_lesson_close{
                flex:0 0 auto;
                border:0;
                border-radius:999px;
                padding:.45rem .7rem;
                background:rgba(255,255,255,.09);
                color:inherit;
                font:inherit;
                cursor:pointer;
            }
            .tutorial_lesson_description{
                margin:.7rem 0;
                color:rgba(255,255,255,.78);
                line-height:1.45;
            }
            .tutorial_lesson_goal{
                margin:0;
                padding:.7rem .8rem;
                border-radius:.75rem;
                background:rgba(126,227,197,.1);
                color:#c8fff0;
                line-height:1.4;
            }
            .tutorial_lesson_hint{
                margin:.65rem 0 0;
                color:rgba(255,255,255,.62);
                font-size:.84rem;
                line-height:1.4;
            }
            .tutorial_lesson_status{
                display:flex;
                justify-content:space-between;
                gap:.75rem;
                margin-top:.75rem;
                font-size:.76rem;
                color:rgba(255,255,255,.58);
            }
            .tutorial_lesson_reopen{
                position:fixed;
                left:max(.75rem,env(safe-area-inset-left));
                bottom:max(.75rem,env(safe-area-inset-bottom));
                z-index:849;
                border:1px solid rgba(255,255,255,.16);
                border-radius:999px;
                padding:.65rem .9rem;
                background:rgba(12,16,25,.92);
                color:#fff;
                font:inherit;
                font-weight:700;
                cursor:pointer;
                box-shadow:0 .5rem 1.8rem rgba(0,0,0,.35);
            }
            @media(max-height:600px){
                .tutorial_lesson_card{bottom:.5rem;padding:.8rem}
                .tutorial_lesson_description{margin:.45rem 0}
                .tutorial_lesson_hint{display:none}
            }
        `;
        document.head.append(style);
    }

    function create_lesson_ui() {
        inject_styles();

        const card = document.createElement("section");
        card.className = "tutorial_lesson_card hidden";
        card.setAttribute("role", "region");
        card.setAttribute("aria-label", "Tutorial lesson");

        const header = document.createElement("div");
        header.className = "tutorial_lesson_header";

        const heading = document.createElement("div");
        const step = document.createElement("p");
        step.className = "tutorial_lesson_step";
        const title = document.createElement("h2");
        heading.append(step, title);

        const close = document.createElement("button");
        close.type = "button";
        close.className = "tutorial_lesson_close";
        close.textContent = "Hide";
        close.setAttribute("aria-label", "Hide tutorial lesson");
        header.append(heading, close);

        const description = document.createElement("p");
        description.className = "tutorial_lesson_description";

        const goal = document.createElement("p");
        goal.className = "tutorial_lesson_goal";

        const hint = document.createElement("p");
        hint.className = "tutorial_lesson_hint";

        const status = document.createElement("div");
        status.className = "tutorial_lesson_status";
        const remaining = document.createElement("span");
        const queued = document.createElement("span");
        status.append(remaining, queued);

        card.append(header, description, goal, hint, status);

        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "tutorial_lesson_reopen hidden";
        reopen.textContent = "Lesson";
        reopen.setAttribute("aria-label", "Show tutorial lesson");

        document.body.append(card, reopen);

        close.addEventListener("click", () => {
            card.classList.add("hidden");
            reopen.classList.remove("hidden");
        });
        reopen.addEventListener("click", () => {
            reopen.classList.add("hidden");
            card.classList.remove("hidden");
        });

        return {
            card,
            reopen,
            step,
            title,
            description,
            goal,
            hint,
            remaining,
            queued
        };
    }

    function install_tutorial_ui(application) {
        if (
            !application ||
            application[INSTALL_FLAG] ||
            !application.__campaign_state
        ) {
            return false;
        }

        application[INSTALL_FLAG] = true;
        migrate_tutorial_progress(application);
        const elements = create_lesson_ui();
        let current_session = null;

        const update = () => {
            const session = application.session;
            const level = session && session.level;
            const settings = level && level.settings;
            const campaign_id =
                application.__campaign_state.active &&
                application.__campaign_state.active.id;
            const is_tutorial = Boolean(
                level &&
                settings &&
                settings.tutorial &&
                campaign_id === ROOT_CAMPAIGN_ID &&
                level.number >= 1 &&
                level.number <= TUTORIAL_COUNT
            );

            if (!is_tutorial) {
                current_session = null;
                elements.card.classList.add("hidden");
                elements.reopen.classList.add("hidden");
                return;
            }

            if (session !== current_session) {
                current_session = session;
                const step_number = Math.max(
                    1,
                    Math.floor(Number(settings.tutorial_step) || level.number)
                );
                const total = Math.max(
                    step_number,
                    Math.floor(Number(settings.tutorial_total) || TUTORIAL_COUNT)
                );

                elements.step.textContent =
                    `Tutorial ${step_number} of ${total}`;
                elements.title.textContent =
                    settings.tutorial_title || level.name;
                elements.description.textContent =
                    settings.tutorial_description || "";
                elements.goal.textContent =
                    `Goal: ${settings.tutorial_goal || "Clear every pipe."}`;
                elements.hint.textContent =
                    settings.tutorial_hint ?
                        `Tip: ${settings.tutorial_hint}` :
                        "";
                elements.hint.classList.toggle(
                    "hidden",
                    !settings.tutorial_hint
                );
                elements.reopen.classList.add("hidden");
                elements.card.classList.remove("hidden");

                const move_duration = Number(
                    settings.tutorial_move_duration
                );
                if (Number.isFinite(move_duration) && move_duration > 0) {
                    session.move_duration = move_duration;
                }
            }

            const active_count =
                typeof session.get_active_count === "function" ?
                    session.get_active_count() :
                    session.pipes.filter((pipe) => pipe.active).length;
            const queued_count =
                typeof session.get_queued_count === "function" ?
                    session.get_queued_count() :
                    session.queued_pipes instanceof Map ?
                        session.queued_pipes.size :
                        0;
            const moving_count =
                typeof session.get_moving_count === "function" ?
                    session.get_moving_count() :
                    session.moving_pipes.size;

            elements.remaining.textContent =
                `${active_count} pipe${active_count === 1 ? "" : "s"} remaining`;
            elements.queued.textContent = queued_count > 0 ?
                `${queued_count} queued` :
                moving_count > 0 ?
                    `${moving_count} moving` :
                    "Ready";
        };

        update();
        globalThis.setInterval(update, 120);
        return true;
    }

    function install() {
        const application = globalThis.choobsGame;

        if (!application) {
            return false;
        }

        install_tutorial_loader(application);

        let attempts = 0;
        const wait_for_campaigns = () => {
            if (install_tutorial_ui(application)) {
                return;
            }

            attempts += 1;
            if (attempts < 400) {
                globalThis.setTimeout(wait_for_campaigns, 25);
            }
        };

        wait_for_campaigns();
        return true;
    }

    if (!install()) {
        let attempts = 0;
        const wait_for_game = () => {
            if (install()) {
                return;
            }

            attempts += 1;
            if (attempts < 240) {
                globalThis.setTimeout(wait_for_game, 25);
            }
        };

        globalThis.setTimeout(wait_for_game, 0);
    }
})();