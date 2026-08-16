(() => {
    "use strict";

    const INSTALL_RETRY_MS = 25;
    const INSTALL_RETRY_LIMIT = 240;

    function install(application) {
        if (!application || !application.__choobs_campaigns_installed) {
            return false;
        }
        if (application.__choobs_campaign_race_guard_installed) {
            return true;
        }

        const original_preload_level_names =
            application.preload_level_names.bind(application);
        const original_switch_campaign =
            application.switch_campaign.bind(application);
        const original_load_level_number =
            application.load_level_number.bind(application);

        let active_preload = Promise.resolve();
        let campaign_switch_generation = 0;
        let level_load_generation = 0;

        function set_selectors_disabled(disabled) {
            const campaign_select = document.getElementById("campaign_select");
            const level_select = application.elements &&
                application.elements.level_select;

            if (campaign_select) {
                campaign_select.disabled = disabled;
            }
            if (level_select) {
                level_select.disabled = disabled;
            }
        }

        application.preload_level_names = function (preferred_number = null) {
            const preload = Promise.resolve(
                original_preload_level_names(preferred_number)
            );
            active_preload = preload.catch(() => {});
            return preload;
        };

        application.switch_campaign = async function (
            campaign_id,
            preferred_number = null,
            options = {}
        ) {
            const generation = ++campaign_switch_generation;
            ++level_load_generation;
            set_selectors_disabled(true);

            try {
                await active_preload;
                if (generation !== campaign_switch_generation) {
                    return false;
                }

                const switched = await original_switch_campaign(
                    campaign_id,
                    preferred_number,
                    options
                );

                await active_preload;
                return generation === campaign_switch_generation ? switched : false;
            } finally {
                if (generation === campaign_switch_generation) {
                    set_selectors_disabled(false);
                }
            }
        };

        application.load_level_number = async function (level_number) {
            const generation = ++level_load_generation;
            const campaign_generation = campaign_switch_generation;
            const level_select = this.elements && this.elements.level_select;

            if (level_select) {
                level_select.disabled = true;
            }

            try {
                await original_load_level_number(level_number);
            } finally {
                if (generation === level_load_generation &&
                    campaign_generation === campaign_switch_generation &&
                    level_select) {
                    level_select.disabled = false;

                    if (this.level_index >= 0 && this.levels[this.level_index]) {
                        level_select.value = String(
                            this.levels[this.level_index].number
                        );
                    }
                }
            }
        };

        application.__choobs_campaign_race_guard_installed = true;
        return true;
    }

    let attempts = 0;
    const wait_for_campaigns = () => {
        if (install(globalThis.choobsGame)) {
            return;
        }

        attempts += 1;
        if (attempts < INSTALL_RETRY_LIMIT) {
            globalThis.setTimeout(wait_for_campaigns, INSTALL_RETRY_MS);
        }
    };

    wait_for_campaigns();
})();
