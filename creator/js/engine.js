(function (global_scope) {
    "use strict";

    const DIRECTIONS = Object.freeze([
        Object.freeze({ x: 0, y: -1 }),
        Object.freeze({ x: 1, y: 0 }),
        Object.freeze({ x: 0, y: 1 }),
        Object.freeze({ x: -1, y: 0 })
    ]);

    const PIPE_COLORS = Object.freeze([
        "#ff5c7a", "#ffd166", "#4dd6a8", "#5b9dff", "#b983ff"
    ]);
    const MAX_PALETTE_SIZE = 2500;
    const EMPTY_COLOR_INDEX = 65535;


    function normalize_palette(raw_palette) {
        const source = Array.isArray(raw_palette) ? raw_palette : [];
        const palette = [];

        for (const value of source) {
            const color = String(value || "").trim();

            if (/^#[0-9a-f]{6}$/i.test(color) && !palette.includes(color)) {
                palette.push(color.toLowerCase());
            }

            if (palette.length >= MAX_PALETTE_SIZE) {
                break;
            }
        }

        if (palette.length === 0) {
            return Array.from(PIPE_COLORS);
        }

        return palette;
    }

    const LENGTH_RANGES = Object.freeze([
        Object.freeze({ minimum: 12, maximum: 24 }),
        Object.freeze({ minimum: 20, maximum: 40 }),
        Object.freeze({ minimum: 32, maximum: 64 })
    ]);

    const MAX_STRAIGHT_CELLS = 5;
    const MAX_STRAIGHT_SEGMENTS = MAX_STRAIGHT_CELLS - 1;
    const MIN_EFFECTIVE_NESTING = 3.7;

    class SeededRandom {
        constructor(seed) {
            this.state = seed >>> 0;
        }

        next() {
            this.state += 0x6D2B79F5;
            let value = this.state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        }

        integer(minimum, maximum_exclusive) {
            return minimum + Math.floor(this.next() * (maximum_exclusive - minimum));
        }

        choice(items) {
            return items[this.integer(0, items.length)];
        }

        shuffle(items) {
            for (let index = items.length - 1; index > 0; index -= 1) {
                const swap_index = this.integer(0, index + 1);
                [items[index], items[swap_index]] = [items[swap_index], items[index]];
            }

            return items;
        }
    }

    class Grid {
        constructor(columns, rows, valid_cells) {
            this.columns = columns;
            this.rows = rows;
            this.cell_count = columns * rows;
            this.valid_cells = Uint8Array.from(valid_cells);
            this.occupancy = new Int32Array(this.cell_count);
            this.occupancy.fill(-1);
        }

        index(x, y) {
            return y * this.columns + x;
        }

        coordinates(index) {
            return {
                x: index % this.columns,
                y: Math.floor(index / this.columns)
            };
        }

        is_inside(x, y) {
            return x >= 0 && x < this.columns && y >= 0 && y < this.rows;
        }

        get_occupant(x, y) {
            return this.is_inside(x, y) ? this.occupancy[this.index(x, y)] : -1;
        }

        set_occupant(x, y, pipe_id) {
            if (this.is_inside(x, y)) {
                this.occupancy[this.index(x, y)] = pipe_id;
            }
        }
    }

    function create_seed() {
        if (
            typeof crypto !== "undefined" &&
            typeof crypto.getRandomValues === "function"
        ) {
            const values = new Uint32Array(1);
            crypto.getRandomValues(values);
            return values[0];
        }

        return (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    }

    function clean_mask(mask, columns, rows, minimum_component_size = 3) {
        const cleaned = Uint8Array.from(mask);
        const visited = new Uint8Array(cleaned.length);

        for (let index = 0; index < cleaned.length; index += 1) {
            if (!cleaned[index] || visited[index]) {
                continue;
            }

            const component = [];
            const queue = [index];
            visited[index] = 1;

            for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
                const current_index = queue[queue_index];
                component.push(current_index);

                const x = current_index % columns;
                const y = Math.floor(current_index / columns);

                for (const direction of DIRECTIONS) {
                    const next_x = x + direction.x;
                    const next_y = y + direction.y;

                    if (
                        next_x < 0 || next_x >= columns ||
                        next_y < 0 || next_y >= rows
                    ) {
                        continue;
                    }

                    const next_index = next_y * columns + next_x;

                    if (cleaned[next_index] && !visited[next_index]) {
                        visited[next_index] = 1;
                        queue.push(next_index);
                    }
                }
            }

            if (component.length < minimum_component_size) {
                for (const component_index of component) {
                    cleaned[component_index] = 0;
                }
            }
        }

        return cleaned;
    }

    function resize_mask(mask, old_columns, old_rows, new_columns, new_rows) {
        const resized = new Uint8Array(new_columns * new_rows);

        for (let y = 0; y < new_rows; y += 1) {
            const source_y = Math.min(
                old_rows - 1,
                Math.floor((y + 0.5) * old_rows / new_rows)
            );

            for (let x = 0; x < new_columns; x += 1) {
                const source_x = Math.min(
                    old_columns - 1,
                    Math.floor((x + 0.5) * old_columns / new_columns)
                );

                resized[y * new_columns + x] =
                    mask[source_y * old_columns + source_x] ? 1 : 0;
            }
        }

        return resized;
    }

    function count_available_neighbors(grid, available, index) {
        const x = index % grid.columns;
        const y = Math.floor(index / grid.columns);
        let count = 0;

        for (const direction of DIRECTIONS) {
            const next_x = x + direction.x;
            const next_y = y + direction.y;

            if (
                grid.is_inside(next_x, next_y) &&
                available[grid.index(next_x, next_y)]
            ) {
                count += 1;
            }
        }

        return count;
    }

    function count_occupied_neighbors(grid, x, y) {
        let count = 0;

        for (const direction of DIRECTIONS) {
            const next_x = x + direction.x;
            const next_y = y + direction.y;

            if (
                grid.is_inside(next_x, next_y) &&
                grid.get_occupant(next_x, next_y) !== -1
            ) {
                count += 1;
            }
        }

        return count;
    }

    function count_nearby_occupied_cells(grid, x, y) {
        let count = 0;

        for (let offset_y = -2; offset_y <= 2; offset_y += 1) {
            for (let offset_x = -2; offset_x <= 2; offset_x += 1) {
                const distance = Math.abs(offset_x) + Math.abs(offset_y);

                if (distance === 0 || distance > 2) {
                    continue;
                }

                const next_x = x + offset_x;
                const next_y = y + offset_y;

                if (
                    grid.is_inside(next_x, next_y) &&
                    grid.get_occupant(next_x, next_y) !== -1
                ) {
                    count += 1;
                }
            }
        }

        return count;
    }

    function count_path_neighbors(
        grid,
        path_marks,
        path_token,
        x,
        y,
        current_index
    ) {
        let count = 0;

        for (const direction of DIRECTIONS) {
            const next_x = x + direction.x;
            const next_y = y + direction.y;

            if (!grid.is_inside(next_x, next_y)) {
                continue;
            }

            const next_index = grid.index(next_x, next_y);

            if (
                next_index !== current_index &&
                path_marks[next_index] === path_token
            ) {
                count += 1;
            }
        }

        return count;
    }

    function direction_between_indices(grid, first_index, second_index) {
        const first_x = first_index % grid.columns;
        const first_y = Math.floor(first_index / grid.columns);
        const second_x = second_index % grid.columns;
        const second_y = Math.floor(second_index / grid.columns);

        return {
            x: second_x - first_x,
            y: second_y - first_y
        };
    }

    function trailing_straight_segments_for_indices(grid, path) {
        if (path.length < 2) {
            return 0;
        }

        const final_direction = direction_between_indices(
            grid,
            path[path.length - 2],
            path[path.length - 1]
        );
        let segment_count = 1;

        for (let index = path.length - 2; index > 0; index -= 1) {
            const direction = direction_between_indices(
                grid,
                path[index - 1],
                path[index]
            );

            if (
                direction.x !== final_direction.x ||
                direction.y !== final_direction.y
            ) {
                break;
            }

            segment_count += 1;
        }

        return segment_count;
    }

    function index_path_extension_respects_straight_limit(
        grid,
        path,
        next_index
    ) {
        if (path.length < 2) {
            return true;
        }

        const previous_direction = direction_between_indices(
            grid,
            path[path.length - 2],
            path[path.length - 1]
        );
        const next_direction = direction_between_indices(
            grid,
            path[path.length - 1],
            next_index
        );

        if (
            previous_direction.x !== next_direction.x ||
            previous_direction.y !== next_direction.y
        ) {
            return true;
        }

        return (
            trailing_straight_segments_for_indices(grid, path) <
            MAX_STRAIGHT_SEGMENTS
        );
    }

    function analyze_pipe_geometry(cells) {
        if (cells.length < 2) {
            return {
                maximum_straight_cells: cells.length,
                turn_count: 0,
                segment_count: 0
            };
        }

        let previous_direction = null;
        let current_straight_cells = 1;
        let maximum_straight_cells = 1;
        let turn_count = 0;

        for (let index = 1; index < cells.length; index += 1) {
            const direction = {
                x: cells[index].x - cells[index - 1].x,
                y: cells[index].y - cells[index - 1].y
            };

            if (
                previous_direction &&
                direction.x === previous_direction.x &&
                direction.y === previous_direction.y
            ) {
                current_straight_cells += 1;
            } else {
                if (previous_direction) {
                    turn_count += 1;
                }

                current_straight_cells = 2;
            }

            maximum_straight_cells = Math.max(
                maximum_straight_cells,
                current_straight_cells
            );
            previous_direction = direction;
        }

        return {
            maximum_straight_cells,
            turn_count,
            segment_count: cells.length - 1
        };
    }

    function cells_respect_straight_limit(cells) {
        return (
            analyze_pipe_geometry(cells).maximum_straight_cells <=
            MAX_STRAIGHT_CELLS
        );
    }

    function analyze_pipe_collection(pipes) {
        let maximum_straight_cells = 0;
        let turn_count = 0;
        let segment_count = 0;
        let straight_only_pipe_count = 0;

        for (const pipe of pipes) {
            const geometry = analyze_pipe_geometry(pipe.cells);
            maximum_straight_cells = Math.max(
                maximum_straight_cells,
                geometry.maximum_straight_cells
            );
            turn_count += geometry.turn_count;
            segment_count += geometry.segment_count;

            if (pipe.cells.length >= 4 && geometry.turn_count === 0) {
                straight_only_pipe_count += 1;
            }
        }

        return {
            maximum_straight_cells,
            turn_count,
            segment_count,
            straight_only_pipe_count,
            turn_density: segment_count > 0 ? turn_count / segment_count : 0
        };
    }

    function weighted_choice(items, random) {
        let total_weight = 0;

        for (const item of items) {
            total_weight += item.weight;
        }

        let cursor = random.next() * total_weight;

        for (const item of items) {
            cursor -= item.weight;

            if (cursor <= 0) {
                return item;
            }
        }

        return items[items.length - 1];
    }

    function remove_remaining_index(
        index,
        available,
        remaining_indices,
        remaining_positions
    ) {
        if (!available[index]) {
            return;
        }

        available[index] = 0;
        const position = remaining_positions[index];
        const last_position = remaining_indices.length - 1;
        const last_index = remaining_indices[last_position];

        if (position !== last_position) {
            remaining_indices[position] = last_index;
            remaining_positions[last_index] = position;
        }

        remaining_indices.pop();
        remaining_positions[index] = -1;
    }

    function choose_start_index(
        grid,
        available,
        remaining_indices,
        random,
        nesting
    ) {
        const remaining_count = remaining_indices.length;
        const sample_count = Math.min(
            remaining_count,
            96 + nesting * 64
        );
        let best_index = remaining_indices[0];
        let best_score = Number.POSITIVE_INFINITY;
        const sampled_positions = new Set();

        while (sampled_positions.size < sample_count) {
            sampled_positions.add(random.integer(0, remaining_count));
        }

        for (const position of sampled_positions) {
            const index = remaining_indices[position];
            const x = index % grid.columns;
            const y = Math.floor(index / grid.columns);
            const degree = count_available_neighbors(grid, available, index);
            const occupied_neighbors = count_occupied_neighbors(grid, x, y);
            const nearby_occupied = nesting > 0 ?
                count_nearby_occupied_cells(grid, x, y) :
                0;
            const edge_distance = Math.min(
                x,
                y,
                grid.columns - 1 - x,
                grid.rows - 1 - y
            );
            let score = degree * 8;

            if (degree <= 1) {
                score -= 18;
            }

            if (nesting > 0) {
                score -= occupied_neighbors * nesting * 5.5;
                score -= nearby_occupied * nesting * 0.7;
                score -= Math.min(edge_distance, 8) * nesting * 0.18;
            }

            score += random.next() * 2.5;

            if (score < best_score) {
                best_score = score;
                best_index = index;
            }
        }

        return best_index;
    }

    function grow_path(
        grid,
        available,
        start_index,
        target_length,
        random,
        nesting,
        path_marks,
        path_token
    ) {
        const path = [start_index];
        path_marks[start_index] = path_token;
        let current_index = start_index;
        let previous_direction_index = -1;
        let straight_run = 0;

        while (path.length < target_length) {
            const current_x = current_index % grid.columns;
            const current_y = Math.floor(current_index / grid.columns);
            const choices = [];

            for (
                let direction_index = 0;
                direction_index < DIRECTIONS.length;
                direction_index += 1
            ) {
                const direction = DIRECTIONS[direction_index];
                const next_x = current_x + direction.x;
                const next_y = current_y + direction.y;

                if (!grid.is_inside(next_x, next_y)) {
                    continue;
                }

                const next_index = grid.index(next_x, next_y);

                if (
                    !available[next_index] ||
                    path_marks[next_index] === path_token
                ) {
                    continue;
                }

                const continues_straight =
                    direction_index === previous_direction_index;

                if (
                    continues_straight &&
                    straight_run >= MAX_STRAIGHT_SEGMENTS
                ) {
                    continue;
                }

                const onward_degree = count_available_neighbors(
                    grid,
                    available,
                    next_index
                );
                const is_turn =
                    previous_direction_index !== -1 &&
                    direction_index !== previous_direction_index;
                const occupied_neighbors = nesting > 0 ?
                    count_occupied_neighbors(grid, next_x, next_y) :
                    0;
                const nearby_occupied = nesting > 0 ?
                    count_nearby_occupied_cells(grid, next_x, next_y) :
                    0;
                const path_neighbors = nesting > 0 ?
                    count_path_neighbors(
                        grid,
                        path_marks,
                        path_token,
                        next_x,
                        next_y,
                        current_index
                    ) :
                    0;
                const edge_distance = Math.min(
                    next_x,
                    next_y,
                    grid.columns - 1 - next_x,
                    grid.rows - 1 - next_y
                );
                let weight = 1;

                if (is_turn) {
                    weight +=
                        1.9 +
                        Math.min(straight_run, 3) * 0.55 +
                        nesting * 1.15;
                } else if (straight_run >= Math.max(1, 3 - nesting)) {
                    weight *= Math.max(0.12, 0.4 - nesting * 0.08);
                }

                if (onward_degree <= 1) {
                    weight += 1.5;
                } else if (onward_degree >= 3) {
                    weight += 0.3 + nesting * 0.18;
                }

                if (nesting > 0) {
                    weight += occupied_neighbors * nesting * 2.4;
                    weight += nearby_occupied * nesting * 0.24;
                    weight += path_neighbors * nesting * 1.45;
                    weight += Math.min(edge_distance, 7) * nesting * 0.08;
                } else if (edge_distance <= 1) {
                    weight += 0.22;
                }

                choices.push({
                    index: next_index,
                    direction_index,
                    weight: Math.max(0.01, weight)
                });
            }

            if (choices.length === 0) {
                break;
            }

            const selected = weighted_choice(choices, random);
            path.push(selected.index);
            path_marks[selected.index] = path_token;
            current_index = selected.index;

            if (previous_direction_index === selected.direction_index) {
                straight_run += 1;
            } else {
                straight_run = 1;
            }

            previous_direction_index = selected.direction_index;
        }

        return path;
    }

    function evaluate_path_orientation(
        grid,
        available,
        path_indices,
        orientation
    ) {
        const ordered_indices = orientation === 0 ?
            path_indices :
            [...path_indices].reverse();
        const head_index = ordered_indices[ordered_indices.length - 1];
        const previous_index = ordered_indices[ordered_indices.length - 2];
        const head_x = head_index % grid.columns;
        const head_y = Math.floor(head_index / grid.columns);
        const previous_x = previous_index % grid.columns;
        const previous_y = Math.floor(previous_index / grid.columns);
        const direction = {
            x: head_x - previous_x,
            y: head_y - previous_y
        };
        const path_lookup = new Set(path_indices);
        const reservation_indices = [];
        const blockers = new Set();
        let x = head_x + direction.x;
        let y = head_y + direction.y;

        while (grid.is_inside(x, y)) {
            const index = grid.index(x, y);

            if (path_lookup.has(index)) {
                return null;
            }

            const occupant = grid.occupancy[index];

            if (occupant !== -1) {
                blockers.add(occupant);
            } else if (available[index]) {
                reservation_indices.push(index);
            }

            x += direction.x;
            y += direction.y;
        }

        return {
            orientation,
            ordered_indices,
            direction,
            reservation_indices,
            blocker_count: blockers.size
        };
    }

    function count_path_contact(grid, path_indices) {
        const path_lookup = new Set(path_indices);
        let contact_count = 0;

        for (const index of path_indices) {
            const x = index % grid.columns;
            const y = Math.floor(index / grid.columns);

            for (const direction of DIRECTIONS) {
                const next_x = x + direction.x;
                const next_y = y + direction.y;

                if (!grid.is_inside(next_x, next_y)) {
                    continue;
                }

                const next_index = grid.index(next_x, next_y);

                if (
                    !path_lookup.has(next_index) &&
                    grid.occupancy[next_index] !== -1
                ) {
                    contact_count += 1;
                }
            }
        }

        return contact_count;
    }

    function direction_index_from_vector(direction) {
        for (let index = 0; index < DIRECTIONS.length; index += 1) {
            if (
                DIRECTIONS[index].x === direction.x &&
                DIRECTIONS[index].y === direction.y
            ) {
                return index;
            }
        }

        return -1;
    }

    function build_frontier_candidates(grid, available, remaining_indices) {
        const row_left = new Int32Array(grid.rows);
        const row_right = new Int32Array(grid.rows);
        const column_top = new Int32Array(grid.columns);
        const column_bottom = new Int32Array(grid.columns);
        const candidates = [];
        const candidate_keys = new Set();

        row_left.fill(grid.columns);
        row_right.fill(-1);
        column_top.fill(grid.rows);
        column_bottom.fill(-1);

        for (const index of remaining_indices) {
            const x = index % grid.columns;
            const y = Math.floor(index / grid.columns);
            row_left[y] = Math.min(row_left[y], x);
            row_right[y] = Math.max(row_right[y], x);
            column_top[x] = Math.min(column_top[x], y);
            column_bottom[x] = Math.max(column_bottom[x], y);
        }

        function add_candidate(x, y, direction_index) {
            if (!grid.is_inside(x, y)) {
                return;
            }

            const head_index = grid.index(x, y);

            if (!available[head_index]) {
                return;
            }

            const key = head_index * 4 + direction_index;

            if (candidate_keys.has(key)) {
                return;
            }

            candidate_keys.add(key);
            const direction = DIRECTIONS[direction_index];
            const inside_x = x - direction.x;
            const inside_y = y - direction.y;
            const second_index =
                grid.is_inside(inside_x, inside_y) &&
                available[grid.index(inside_x, inside_y)] ?
                    grid.index(inside_x, inside_y) :
                    -1;
            let blocker_count = 0;
            let ray_contact_count = 0;
            let ray_x = x + direction.x;
            let ray_y = y + direction.y;

            while (grid.is_inside(ray_x, ray_y)) {
                const occupant = grid.get_occupant(ray_x, ray_y);

                if (occupant !== -1) {
                    blocker_count += 1;
                    ray_contact_count += 1;
                }

                ray_x += direction.x;
                ray_y += direction.y;
            }

            candidates.push({
                head_index,
                second_index,
                direction_index,
                direction,
                blocker_count,
                ray_contact_count
            });
        }

        for (let y = 0; y < grid.rows; y += 1) {
            if (row_right[y] < 0) {
                continue;
            }

            add_candidate(row_left[y], y, 3);
            add_candidate(row_right[y], y, 1);
        }

        for (let x = 0; x < grid.columns; x += 1) {
            if (column_bottom[x] < 0) {
                continue;
            }

            add_candidate(x, column_top[x], 0);
            add_candidate(x, column_bottom[x], 2);
        }

        return candidates;
    }

    function count_side_contacts(grid, x, y, direction_index) {
        const direction = DIRECTIONS[direction_index];
        const side_directions = [
            { x: -direction.y, y: direction.x },
            { x: direction.y, y: -direction.x }
        ];
        let count = 0;

        for (const side of side_directions) {
            const side_x = x + side.x;
            const side_y = y + side.y;

            if (
                grid.is_inside(side_x, side_y) &&
                grid.get_occupant(side_x, side_y) !== -1
            ) {
                count += 1;
            }
        }

        return count;
    }

    function count_remaining_neighbors_after_path(
        grid,
        available,
        path_marks,
        path_token,
        index
    ) {
        const x = index % grid.columns;
        const y = Math.floor(index / grid.columns);
        let count = 0;

        for (const direction of DIRECTIONS) {
            const next_x = x + direction.x;
            const next_y = y + direction.y;

            if (!grid.is_inside(next_x, next_y)) {
                continue;
            }

            const next_index = grid.index(next_x, next_y);

            if (
                available[next_index] &&
                path_marks[next_index] !== path_token
            ) {
                count += 1;
            }
        }

        return count;
    }

    function collect_orphaned_cells_after_path(
        grid,
        available,
        path_indices,
        path_marks,
        path_token
    ) {
        const orphaned = [];
        const checked = new Set();

        for (const path_index of path_indices) {
            const x = path_index % grid.columns;
            const y = Math.floor(path_index / grid.columns);

            for (const direction of DIRECTIONS) {
                const next_x = x + direction.x;
                const next_y = y + direction.y;

                if (!grid.is_inside(next_x, next_y)) {
                    continue;
                }

                const next_index = grid.index(next_x, next_y);

                if (
                    checked.has(next_index) ||
                    !available[next_index] ||
                    path_marks[next_index] === path_token
                ) {
                    continue;
                }

                checked.add(next_index);

                if (
                    count_remaining_neighbors_after_path(
                        grid,
                        available,
                        path_marks,
                        path_token,
                        next_index
                    ) === 0
                ) {
                    orphaned.push(next_index);
                }
            }
        }

        return orphaned;
    }

    function collect_orphaned_cells_for_path(
        grid,
        available,
        path_indices
    ) {
        const path_lookup = new Set(path_indices);
        const checked = new Set();
        const orphaned = [];

        for (const path_index of path_indices) {
            const x = path_index % grid.columns;
            const y = Math.floor(path_index / grid.columns);

            for (const direction of DIRECTIONS) {
                const next_x = x + direction.x;
                const next_y = y + direction.y;

                if (!grid.is_inside(next_x, next_y)) {
                    continue;
                }

                const next_index = grid.index(next_x, next_y);

                if (
                    checked.has(next_index) ||
                    !available[next_index] ||
                    path_lookup.has(next_index)
                ) {
                    continue;
                }

                checked.add(next_index);
                let remaining_neighbor_count = 0;

                for (const neighbor_direction of DIRECTIONS) {
                    const neighbor_x = next_x + neighbor_direction.x;
                    const neighbor_y = next_y + neighbor_direction.y;

                    if (!grid.is_inside(neighbor_x, neighbor_y)) {
                        continue;
                    }

                    const neighbor_index = grid.index(neighbor_x, neighbor_y);

                    if (
                        available[neighbor_index] &&
                        !path_lookup.has(neighbor_index)
                    ) {
                        remaining_neighbor_count += 1;
                    }
                }

                if (remaining_neighbor_count === 0) {
                    orphaned.push(next_index);
                }
            }
        }

        return orphaned;
    }

    function trim_path_to_avoid_orphans(
        grid,
        available,
        path_indices,
        path_marks,
        path_token
    ) {
        for (
            let path_length = path_indices.length;
            path_length >= 2;
            path_length -= 1
        ) {
            const candidate = path_indices.slice(0, path_length);

            if (
                collect_orphaned_cells_for_path(
                    grid,
                    available,
                    candidate
                ).length === 0
            ) {
                for (
                    let index = path_length;
                    index < path_indices.length;
                    index += 1
                ) {
                    if (path_marks[path_indices[index]] === path_token) {
                        path_marks[path_indices[index]] = 0;
                    }
                }

                return candidate;
            }
        }

        return null;
    }
    function count_structural_boundary_contacts(
        grid,
        available,
        path_marks,
        path_token,
        x,
        y,
        direction_index
    ) {
        const direction = DIRECTIONS[direction_index];
        const side_directions = [
            { x: -direction.y, y: direction.x },
            { x: direction.y, y: -direction.x }
        ];
        let count = 0;

        for (const side of side_directions) {
            const side_x = x + side.x;
            const side_y = y + side.y;

            if (!grid.is_inside(side_x, side_y)) {
                count += 1;
                continue;
            }

            const side_index = grid.index(side_x, side_y);

            if (
                !grid.valid_cells[side_index] ||
                grid.occupancy[side_index] !== -1 ||
                path_marks[side_index] === path_token ||
                !available[side_index]
            ) {
                count += 1;
            }
        }

        return count;
    }

    function calculate_entanglement_score(
        grid,
        available,
        path_marks,
        path_token,
        next_x,
        next_y,
        direction_index,
        previous_direction_index,
        nesting,
        straight_run
    ) {
        const occupied_neighbors = count_occupied_neighbors(
            grid,
            next_x,
            next_y
        );
        const nearby_occupied = count_nearby_occupied_cells(
            grid,
            next_x,
            next_y
        );
        const side_contacts = count_side_contacts(
            grid,
            next_x,
            next_y,
            direction_index
        );
        const boundary_contacts = count_structural_boundary_contacts(
            grid,
            available,
            path_marks,
            path_token,
            next_x,
            next_y,
            direction_index
        );
        const is_turn =
            previous_direction_index !== -1 &&
            direction_index !== previous_direction_index;
        const pipe_contact_value =
            occupied_neighbors * 8.6 +
            side_contacts * 11.4 +
            nearby_occupied * 0.92;
        const structural_value = boundary_contacts * 3.75;
        let score =
            pipe_contact_value * (0.78 + nesting * 0.72) +
            structural_value * (1.0 + nesting * 0.22);

        if (is_turn) {
            if (pipe_contact_value > 0) {
                score += pipe_contact_value * (2.15 + nesting * 1.08);
            } else if (boundary_contacts > 0) {
                score += structural_value * (1.42 + nesting * 0.34);
            } else {
                score -= 12 + nesting * 3.2;
            }

            score += straight_run * (4.2 + nesting * 0.84);
        } else {
            score -= 6.2 + straight_run * (3.15 + nesting * 0.5);

            if (straight_run >= 3) {
                score -= 18 + nesting * 2.6;
            }
        }

        return {
            score,
            pipe_contact_value,
            boundary_contacts,
            is_turn
        };
    }

    function grow_frontier_path(
        grid,
        available,
        frontier,
        target_length,
        random,
        nesting,
        path_marks,
        path_token
    ) {
        const path = [frontier.head_index];
        path_marks[frontier.head_index] = path_token;

        if (frontier.second_index < 0) {
            return path;
        }

        path.push(frontier.second_index);
        path_marks[frontier.second_index] = path_token;
        let current_index = frontier.second_index;
        let previous_direction_index = direction_index_from_vector({
            x:
                (frontier.second_index % grid.columns) -
                (frontier.head_index % grid.columns),
            y:
                Math.floor(frontier.second_index / grid.columns) -
                Math.floor(frontier.head_index / grid.columns)
        });
        let straight_run = 1;

        while (path.length < target_length) {
            const current_x = current_index % grid.columns;
            const current_y = Math.floor(current_index / grid.columns);
            const choices = [];

            for (
                let direction_index = 0;
                direction_index < DIRECTIONS.length;
                direction_index += 1
            ) {
                const direction = DIRECTIONS[direction_index];
                const next_x = current_x + direction.x;
                const next_y = current_y + direction.y;

                if (!grid.is_inside(next_x, next_y)) {
                    continue;
                }

                const next_index = grid.index(next_x, next_y);

                if (
                    !available[next_index] ||
                    path_marks[next_index] === path_token
                ) {
                    continue;
                }

                const continues_straight =
                    direction_index === previous_direction_index;

                if (
                    continues_straight &&
                    straight_run >= MAX_STRAIGHT_SEGMENTS
                ) {
                    continue;
                }

                const onward_degree = count_available_neighbors(
                    grid,
                    available,
                    next_index
                );
                const path_neighbors = count_path_neighbors(
                    grid,
                    path_marks,
                    path_token,
                    next_x,
                    next_y,
                    current_index
                );
                const entanglement = calculate_entanglement_score(
                    grid,
                    available,
                    path_marks,
                    path_token,
                    next_x,
                    next_y,
                    direction_index,
                    previous_direction_index,
                    nesting,
                    straight_run
                );
                let score = entanglement.score;

                if (entanglement.is_turn) {
                    score += 7.2 + Math.min(straight_run, 4) * 2.15;
                }

                if (onward_degree === 0) {
                    score += path.length + 1 >= target_length ? 4 : -10;
                } else if (onward_degree === 1) {
                    score += 3.2;
                } else if (onward_degree === 2) {
                    score += 4.4;
                } else if (onward_degree === 3) {
                    score -= 2.5;
                } else {
                    score -= 7.5;
                }

                score -= path_neighbors * (4.5 - nesting * 0.3);
                score += random.next() * 0.2;

                choices.push({
                    index: next_index,
                    direction_index,
                    score
                });
            }

            if (choices.length === 0) {
                break;
            }

            choices.sort((left, right) => right.score - left.score);
            const selected = choices[0];
            path.push(selected.index);
            path_marks[selected.index] = path_token;
            current_index = selected.index;

            if (selected.direction_index === previous_direction_index) {
                straight_run += 1;
            } else {
                straight_run = 1;
            }

            previous_direction_index = selected.direction_index;
        }

        let changed = true;

        while (changed) {
            changed = false;
            const orphaned = collect_orphaned_cells_after_path(
                grid,
                available,
                path,
                path_marks,
                path_token
            );
            const tail_index = path[path.length - 1];
            const tail_x = tail_index % grid.columns;
            const tail_y = Math.floor(tail_index / grid.columns);

            for (const orphan_index of orphaned) {
                const orphan_x = orphan_index % grid.columns;
                const orphan_y = Math.floor(orphan_index / grid.columns);

                if (
                    Math.abs(orphan_x - tail_x) +
                    Math.abs(orphan_y - tail_y) === 1 &&
                    index_path_extension_respects_straight_limit(
                        grid,
                        path,
                        orphan_index
                    )
                ) {
                    path.push(orphan_index);
                    path_marks[orphan_index] = path_token;
                    changed = true;
                    break;
                }
            }
        }

        return path;
    }

    function score_frontier_candidate(
        grid,
        frontier,
        random,
        nesting,
        remaining_count
    ) {
        const head = grid.coordinates(frontier.head_index);
        const occupied_neighbors = count_occupied_neighbors(
            grid,
            head.x,
            head.y
        );
        const nearby_occupied = count_nearby_occupied_cells(
            grid,
            head.x,
            head.y
        );
        const side_contacts = count_side_contacts(
            grid,
            head.x,
            head.y,
            frontier.direction_index
        );
        let score =
            frontier.blocker_count * (3.2 + nesting * 5.4) +
            occupied_neighbors * (2.1 + nesting * 3.35) +
            side_contacts * (2.8 + nesting * 4.25) +
            nearby_occupied * nesting * 0.5;

        if (frontier.second_index < 0) {
            score -= remaining_count === 1 ? 0 : 1000;
        }

        score += random.next() * 1.5;
        return score;
    }

    function head_extension_is_safe(
        grid,
        target,
        new_head,
        new_direction
    ) {
        const target_cells = new Set(
            target.cells.map((cell) => grid.index(cell.x, cell.y))
        );
        target_cells.add(grid.index(new_head.x, new_head.y));
        let x = new_head.x + new_direction.x;
        let y = new_head.y + new_direction.y;

        while (grid.is_inside(x, y)) {
            const index = grid.index(x, y);

            if (target_cells.has(index)) {
                return false;
            }

            const occupant = grid.occupancy[index];

            if (occupant !== -1 && occupant >= target.id) {
                return false;
            }

            x += new_direction.x;
            y += new_direction.y;
        }

        return true;
    }

    function candidate_pipe_direction_is_safe(
        grid,
        pipe_id,
        cells,
        direction
    ) {
        const candidate_cells = new Set(
            cells.map((cell) => grid.index(cell.x, cell.y))
        );
        const head = cells[cells.length - 1];
        let x = head.x + direction.x;
        let y = head.y + direction.y;

        while (grid.is_inside(x, y)) {
            const index = grid.index(x, y);

            if (candidate_cells.has(index)) {
                return false;
            }

            x += direction.x;
            y += direction.y;
        }

        return true;
    }

    function try_resolve_singleton_by_prefix_transfer(
        grid,
        pipes,
        removed_ids,
        pipe
    ) {
        const singleton = pipe.cells[0];

        for (const target of pipes) {
            if (
                target.id === pipe.id ||
                removed_ids.has(target.id) ||
                target.cells.length < 5
            ) {
                continue;
            }

            const maximum_prefix = target.cells.length - 2;

            for (let prefix_length = 2; prefix_length <= maximum_prefix; prefix_length += 1) {
                const prefix = target.cells.slice(0, prefix_length).map((cell) => ({
                    x: cell.x,
                    y: cell.y
                }));
                const reversed_prefix = [...prefix].reverse();
                const variants = [
                    [...prefix, { x: singleton.x, y: singleton.y }],
                    [...reversed_prefix, { x: singleton.x, y: singleton.y }],
                    [{ x: singleton.x, y: singleton.y }, ...prefix],
                    [{ x: singleton.x, y: singleton.y }, ...reversed_prefix]
                ];

                for (const candidate_cells of variants) {
                    let continuous = true;

                    for (let index = 1; index < candidate_cells.length; index += 1) {
                        const previous = candidate_cells[index - 1];
                        const current = candidate_cells[index];

                        if (
                            Math.abs(current.x - previous.x) +
                            Math.abs(current.y - previous.y) !== 1
                        ) {
                            continuous = false;
                            break;
                        }
                    }

                    if (!continuous) {
                        continue;
                    }

                    const geometry = analyze_pipe_geometry(candidate_cells);

                    if (
                        geometry.turn_count < 1 ||
                        geometry.maximum_straight_cells > MAX_STRAIGHT_CELLS
                    ) {
                        continue;
                    }

                    const head = candidate_cells[candidate_cells.length - 1];
                    const previous = candidate_cells[candidate_cells.length - 2];
                    const direction = {
                        x: head.x - previous.x,
                        y: head.y - previous.y
                    };

                    if (
                        !candidate_pipe_direction_is_safe(
                            grid,
                            pipe.id,
                            candidate_cells,
                            direction
                        )
                    ) {
                        continue;
                    }

                    const remaining_target_cells = target.cells
                        .slice(prefix_length)
                        .map((cell) => ({ x: cell.x, y: cell.y }));

                    if (remaining_target_cells.length < 2) {
                        continue;
                    }

                    pipe.cells = candidate_cells;
                    pipe.direction = direction;
                    target.cells = remaining_target_cells;

                    for (const transferred_cell of candidate_cells) {
                        grid.set_occupant(
                            transferred_cell.x,
                            transferred_cell.y,
                            pipe.id
                        );
                    }

                    for (const remaining_cell of remaining_target_cells) {
                        grid.set_occupant(
                            remaining_cell.x,
                            remaining_cell.y,
                            target.id
                        );
                    }

                    return true;
                }
            }
        }

        return false;
    }

    function merge_singleton_pipes(grid, pipes) {
        const removed_ids = new Set();
        let changed = true;

        while (changed) {
            changed = false;

            for (const pipe of pipes) {
                if (removed_ids.has(pipe.id) || pipe.cells.length !== 1) {
                    continue;
                }

                const cell = pipe.cells[0];
                let resolved = false;

                for (const target of pipes) {
                    if (
                        target.id >= pipe.id ||
                        removed_ids.has(target.id) ||
                        target.cells.length < 2
                    ) {
                        continue;
                    }

                    const tail = target.cells[0];
                    const head = target.cells[target.cells.length - 1];
                    const prepend_cells = [
                        { x: cell.x, y: cell.y },
                        ...target.cells
                    ];
                    const append_cells = [
                        ...target.cells,
                        { x: cell.x, y: cell.y }
                    ];

                    if (
                        Math.abs(cell.x - tail.x) +
                        Math.abs(cell.y - tail.y) === 1 &&
                        cells_respect_straight_limit(prepend_cells)
                    ) {
                        target.cells = prepend_cells;
                        grid.set_occupant(cell.x, cell.y, target.id);
                        removed_ids.add(pipe.id);
                        resolved = true;
                    } else if (
                        Math.abs(cell.x - head.x) +
                        Math.abs(cell.y - head.y) === 1 &&
                        cells_respect_straight_limit(append_cells) &&
                        head_extension_is_safe(
                            grid,
                            target,
                            cell,
                            {
                                x: cell.x - head.x,
                                y: cell.y - head.y
                            }
                        )
                    ) {
                        target.cells = append_cells;
                        target.direction = {
                            x: cell.x - head.x,
                            y: cell.y - head.y
                        };
                        grid.set_occupant(cell.x, cell.y, target.id);
                        removed_ids.add(pipe.id);
                        resolved = true;
                    }

                    if (resolved) {
                        changed = true;
                        break;
                    }
                }

                if (resolved) {
                    continue;
                }

                for (const target of pipes) {
                    if (
                        target.id >= pipe.id ||
                        removed_ids.has(target.id) ||
                        target.cells.length < 4
                    ) {
                        continue;
                    }

                    for (
                        let contact_index = 1;
                        contact_index <= target.cells.length - 3;
                        contact_index += 1
                    ) {
                        const contact = target.cells[contact_index];
                        const final_direction = {
                            x: cell.x - contact.x,
                            y: cell.y - contact.y
                        };

                        if (
                            final_direction.x !== pipe.direction.x ||
                            final_direction.y !== pipe.direction.y
                        ) {
                            continue;
                        }

                        const transferred_cells = [
                            ...target.cells.slice(0, contact_index + 1),
                            { x: cell.x, y: cell.y }
                        ];
                        const remaining_target_cells =
                            target.cells.slice(contact_index + 1);
                        const transferred_geometry =
                            analyze_pipe_geometry(transferred_cells);

                        if (
                            remaining_target_cells.length < 2 ||
                            transferred_geometry.turn_count < 1 ||
                            transferred_geometry.maximum_straight_cells >
                                MAX_STRAIGHT_CELLS
                        ) {
                            continue;
                        }

                        pipe.cells = transferred_cells;
                        target.cells = remaining_target_cells;

                        for (const transferred_cell of transferred_cells) {
                            grid.set_occupant(
                                transferred_cell.x,
                                transferred_cell.y,
                                pipe.id
                            );
                        }

                        for (const remaining_cell of remaining_target_cells) {
                            grid.set_occupant(
                                remaining_cell.x,
                                remaining_cell.y,
                                target.id
                            );
                        }

                        resolved = true;
                        changed = true;
                        break;
                    }

                    if (resolved) {
                        break;
                    }
                }

                if (
                    !resolved &&
                    try_resolve_singleton_by_prefix_transfer(
                        grid,
                        pipes,
                        removed_ids,
                        pipe
                    )
                ) {
                    resolved = true;
                    changed = true;
                }
            }
        }

        const compacted = [];

        for (const pipe of pipes) {
            if (removed_ids.has(pipe.id)) {
                continue;
            }

            pipe.id = compacted.length;
            pipe.color_index = pipe.id % PIPE_COLORS.length;
            compacted.push(pipe);
        }

        grid.occupancy.fill(-1);

        for (const pipe of compacted) {
            for (const cell of pipe.cells) {
                grid.set_occupant(cell.x, cell.y, pipe.id);
            }
        }

        return compacted;
    }

    function calculate_fixed_direction_solution_order(grid, pipes) {
        const blocker_counts = new Uint32Array(pipes.length);
        const dependents = Array.from({ length: pipes.length }, () => []);
        const scheduled = new Uint8Array(pipes.length);
        const queue = [];
        const solution_order = [];

        for (const pipe of pipes) {
            const head = pipe.cells[pipe.cells.length - 1];
            const blockers = new Set();
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;

            while (grid.is_inside(x, y)) {
                const occupant = grid.get_occupant(x, y);

                if (occupant === pipe.id) {
                    return null;
                }

                if (occupant !== -1) {
                    blockers.add(occupant);
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            blocker_counts[pipe.id] = blockers.size;

            for (const blocker of blockers) {
                dependents[blocker].push(pipe.id);
            }
        }

        for (const pipe of pipes) {
            if (blocker_counts[pipe.id] === 0) {
                queue.push(pipe.id);
            }
        }

        while (queue.length > 0) {
            const pipe_id = queue.pop();

            if (scheduled[pipe_id]) {
                continue;
            }

            scheduled[pipe_id] = 1;
            solution_order.push(pipe_id);

            for (const dependent_id of dependents[pipe_id]) {
                if (blocker_counts[dependent_id] > 0) {
                    blocker_counts[dependent_id] -= 1;
                }

                if (blocker_counts[dependent_id] === 0) {
                    queue.push(dependent_id);
                }
            }
        }

        return solution_order.length === pipes.length ? solution_order : null;
    }
    function split_pipes_to_straight_limit(grid, pipes) {
        const split_pipes = [];

        for (const pipe of pipes) {
            const tail_to_head_chunks = [];
            let chunk_start = 0;
            let previous_direction = null;
            let straight_cells = 1;

            for (let index = 1; index < pipe.cells.length; index += 1) {
                const direction = {
                    x: pipe.cells[index].x - pipe.cells[index - 1].x,
                    y: pipe.cells[index].y - pipe.cells[index - 1].y
                };

                if (
                    previous_direction &&
                    direction.x === previous_direction.x &&
                    direction.y === previous_direction.y
                ) {
                    straight_cells += 1;
                } else {
                    straight_cells = 2;
                }

                if (straight_cells > MAX_STRAIGHT_CELLS) {
                    tail_to_head_chunks.push(
                        pipe.cells.slice(chunk_start, index)
                    );
                    chunk_start = index;
                    straight_cells = 1;
                    previous_direction = null;
                    continue;
                }

                previous_direction = direction;
            }

            tail_to_head_chunks.push(pipe.cells.slice(chunk_start));

            if (
                tail_to_head_chunks.length > 1 &&
                tail_to_head_chunks[tail_to_head_chunks.length - 1].length === 1
            ) {
                const final_chunk = tail_to_head_chunks[tail_to_head_chunks.length - 1];
                const previous_chunk = tail_to_head_chunks[tail_to_head_chunks.length - 2];

                while (final_chunk.length < 3 && previous_chunk.length > 3) {
                    final_chunk.unshift(previous_chunk.pop());
                }
            }

            for (
                let chunk_index = tail_to_head_chunks.length - 1;
                chunk_index >= 0;
                chunk_index -= 1
            ) {
                const cells = tail_to_head_chunks[chunk_index].map((cell) => ({
                    x: cell.x,
                    y: cell.y
                }));

                if (cells.length === 0) {
                    continue;
                }

                let direction = { ...pipe.direction };

                if (chunk_index + 1 < tail_to_head_chunks.length) {
                    const head = cells[cells.length - 1];
                    const next_cell = tail_to_head_chunks[chunk_index + 1][0];
                    direction = {
                        x: next_cell.x - head.x,
                        y: next_cell.y - head.y
                    };
                }

                split_pipes.push({
                    id: split_pipes.length,
                    cells,
                    color_index: split_pipes.length % PIPE_COLORS.length,
                    direction
                });
            }
        }

        grid.occupancy.fill(-1);

        for (const pipe of split_pipes) {
            for (const cell of pipe.cells) {
                grid.set_occupant(cell.x, cell.y, pipe.id);
            }
        }

        return split_pipes;
    }



    function split_pipes_by_color(grid, pipes, color_map) {
        if (!color_map || color_map.length !== grid.cell_count) {
            return pipes;
        }

        const split_pipes = [];

        for (const pipe of pipes) {
            if (pipe.cells.length === 0) continue;
            const chunks = [];
            let cells = [];
            let color_index = Number(color_map[grid.index(pipe.cells[0].x, pipe.cells[0].y)]);

            for (const cell of pipe.cells) {
                const next_color = Number(color_map[grid.index(cell.x, cell.y)]);
                if (cells.length > 0 && next_color !== color_index) {
                    chunks.push({ cells, color_index });
                    cells = [];
                    color_index = next_color;
                }
                cells.push({ x: cell.x, y: cell.y });
            }
            if (cells.length > 0) chunks.push({ cells, color_index });

            // Emit the head-most colour chunk first. Earlier chunks point into the
            // next chunk, preserving the original pipe as an explicit dependency
            // chain while guaranteeing that every resulting pipe has one colour.
            for (let chunk_index = chunks.length - 1; chunk_index >= 0; chunk_index -= 1) {
                const chunk = chunks[chunk_index];
                let direction = { ...pipe.direction };

                if (chunk_index + 1 < chunks.length) {
                    const head = chunk.cells[chunk.cells.length - 1];
                    const next_cell = chunks[chunk_index + 1].cells[0];
                    direction = {
                        x: next_cell.x - head.x,
                        y: next_cell.y - head.y
                    };
                }

                split_pipes.push({
                    id: split_pipes.length,
                    cells: chunk.cells,
                    color_index: chunk.color_index,
                    direction
                });
            }
        }

        grid.occupancy.fill(-1);
        for (const pipe of split_pipes) {
            for (const cell of pipe.cells) {
                grid.set_occupant(cell.x, cell.y, pipe.id);
            }
        }

        return split_pipes;
    }


    function merge_same_color_endpoint_singletons(
        grid,
        pipes,
        random,
        nesting_setting
    ) {
        const clone_and_compact = (
            source_pipes,
            removed_id = -1,
            replacement_id = -1,
            replacement_cells = null,
            replacement_direction = null
        ) => {
            const compacted = [];

            for (const source of source_pipes) {
                if (source.id === removed_id) {
                    continue;
                }

                const is_replacement = source.id === replacement_id;
                compacted.push({
                    ...source,
                    id: compacted.length,
                    color_index: source.color_index,
                    cells: (is_replacement ? replacement_cells : source.cells)
                        .map((cell) => ({ x: cell.x, y: cell.y })),
                    direction: {
                        ...(is_replacement ?
                            replacement_direction :
                            source.direction)
                    }
                });
            }

            return compacted;
        };

        const rebuild_occupancy = (source_pipes) => {
            grid.occupancy.fill(-1);

            for (const pipe of source_pipes) {
                for (const cell of pipe.cells) {
                    grid.set_occupant(cell.x, cell.y, pipe.id);
                }
            }
        };

        let current_pipes = clone_and_compact(pipes);
        rebuild_occupancy(current_pipes);
        let changed = true;

        while (changed) {
            changed = false;

            for (const singleton_pipe of current_pipes) {
                if (singleton_pipe.cells.length !== 1) {
                    continue;
                }

                const singleton_cell = singleton_pipe.cells[0];
                const candidates = [];

                for (const target of current_pipes) {
                    if (
                        target.id === singleton_pipe.id ||
                        target.color_index !== singleton_pipe.color_index ||
                        target.cells.length < 1
                    ) {
                        continue;
                    }

                    const orientations = [
                        {
                            cells: target.cells,
                            reversal_priority: 0
                        },
                        {
                            cells: [...target.cells].reverse(),
                            reversal_priority: 1
                        }
                    ];

                    for (const orientation of orientations) {
                        const oriented_cells = orientation.cells;
                        const first = oriented_cells[0];
                        const last = oriented_cells[oriented_cells.length - 1];

                        if (
                            Math.abs(singleton_cell.x - first.x) +
                            Math.abs(singleton_cell.y - first.y) === 1
                        ) {
                            const cells = [
                                { x: singleton_cell.x, y: singleton_cell.y },
                                ...oriented_cells.map((cell) => ({
                                    x: cell.x,
                                    y: cell.y
                                }))
                            ];
                            const head = cells[cells.length - 1];
                            const previous = cells[cells.length - 2];
                            const direction = {
                                x: head.x - previous.x,
                                y: head.y - previous.y
                            };

                            if (
                                cells_respect_straight_limit(cells) &&
                                candidate_pipe_direction_is_safe(
                                    grid,
                                    target.id,
                                    cells,
                                    direction
                                )
                            ) {
                                candidates.push({
                                    target,
                                    cells,
                                    direction,
                                    endpoint_priority: 0,
                                    reversal_priority:
                                        orientation.reversal_priority
                                });
                            }
                        }

                        if (
                            Math.abs(singleton_cell.x - last.x) +
                            Math.abs(singleton_cell.y - last.y) === 1
                        ) {
                            const cells = [
                                ...oriented_cells.map((cell) => ({
                                    x: cell.x,
                                    y: cell.y
                                })),
                                { x: singleton_cell.x, y: singleton_cell.y }
                            ];
                            const head = cells[cells.length - 1];
                            const previous = cells[cells.length - 2];
                            const direction = {
                                x: head.x - previous.x,
                                y: head.y - previous.y
                            };

                            if (
                                cells_respect_straight_limit(cells) &&
                                candidate_pipe_direction_is_safe(
                                    grid,
                                    target.id,
                                    cells,
                                    direction
                                )
                            ) {
                                candidates.push({
                                    target,
                                    cells,
                                    direction,
                                    endpoint_priority: 1,
                                    reversal_priority:
                                        orientation.reversal_priority
                                });
                            }
                        }
                    }
                }

                candidates.sort((left, right) => {
                    const length_difference =
                        right.target.cells.length - left.target.cells.length;

                    if (length_difference !== 0) {
                        return length_difference;
                    }

                    if (left.reversal_priority !== right.reversal_priority) {
                        return left.reversal_priority - right.reversal_priority;
                    }

                    if (left.endpoint_priority !== right.endpoint_priority) {
                        return left.endpoint_priority - right.endpoint_priority;
                    }

                    return left.target.id - right.target.id;
                });

                let accepted = null;

                for (const candidate of candidates) {
                    const candidate_pipes = clone_and_compact(
                        current_pipes,
                        singleton_pipe.id,
                        candidate.target.id,
                        candidate.cells,
                        candidate.direction
                    );
                    rebuild_occupancy(candidate_pipes);

                    if (
                        assign_solvable_orientations(
                            grid,
                            candidate_pipes,
                            random,
                            nesting_setting
                        )
                    ) {
                        accepted = candidate_pipes;
                        break;
                    }
                }

                if (accepted) {
                    current_pipes = accepted;
                    changed = true;
                    break;
                }

                rebuild_occupancy(current_pipes);
            }
        }

        rebuild_occupancy(current_pipes);
        return current_pipes;
    }

    function carve_pipes(grid, random, length_setting, nesting_setting, exact_cover_mode = false, color_map = null) {
        const available = grid.valid_cells.slice();
        const pipes = [];
        const solution_order = [];
        const remaining_indices = [];
        const remaining_positions = new Int32Array(available.length);
        const path_marks = new Uint32Array(available.length);
        const safe_length_setting = Math.max(
            0,
            Math.min(LENGTH_RANGES.length - 1, Number(length_setting) || 0)
        );
        const requested_nesting = Math.max(
            0,
            Math.min(3, Number(nesting_setting) || 0)
        );
        const nesting =
            MIN_EFFECTIVE_NESTING + requested_nesting * 0.84;
        const length_range = LENGTH_RANGES[safe_length_setting];
        let path_token = 0;
        let singleton_pipe_count = 0;

        remaining_positions.fill(-1);

        for (let index = 0; index < available.length; index += 1) {
            if (available[index]) {
                remaining_positions[index] = remaining_indices.length;
                remaining_indices.push(index);
            }
        }

        while (remaining_indices.length > 0) {
            const frontier_candidates = build_frontier_candidates(
                grid,
                available,
                remaining_indices
            );

            if (frontier_candidates.length === 0) {
                throw new Error("The remaining image cells have no usable exit frontier.");
            }

            const scored_frontiers = frontier_candidates.map((frontier) => ({
                frontier,
                score: score_frontier_candidate(
                    grid,
                    frontier,
                    random,
                    nesting,
                    remaining_indices.length
                )
            }));
            scored_frontiers.sort((left, right) => right.score - left.score);

            const candidate_limit = Math.min(
                scored_frontiers.length,
                10 + Math.round(nesting * 5)
            );
            let best_candidate = null;
            let best_score = Number.NEGATIVE_INFINITY;

            for (
                let candidate_index = 0;
                candidate_index < candidate_limit;
                candidate_index += 1
            ) {
                const frontier = scored_frontiers[candidate_index].frontier;
                const resolution_scale = Math.max(
                    1,
                    Math.min(3.2, Math.max(grid.columns, grid.rows) / 30)
                );
                const length_multiplier =
                    resolution_scale * Math.max(0.84, 1 - nesting * 0.028);
                const minimum_length = Math.max(
                    2,
                    Math.round(length_range.minimum * length_multiplier)
                );
                const maximum_length = Math.max(
                    minimum_length,
                    Math.round(length_range.maximum * length_multiplier)
                );
                const target_length = Math.min(
                    remaining_indices.length,
                    random.integer(minimum_length, maximum_length + 1)
                );

                path_token = (path_token + 1) >>> 0;

                if (path_token === 0) {
                    path_marks.fill(0);
                    path_token = 1;
                }

                let growth_path = grow_frontier_path(
                    grid,
                    available,
                    frontier,
                    target_length,
                    random,
                    nesting,
                    path_marks,
                    path_token
                );
                if (grid.cell_count < 8000) {
                    growth_path = trim_path_to_avoid_orphans(
                        grid,
                        available,
                        growth_path,
                        path_marks,
                        path_token
                    );

                    if (!growth_path) {
                        continue;
                    }
                }

                const orphan_count = collect_orphaned_cells_after_path(
                    grid,
                    available,
                    growth_path,
                    path_marks,
                    path_token
                ).length;
                const contact_count = count_path_contact(grid, growth_path);
                let turn_count = 0;

                for (let index = 2; index < growth_path.length; index += 1) {
                    const first = grid.coordinates(growth_path[index - 2]);
                    const second = grid.coordinates(growth_path[index - 1]);
                    const third = grid.coordinates(growth_path[index]);

                    if (
                        second.x - first.x !== third.x - second.x ||
                        second.y - first.y !== third.y - second.y
                    ) {
                        turn_count += 1;
                    }
                }

                const purposeful_turn_value =
                    contact_count > 0 ?
                        Math.min(turn_count, contact_count) :
                        -turn_count;
                const score =
                    score_frontier_candidate(
                        grid,
                        frontier,
                        random,
                        nesting,
                        remaining_indices.length
                    ) +
                    contact_count * (3.25 + nesting * 4.15) +
                    purposeful_turn_value * (2.85 + nesting * 2.3) -
                    orphan_count * 500 +
                    growth_path.length * 0.08;

                if (score > best_score) {
                    best_score = score;
                    best_candidate = {
                        frontier,
                        growth_path,
                        orphan_count
                    };
                }
            }

            if (!best_candidate) {
                if (!exact_cover_mode) {
                    throw new Error("A complete pipe cover could not be constructed.");
                }

                const fallback_frontier = scored_frontiers[0].frontier;
                best_candidate = {
                    frontier: fallback_frontier,
                    growth_path: [fallback_frontier.index],
                    orphan_count: 0
                };
            }

            const ordered_indices = [...best_candidate.growth_path].reverse();
            const pipe_id = pipes.length;

            if (ordered_indices.length === 1) {
                singleton_pipe_count += 1;
            }

            pipes.push({
                id: pipe_id,
                cells: ordered_indices.map((index) => grid.coordinates(index)),
                color_index: pipe_id % PIPE_COLORS.length,
                direction: {
                    x: best_candidate.frontier.direction.x,
                    y: best_candidate.frontier.direction.y
                }
            });
            solution_order.push(pipe_id);

            for (const index of ordered_indices) {
                remove_remaining_index(
                    index,
                    available,
                    remaining_indices,
                    remaining_positions
                );
                grid.occupancy[index] = pipe_id;
            }
        }

        let final_pipes = exact_cover_mode ?
            pipes :
            merge_singleton_pipes(grid, pipes);

        final_pipes = split_pipes_by_color(grid, final_pipes, color_map);
        final_pipes = merge_same_color_endpoint_singletons(
            grid,
            final_pipes,
            random,
            nesting_setting
        );

        const remaining_singletons = final_pipes.reduce(
            (total, pipe) => total + (pipe.cells.length === 1 ? 1 : 0),
            0
        );

        const fixed_solution_order =
            calculate_fixed_direction_solution_order(grid, final_pipes);
        const style = analyze_pipe_collection(final_pipes);

        return {
            pipes: final_pipes,
            solution_order: fixed_solution_order,
            reserved_cell_count: 0,
            singleton_pipe_count: remaining_singletons,
            ...style
        };
    }



    function build_fast_frontier_candidates(grid, available) {
        const row_left = new Int32Array(grid.rows);
        const row_right = new Int32Array(grid.rows);
        const column_top = new Int32Array(grid.columns);
        const column_bottom = new Int32Array(grid.columns);
        row_left.fill(grid.columns);
        row_right.fill(-1);
        column_top.fill(grid.rows);
        column_bottom.fill(-1);

        for (let index = 0; index < available.length; index += 1) {
            if (!available[index]) continue;
            const x = index % grid.columns;
            const y = Math.floor(index / grid.columns);
            row_left[y] = Math.min(row_left[y], x);
            row_right[y] = Math.max(row_right[y], x);
            column_top[x] = Math.min(column_top[x], y);
            column_bottom[x] = Math.max(column_bottom[x], y);
        }

        const candidates = [];
        const seen = new Set();
        const add = (x, y, direction) => {
            if (!grid.is_inside(x, y)) return;
            const index = grid.index(x, y);
            if (!available[index]) return;
            const key = `${index}:${direction.x}:${direction.y}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ index, direction });
        };

        for (let y = 0; y < grid.rows; y += 1) {
            if (row_right[y] < 0) continue;
            add(row_left[y], y, { x: -1, y: 0 });
            add(row_right[y], y, { x: 1, y: 0 });
        }
        for (let x = 0; x < grid.columns; x += 1) {
            if (column_bottom[x] < 0) continue;
            add(x, column_top[x], { x: 0, y: -1 });
            add(x, column_bottom[x], { x: 0, y: 1 });
        }
        return candidates;
    }

    function fast_exact_color_cover(grid, random, length_setting, nesting_setting, color_map) {
        const available = grid.valid_cells.slice();
        const pipes = [];
        const safe_length_setting = Math.max(0, Math.min(2, Number(length_setting) || 0));
        const nesting = Math.max(0, Math.min(3, Number(nesting_setting) || 0));
        const targets = [14, 22, 32];
        let remaining = available.reduce((sum, value) => sum + value, 0);

        while (remaining > 0) {
            const frontiers = build_fast_frontier_candidates(grid, available);
            if (frontiers.length === 0) {
                throw new Error("The exact-cover fallback could not find a remaining frontier.");
            }

            // Prefer a frontier with multiple same-colour inward choices, then use
            // seeded noise to avoid producing a rigid scanline pattern.
            frontiers.sort((left, right) => {
                const left_color = color_map ? Number(color_map[left.index]) : 0;
                const right_color = color_map ? Number(color_map[right.index]) : 0;
                const score = (frontier, color) => {
                    const x = frontier.index % grid.columns;
                    const y = Math.floor(frontier.index / grid.columns);
                    let neighbours = 0;
                    for (const direction of DIRECTIONS) {
                        const nx = x + direction.x;
                        const ny = y + direction.y;
                        if (!grid.is_inside(nx, ny)) continue;
                        const ni = grid.index(nx, ny);
                        if (available[ni] && (!color_map || Number(color_map[ni]) === color)) {
                            neighbours += 1;
                        }
                    }
                    return neighbours * 100 + random.next();
                };
                return score(right, right_color) - score(left, left_color);
            });

            const frontier = frontiers[0];
            const pipe_color = color_map ? Number(color_map[frontier.index]) : pipes.length % PIPE_COLORS.length;
            const head_to_tail = [frontier.index];
            const in_path = new Set(head_to_tail);
            const target_length = targets[safe_length_setting] + random.integer(-2, 4);
            let current = frontier.index;
            let previous_direction = null;
            let straight_cells = 1;

            // A multi-cell pipe's final segment must point in the arrow direction.
            // Since this path is grown from head toward tail, force the first step
            // to be exactly opposite the outward arrow whenever that cell belongs
            // to the same colour region.
            const head_x = frontier.index % grid.columns;
            const head_y = Math.floor(frontier.index / grid.columns);
            const inward_x = head_x - frontier.direction.x;
            const inward_y = head_y - frontier.direction.y;
            if (grid.is_inside(inward_x, inward_y)) {
                const inward_index = grid.index(inward_x, inward_y);
                if (available[inward_index] &&
                    (!color_map || Number(color_map[inward_index]) === pipe_color)) {
                    head_to_tail.push(inward_index);
                    in_path.add(inward_index);
                    current = inward_index;
                    previous_direction = {
                        x: -frontier.direction.x,
                        y: -frontier.direction.y
                    };
                    straight_cells = 2;
                }
            }

            while (head_to_tail.length > 1 && head_to_tail.length < target_length) {
                const x = current % grid.columns;
                const y = Math.floor(current / grid.columns);
                const choices = [];

                for (const direction of DIRECTIONS) {
                    const nx = x + direction.x;
                    const ny = y + direction.y;
                    if (!grid.is_inside(nx, ny)) continue;
                    const next = grid.index(nx, ny);
                    if (!available[next] || in_path.has(next)) continue;
                    if (color_map && Number(color_map[next]) !== pipe_color) continue;

                    const same_direction = previous_direction &&
                        previous_direction.x === direction.x &&
                        previous_direction.y === direction.y;
                    if (same_direction && straight_cells >= MAX_STRAIGHT_CELLS) continue;

                    let onward = 0;
                    for (const onward_direction of DIRECTIONS) {
                        const ox = nx + onward_direction.x;
                        const oy = ny + onward_direction.y;
                        if (!grid.is_inside(ox, oy)) continue;
                        const oi = grid.index(ox, oy);
                        if (available[oi] && !in_path.has(oi) &&
                            (!color_map || Number(color_map[oi]) === pipe_color)) {
                            onward += 1;
                        }
                    }

                    const is_turn = previous_direction && !same_direction;
                    const occupied_neighbors = count_occupied_neighbors(grid, nx, ny);
                    const nearby_occupied = count_nearby_occupied_cells(grid, nx, ny);
                    const score =
                        (is_turn ? 8 + nesting * 2.4 : 0) +
                        (onward === 1 ? 6 : onward === 2 ? 4 : onward === 0 ? -4 : 0) +
                        occupied_neighbors * nesting * 2.2 +
                        nearby_occupied * nesting * 0.22 +
                        random.next() * 2;
                    choices.push({ index: next, direction, score, same_direction });
                }

                if (choices.length === 0) break;
                choices.sort((left, right) => right.score - left.score);
                const selected = choices[0];
                head_to_tail.push(selected.index);
                in_path.add(selected.index);
                current = selected.index;
                straight_cells = selected.same_direction ? straight_cells + 1 : 2;
                previous_direction = selected.direction;
            }

            const ordered = head_to_tail.reverse();
            const pipe = {
                id: pipes.length,
                color_index: pipe_color,
                cells: ordered.map((index) => grid.coordinates(index)),
                direction: { ...frontier.direction }
            };
            pipes.push(pipe);

            for (const index of ordered) {
                available[index] = 0;
                remaining -= 1;
                grid.occupancy[index] = pipe.id;
            }
        }

        const final_pipes = merge_same_color_endpoint_singletons(
            grid,
            pipes,
            random,
            nesting_setting
        );
        const solution_order =
            calculate_fixed_direction_solution_order(grid, final_pipes);
        if (!solution_order) {
            throw new Error("The exact-cover fallback produced a dependency cycle.");
        }
        const style = analyze_pipe_collection(final_pipes);
        return {
            pipes: final_pipes,
            solution_order,
            reserved_cell_count: 0,
            singleton_pipe_count: final_pipes.reduce(
                (sum, pipe) => sum + (pipe.cells.length === 1 ? 1 : 0),
                0
            ),
            ...style
        };
    }

    function calculate_orientation_data(grid, pipe, orientation) {
        if (pipe.cells.length === 1) {
            if (orientation === 1) {
                return {
                    direction: { ...pipe.direction },
                    blockers: new Set(),
                    self_blocked: true
                };
            }

            const head = pipe.cells[0];
            const blockers = new Set();
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;

            while (grid.is_inside(x, y)) {
                const occupant = grid.get_occupant(x, y);

                if (occupant === pipe.id) {
                    return {
                        direction: { ...pipe.direction },
                        blockers,
                        self_blocked: true
                    };
                }

                if (occupant !== -1) {
                    blockers.add(occupant);
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            return {
                direction: { ...pipe.direction },
                blockers,
                self_blocked: false
            };
        }

        const cells = orientation === 0 ? pipe.cells : [...pipe.cells].reverse();
        const head = cells[cells.length - 1];
        const previous = cells[cells.length - 2];
        const direction = {
            x: head.x - previous.x,
            y: head.y - previous.y
        };
        const blockers = new Set();
        let self_blocked = false;
        let x = head.x + direction.x;
        let y = head.y + direction.y;

        while (grid.is_inside(x, y)) {
            const occupant = grid.get_occupant(x, y);

            if (occupant === pipe.id) {
                self_blocked = true;
                break;
            }

            if (occupant !== -1) {
                blockers.add(occupant);
            }

            x += direction.x;
            y += direction.y;
        }

        return { direction, blockers, self_blocked };
    }

    function assign_solvable_orientations(
        grid,
        pipes,
        random,
        nesting_setting = 0
    ) {
        const nesting = Math.max(
            0,
            Math.min(3, Number(nesting_setting) || 0)
        );
        const pipe_count = pipes.length;
        const orientation_options = pipes.map((pipe) => [
            calculate_orientation_data(grid, pipe, 0),
            calculate_orientation_data(grid, pipe, 1)
        ]);
        const unresolved = Array.from(
            { length: pipe_count },
            () => new Uint16Array(2)
        );
        const dependents = Array.from(
            { length: pipe_count },
            () => []
        );
        const available_masks = new Uint8Array(pipe_count);
        const scheduled = new Uint8Array(pipe_count);
        const queued = new Uint8Array(pipe_count);
        const queue = [];
        const choices_by_pipe = new Int8Array(pipe_count);
        const solution_order = [];

        choices_by_pipe.fill(-1);

        for (let pipe_id = 0; pipe_id < pipe_count; pipe_id += 1) {
            for (let orientation = 0; orientation < 2; orientation += 1) {
                const option = orientation_options[pipe_id][orientation];

                if (option.self_blocked) {
                    unresolved[pipe_id][orientation] = 65535;
                    continue;
                }

                unresolved[pipe_id][orientation] = option.blockers.size;

                if (option.blockers.size === 0) {
                    available_masks[pipe_id] |= 1 << orientation;
                }

                for (const blocker of option.blockers) {
                    if (blocker >= 0 && blocker < pipe_count) {
                        dependents[blocker].push({
                            pipe_id,
                            orientation
                        });
                    }
                }
            }

            if (available_masks[pipe_id] !== 0) {
                queue.push(pipe_id);
                queued[pipe_id] = 1;
            }
        }

        while (queue.length > 0) {
            const queue_index = nesting > 1 && queue.length > 1 ?
                random.integer(0, queue.length) :
                queue.length - 1;
            const pipe_id = queue[queue_index];
            const last_pipe_id = queue.pop();

            if (queue_index < queue.length) {
                queue[queue_index] = last_pipe_id;
            }

            queued[pipe_id] = 0;

            if (scheduled[pipe_id] || available_masks[pipe_id] === 0) {
                continue;
            }

            const mask = available_masks[pipe_id];
            let orientation = 0;

            if (mask === 2) {
                orientation = 1;
            } else if (mask === 3) {
                const first_blockers =
                    orientation_options[pipe_id][0].blockers.size;
                const second_blockers =
                    orientation_options[pipe_id][1].blockers.size;

                if (nesting >= 2) {
                    orientation = second_blockers > first_blockers ? 1 : 0;

                    if (second_blockers === first_blockers) {
                        orientation = random.integer(0, 2);
                    }
                } else if (nesting === 1) {
                    orientation = random.integer(0, 2);
                } else {
                    orientation = second_blockers < first_blockers ? 1 : 0;
                }
            }

            scheduled[pipe_id] = 1;
            choices_by_pipe[pipe_id] = orientation;
            solution_order.push(pipe_id);

            for (const dependent of dependents[pipe_id]) {
                if (scheduled[dependent.pipe_id]) {
                    continue;
                }

                const current =
                    unresolved[dependent.pipe_id][dependent.orientation];

                if (current === 0 || current === 65535) {
                    continue;
                }

                const next = current - 1;
                unresolved[dependent.pipe_id][dependent.orientation] = next;

                if (next === 0) {
                    available_masks[dependent.pipe_id] |=
                        1 << dependent.orientation;

                    if (!queued[dependent.pipe_id]) {
                        queue.push(dependent.pipe_id);
                        queued[dependent.pipe_id] = 1;
                    }
                }
            }
        }

        if (solution_order.length !== pipe_count) {
            return null;
        }

        for (const pipe of pipes) {
            if (pipe.cells.length === 1) {
                continue;
            }

            if (choices_by_pipe[pipe.id] === 1) {
                pipe.cells.reverse();
            }

            const head = pipe.cells[pipe.cells.length - 1];
            const previous = pipe.cells[pipe.cells.length - 2];
            pipe.direction = {
                x: head.x - previous.x,
                y: head.y - previous.y
            };
        }

        return solution_order;
    }

    function calculate_difficulty(level) {
        const occupancy = new Int32Array(level.columns * level.rows);
        occupancy.fill(-1);
        const blockers = new Map();

        for (const pipe of level.pipes) {
            for (const cell of pipe.cells) {
                occupancy[cell.y * level.columns + cell.x] = pipe.id;
            }
        }

        for (const pipe of level.pipes) {
            const pipe_blockers = new Set();
            const head = pipe.cells[pipe.cells.length - 1];
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;

            while (x >= 0 && x < level.columns && y >= 0 && y < level.rows) {
                const occupant = occupancy[y * level.columns + x];

                if (occupant !== -1 && occupant !== pipe.id) {
                    pipe_blockers.add(occupant);
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            blockers.set(pipe.id, pipe_blockers);
        }

        const memo = new Map();

        function depth(pipe_id, visiting) {
            if (memo.has(pipe_id)) {
                return memo.get(pipe_id);
            }

            if (visiting.has(pipe_id)) {
                return 0;
            }

            visiting.add(pipe_id);
            let value = 1;

            for (const blocker of blockers.get(pipe_id) || []) {
                value = Math.max(value, 1 + depth(blocker, visiting));
            }

            visiting.delete(pipe_id);
            memo.set(pipe_id, value);
            return value;
        }

        let maximum_depth = 0;
        let initially_open = 0;
        let total_segments = 0;

        for (const pipe of level.pipes) {
            maximum_depth = Math.max(maximum_depth, depth(pipe.id, new Set()));
            total_segments += pipe.cells.length;

            if ((blockers.get(pipe.id) || new Set()).size === 0) {
                initially_open += 1;
            }
        }

        return {
            pipe_count: level.pipes.length,
            segment_count: total_segments,
            initially_open,
            dependency_depth: maximum_depth,
            average_pipe_length:
                level.pipes.length > 0 ? total_segments / level.pipes.length : 0
        };
    }

    function generate_level(options) {
        const columns = Number(options.columns);
        const rows = Number(options.rows);
        const raw_mask = Uint8Array.from(options.mask || []);
        const raw_color_map = Uint16Array.from(options.color_map || []);
        const palette = normalize_palette(options.palette);
        const report_progress =
            typeof options.on_progress === "function" ?
                options.on_progress :
                () => {};

        if (
            !Number.isInteger(columns) ||
            !Number.isInteger(rows) ||
            columns < 4 ||
            rows < 4 ||
            columns > 50 ||
            rows > 50
        ) {
            throw new Error(
                "Grid dimensions must be integers between 4 and 50."
            );
        }

        if (raw_mask.length !== columns * rows) {
            throw new Error("Mask dimensions do not match the grid.");
        }

        if (raw_color_map.length !== 0 && raw_color_map.length !== columns * rows) {
            throw new Error("Colour-map dimensions do not match the grid.");
        }

        const color_map = raw_color_map.length === columns * rows ?
            Uint16Array.from(raw_color_map, (value, index) =>
                raw_mask[index] ?
                    Math.max(0, Math.min(palette.length - 1, Number(value) || 0)) :
                    EMPTY_COLOR_INDEX
            ) : null;

        const preserve_exact_mask = Boolean(options.preserve_exact_mask);
        report_progress({ phase: "cleaning_mask", attempt: 0 });
        const cleaned_mask = preserve_exact_mask ?
            Uint8Array.from(raw_mask, (value) => value ? 1 : 0) :
            clean_mask(raw_mask, columns, rows);
        const valid_count = cleaned_mask.reduce(
            (total, value) => total + value,
            0
        );

        if (valid_count < 1) {
            throw new Error("The image contains no valid visible pixels.");
        }

        const requested_seed = Number.isFinite(Number(options.seed)) ?
            Number(options.seed) >>> 0 :
            create_seed();
        const length_setting = Math.max(
            0,
            Math.min(2, Number(options.length_setting) || 0)
        );
        const nesting = Math.max(
            0,
            Math.min(3, Number(options.nesting) || 0)
        );
        const area = columns * rows;
        const maximum_attempts = preserve_exact_mask ?
            (area >= 6400 ? 3 : 6) :
            (area >= 6400 ? 16 : area >= 2500 ? 24 : 40);
        let generated = null;

        for (
            let attempt = 0;
            attempt < maximum_attempts && !generated;
            attempt += 1
        ) {
            report_progress({
                phase: "generating",
                attempt: attempt + 1,
                maximum_attempts
            });

            const attempt_seed =
                (requested_seed + Math.imul(attempt, 0x9E3779B1)) >>> 0;
            const random = new SeededRandom(attempt_seed);
            const grid = new Grid(columns, rows, cleaned_mask);
            let carved = null;

            try {
                carved = preserve_exact_mask && (color_map || area >= 1600) ?
                    fast_exact_color_cover(
                        grid,
                        random,
                        length_setting,
                        nesting,
                        color_map
                    ) :
                    carve_pipes(
                        grid,
                        random,
                        length_setting,
                        nesting,
                        preserve_exact_mask,
                        color_map
                    );
            } catch (error) {
                continue;
            }

            const pipes = carved.pipes;
            const solution_order = carved.solution_order;

            if (
                pipes.length < 1 ||
                !solution_order ||
                carved.maximum_straight_cells > MAX_STRAIGHT_CELLS ||
                (!preserve_exact_mask && (
                    pipes.length < 3 ||
                    carved.singleton_pipe_count > 0 ||
                    carved.turn_density < 0.58
                ))
            ) {
                continue;
            }

            report_progress({
                phase: "orienting",
                attempt: attempt + 1,
                maximum_attempts,
                pipe_count: pipes.length
            });

            generated = {
                version: 3,
                number: Math.max(1, Math.floor(Number(options.number) || 1)),
                name: String(options.name || `level_${options.number || 1}`),
                source_name: String(options.source_name || "custom image"),
                created_at: new Date().toISOString(),
                palette,
                columns,
                rows,
                mask: Array.from(grid.valid_cells),
                pipes: pipes.map((pipe) => ({
                    id: pipe.id,
                    color_index: pipe.color_index,
                    cells: pipe.cells.map((cell) => [cell.x, cell.y]),
                    direction: [pipe.direction.x, pipe.direction.y]
                })),
                solution_order,
                settings: {
                    seed: attempt_seed,
                    requested_seed,
                    white_majority: Number(options.white_majority) || 0.5,
                    length_setting,
                    nesting,
                    effective_nesting:
                        MIN_EFFECTIVE_NESTING + nesting * 0.84,
                    maximum_straight_cells:
                        carved.maximum_straight_cells,
                    turn_count: carved.turn_count,
                    turn_density: carved.turn_density,
                    straight_only_pipe_count:
                        carved.straight_only_pipe_count,
                    reserved_cell_count: 0,
                    covered_cell_count: valid_count,
                    uncovered_cell_count: 0,
                    singleton_pipe_count: carved.singleton_pipe_count,
                    palette_size: palette.length,
                    color_region_preserving: Boolean(color_map),
                    preserve_exact_mask
                }
            };
        }

        if (!generated) {
            throw new Error(
                "No solvable pipe layout could be generated for this mask and seed."
            );
        }

        report_progress({ phase: "scoring", attempt: maximum_attempts });
        generated.difficulty = calculate_difficulty(normalize_level(generated));
        report_progress({ phase: "complete", attempt: maximum_attempts });
        return generated;
    }

    function normalize_level(raw_level) {
        if (!raw_level || typeof raw_level !== "object") {
            throw new Error("Level data is missing.");
        }

        const columns = Number(raw_level.columns);
        const rows = Number(raw_level.rows);

        if (
            !Number.isInteger(columns) ||
            !Number.isInteger(rows) ||
            columns < 4 ||
            rows < 4 ||
            columns > 50 ||
            rows > 50
        ) {
            throw new Error(
                "Level grid dimensions must be between 4 and 50."
            );
        }

        const mask = Array.from(raw_level.mask || [], (value) => value ? 1 : 0);

        if (mask.length !== columns * rows) {
            throw new Error("Level mask length is invalid.");
        }

        const pipes = (raw_level.pipes || []).map((raw_pipe, index) => {
            const cells = (raw_pipe.cells || []).map((cell) => ({
                x: Number(Array.isArray(cell) ? cell[0] : cell.x),
                y: Number(Array.isArray(cell) ? cell[1] : cell.y)
            }));
            const raw_direction = raw_pipe.direction || [0, 0];
            const direction = {
                x: Number(
                    Array.isArray(raw_direction) ? raw_direction[0] : raw_direction.x
                ),
                y: Number(
                    Array.isArray(raw_direction) ? raw_direction[1] : raw_direction.y
                )
            };

            return {
                id: Number.isInteger(Number(raw_pipe.id)) ?
                    Number(raw_pipe.id) :
                    index,
                color_index: Number(raw_pipe.color_index) || 0,
                cells,
                direction,
                active: true
            };
        });

        const level = {
            version: Number(raw_level.version) || 1,
            number: Math.max(1, Math.floor(Number(raw_level.number) || 1)),
            name: String(raw_level.name || `level_${raw_level.number || 1}`),
            source_name: String(raw_level.source_name || "custom image"),
            created_at: String(raw_level.created_at || ""),
            palette: normalize_palette(raw_level.palette),
            columns,
            rows,
            mask,
            pipes,
            solution_order: Array.from(raw_level.solution_order || [], Number),
            settings: { ...(raw_level.settings || {}) },
            difficulty: raw_level.difficulty ? { ...raw_level.difficulty } : null
        };

        validate_level(level);

        if (!level.difficulty) {
            level.difficulty = calculate_difficulty(level);
        }

        return level;
    }

    function validate_level(level) {
        const occupancy = new Int32Array(level.columns * level.rows);
        occupancy.fill(-1);
        const ids = new Set();

        for (const pipe of level.pipes) {
            if (ids.has(pipe.id)) {
                throw new Error(`Pipe id ${pipe.id} is duplicated.`);
            }

            ids.add(pipe.id);

            if (pipe.cells.length < 1) {
                throw new Error(`Pipe ${pipe.id} has no cells.`);
            }

            for (let index = 0; index < pipe.cells.length; index += 1) {
                const cell = pipe.cells[index];

                if (
                    !Number.isInteger(cell.x) ||
                    !Number.isInteger(cell.y) ||
                    cell.x < 0 || cell.x >= level.columns ||
                    cell.y < 0 || cell.y >= level.rows
                ) {
                    throw new Error(`Pipe ${pipe.id} contains an invalid cell.`);
                }

                const occupancy_index = cell.y * level.columns + cell.x;

                if (!level.mask[occupancy_index]) {
                    throw new Error(
                        `Pipe ${pipe.id} occupies a cell outside the image mask.`
                    );
                }

                if (occupancy[occupancy_index] !== -1) {
                    throw new Error("Two pipes overlap.");
                }

                occupancy[occupancy_index] = pipe.id;

                if (index > 0) {
                    const previous = pipe.cells[index - 1];
                    const distance =
                        Math.abs(cell.x - previous.x) +
                        Math.abs(cell.y - previous.y);

                    if (distance !== 1) {
                        throw new Error(
                            `Pipe ${pipe.id} has a disconnected path.`
                        );
                    }
                }
            }

            const geometry = analyze_pipe_geometry(pipe.cells);

            if (geometry.maximum_straight_cells > MAX_STRAIGHT_CELLS) {
                throw new Error(
                    `Pipe ${pipe.id} contains a straight run longer than ${MAX_STRAIGHT_CELLS} cells.`
                );
            }

            const head = pipe.cells[pipe.cells.length - 1];
            const direction_length =
                Math.abs(pipe.direction.x) + Math.abs(pipe.direction.y);

            if (direction_length !== 1) {
                throw new Error(
                    `Pipe ${pipe.id} has an invalid arrow direction.`
                );
            }

            if (pipe.cells.length > 1) {
                const previous = pipe.cells[pipe.cells.length - 2];

                if (
                    pipe.direction.x !== head.x - previous.x ||
                    pipe.direction.y !== head.y - previous.y
                ) {
                    throw new Error(
                        `Pipe ${pipe.id} has an invalid arrow direction.`
                    );
                }
            }
        }

        if (level.version >= 3) {
            for (let index = 0; index < level.mask.length; index += 1) {
                if (level.mask[index] && occupancy[index] === -1) {
                    throw new Error(
                        "Every valid image cell must be occupied by a pipe."
                    );
                }
            }
        }

        const remaining = new Set(level.pipes.map((pipe) => pipe.id));
        let safety = level.pipes.length + 1;

        while (remaining.size > 0 && safety > 0) {
            const removable = [];

            for (const pipe of level.pipes) {
                if (!remaining.has(pipe.id)) {
                    continue;
                }

                const head = pipe.cells[pipe.cells.length - 1];
                let x = head.x + pipe.direction.x;
                let y = head.y + pipe.direction.y;
                let blocked = false;

                while (
                    x >= 0 && x < level.columns &&
                    y >= 0 && y < level.rows
                ) {
                    const occupant = occupancy[y * level.columns + x];

                    if (occupant !== -1 && remaining.has(occupant)) {
                        blocked = true;
                        break;
                    }

                    x += pipe.direction.x;
                    y += pipe.direction.y;
                }

                if (!blocked) {
                    removable.push(pipe.id);
                }
            }

            if (removable.length === 0) {
                throw new Error(
                    "The level contains a pipe dependency deadlock."
                );
            }

            for (const pipe_id of removable) {
                remaining.delete(pipe_id);
            }

            safety -= 1;
        }

        return true;
    }

    function serialize_level(level) {
        const normalized = normalize_level(level);

        return {
            version: normalized.version,
            number: normalized.number,
            name: normalized.name,
            source_name: normalized.source_name,
            created_at: normalized.created_at,
            palette: Array.from(normalized.palette),
            columns: normalized.columns,
            rows: normalized.rows,
            mask: Array.from(normalized.mask),
            pipes: normalized.pipes.map((pipe) => ({
                id: pipe.id,
                color_index: pipe.color_index,
                cells: pipe.cells.map((cell) => [cell.x, cell.y]),
                direction: [pipe.direction.x, pipe.direction.y]
            })),
            solution_order: Array.from(normalized.solution_order),
            settings: { ...normalized.settings },
            difficulty: { ...normalized.difficulty }
        };
    }

    class PuzzleSession {
        constructor(raw_level) {
            this.level = normalize_level(raw_level);
            this.grid = new Grid(
                this.level.columns,
                this.level.rows,
                this.level.mask
            );
            this.pipes = [];
            this.moving_pipes = new Map();
            this.move_duration = 52.5;
            this.move_count = 0;
            this.completed_pipe_count = 0;
            this.state_revision = 0;
            this.swept_cell_cache = new Map();
            this.reset();
        }

        reset() {
            this.pipes = this.level.pipes.map((pipe) => ({
                id: pipe.id,
                color_index: pipe.color_index,
                cells: pipe.cells.map((cell) => ({ x: cell.x, y: cell.y })),
                direction: { x: pipe.direction.x, y: pipe.direction.y },
                active: true
            }));
            this.pipe_by_id = new Map(
                this.pipes.map((pipe) => [pipe.id, pipe])
            );
            this.moving_pipes.clear();
            this.grid.occupancy.fill(-1);
            this.move_count = 0;
            this.completed_pipe_count = 0;
            this.state_revision += 1;
            this.swept_cell_cache.clear();
            this.rebuild_occupancy();
        }

        rebuild_occupancy() {
            this.grid.occupancy.fill(-1);

            for (const pipe of this.pipes) {
                if (!pipe.active) {
                    continue;
                }

                for (const cell of pipe.cells) {
                    this.grid.set_occupant(cell.x, cell.y, pipe.id);
                }
            }
        }

        mark_state_changed() {
            this.state_revision += 1;
            this.swept_cell_cache.clear();
        }

        get_pipe(pipe_id) {
            return this.pipe_by_id.get(pipe_id) || null;
        }

        get_active_count() {
            return this.pipes.length - this.completed_pipe_count;
        }

        get_moving_count() {
            return this.moving_pipes.size;
        }

        is_complete() {
            return this.completed_pipe_count >= this.pipes.length;
        }

        can_activate(pipe_id) {
            const pipe = this.get_pipe(pipe_id);

            if (!pipe || !pipe.active) {
                return { ok: false, reason: "inactive" };
            }

            if (this.moving_pipes.has(pipe_id)) {
                return { ok: false, reason: "already_moving" };
            }

            const stationary_blocker = this.get_stationary_blocker(pipe);

            if (stationary_blocker !== -1) {
                return {
                    ok: false,
                    reason: "occupied",
                    blocker: stationary_blocker
                };
            }

            const moving_collision = this.get_moving_collision(pipe);

            if (moving_collision !== -1) {
                return {
                    ok: false,
                    reason: "collision",
                    blocker: moving_collision
                };
            }

            return { ok: true, reason: "clear" };
        }

        get_stationary_blocker(pipe) {
            const head = pipe.cells[pipe.cells.length - 1];
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;

            while (this.grid.is_inside(x, y)) {
                const occupant = this.grid.get_occupant(x, y);

                if (
                    occupant !== -1 &&
                    occupant !== pipe.id &&
                    !this.moving_pipes.has(occupant)
                ) {
                    return occupant;
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            return -1;
        }

        get_moving_collision(candidate_pipe) {
            if (this.moving_pipes.size === 0) {
                return -1;
            }

            const candidate_swept_cells =
                this.create_swept_cell_set(candidate_pipe);

            for (const [moving_pipe_id, movement] of this.moving_pipes) {
                const moving_pipe = this.get_pipe(moving_pipe_id);

                if (!moving_pipe || !moving_pipe.active) {
                    continue;
                }

                const moving_swept_cells =
                    this.get_cached_swept_cell_set(moving_pipe);

                if (!this.cell_sets_overlap(
                    candidate_swept_cells,
                    moving_swept_cells
                )) {
                    continue;
                }

                if (this.simulate_pair_collision(
                    candidate_pipe,
                    moving_pipe,
                    movement.progress
                )) {
                    return moving_pipe_id;
                }
            }

            return -1;
        }

        get_cached_swept_cell_set(pipe) {
            const cached = this.swept_cell_cache.get(pipe.id);

            if (cached) {
                return cached;
            }

            const cells = this.create_swept_cell_set(pipe);
            this.swept_cell_cache.set(pipe.id, cells);
            return cells;
        }

        create_swept_cell_set(pipe) {
            const state = this.create_simulation_state(pipe, 0);
            const cells = new Set();
            let safety =
                this.grid.columns +
                this.grid.rows +
                pipe.cells.length * 3 +
                8;

            while (state.active && safety > 0) {
                for (const cell of state.cells) {
                    cells.add(`${cell.x},${cell.y}`);
                }

                this.advance_simulation_state(state, 1);
                safety -= 1;
            }

            return cells;
        }

        cell_sets_overlap(left, right) {
            const smaller = left.size <= right.size ? left : right;
            const larger = smaller === left ? right : left;

            for (const key of smaller) {
                if (larger.has(key)) {
                    return true;
                }
            }

            return false;
        }

        simulate_pair_collision(
            candidate_pipe,
            moving_pipe,
            moving_progress
        ) {
            const candidate_state =
                this.create_simulation_state(candidate_pipe, 0);
            const moving_state =
                this.create_simulation_state(
                    moving_pipe,
                    moving_progress
                );
            const sample_step = 0.08;
            let safety = 2048;

            if (this.simulation_states_collide(
                candidate_state,
                moving_state
            )) {
                return true;
            }

            while (
                candidate_state.active &&
                moving_state.active &&
                safety > 0
            ) {
                this.advance_simulation_state(
                    candidate_state,
                    sample_step
                );
                this.advance_simulation_state(
                    moving_state,
                    sample_step
                );

                if (
                    candidate_state.active &&
                    moving_state.active &&
                    this.simulation_states_collide(
                        candidate_state,
                        moving_state
                    )
                ) {
                    return true;
                }

                safety -= 1;
            }

            return false;
        }

        create_simulation_state(pipe, progress) {
            return {
                cells: pipe.cells.map((cell) => ({
                    x: cell.x,
                    y: cell.y
                })),
                direction: {
                    x: pipe.direction.x,
                    y: pipe.direction.y
                },
                progress: Math.max(0, Math.min(0.999999, progress || 0)),
                active: pipe.active
            };
        }

        advance_simulation_state(state, delta) {
            if (!state.active) {
                return;
            }

            state.progress += delta;

            while (state.progress >= 1 && state.active) {
                state.progress -= 1;
                const old_head = state.cells[state.cells.length - 1];
                const new_head = {
                    x: old_head.x + state.direction.x,
                    y: old_head.y + state.direction.y
                };

                state.cells.shift();
                state.cells.push(new_head);
                state.active = state.cells.some((cell) => {
                    return this.grid.is_inside(cell.x, cell.y);
                });
            }
        }

        simulation_states_collide(left_state, right_state) {
            const left_points =
                this.get_simulation_render_cells(left_state);
            const right_points =
                this.get_simulation_render_cells(right_state);

            return this.polylines_collide(
                left_points,
                right_points,
                0.48
            );
        }

        get_simulation_render_cells(state) {
            const progress = ease_in_out(state.progress);
            const cells = [];

            for (let index = 0; index < state.cells.length; index += 1) {
                const cell = state.cells[index];
                let x = cell.x;
                let y = cell.y;

                if (index < state.cells.length - 1) {
                    const target = state.cells[index + 1];
                    x += (target.x - cell.x) * progress;
                    y += (target.y - cell.y) * progress;
                } else {
                    x += state.direction.x * progress;
                    y += state.direction.y * progress;
                }

                cells.push({ x, y });
            }

            return cells;
        }

        polylines_collide(left_points, right_points, minimum_distance) {
            const minimum_distance_squared =
                minimum_distance * minimum_distance;

            for (
                let left_index = 0;
                left_index < left_points.length - 1;
                left_index += 1
            ) {
                const left_start = left_points[left_index];
                const left_end = left_points[left_index + 1];

                for (
                    let right_index = 0;
                    right_index < right_points.length - 1;
                    right_index += 1
                ) {
                    const right_start = right_points[right_index];
                    const right_end = right_points[right_index + 1];

                    if (!this.segment_bounds_overlap(
                        left_start,
                        left_end,
                        right_start,
                        right_end,
                        minimum_distance
                    )) {
                        continue;
                    }

                    if (
                        this.segment_distance_squared(
                            left_start,
                            left_end,
                            right_start,
                            right_end
                        ) < minimum_distance_squared
                    ) {
                        return true;
                    }
                }
            }

            return false;
        }

        segment_bounds_overlap(
            left_start,
            left_end,
            right_start,
            right_end,
            padding
        ) {
            const left_min_x =
                Math.min(left_start.x, left_end.x) - padding;
            const left_max_x =
                Math.max(left_start.x, left_end.x) + padding;
            const left_min_y =
                Math.min(left_start.y, left_end.y) - padding;
            const left_max_y =
                Math.max(left_start.y, left_end.y) + padding;
            const right_min_x =
                Math.min(right_start.x, right_end.x);
            const right_max_x =
                Math.max(right_start.x, right_end.x);
            const right_min_y =
                Math.min(right_start.y, right_end.y);
            const right_max_y =
                Math.max(right_start.y, right_end.y);

            return !(
                left_max_x < right_min_x ||
                right_max_x < left_min_x ||
                left_max_y < right_min_y ||
                right_max_y < left_min_y
            );
        }

        segment_distance_squared(
            left_start,
            left_end,
            right_start,
            right_end
        ) {
            if (this.segments_intersect(
                left_start,
                left_end,
                right_start,
                right_end
            )) {
                return 0;
            }

            return Math.min(
                this.point_segment_distance_squared(
                    left_start,
                    right_start,
                    right_end
                ),
                this.point_segment_distance_squared(
                    left_end,
                    right_start,
                    right_end
                ),
                this.point_segment_distance_squared(
                    right_start,
                    left_start,
                    left_end
                ),
                this.point_segment_distance_squared(
                    right_end,
                    left_start,
                    left_end
                )
            );
        }

        segments_intersect(
            left_start,
            left_end,
            right_start,
            right_end
        ) {
            const first = this.cross_product(
                left_start,
                left_end,
                right_start
            );
            const second = this.cross_product(
                left_start,
                left_end,
                right_end
            );
            const third = this.cross_product(
                right_start,
                right_end,
                left_start
            );
            const fourth = this.cross_product(
                right_start,
                right_end,
                left_end
            );
            const epsilon = 0.000001;

            if (
                ((first > epsilon && second < -epsilon) ||
                    (first < -epsilon && second > epsilon)) &&
                ((third > epsilon && fourth < -epsilon) ||
                    (third < -epsilon && fourth > epsilon))
            ) {
                return true;
            }

            if (
                Math.abs(first) <= epsilon &&
                this.point_on_segment(
                    right_start,
                    left_start,
                    left_end,
                    epsilon
                )
            ) {
                return true;
            }

            if (
                Math.abs(second) <= epsilon &&
                this.point_on_segment(
                    right_end,
                    left_start,
                    left_end,
                    epsilon
                )
            ) {
                return true;
            }

            if (
                Math.abs(third) <= epsilon &&
                this.point_on_segment(
                    left_start,
                    right_start,
                    right_end,
                    epsilon
                )
            ) {
                return true;
            }

            return (
                Math.abs(fourth) <= epsilon &&
                this.point_on_segment(
                    left_end,
                    right_start,
                    right_end,
                    epsilon
                )
            );
        }

        cross_product(start, end, point) {
            return (
                (end.x - start.x) * (point.y - start.y) -
                (end.y - start.y) * (point.x - start.x)
            );
        }

        point_on_segment(point, start, end, epsilon) {
            return (
                point.x >= Math.min(start.x, end.x) - epsilon &&
                point.x <= Math.max(start.x, end.x) + epsilon &&
                point.y >= Math.min(start.y, end.y) - epsilon &&
                point.y <= Math.max(start.y, end.y) + epsilon
            );
        }

        point_segment_distance_squared(point, start, end) {
            const segment_x = end.x - start.x;
            const segment_y = end.y - start.y;
            const segment_length_squared =
                segment_x * segment_x + segment_y * segment_y;

            if (segment_length_squared <= 0.0000001) {
                const difference_x = point.x - start.x;
                const difference_y = point.y - start.y;
                return (
                    difference_x * difference_x +
                    difference_y * difference_y
                );
            }

            const projection = Math.max(
                0,
                Math.min(
                    1,
                    (
                        (point.x - start.x) * segment_x +
                        (point.y - start.y) * segment_y
                    ) / segment_length_squared
                )
            );
            const closest_x = start.x + segment_x * projection;
            const closest_y = start.y + segment_y * projection;
            const difference_x = point.x - closest_x;
            const difference_y = point.y - closest_y;

            return (
                difference_x * difference_x +
                difference_y * difference_y
            );
        }

        activate(pipe_id) {
            const check = this.can_activate(pipe_id);

            if (!check.ok) {
                return check;
            }

            this.moving_pipes.set(pipe_id, { progress: 0 });
            this.move_count += 1;
            this.mark_state_changed();
            return { ok: true, reason: "activated" };
        }

        get_removable_pipe_ids() {
            const removable = [];

            for (const pipe of this.pipes) {
                if (this.can_activate(pipe.id).ok) {
                    removable.push(pipe.id);
                }
            }

            return removable;
        }

        update(delta_milliseconds) {
            const completed_pipe_ids = [];
            const safe_delta = Math.max(0, Math.min(100, delta_milliseconds));
            let state_changed = false;

            for (const [pipe_id, movement] of Array.from(this.moving_pipes)) {
                movement.progress += safe_delta / this.move_duration;

                while (
                    movement.progress >= 1 &&
                    this.moving_pipes.has(pipe_id)
                ) {
                    movement.progress -= 1;
                    state_changed = true;

                    if (this.advance_pipe_step(pipe_id)) {
                        completed_pipe_ids.push(pipe_id);
                    }
                }
            }

            if (state_changed) {
                this.rebuild_occupancy();
                this.mark_state_changed();
            }

            return {
                completed_pipe_ids,
                state_changed
            };
        }

        advance_pipe_step(pipe_id) {
            const pipe = this.get_pipe(pipe_id);

            if (!pipe || !pipe.active) {
                return false;
            }

            const old_head = pipe.cells[pipe.cells.length - 1];
            const new_head = {
                x: old_head.x + pipe.direction.x,
                y: old_head.y + pipe.direction.y
            };

            pipe.cells.shift();
            pipe.cells.push(new_head);

            const still_visible = pipe.cells.some((cell) => {
                return this.grid.is_inside(cell.x, cell.y);
            });

            if (still_visible) {
                return false;
            }

            pipe.active = false;
            this.moving_pipes.delete(pipe.id);
            this.completed_pipe_count += 1;
            return true;
        }

        get_render_cells(pipe_id) {
            const pipe = this.get_pipe(pipe_id);

            if (!pipe) {
                return [];
            }

            const movement = this.moving_pipes.get(pipe_id);
            const progress = movement ? ease_in_out(movement.progress) : 0;
            const cells = [];

            for (let index = 0; index < pipe.cells.length; index += 1) {
                const cell = pipe.cells[index];
                let x = cell.x;
                let y = cell.y;

                if (movement) {
                    if (index < pipe.cells.length - 1) {
                        const target = pipe.cells[index + 1];
                        x += (target.x - cell.x) * progress;
                        y += (target.y - cell.y) * progress;
                    } else {
                        x += pipe.direction.x * progress;
                        y += pipe.direction.y * progress;
                    }
                }

                cells.push({ x, y });
            }

            return cells;
        }
    }


    function ease_in_out(value) {
        return value < 0.5 ?
            2 * value * value :
            1 - Math.pow(-2 * value + 2, 2) / 2;
    }

    const api = Object.freeze({
        DIRECTIONS,
        PIPE_COLORS,
        normalize_palette,
        LENGTH_RANGES,
        MAX_STRAIGHT_CELLS,
        SeededRandom,
        Grid,
        PuzzleSession,
        calculate_difficulty,
        clean_mask,
        create_seed,
        generate_level,
        normalize_level,
        resize_mask,
        serialize_level,
        validate_level
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    global_scope.Choobs = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
