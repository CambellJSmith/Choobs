(() => {
    "use strict";

    const style_id = "hud_layout_styles";

    if (document.getElementById(style_id)) {
        return;
    }

    const style = document.createElement("style");
    style.id = style_id;
    style.textContent = `
        .brand_lockup {
            grid-column: 1;
            grid-row: 1;
        }

        .hud_actions {
            grid-column: 1;
            grid-row: 2;
            align-self: start;
            justify-self: start;
        }

        #menu_button {
            order: -1;
        }
    `;
    document.head.append(style);
})();
