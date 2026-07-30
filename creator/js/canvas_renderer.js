(function (global_scope) {
    "use strict";

    const DARK_PIPE_OUTLINE_LUMINANCE = 48;

    function pipe_color_needs_light_outline(color) {
        const match = /^#([0-9a-f]{6})$/i.exec(String(color || ""));

        if (!match) {
            return false;
        }

        const value = Number.parseInt(match[1], 16);
        const red = (value >>> 16) & 255;
        const green = (value >>> 8) & 255;
        const blue = value & 255;
        const luminance =
            red * 0.2126 + green * 0.7152 + blue * 0.0722;

        return luminance <= DARK_PIPE_OUTLINE_LUMINANCE;
    }

    class CanvasRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.context = canvas.getContext("2d", { alpha: false });
            this.level = null;
            this.board_bounds = { x: 0, y: 0, size: 1, cell_size: 1 };
            this.css_size = 1;
            this._show_mask = true;
            this.background_canvas = document.createElement("canvas");
            this.background_context =
                this.background_canvas.getContext("2d", { alpha: false });
            this.background_dirty = true;
        }

        get show_mask() {
            return this._show_mask;
        }

        set show_mask(value) {
            const next_value = Boolean(value);

            if (next_value !== this._show_mask) {
                this._show_mask = next_value;
                this.background_dirty = true;
            }
        }

        set_level(level) {
            this.level = Choobs.normalize_level(level);
            this.background_dirty = true;
            this.resize();
        }

        resize() {
            const parent = this.canvas.parentElement;
            const rect = parent ?
                parent.getBoundingClientRect() :
                this.canvas.getBoundingClientRect();
            const width = Math.max(1, Math.floor(rect.width));
            const height = Math.max(1, Math.floor(rect.height || rect.width));
            const css_size = Math.max(1, Math.floor(Math.min(width, height)));
            const device_scale = Math.max(1, window.devicePixelRatio || 1);

            this.css_size = css_size;
            this.canvas.width = Math.floor(css_size * device_scale);
            this.canvas.height = Math.floor(css_size * device_scale);
            this.canvas.style.width = `${css_size}px`;
            this.canvas.style.height = `${css_size}px`;
            this.background_canvas.width = this.canvas.width;
            this.background_canvas.height = this.canvas.height;
            this.background_dirty = true;

            const padding = Math.max(12, css_size * 0.035);
            const board_size = css_size - padding * 2;
            const maximum_dimension = this.level ?
                Math.max(this.level.columns, this.level.rows) :
                24;

            this.board_bounds = {
                x: padding,
                y: padding,
                size: board_size,
                cell_size: board_size / maximum_dimension
            };
        }

        pointer_to_cell(event) {
            if (!this.level) {
                return null;
            }

            const rect = this.canvas.getBoundingClientRect();
            const local_x = event.clientX - rect.left;
            const local_y = event.clientY - rect.top;
            const board_x = local_x - this.board_bounds.x;
            const board_y = local_y - this.board_bounds.y;
            const board_width =
                this.level.columns * this.board_bounds.cell_size;
            const board_height =
                this.level.rows * this.board_bounds.cell_size;

            if (
                board_x < 0 ||
                board_y < 0 ||
                board_x >= board_width ||
                board_y >= board_height
            ) {
                return null;
            }

            return {
                x: Math.floor(board_x / this.board_bounds.cell_size),
                y: Math.floor(board_y / this.board_bounds.cell_size)
            };
        }

        render(session, visual_state = {}) {
            const context = this.context;
            const device_scale = Math.max(1, window.devicePixelRatio || 1);
            const time = Number(visual_state.time) || performance.now();

            context.save();
            context.setTransform(
                device_scale,
                0,
                0,
                device_scale,
                0,
                0
            );

            if (!this.level) {
                context.fillStyle = "#090b0f";
                context.fillRect(0, 0, this.css_size, this.css_size);
                context.restore();
                return;
            }

            this.ensure_background_cache();
            context.drawImage(
                this.background_canvas,
                0,
                0,
                this.background_canvas.width,
                this.background_canvas.height,
                0,
                0,
                this.css_size,
                this.css_size
            );

            this.draw_exit_guide(context, session, visual_state);
            this.draw_effects(
                context,
                visual_state.effects || [],
                time,
                "behind"
            );

            for (const pipe of session.pipes) {
                if (pipe.active) {
                    this.draw_pipe(
                        context,
                        session,
                        pipe,
                        visual_state,
                        time
                    );
                }
            }

            this.draw_effects(
                context,
                visual_state.effects || [],
                time,
                "front"
            );
            context.restore();
        }

        ensure_background_cache() {
            if (!this.background_dirty) {
                return;
            }

            const context = this.background_context;
            const device_scale = Math.max(1, window.devicePixelRatio || 1);

            context.save();
            context.setTransform(
                device_scale,
                0,
                0,
                device_scale,
                0,
                0
            );
            context.fillStyle = "#090b0f";
            context.fillRect(0, 0, this.css_size, this.css_size);
            this.draw_board_background(context);
            this.draw_grid(context);
            context.restore();
            this.background_dirty = false;
        }

        draw_board_background(context) {
            const { x, y, cell_size } = this.board_bounds;
            const board_width = this.level.columns * cell_size;
            const board_height = this.level.rows * cell_size;

            context.fillStyle = "#0d1016";
            context.fillRect(x, y, board_width, board_height);

            if (!this.show_mask) {
                return;
            }

            context.fillStyle = "rgba(255, 255, 255, 0.047)";

            for (let grid_y = 0; grid_y < this.level.rows; grid_y += 1) {
                for (
                    let grid_x = 0;
                    grid_x < this.level.columns;
                    grid_x += 1
                ) {
                    const index = grid_y * this.level.columns + grid_x;

                    if (!this.level.mask[index]) {
                        continue;
                    }

                    context.fillRect(
                        x + grid_x * cell_size,
                        y + grid_y * cell_size,
                        cell_size,
                        cell_size
                    );
                }
            }
        }

        draw_grid(context) {
            const { x, y, cell_size } = this.board_bounds;
            const board_width = this.level.columns * cell_size;
            const board_height = this.level.rows * cell_size;

            context.save();
            context.beginPath();
            context.rect(x, y, board_width, board_height);
            context.clip();
            context.strokeStyle = "rgba(255, 255, 255, 0.045)";
            context.lineWidth = 1;

            for (
                let column = 0;
                column <= this.level.columns;
                column += 1
            ) {
                const line_x = x + column * cell_size;
                context.beginPath();
                context.moveTo(line_x, y);
                context.lineTo(line_x, y + board_height);
                context.stroke();
            }

            for (let row = 0; row <= this.level.rows; row += 1) {
                const line_y = y + row * cell_size;
                context.beginPath();
                context.moveTo(x, line_y);
                context.lineTo(x + board_width, line_y);
                context.stroke();
            }

            context.strokeStyle = "rgba(255, 255, 255, 0.15)";
            context.strokeRect(
                x + 0.5,
                y + 0.5,
                board_width - 1,
                board_height - 1
            );
            context.restore();
        }

        draw_exit_guide(context, session, visual_state) {
            if (
                !visual_state.hovered_pipe_is_clear ||
                visual_state.hovered_pipe_id < 0 ||
                this.board_bounds.cell_size < 4
            ) {
                return;
            }

            const pipe = session.get_pipe(visual_state.hovered_pipe_id);

            if (
                !pipe ||
                !pipe.active ||
                session.moving_pipes.has(pipe.id)
            ) {
                return;
            }

            const head = pipe.cells[pipe.cells.length - 1];
            const start = this.cell_center(
                head.x + pipe.direction.x * 0.48,
                head.y + pipe.direction.y * 0.48
            );
            let end_x = head.x;
            let end_y = head.y;

            while (
                end_x >= 0 &&
                end_x < this.level.columns &&
                end_y >= 0 &&
                end_y < this.level.rows
            ) {
                end_x += pipe.direction.x;
                end_y += pipe.direction.y;
            }

            const end = this.cell_center(
                end_x - pipe.direction.x * 0.28,
                end_y - pipe.direction.y * 0.28
            );
            const cell_size = this.board_bounds.cell_size;

            context.save();
            context.globalAlpha = 0.2;
            context.strokeStyle =
                (this.level.palette || Choobs.PIPE_COLORS)[
                    pipe.color_index % (this.level.palette || Choobs.PIPE_COLORS).length
                ];
            context.lineWidth = Math.max(1, cell_size * 0.065);
            context.lineCap = "round";
            context.setLineDash([
                Math.max(2, cell_size * 0.16),
                Math.max(3, cell_size * 0.27)
            ]);
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
            context.restore();
        }

        draw_pipe(context, session, pipe, visual_state, time) {
            const render_cells = session.get_render_cells(pipe.id);
            const points = render_cells.map((cell) => {
                return this.cell_center(cell.x, cell.y);
            });

            if (points.length === 0) {
                return;
            }

            const cell_size = this.board_bounds.cell_size;

            if (points.length === 1) {
                const center = points[0];
                const half_length = cell_size * 0.22;
                points.unshift({
                    x: center.x - pipe.direction.x * half_length,
                    y: center.y - pipe.direction.y * half_length
                });
                points[1] = {
                    x: center.x + pipe.direction.x * half_length * 0.35,
                    y: center.y + pipe.direction.y * half_length * 0.35
                };
            }

            const hovered = pipe.id === visual_state.hovered_pipe_id;
            const hinted = pipe.id === visual_state.hint_pipe_id;
            const blocked = pipe.id === visual_state.blocked_pipe_id;
            const blocker = pipe.id === visual_state.blocker_pipe_id;
            const moving = session.moving_pipes.has(pipe.id);
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.011);
            const outer_width =
                cell_size * (hovered || hinted || moving ? 0.55 : 0.5);
            const inner_width =
                cell_size * (hovered || hinted || moving ? 0.335 : 0.3);
            const shake_amount = blocked ?
                Math.sin(time * 0.095) * cell_size * 0.065 :
                0;
            const side_x = -pipe.direction.y;
            const side_y = pipe.direction.x;
            const palette = this.level.palette || Choobs.PIPE_COLORS;
            const pipe_color = palette[pipe.color_index % palette.length];
            const needs_light_outline =
                !blocked && pipe_color_needs_light_outline(pipe_color);
            const intro_alpha = this.get_intro_alpha(
                pipe.id,
                time,
                visual_state.intro_started
            );

            context.save();
            context.globalAlpha = intro_alpha;
            context.translate(
                side_x * shake_amount,
                side_y * shake_amount
            );
            context.lineCap = "round";
            context.lineJoin = "round";

            if (moving) {
                context.shadowColor = pipe_color;
                context.shadowBlur = Math.max(2, cell_size * 0.5);
                this.draw_speed_streaks(
                    context,
                    points,
                    pipe.direction,
                    pipe_color,
                    cell_size,
                    time,
                    pipe.id
                );
            } else if (hinted) {
                context.shadowColor = `rgba(126, 227, 197, ${0.35 + pulse * 0.35})`;
                context.shadowBlur = cell_size * (0.45 + pulse * 0.35);
            } else if (blocker) {
                context.shadowColor = `rgba(255, 171, 101, ${0.25 + pulse * 0.3})`;
                context.shadowBlur = cell_size * (0.35 + pulse * 0.25);
            } else if (hovered) {
                context.shadowColor = "rgba(255, 255, 255, 0.22)";
                context.shadowBlur = cell_size * 0.3;
            }

            this.stroke_polyline(
                context,
                points,
                "#080a0e",
                outer_width
            );

            if (needs_light_outline) {
                const light_outline_width = Math.min(
                    outer_width,
                    inner_width + Math.max(1, cell_size * 0.055)
                );
                this.stroke_polyline(
                    context,
                    points,
                    "#ffffff",
                    light_outline_width
                );
            }

            this.stroke_polyline(
                context,
                points,
                blocked ? "#ff7d8f" : pipe_color,
                inner_width
            );

            if (moving && cell_size >= 5) {
                context.save();
                context.globalAlpha = 0.22;
                this.stroke_polyline(
                    context,
                    points,
                    "#ffffff",
                    Math.max(0.75, inner_width * 0.18)
                );
                context.restore();
            }

            const arrow_colors = {
                outer: needs_light_outline && !hinted ?
                    "#ffffff" :
                    "#080a0e",
                inner: blocked ?
                    "#ff7d8f" :
                    hinted ?
                        "#7ee3c5" :
                        pipe_color
            };
            const arrow_tip = this.draw_arrow(
                context,
                points[points.length - 1],
                pipe.direction,
                arrow_colors.outer,
                arrow_colors.inner,
                outer_width,
                inner_width,
                cell_size
            );

            if (moving) {
                this.draw_motion_tip(
                    context,
                    arrow_tip,
                    pipe_color,
                    cell_size,
                    time,
                    pipe.id
                );
            }

            context.restore();
        }

        get_intro_alpha(pipe_id, time, intro_started) {
            if (!intro_started) {
                return 1;
            }

            const delay = (pipe_id % 36) * 4;
            const progress = Math.max(
                0,
                Math.min(1, (time - intro_started - delay) / 190)
            );

            return progress * progress * (3 - 2 * progress);
        }

        draw_speed_streaks(
            context,
            points,
            direction,
            color,
            cell_size,
            time,
            pipe_id
        ) {
            const head = points[points.length - 1];
            const side_x = -direction.y;
            const side_y = direction.x;
            const pulse = 0.65 + 0.35 * Math.sin(time * 0.025 + pipe_id);

            context.save();
            context.shadowBlur = 0;
            context.strokeStyle = color;
            context.lineCap = "round";

            for (let index = 0; index < 2; index += 1) {
                const side = index === 0 ? -1 : 1;
                const offset = side * cell_size * 0.16;
                const length = cell_size * (0.24 + index * 0.09) * pulse;
                context.globalAlpha = 0.2 - index * 0.055;
                context.lineWidth = Math.max(1, cell_size * 0.055);
                context.beginPath();
                context.moveTo(
                    head.x - direction.x * cell_size * 0.18 + side_x * offset,
                    head.y - direction.y * cell_size * 0.18 + side_y * offset
                );
                context.lineTo(
                    head.x - direction.x * (cell_size * 0.18 + length) + side_x * offset,
                    head.y - direction.y * (cell_size * 0.18 + length) + side_y * offset
                );
                context.stroke();
            }

            context.restore();
        }

        draw_motion_tip(context, tip, color, cell_size, time, pipe_id) {
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.03 + pipe_id * 0.7);

            context.save();
            context.shadowColor = color;
            context.shadowBlur = cell_size * 0.55;
            context.fillStyle = color;
            context.globalAlpha = 0.34 + pulse * 0.22;
            context.beginPath();
            context.arc(
                tip.x,
                tip.y,
                Math.max(1.2, cell_size * (0.08 + pulse * 0.025)),
                0,
                Math.PI * 2
            );
            context.fill();
            context.restore();
        }

        draw_effects(context, effects, time, layer) {
            for (const effect of effects) {
                const progress = Math.max(
                    0,
                    Math.min(1, (time - effect.started) / effect.duration)
                );

                if (progress >= 1 || progress < 0) {
                    continue;
                }

                if (effect.type === "ripple" && layer === "behind") {
                    this.draw_ripple(context, effect, progress);
                } else if (effect.type === "launch" && layer === "front") {
                    this.draw_launch(context, effect, progress);
                } else if (effect.type === "impact" && layer === "front") {
                    this.draw_impact(context, effect, progress);
                } else if (effect.type === "burst" && layer === "front") {
                    this.draw_burst(context, effect, progress);
                } else if (
                    effect.type === "celebration" &&
                    layer === "front"
                ) {
                    this.draw_celebration(context, effect, progress);
                }
            }
        }

        draw_ripple(context, effect, progress) {
            const point = this.grid_point_to_canvas(effect.x, effect.y);
            const radius = this.board_bounds.cell_size *
                (0.22 + progress * (effect.strength || 1) * 1.25);

            context.save();
            context.globalAlpha = Math.pow(1 - progress, 2) * 0.65;
            context.strokeStyle = effect.color;
            context.lineWidth = Math.max(1, this.board_bounds.cell_size * 0.08);
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, Math.PI * 2);
            context.stroke();
            context.restore();
        }

        draw_launch(context, effect, progress) {
            const point = this.grid_point_to_canvas(effect.x, effect.y);
            const direction = effect.direction || { x: 1, y: 0 };
            const side_x = -direction.y;
            const side_y = direction.x;
            const cell_size = this.board_bounds.cell_size;
            const distance = cell_size * (0.35 + progress * 0.9);

            context.save();
            context.lineCap = "round";
            context.strokeStyle = effect.color;

            for (let index = 0; index < 5; index += 1) {
                const offset = (index - 2) * cell_size * 0.1;
                const stagger = index * 0.055;
                const local_progress = Math.max(
                    0,
                    Math.min(1, (progress - stagger) / (1 - stagger))
                );

                context.globalAlpha = (1 - local_progress) * 0.34;
                context.lineWidth = Math.max(1, cell_size * 0.045);
                context.beginPath();
                context.moveTo(
                    point.x - direction.x * distance * local_progress + side_x * offset,
                    point.y - direction.y * distance * local_progress + side_y * offset
                );
                context.lineTo(
                    point.x - direction.x * (distance * local_progress + cell_size * 0.18) + side_x * offset,
                    point.y - direction.y * (distance * local_progress + cell_size * 0.18) + side_y * offset
                );
                context.stroke();
            }

            context.restore();
        }

        draw_impact(context, effect, progress) {
            const point = this.grid_point_to_canvas(effect.x, effect.y);
            const cell_size = this.board_bounds.cell_size;
            const radius = cell_size * (0.18 + progress * 0.85);

            context.save();
            context.globalAlpha = (1 - progress) * 0.72;
            context.strokeStyle = effect.color || "#ff7d8f";
            context.lineWidth = Math.max(1, cell_size * 0.075);
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, Math.PI * 2);
            context.stroke();

            context.globalAlpha *= 0.6;
            context.beginPath();
            context.arc(
                point.x,
                point.y,
                radius * 0.58,
                0,
                Math.PI * 2
            );
            context.stroke();
            context.restore();
        }

        draw_burst(context, effect, progress) {
            const point = this.grid_point_to_canvas(effect.x, effect.y);
            const cell_size = this.board_bounds.cell_size;
            const count = effect.count || 9;
            const eased = 1 - Math.pow(1 - progress, 3);

            context.save();
            context.lineCap = "round";
            context.strokeStyle = effect.color;

            for (let index = 0; index < count; index += 1) {
                const angle = this.noise(effect.seed || 1, index) * Math.PI * 2;
                const speed = 0.65 + this.noise(effect.seed || 1, index + 31) * 0.8;
                const distance = cell_size * speed * eased * 1.7;
                const length = cell_size * (0.08 + speed * 0.07);
                const x = point.x + Math.cos(angle) * distance;
                const y = point.y + Math.sin(angle) * distance;

                context.globalAlpha = Math.pow(1 - progress, 1.5) * 0.75;
                context.lineWidth = Math.max(1, cell_size * 0.045);
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(
                    x - Math.cos(angle) * length,
                    y - Math.sin(angle) * length
                );
                context.stroke();
            }

            context.restore();
        }

        draw_celebration(context, effect, progress) {
            const point = this.grid_point_to_canvas(effect.x, effect.y);
            const board_radius = this.board_bounds.size * 0.48;
            const eased = 1 - Math.pow(1 - progress, 3);

            context.save();
            context.globalAlpha = Math.pow(1 - progress, 2) * 0.28;
            context.strokeStyle = effect.color;
            context.lineWidth = Math.max(1.5, this.board_bounds.cell_size * 0.08);
            context.beginPath();
            context.arc(
                point.x,
                point.y,
                board_radius * eased,
                0,
                Math.PI * 2
            );
            context.stroke();
            context.restore();

            this.draw_burst(
                context,
                {
                    ...effect,
                    count: effect.count || 30
                },
                progress
            );
        }

        noise(seed, index) {
            const value = Math.sin(
                seed * 12.9898 + index * 78.233
            ) * 43758.5453;

            return value - Math.floor(value);
        }

        grid_point_to_canvas(grid_x, grid_y) {
            return {
                x: this.board_bounds.x + (grid_x + 0.5) * this.board_bounds.cell_size,
                y: this.board_bounds.y + (grid_y + 0.5) * this.board_bounds.cell_size
            };
        }

        cell_center(grid_x, grid_y) {
            return this.grid_point_to_canvas(grid_x, grid_y);
        }

        stroke_polyline(context, points, color, width) {
            context.beginPath();
            context.moveTo(points[0].x, points[0].y);

            for (let index = 1; index < points.length; index += 1) {
                context.lineTo(points[index].x, points[index].y);
            }

            context.strokeStyle = color;
            context.lineWidth = width;
            context.stroke();
        }

        draw_arrow(
            context,
            center,
            direction,
            outer_color,
            inner_color,
            outer_width,
            inner_width,
            cell_size
        ) {
            const forward_x = direction.x;
            const forward_y = direction.y;
            const side_x = -forward_y;
            const side_y = forward_x;
            const arrow_reach = cell_size * 0.43;
            const wing_length = cell_size * 0.28;
            const wing_spread = cell_size * 0.205;
            const tip = {
                x: center.x + forward_x * arrow_reach,
                y: center.y + forward_y * arrow_reach
            };
            const left_wing = {
                x:
                    tip.x - forward_x * wing_length +
                    side_x * wing_spread,
                y:
                    tip.y - forward_y * wing_length +
                    side_y * wing_spread
            };
            const right_wing = {
                x:
                    tip.x - forward_x * wing_length -
                    side_x * wing_spread,
                y:
                    tip.y - forward_y * wing_length -
                    side_y * wing_spread
            };
            const draw_structure = (color, width) => {
                context.beginPath();
                context.moveTo(center.x, center.y);
                context.lineTo(tip.x, tip.y);
                context.moveTo(tip.x, tip.y);
                context.lineTo(left_wing.x, left_wing.y);
                context.moveTo(tip.x, tip.y);
                context.lineTo(right_wing.x, right_wing.y);
                context.strokeStyle = color;
                context.lineWidth = width;
                context.stroke();
            };

            draw_structure(outer_color, outer_width * 0.72);
            draw_structure(inner_color, inner_width * 0.64);
            return tip;
        }
    }

    global_scope.ChoobsCanvasRenderer = CanvasRenderer;
})(globalThis);
