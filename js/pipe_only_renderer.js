(function (global_scope) {
    "use strict";

    class PipeOnlyCanvasRenderer extends global_scope.ChoobsCanvasRenderer {
        draw_board_background(_context) {}

        draw_grid(_context) {}
    }

    global_scope.ChoobsCanvasRenderer = PipeOnlyCanvasRenderer;
})(globalThis);
