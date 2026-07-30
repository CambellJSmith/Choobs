(() => {
    "use strict";

    const ROOT_CAMPAIGN_ID = "tutorial-random";
    const ACTIVE_CAMPAIGN_KEY = "choobs_active_campaign_v1";
    const CAMPAIGN_PROGRESS_KEY = "choobs_campaign_progress_v1";
    const CAMPAIGN_NAMES_KEY = "choobs_campaign_level_names_v1";
    const LEGACY_COMPLETED_KEY = "choobs_completed_levels";
    const CAMPAIGN_QUERY_KEY = "campaign";
    const CAMPAIGN_FILE_PATTERN = /^level_(\d+)\.json$/i;
    const LEGACY_CAMPAIGN_LEVELS = Object.freeze({
        Flags: Object.freeze({ 15: 1, 25: 2, 26: 3, 27: 4, 28: 5 }),
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

    function safe_json_parse(value, fallback) {
        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function normalize_campaign_id(value) {
        return String(value || "").trim() || ROOT_CAMPAIGN_ID;
    }

    function display_name_from_folder(folder) {
        return decodeURIComponent(String(folder || ""))
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim() || "Campaign";
    }

    function parse_discovered_file(raw_path) {
        const normalized_path = String(raw_path || "")
            .replace(/\\/g, "/")
            .replace(/^\.\//, "");
        const marker = "levels/";
        const marker_index = normalized_path.indexOf(marker);

        if (marker_index < 0) {
            return null;
        }

        const relative_path = normalized_path.slice(marker_index + marker.length);
        const parts = relative_path.split("/").filter(Boolean);

        if (parts.length === 0) {
            return null;
        }

        const file_name = parts.pop();
        const folder = parts.join("/");
        const path = `./levels/${relative_path}`;

        if (file_name.toLowerCase() === "campaign.json") {
            return {
                type: "marker",
                folder,
                path
            };
        }

        const match = CAMPAIGN_FILE_PATTERN.exec(file_name);

        if (!match) {
            return null;
        }

        return {
            type: "level",
            folder,
            path,
            file_number: Number(match[1]),
            file_name
        };
    }

    function build_campaigns() {
        const by_id = new Map();
        by_id.set(ROOT_CAMPAIGN_ID, {
            id: ROOT_CAMPAIGN_ID,
            folder: "",
            name: "Tutorial & Random",
            description: "Learn the rules, then continue through endlessly generated levels.",
            procedural: true,
            entries: []
        });

        for (const raw_path of Array.from(globalThis.CHOOBS_CAMPAIGN_FILES || [])) {
            const discovered = parse_discovered_file(raw_path);

            if (!discovered) {
                continue;
            }

            if (!discovered.folder) {
                if (discovered.type === "level" && discovered.file_number <= 3) {
                    by_id.get(ROOT_CAMPAIGN_ID).entries.push(discovered);
                }
                continue;
            }

            const id = normalize_campaign_id(discovered.folder);
            let campaign = by_id.get(id);

            if (!campaign) {
                campaign = {
                    id,
                    folder: discovered.folder,
                    name: display_name_from_folder(discovered.folder),
                    description: `${display_name_from_folder(discovered.folder)} levels in filename order.`,
                    procedural: false,
                    entries: []
                };
                by_id.set(id, campaign);
            }

            if (discovered.type === "level") {
                campaign.entries.push(discovered);
            }
        }

        for (const campaign of by_id.values()) {
            campaign.entries.sort((left, right) => {
                return left.file_number - right.file_number ||
                    left.file_name.localeCompare(right.file_name);
            });
            campaign.entries = campaign.entries.map((entry, index) => ({
                ...entry,
                number: index + 1
            }));
        }

        return Array.from(by_id.values()).sort((left, right) => {
            if (left.id === ROOT_CAMPAIGN_ID) return -1;
            if (right.id === ROOT_CAMPAIGN_ID) return 1;
            return left.name.localeCompare(right.name);
        });
    }

    function load_progress() {
        const parsed = safe_json_parse(
            localStorage.getItem(CAMPAIGN_PROGRESS_KEY) || "{}",
            {}
        );
        const progress = {};

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [campaign_id, values] of Object.entries(parsed)) {
                if (!Array.isArray(values)) continue;
                progress[campaign_id] = Array.from(new Set(
                    values
                        .map((value) => Math.floor(Number(value) || 0))
                        .filter((value) => value >= 1)
                )).sort((left, right) => left - right);
            }
        }

        return progress;
    }

    function load_name_cache() {
        const parsed = safe_json_parse(
            localStorage.getItem(CAMPAIGN_NAMES_KEY) || "{}",
            {}
        );
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ?
            parsed : {};
    }

    function save_object(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn(`Could not save ${key}.`, error);
        }
    }

    function migrate_legacy_progress(progress) {
        if (Object.keys(progress).length > 0) {
            return progress;
        }

        const legacy_values = safe_json_parse(
            localStorage.getItem(LEGACY_COMPLETED_KEY) || "[]",
            []
        );
        const legacy = new Set(
            Array.isArray(legacy_values) ? legacy_values.map(Number) : []
        );
        progress[ROOT_CAMPAIGN_ID] = [1, 2, 3].filter((number) => legacy.has(number));

        for (const [campaign_id, mapping] of Object.entries(LEGACY_CAMPAIGN_LEVELS)) {
            progress[campaign_id] = Object.entries(mapping)
                .filter(([legacy_number]) => legacy.has(Number(legacy_number)))
                .map(([, local_number]) => local_number)
                .sort((left, right) => left - right);
        }

        save_object(CAMPAIGN_PROGRESS_KEY, progress);
        return progress;
    }

    function get_legacy_campaign_for_number(level_number) {
        for (const [campaign_id, mapping] of Object.entries(LEGACY_CAMPAIGN_LEVELS)) {
            if (Object.prototype.hasOwnProperty.call(mapping, level_number)) {
                return {
                    campaign_id,
                    level_number: mapping[level_number]
                };
            }
        }

        return null;
    }

    function inject_styles() {
        if (document.getElementById("campaign_styles")) return;
        const style = document.createElement("style");
        style.id = "campaign_styles";
        style.textContent = `
            .campaign_hud_picker{display:flex;align-items:center;gap:.45rem;min-width:0}
            .campaign_hud_picker span{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;opacity:.66}
            .campaign_hud_picker select{max-width:11rem;background:#151a25;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:.65rem;padding:.55rem 1.8rem .55rem .7rem;font:inherit}
            .campaign_overlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:1rem;background:rgba(4,6,10,.82);backdrop-filter:blur(14px)}
            .campaign_overlay.hidden{display:none}
            .campaign_dialog{width:min(44rem,100%);max-height:min(48rem,92vh);overflow:auto;background:#111620;border:1px solid rgba(255,255,255,.13);border-radius:1.25rem;padding:1.15rem;box-shadow:0 1.5rem 5rem rgba(0,0,0,.55)}
            .campaign_dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}
            .campaign_dialog h2{margin:.15rem 0 .3rem;font-size:clamp(1.5rem,4vw,2.25rem)}
            .campaign_dialog p{margin:0;color:rgba(255,255,255,.68)}
            .campaign_close{border:0;background:rgba(255,255,255,.08);color:inherit;border-radius:999px;width:2.5rem;height:2.5rem;font-size:1.35rem;cursor:pointer}
            .campaign_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.75rem}
            .campaign_card{display:flex;flex-direction:column;align-items:stretch;text-align:left;gap:.55rem;min-height:9.5rem;padding:1rem;border-radius:1rem;border:1px solid rgba(255,255,255,.12);background:linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025));color:inherit;cursor:pointer}
            .campaign_card:hover:not(:disabled),.campaign_card:focus-visible:not(:disabled){border-color:rgba(126,227,197,.65);transform:translateY(-1px)}
            .campaign_card:disabled{opacity:.46;cursor:not-allowed}
            .campaign_card strong{font-size:1.12rem}
            .campaign_card small{color:rgba(255,255,255,.62);line-height:1.35}
            .campaign_progress{margin-top:auto;display:flex;justify-content:space-between;gap:.5rem;font-size:.78rem;color:#7ee3c5}
            .campaign_pause_row{width:100%}
            @media(max-width:760px){.campaign_hud_picker span{display:none}.campaign_hud_picker select{max-width:8.5rem;padding-left:.5rem}.game_hud{gap:.45rem}}
        `;
        document.head.append(style);
    }

    function create_ui(app, state) {
        inject_styles();

        const hud_picker = document.createElement("label");
        hud_picker.className = "campaign_hud_picker";
        const hud_label = document.createElement("span");
        hud_label.textContent = "Campaign";
        const select = document.createElement("select");
        select.id = "campaign_select";
        select.setAttribute("aria-label", "Choose a campaign");
        hud_picker.append(hud_label, select);
        const level_picker = document.querySelector(".level_picker");
        level_picker?.before(hud_picker);

        const overlay = document.createElement("div");
        overlay.className = "campaign_overlay hidden";
        overlay.setAttribute("aria-hidden", "true");
        const dialog = document.createElement("section");
        dialog.className = "campaign_dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "campaign_title");
        const header = document.createElement("header");
        const heading = document.createElement("div");
        const kicker = document.createElement("p");
        kicker.textContent = "Choose your route";
        const title = document.createElement("h2");
        title.id = "campaign_title";
        title.textContent = "Campaigns";
        const intro = document.createElement("p");
        intro.textContent = "Each campaign keeps its own level order and completion progress.";
        heading.append(kicker, title, intro);
        const close = document.createElement("button");
        close.type = "button";
        close.className = "campaign_close";
        close.setAttribute("aria-label", "Close campaign chooser");
        close.textContent = "×";
        header.append(heading, close);
        const grid = document.createElement("div");
        grid.className = "campaign_grid";
        dialog.append(header, grid);
        overlay.append(dialog);
        document.body.append(overlay);

        const pause_group = document.querySelector(".pause_group");
        const reset_button = document.getElementById("reset_game_button");
        const pause_button = document.createElement("button");
        pause_button.type = "button";
        pause_button.className = "pause_row campaign_pause_row";
        pause_button.innerHTML = `
            <span class="pause_row_icon" aria-hidden="true">◫</span>
            <span class="pause_row_copy"><strong>Choose campaign</strong><small>Switch to another level collection</small></span>
            <span class="pause_row_arrow" aria-hidden="true">›</span>
        `;
        pause_group?.insertBefore(pause_button, reset_button || null);

        state.elements = { select, overlay, grid, close, pause_button };

        select.addEventListener("change", () => {
            void app.switch_campaign(select.value, null, { manual: true });
        });
        pause_button.addEventListener("click", () => {
            if (app.is_paused) app.close_pause_menu();
            app.show_campaign_chooser();
        });
        close.addEventListener("click", () => app.hide_campaign_chooser());
        overlay.addEventListener("pointerdown", (event) => {
            if (event.target === overlay) app.hide_campaign_chooser();
        });
    }

    function wait_for_initial_game(app) {
        return new Promise((resolve) => {
            const started = performance.now();
            const check = () => {
                if (app.session || performance.now() - started > 2500) {
                    resolve();
                } else {
                    window.setTimeout(check, 25);
                }
            };
            check();
        });
    }

    async function install() {
        const app = globalThis.choobsGame;

        if (!app || app.__choobs_campaigns_installed) {
            return;
        }

        await wait_for_initial_game(app);
        app.__choobs_campaigns_installed = true;

        const campaigns = build_campaigns();
        const campaign_by_id = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
        const state = {
            campaigns,
            campaign_by_id,
            active: null,
            progress: migrate_legacy_progress(load_progress()),
            names: load_name_cache(),
            elements: null,
            first_choice_pending: false
        };
        app.__campaign_state = state;

        const original = {
            load_levels: app.load_levels.bind(app),
            try_load_manual_level_file: app.try_load_manual_level_file.bind(app),
            preload_level_names: app.preload_level_names.bind(app),
            resolve_level: app.resolve_level.bind(app),
            get_resume_level_number: app.get_resume_level_number.bind(app),
            is_level_number_unlocked: app.is_level_number_unlocked.bind(app),
            ensure_level_entry: app.ensure_level_entry.bind(app),
            load_next_level: app.load_next_level.bind(app),
            begin_level_completion: app.begin_level_completion.bind(app),
            save_current_progress: app.save_current_progress.bind(app),
            reset_game: app.reset_game.bind(app),
            update_pause_menu: app.update_pause_menu.bind(app),
            get_current_history_url: app.get_current_history_url.bind(app),
            select_game_mode: app.select_game_mode.bind(app)
        };

        function get_active_campaign() {
            return state.active || campaign_by_id.get(ROOT_CAMPAIGN_ID);
        }

        function save_progress_for_active() {
            const campaign = get_active_campaign();
            state.progress[campaign.id] = Array.from(app.completed_numbers)
                .map(Number)
                .filter((number) => Number.isInteger(number) && number >= 1)
                .sort((left, right) => left - right);
            save_object(CAMPAIGN_PROGRESS_KEY, state.progress);
        }

        function set_active_name_cache(campaign_id) {
            const raw = state.names[campaign_id] || {};
            app.level_name_cache = new Map(
                Object.entries(raw)
                    .map(([number, name]) => [Number(number), String(name || "")])
                    .filter(([number, name]) => Number.isInteger(number) && number >= 1 && name)
            );
        }

        function save_active_name_cache() {
            const campaign = get_active_campaign();
            state.names[campaign.id] = Object.fromEntries(app.level_name_cache);
            save_object(CAMPAIGN_NAMES_KEY, state.names);
        }

        function update_campaign_ui() {
            if (!state.elements) return;
            const active = get_active_campaign();
            state.elements.select.replaceChildren();

            for (const campaign of campaigns) {
                const option = document.createElement("option");
                option.value = campaign.id;
                option.textContent = campaign.name;
                option.disabled = !campaign.procedural && campaign.entries.length === 0;
                state.elements.select.append(option);
            }
            state.elements.select.value = active.id;

            state.elements.grid.replaceChildren();
            for (const campaign of campaigns) {
                const completed = new Set(state.progress[campaign.id] || []);
                const total = campaign.procedural ? null : campaign.entries.length;
                const card = document.createElement("button");
                card.type = "button";
                card.className = "campaign_card";
                card.disabled = total === 0;
                const name = document.createElement("strong");
                name.textContent = campaign.name;
                const description = document.createElement("small");
                description.textContent = campaign.description;
                const progress = document.createElement("span");
                progress.className = "campaign_progress";
                const progress_text = document.createElement("span");
                progress_text.textContent = total === null ?
                    `${completed.size} completed` :
                    `${completed.size} / ${total} completed`;
                const availability = document.createElement("span");
                availability.textContent = total === 0 ? "No levels yet" :
                    total === null ? "Endless" : `${total} levels`;
                progress.append(progress_text, availability);
                card.append(name, description, progress);
                card.addEventListener("click", async () => {
                    await app.switch_campaign(campaign.id, null, { manual: true });
                    app.hide_campaign_chooser();
                });
                state.elements.grid.append(card);
            }
        }

        app.show_campaign_chooser = function () {
            update_campaign_ui();
            state.elements.overlay.classList.remove("hidden");
            state.elements.overlay.setAttribute("aria-hidden", "false");
            requestAnimationFrame(() => {
                state.elements.grid.querySelector("button:not(:disabled)")?.focus();
            });
        };

        app.hide_campaign_chooser = function () {
            state.elements.overlay.classList.add("hidden");
            state.elements.overlay.setAttribute("aria-hidden", "true");
        };

        app.save_completed_numbers = function () {
            save_progress_for_active();
            update_campaign_ui();
        };

        app.remember_level_name = function (level) {
            const level_number = Math.floor(Number(level && level.number) || 0);
            const level_name = String(level && level.name || "").trim();
            if (level_number < 1 || !level_name || level_name === `Level ${level_number}`) {
                return;
            }
            this.level_name_cache.set(level_number, level_name);
            save_active_name_cache();
        };

        app.get_resume_level_number = function () {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.get_resume_level_number();
            }
            if (campaign.entries.length === 0) return 1;
            let level_number = 1;
            while (level_number <= campaign.entries.length &&
                this.completed_numbers.has(level_number)) {
                level_number += 1;
            }
            return Math.min(level_number, campaign.entries.length);
        };

        app.is_level_number_unlocked = function (level_number) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.is_level_number_unlocked(level_number);
            }
            return Number.isInteger(level_number) && level_number >= 1 &&
                level_number <= campaign.entries.length &&
                level_number <= this.get_resume_level_number();
        };

        app.ensure_level_entry = function (level_number) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.ensure_level_entry(level_number);
            }
            const normalized = Math.floor(Number(level_number) || 0);
            return normalized >= 1 && normalized <= this.levels.length ?
                normalized - 1 : -1;
        };

        app.try_load_manual_level_file = async function (level_number) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                if (level_number > 3 && !this.imported_levels.some((level) =>
                    level.number === level_number)) {
                    return null;
                }
                return original.try_load_manual_level_file(level_number);
            }

            const normalized = Math.floor(Number(level_number) || 0);
            const entry = campaign.entries[normalized - 1];
            if (!entry) return null;
            const cache_key = `${campaign.id}:${normalized}`;
            if (this.manual_file_checks.has(cache_key)) {
                return this.manual_file_checks.get(cache_key);
            }

            const request = (async () => {
                const response = await fetch(new URL(entry.path, document.baseURI), {
                    cache: "no-store"
                });
                if (!response.ok) {
                    throw new Error(`Campaign level ${entry.path} returned ${response.status}.`);
                }
                const raw = await response.json();
                const source_number = Math.floor(Number(raw.number) || entry.file_number);
                raw.number = normalized;
                raw.settings = {
                    ...(raw.settings || {}),
                    campaign_id: campaign.id,
                    campaign_folder: campaign.folder,
                    campaign_file_number: entry.file_number,
                    source_level_number: source_number
                };
                const level = Choobs.normalize_level(raw);
                this.manual_levels.set(normalized, level);
                this.remember_level_name(level);
                if (this.levels[normalized - 1]) {
                    this.levels[normalized - 1] = level;
                }
                return level;
            })().catch((error) => {
                console.error(error);
                return null;
            });
            this.manual_file_checks.set(cache_key, request);
            return request;
        };

        app.preload_level_names = async function (preferred_number = null) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.preload_level_names(preferred_number);
            }
            const candidates = campaign.entries.map((entry) => entry.number);
            const preferred = Math.floor(Number(preferred_number) || 0);
            const preferred_index = candidates.indexOf(preferred);
            if (preferred_index > 0) {
                candidates.splice(preferred_index, 1);
                candidates.unshift(preferred);
            }
            let cursor = 0;
            const worker = async () => {
                while (cursor < candidates.length) {
                    const number = candidates[cursor++];
                    await this.try_load_manual_level_file(number);
                    this.populate_level_select();
                }
            };
            await Promise.all(
                Array.from({ length: Math.min(4, candidates.length) }, worker)
            );
        };

        app.resolve_level = async function (index) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.resolve_level(index);
            }
            const entry = this.levels[index];
            if (!entry) throw new Error("The campaign level does not exist.");
            const level = await this.try_load_manual_level_file(entry.number);
            if (!level) throw new Error("The campaign level could not be loaded.");
            this.levels[index] = level;
            return level;
        };

        app.load_levels = async function (preferred_number = null, reload_imported = true) {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.load_levels(preferred_number, reload_imported);
            }

            this.manual_file_checks.clear();
            this.manual_levels = new Map();
            this.procedural_levels.clear();
            this.levels = campaign.entries.map((entry) => ({
                number: entry.number,
                name: this.level_name_cache.get(entry.number) || `Level ${entry.number}`,
                campaign_path: entry.path,
                campaign_file_number: entry.file_number,
                procedural_placeholder: true
            }));
            this.populate_level_select();
            this.elements.loading_overlay.classList.add("hidden");

            if (this.levels.length === 0) {
                this.session = null;
                this.level_index = -1;
                this.set_status(`${campaign.name} has no levels yet.`);
                update_campaign_ui();
                return;
            }

            const preferred = Math.floor(Number(preferred_number) || 0);
            const autosave_number = Math.floor(Number(
                this.pending_autosave && this.pending_autosave.level_number
            ) || 0);
            const query = new URLSearchParams(window.location.search);
            const query_number = query.get(CAMPAIGN_QUERY_KEY) === campaign.id ?
                Math.floor(Number(query.get("level")) || 0) : 0;
            const requested = preferred || autosave_number || query_number;
            const target = this.is_level_number_unlocked(requested) ?
                requested : this.get_resume_level_number();
            const names = this.preload_level_names(target);
            await this.load_level_number(target);
            void names;
        };

        app.load_next_level = async function () {
            const campaign = get_active_campaign();
            if (campaign.procedural) {
                return original.load_next_level();
            }
            const next_index = this.level_index + 1;
            if (next_index >= 0 && next_index < this.levels.length) {
                await this.load_level_by_index(next_index);
                return;
            }
            this.hide_win_overlay();
            this.show_campaign_chooser();
            this.set_status(`${campaign.name} complete. Choose another campaign.`);
        };

        app.begin_level_completion = function (time) {
            const campaign = get_active_campaign();
            original.begin_level_completion(time);
            if (!campaign.procedural && this.level_index === this.levels.length - 1) {
                this.elements.continue_button_label.textContent = "Choose campaign";
                this.set_status(`${campaign.name} complete.`);
            }
            update_campaign_ui();
        };

        app.save_current_progress = function (reason = "autosave") {
            original.save_current_progress(reason);
            try {
                const raw = localStorage.getItem("choobs_autosave_v1");
                if (!raw) return;
                const autosave = JSON.parse(raw);
                autosave.campaign_id = get_active_campaign().id;
                localStorage.setItem("choobs_autosave_v1", JSON.stringify(autosave));
            } catch (error) {
                console.warn("Campaign autosave metadata could not be saved.", error);
            }
        };

        app.get_current_history_url = function () {
            const url = original.get_current_history_url();
            url.searchParams.set(CAMPAIGN_QUERY_KEY, get_active_campaign().id);
            return url;
        };

        app.update_pause_menu = function () {
            original.update_pause_menu();
            const campaign = get_active_campaign();
            const level = this.level_index >= 0 ? this.levels[this.level_index] : null;
            if (level) {
                const suffix = campaign.procedural ?
                    `Level ${level.number}` :
                    `${level.number}/${campaign.entries.length}`;
                this.elements.pause_level_badge.textContent =
                    `${campaign.name} · ${suffix}`;
            }
        };

        app.reset_game = async function () {
            state.progress = {};
            save_object(CAMPAIGN_PROGRESS_KEY, state.progress);
            state.active = campaign_by_id.get(ROOT_CAMPAIGN_ID);
            this.completed_numbers = new Set();
            localStorage.setItem(ACTIVE_CAMPAIGN_KEY, ROOT_CAMPAIGN_ID);
            state.first_choice_pending = true;
            await original.reset_game();
            update_campaign_ui();
        };

        app.select_game_mode = function (mode) {
            original.select_game_mode(mode);
            if (state.first_choice_pending) {
                state.first_choice_pending = false;
                this.show_campaign_chooser();
            }
        };

        app.switch_campaign = async function (
            campaign_id,
            preferred_number = null,
            options = {}
        ) {
            const campaign = campaign_by_id.get(normalize_campaign_id(campaign_id));
            if (!campaign || (!campaign.procedural && campaign.entries.length === 0)) {
                this.set_status("That campaign has no levels yet.");
                update_campaign_ui();
                return false;
            }

            const previous = state.active;
            if (previous && this.session) {
                this.save_current_progress("campaign_switch");
                save_progress_for_active();
            }

            state.active = campaign;
            localStorage.setItem(ACTIVE_CAMPAIGN_KEY, campaign.id);
            this.completed_numbers = new Set(state.progress[campaign.id] || []);
            set_active_name_cache(campaign.id);
            this.load_request_id += 1;
            this.session = null;
            this.level_index = -1;
            this.effects.length = 0;
            this.activation_metadata.clear();
            this.hide_win_overlay();
            this.elements.loading_overlay.classList.remove("hidden");

            if (options.manual) {
                this.pending_autosave = null;
                this.clear_autosave();
                this.reset_run_score();
            } else if (this.pending_autosave) {
                const autosave_campaign = normalize_campaign_id(
                    this.pending_autosave.campaign_id || ROOT_CAMPAIGN_ID
                );
                if (autosave_campaign !== campaign.id) {
                    this.pending_autosave = null;
                }
            }

            update_campaign_ui();
            await this.load_levels(preferred_number, false);
            this.update_pause_menu();
            update_campaign_ui();
            this.set_status(`${campaign.name} selected.`);
            return true;
        };

        create_ui(app, state);

        let requested_campaign = null;
        let requested_level = null;
        const query = new URLSearchParams(window.location.search);
        if (query.has(CAMPAIGN_QUERY_KEY)) {
            requested_campaign = query.get(CAMPAIGN_QUERY_KEY);
            requested_level = Math.floor(Number(query.get("level")) || 0) || null;
        }

        if (!requested_campaign && app.pending_autosave) {
            requested_campaign = app.pending_autosave.campaign_id || null;
            if (!requested_campaign) {
                const migrated = get_legacy_campaign_for_number(
                    Number(app.pending_autosave.level_number)
                );
                if (migrated) {
                    requested_campaign = migrated.campaign_id;
                    app.pending_autosave.level_number = migrated.level_number;
                }
            }
        }

        if (!requested_campaign) {
            requested_campaign = localStorage.getItem(ACTIVE_CAMPAIGN_KEY) ||
                ROOT_CAMPAIGN_ID;
        }
        if (!campaign_by_id.has(requested_campaign)) {
            requested_campaign = ROOT_CAMPAIGN_ID;
        }

        const had_saved_campaign = Boolean(localStorage.getItem(ACTIVE_CAMPAIGN_KEY));
        await app.switch_campaign(requested_campaign, requested_level, {
            initial: true
        });
        state.first_choice_pending = !had_saved_campaign;
        if (state.first_choice_pending && app.game_mode) {
            state.first_choice_pending = false;
            app.show_campaign_chooser();
        }
    }

    install().catch((error) => {
        console.error("Campaign support failed to initialize.", error);
    });
})();
