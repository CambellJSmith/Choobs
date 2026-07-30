(function (global_scope) {
    "use strict";

    const MAX_STRAIGHT_CELLS = 5;
    const MIN_PIPE_LENGTH = 8;
    const PIPE_COLORS = 5;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function mix_uint32(value) {
        let mixed = value >>> 0;
        mixed ^= mixed >>> 16;
        mixed = Math.imul(mixed, 0x7FEB352D);
        mixed ^= mixed >>> 15;
        mixed = Math.imul(mixed, 0x846CA68B);
        mixed ^= mixed >>> 16;
        return mixed >>> 0;
    }

    function next_power_of_two(value) {
        let result = 1;

        while (result < value) {
            result *= 2;
        }

        return result;
    }

    function round_to_even(value) {
        return clamp(Math.round(value / 2) * 2, 10, 50);
    }

    function choose_even_size(minimum, maximum, random_value) {
        const first = round_to_even(minimum);
        const last = round_to_even(maximum);
        const step_count = Math.max(0, Math.floor((last - first) / 2));
        const selected_step = Math.min(
            step_count,
            Math.floor(clamp(random_value, 0, 0.999999999) * (step_count + 1))
        );

        return first + selected_step * 2;
    }


    function hsl_to_hex(hue, saturation, lightness) {
        const h = ((hue % 360) + 360) % 360;
        const s = clamp(saturation, 0, 100) / 100;
        const l = clamp(lightness, 0, 100) / 100;
        const chroma = (1 - Math.abs(2 * l - 1)) * s;
        const section = h / 60;
        const x = chroma * (1 - Math.abs(section % 2 - 1));
        let red = 0;
        let green = 0;
        let blue = 0;

        if (section < 1) { red = chroma; green = x; }
        else if (section < 2) { red = x; green = chroma; }
        else if (section < 3) { green = chroma; blue = x; }
        else if (section < 4) { green = x; blue = chroma; }
        else if (section < 5) { red = x; blue = chroma; }
        else { red = chroma; blue = x; }

        const match = l - chroma / 2;
        const channel = (value) => Math.round((value + match) * 255)
            .toString(16)
            .padStart(2, "0");
        return `#${channel(red)}${channel(green)}${channel(blue)}`;
    }

    function create_random_palette(seed) {
        const colors = [];
        const base_hue = (mix_uint32(seed ^ 0x6D2B79F5) / 4294967296) * 360;

        for (let index = 0; index < 5; index += 1) {
            const hash = mix_uint32(seed + Math.imul(index + 1, 0x9E3779B1));
            const jitter = ((hash & 0xFFFF) / 65535 - 0.5) * 18;
            const saturation = 72 + ((hash >>> 16) & 0x0F);
            const lightness = 56 + ((hash >>> 20) & 0x0F) * 0.65;
            colors.push(hsl_to_hex(base_hue + index * 72 + jitter, saturation, lightness));
        }

        for (let index = colors.length - 1; index > 0; index -= 1) {
            const hash = mix_uint32(seed ^ Math.imul(index, 0x85EBCA6B));
            const swap_index = hash % (index + 1);
            [colors[index], colors[swap_index]] = [colors[swap_index], colors[index]];
        }

        return colors;
    }

    function create_level_profile(level_number) {
        const number = Math.max(1, Math.floor(Number(level_number) || 1));
        const growth_level_count = 50;
        const seed = mix_uint32(number ^ 0xA341316C);
        const size_hash = mix_uint32(seed ^ 0xB5297A4D);
        const size_random = size_hash / 4294967296;
        const is_growth_phase = number <= growth_level_count;
        let size;
        let size_progress;
        let size_minimum;
        let size_maximum;

        if (is_growth_phase) {
            size_progress = growth_level_count <= 1 ?
                1 :
                (number - 1) / (growth_level_count - 1);

            // Both ends of this random band rise with the level number. Early
            // levels stay compact, later levels become increasingly large, and
            // level 50 deliberately reaches the full 50x50 scale.
            size_minimum = round_to_even(10 + size_progress * 34);
            size_maximum = round_to_even(18 + size_progress * 32);
            size = number === growth_level_count ?
                50 :
                choose_even_size(size_minimum, size_maximum, size_random);
        } else {
            // After the progression has demonstrated the full scale once, every
            // subsequent procedural level draws freely from the complete range.
            size_progress = 1;
            size_minimum = 10;
            size_maximum = 50;
            size = choose_even_size(10, 50, size_random);
        }

        const complexity_progress = (size - 10) / 40;
        const target_base = Math.round((11 + complexity_progress * 18) * 2);
        const target_variation = Math.round((2 + complexity_progress * 6) * 2);
        const maximum_pipe_length = Math.round(
            80 + complexity_progress * 240
        );

        return {
            number,
            columns: size,
            rows: size,
            curve_size:
                size < 16 ? 16 :
                size < 32 ? 16 :
                size < 64 ? 32 :
                64,
            seed,
            size_phase: is_growth_phase ? "growth" : "full_random",
            size_progress,
            size_minimum,
            size_maximum,
            minimum_pipe_length: MIN_PIPE_LENGTH,
            maximum_pipe_length,
            target_base,
            target_variation
        };
    }

    function create_layout_profile(profile) {
        return {
            ...profile,
            columns: profile.curve_size,
            rows: profile.curve_size
        };
    }

    function rotate_hilbert_quadrant(size, x, y, rotate_x, rotate_y) {
        let next_x = x;
        let next_y = y;

        if (rotate_y === 0) {
            if (rotate_x === 1) {
                next_x = size - 1 - next_x;
                next_y = size - 1 - next_y;
            }

            const temporary = next_x;
            next_x = next_y;
            next_y = temporary;
        }

        return { x: next_x, y: next_y };
    }

    function hilbert_index_to_cell(size, distance) {
        let x = 0;
        let y = 0;
        let remaining = distance;

        for (let scale = 1; scale < size; scale *= 2) {
            const rotate_x = 1 & (remaining >> 1);
            const rotate_y = 1 & (remaining ^ rotate_x);
            const rotated = rotate_hilbert_quadrant(
                scale,
                x,
                y,
                rotate_x,
                rotate_y
            );

            x = rotated.x + scale * rotate_x;
            y = rotated.y + scale * rotate_y;
            remaining >>= 2;
        }

        return { x, y };
    }

    function transform_cell(cell, size, transform) {
        let x = cell.x;
        let y = cell.y;

        if (transform >= 4) {
            x = size - 1 - x;
        }

        const rotations = transform % 4;

        for (let rotation = 0; rotation < rotations; rotation += 1) {
            const next_x = size - 1 - y;
            y = x;
            x = next_x;
        }

        return { x, y };
    }

    function build_nested_curve(profile, transform, reverse_curve) {
        const cell_count = profile.columns * profile.rows;
        const cells = new Array(cell_count);

        for (let index = 0; index < cell_count; index += 1) {
            cells[index] = transform_cell(
                hilbert_index_to_cell(profile.columns, index),
                profile.columns,
                transform
            );
        }

        if (reverse_curve) {
            cells.reverse();
        }

        return cells;
    }

    function direction_between(from, to) {
        return {
            x: to.x - from.x,
            y: to.y - from.y
        };
    }

    function directions_match(left, right) {
        return Boolean(left && right) &&
            left.x === right.x &&
            left.y === right.y;
    }

    function directions_are_perpendicular(left, right) {
        return Boolean(left && right) &&
            left.x * right.x + left.y * right.y === 0;
    }

    function directions_are_opposites(left, right) {
        return Boolean(left && right) &&
            left.x === -right.x &&
            left.y === -right.y;
    }

    function build_curve_metadata(profile, curve) {
        const cell_count = curve.length;
        const cell_to_curve_index = new Int32Array(cell_count);
        const incoming = new Array(cell_count).fill(null);
        const outgoing = new Array(cell_count).fill(null);
        const turn_prefix = new Int32Array(cell_count);
        const wrap_prefix = new Int32Array(cell_count + 1);

        cell_to_curve_index.fill(-1);

        for (let index = 0; index < cell_count; index += 1) {
            const cell = curve[index];
            cell_to_curve_index[cell.y * profile.columns + cell.x] = index;

            if (index > 0) {
                incoming[index] = direction_between(curve[index - 1], cell);
            }

            if (index + 1 < cell_count) {
                outgoing[index] = direction_between(cell, curve[index + 1]);
            }
        }

        for (let index = 2; index < cell_count; index += 1) {
            turn_prefix[index] = turn_prefix[index - 1] + (
                directions_match(incoming[index], incoming[index - 1]) ? 0 : 1
            );
        }

        for (let index = 0; index < cell_count; index += 1) {
            const cell = curve[index];
            let wrap_contacts = 0;

            for (const direction of [
                { x: 0, y: -1 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
                { x: -1, y: 0 }
            ]) {
                const x = cell.x + direction.x;
                const y = cell.y + direction.y;

                if (
                    x < 0 || x >= profile.columns ||
                    y < 0 || y >= profile.rows
                ) {
                    continue;
                }

                const neighbor_index =
                    cell_to_curve_index[y * profile.columns + x];

                if (Math.abs(neighbor_index - index) > 1) {
                    wrap_contacts += 1;
                }
            }

            wrap_prefix[index + 1] =
                wrap_prefix[index] + wrap_contacts;
        }

        return {
            cell_to_curve_index,
            incoming,
            outgoing,
            turn_prefix,
            wrap_prefix
        };
    }

    function is_inside(profile, x, y) {
        return x >= 0 && x < profile.columns && y >= 0 && y < profile.rows;
    }

    function analyze_aim_endpoint(profile, curve, metadata, end_index) {
        if (end_index <= 0 || end_index + 1 >= curve.length) {
            return null;
        }

        const direction = metadata.incoming[end_index];
        const outgoing = metadata.outgoing[end_index];

        if (!direction || !outgoing || directions_match(direction, outgoing)) {
            return null;
        }

        const head = curve[end_index];
        let x = head.x + direction.x;
        let y = head.y + direction.y;
        let first_index = -1;
        let ray_cell_count = 0;
        let perpendicular_crossings = 0;

        while (is_inside(profile, x, y)) {
            const curve_index =
                metadata.cell_to_curve_index[y * profile.columns + x];

            if (curve_index <= end_index) {
                return null;
            }

            if (first_index === -1) {
                first_index = curve_index;
            }

            const target_incoming = metadata.incoming[curve_index];
            const target_outgoing = metadata.outgoing[curve_index];
            const is_perpendicular_meeting =
                directions_are_perpendicular(direction, target_incoming) ||
                directions_are_perpendicular(direction, target_outgoing);

            if (is_perpendicular_meeting) {
                perpendicular_crossings += 1;
            }

            ray_cell_count += 1;
            x += direction.x;
            y += direction.y;
        }

        if (first_index === -1) {
            return null;
        }

        const first_incoming = metadata.incoming[first_index];
        const first_outgoing = metadata.outgoing[first_index];
        const first_is_perpendicular_meeting =
            directions_are_perpendicular(direction, first_incoming) ||
            directions_are_perpendicular(direction, first_outgoing);

        if (!first_is_perpendicular_meeting) {
            return null;
        }

        return {
            first_index,
            ray_cell_count,
            perpendicular_crossings,
            direction
        };
    }

    function build_endpoint_catalog(profile, curve, metadata) {
        const endpoints = new Array(curve.length).fill(null);

        for (let index = 1; index + 1 < curve.length; index += 1) {
            endpoints[index] = analyze_aim_endpoint(
                profile,
                curve,
                metadata,
                index
            );
        }

        const final_index = curve.length - 1;
        const final_direction = metadata.incoming[final_index];
        const final_cell = curve[final_index];
        const exit_x = final_cell.x + final_direction.x;
        const exit_y = final_cell.y + final_direction.y;

        if (!is_inside(profile, exit_x, exit_y)) {
            endpoints[final_index] = {
                first_index: -1,
                ray_cell_count: 0,
                perpendicular_crossings: 0,
                direction: final_direction
            };
        }

        return endpoints;
    }

    function interval_turn_count(metadata, start, end) {
        if (end - start < 2) {
            return 0;
        }

        return metadata.turn_prefix[end] - metadata.turn_prefix[start];
    }

    function interval_wrap_contacts(metadata, start, end) {
        return metadata.wrap_prefix[end + 1] - metadata.wrap_prefix[start];
    }

    function partition_curve(
        profile,
        curve,
        metadata,
        endpoints,
        target_length,
        tie_seed
    ) {
        const cell_count = curve.length;
        const scores = new Float64Array(cell_count + 1);
        const choices = new Int32Array(cell_count + 1);
        const negative_infinity = Number.NEGATIVE_INFINITY;

        scores.fill(negative_infinity);
        choices.fill(-1);
        scores[cell_count] = 0;

        for (let start = cell_count - 1; start >= 0; start -= 1) {
            const minimum_end = start + profile.minimum_pipe_length - 1;
            const maximum_end = Math.min(
                cell_count - 1,
                start + profile.maximum_pipe_length - 1
            );

            for (let end = minimum_end; end <= maximum_end; end += 1) {
                const endpoint = endpoints[end];

                if (!endpoint || !Number.isFinite(scores[end + 1])) {
                    continue;
                }

                const length = end - start + 1;
                const turn_count = interval_turn_count(metadata, start, end);
                const wrap_contacts = interval_wrap_contacts(
                    metadata,
                    start,
                    end
                );
                const length_score = -Math.abs(length - target_length) *
                    (profile.length_score_weight || 1.25);
                const turn_score = turn_count * 4.2;
                const wrap_score = wrap_contacts * 2.55;
                const aim_score = end === cell_count - 1 ?
                    35 :
                    190 +
                    endpoint.perpendicular_crossings * 27 +
                    endpoint.ray_cell_count * 5.5 +
                    Math.min(110, (endpoint.first_index - end) * 0.3);
                const deterministic_tie =
                    (mix_uint32(tie_seed ^ start ^ Math.imul(end, 0x9E3779B1)) & 1023) /
                    1048576;
                const candidate_score =
                    scores[end + 1] +
                    length_score +
                    turn_score +
                    wrap_score +
                    aim_score +
                    deterministic_tie;

                if (candidate_score > scores[start]) {
                    scores[start] = candidate_score;
                    choices[start] = end;
                }
            }
        }

        if (choices[0] === -1) {
            return null;
        }

        const segments = [];
        let start = 0;

        while (start < cell_count) {
            const end = choices[start];

            if (end < start) {
                return null;
            }

            segments.push({
                start,
                end,
                aim: endpoints[end]
            });
            start = end + 1;
        }

        return {
            curve,
            metadata,
            segments,
            target_length,
            score: scores[0]
        };
    }

    function build_pipes_from_partition(profile, partition) {
        return partition.segments.map((segment, pipe_id) => {
            const cells = partition.curve.slice(
                segment.start,
                segment.end + 1
            );
            const direction = direction_between(
                cells[cells.length - 2],
                cells[cells.length - 1]
            );

            return {
                id: pipe_id,
                color_index: mix_uint32(profile.seed + pipe_id) % PIPE_COLORS,
                cells,
                direction,
                intended_target_index: segment.aim.first_index
            };
        });
    }

    function locate_pipe_cell(pipe, x, y) {
        for (let index = 0; index < pipe.cells.length; index += 1) {
            const cell = pipe.cells[index];

            if (cell.x === x && cell.y === y) {
                return index;
            }
        }

        return -1;
    }

    function target_pipe_is_perpendicular(pipe, cell_index, direction) {
        let has_perpendicular_segment = false;

        if (cell_index > 0) {
            const incoming = direction_between(
                pipe.cells[cell_index - 1],
                pipe.cells[cell_index]
            );
            has_perpendicular_segment =
                directions_are_perpendicular(direction, incoming);
        }

        if (cell_index + 1 < pipe.cells.length) {
            const outgoing = direction_between(
                pipe.cells[cell_index],
                pipe.cells[cell_index + 1]
            );
            has_perpendicular_segment =
                has_perpendicular_segment ||
                directions_are_perpendicular(direction, outgoing);
        }

        return has_perpendicular_segment;
    }

    function analyze_interlocking(profile, pipes) {
        const occupancy = new Int32Array(profile.columns * profile.rows);
        const target_counts = new Map();
        let perpendicular_aim_count = 0;
        let aimed_pipe_count = 0;
        let total_ray_blockers = 0;
        let maximum_ray_blockers = 0;

        occupancy.fill(-1);

        for (const pipe of pipes) {
            for (const cell of pipe.cells) {
                occupancy[cell.y * profile.columns + cell.x] = pipe.id;
            }
        }

        for (let pipe_id = 0; pipe_id < pipes.length; pipe_id += 1) {
            const pipe = pipes[pipe_id];
            const head = pipe.cells[pipe.cells.length - 1];
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;
            let first_target_id = -1;
            let first_target_cell_index = -1;
            const blockers = new Set();

            while (is_inside(profile, x, y)) {
                const occupant = occupancy[y * profile.columns + x];

                if (occupant <= pipe_id) {
                    throw new Error(
                        `Generated pipe ${pipe.id} aims into itself or an earlier pipe.`
                    );
                }

                blockers.add(occupant);

                if (first_target_id === -1) {
                    first_target_id = occupant;
                    first_target_cell_index = locate_pipe_cell(
                        pipes[occupant],
                        x,
                        y
                    );
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            if (pipe_id === pipes.length - 1) {
                if (blockers.size !== 0) {
                    throw new Error("The final generated pipe does not have a clear exit.");
                }

                continue;
            }

            if (first_target_id === -1) {
                throw new Error(
                    `Generated pipe ${pipe.id} does not aim into another pipe.`
                );
            }

            aimed_pipe_count += 1;
            total_ray_blockers += blockers.size;
            maximum_ray_blockers = Math.max(
                maximum_ray_blockers,
                blockers.size
            );
            target_counts.set(
                first_target_id,
                (target_counts.get(first_target_id) || 0) + 1
            );

            if (
                target_pipe_is_perpendicular(
                    pipes[first_target_id],
                    first_target_cell_index,
                    pipe.direction
                )
            ) {
                perpendicular_aim_count += 1;
            }
        }

        let overlapping_aim_count = 0;
        let maximum_shared_target = 0;
        let target_concentration = 0;

        for (const count of target_counts.values()) {
            if (count > 1) {
                overlapping_aim_count += count;
            }

            maximum_shared_target = Math.max(maximum_shared_target, count);
            target_concentration += count * count;
        }

        const perpendicular_ratio = aimed_pipe_count > 0 ?
            perpendicular_aim_count / aimed_pipe_count :
            1;
        const overlapping_ratio = aimed_pipe_count > 0 ?
            overlapping_aim_count / aimed_pipe_count :
            0;

        return {
            aimed_pipe_count,
            perpendicular_aim_count,
            perpendicular_ratio,
            overlapping_aim_count,
            overlapping_ratio,
            maximum_shared_target,
            target_concentration: aimed_pipe_count > 0 ?
                target_concentration / aimed_pipe_count :
                0,
            average_ray_blockers: aimed_pipe_count > 0 ?
                total_ray_blockers / aimed_pipe_count :
                0,
            maximum_ray_blockers
        };
    }

    function analyze_pipe(cells) {
        let maximum_straight_cells = 1;
        let current_straight_cells = 1;
        let turn_count = 0;
        let previous_direction = null;

        for (let index = 1; index < cells.length; index += 1) {
            const direction = direction_between(cells[index - 1], cells[index]);

            if (directions_match(direction, previous_direction)) {
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
            segment_count: Math.max(0, cells.length - 1)
        };
    }

    function analyze_style(pipes) {
        let maximum_straight_cells = 0;
        let turn_count = 0;
        let segment_count = 0;

        for (const pipe of pipes) {
            const report = analyze_pipe(pipe.cells);
            maximum_straight_cells = Math.max(
                maximum_straight_cells,
                report.maximum_straight_cells
            );
            turn_count += report.turn_count;
            segment_count += report.segment_count;

            if (report.maximum_straight_cells > MAX_STRAIGHT_CELLS) {
                throw new Error(
                    `Generated pipe ${pipe.id} exceeds the five-cell straight-run limit.`
                );
            }

            if (pipe.cells.length >= 8 && report.turn_count < 3) {
                throw new Error(
                    `Generated pipe ${pipe.id} does not curve often enough.`
                );
            }
        }

        const turn_density = segment_count > 0 ?
            turn_count / segment_count :
            0;

        if (turn_density < 0.66) {
            throw new Error("Generated fallback level is not sufficiently curved.");
        }

        return {
            maximum_straight_cells,
            turn_count,
            segment_count,
            turn_density
        };
    }

    function score_partition_candidate(profile, partition) {
        const pipes = build_pipes_from_partition(profile, partition);
        const style = analyze_style(pipes);
        const interlocking = analyze_interlocking(profile, pipes);

        if (interlocking.perpendicular_ratio < 1) {
            throw new Error("A generated arrow missed its perpendicular target.");
        }

        const score =
            partition.score +
            interlocking.overlapping_ratio * 1450 +
            interlocking.average_ray_blockers * 125 +
            interlocking.maximum_shared_target * 70 +
            interlocking.target_concentration * 95 +
            style.turn_density * 390;

        return {
            partition,
            pipes,
            style,
            interlocking,
            score
        };
    }

    function build_best_layout(profile) {
        const candidates = [];
        const random = new Choobs.SeededRandom(profile.seed);
        const target_lengths = [];

        for (let index = 0; index < 6; index += 1) {
            const offset = random.integer(
                -profile.target_variation,
                profile.target_variation + 1
            );
            target_lengths.push(clamp(
                profile.target_base + offset,
                profile.minimum_pipe_length,
                profile.maximum_pipe_length
            ));
        }

        for (let variant = 0; variant < 8; variant += 1) {
            const transform = (variant + (profile.seed & 7)) % 8;
            const reverse_curve = Boolean(
                (profile.seed >>> (variant % 16)) & 1
            );
            const curve = build_nested_curve(
                profile,
                transform,
                reverse_curve
            );
            const metadata = build_curve_metadata(profile, curve);
            const endpoints = build_endpoint_catalog(
                profile,
                curve,
                metadata
            );

            for (let target_index = 0; target_index < target_lengths.length; target_index += 1) {
                const target_length = target_lengths[target_index];
                const partition = partition_curve(
                    profile,
                    curve,
                    metadata,
                    endpoints,
                    target_length,
                    mix_uint32(profile.seed ^ variant ^ target_index)
                );

                if (!partition) {
                    continue;
                }

                try {
                    const candidate = score_partition_candidate(
                        profile,
                        partition
                    );
                    candidate.transform = transform;
                    candidate.reverse_curve = reverse_curve;
                    candidates.push(candidate);
                } catch (error) {
                    // Invalid candidates are discarded; another deterministic variant is tested.
                }
            }
        }

        if (candidates.length === 0) {
            throw new Error("Could not construct an interlocking fallback level.");
        }

        candidates.sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return left.partition.target_length - right.partition.target_length;
        });

        return candidates[0];
    }



    function smooth_step(value) {
        return value * value * (3 - 2 * value);
    }

    function sample_noise_grid(noise, size, normalized_x, normalized_y) {
        const grid_x = clamp(normalized_x, 0, 1) * (size - 1);
        const grid_y = clamp(normalized_y, 0, 1) * (size - 1);
        const x0 = Math.floor(grid_x);
        const y0 = Math.floor(grid_y);
        const x1 = Math.min(size - 1, x0 + 1);
        const y1 = Math.min(size - 1, y0 + 1);
        const blend_x = smooth_step(grid_x - x0);
        const blend_y = smooth_step(grid_y - y0);
        const top =
            noise[y0 * size + x0] * (1 - blend_x) +
            noise[y0 * size + x1] * blend_x;
        const bottom =
            noise[y1 * size + x0] * (1 - blend_x) +
            noise[y1 * size + x1] * blend_x;

        return top * (1 - blend_y) + bottom * blend_y;
    }

    function keep_largest_cell_component(mask, columns, rows) {
        const visited = new Uint8Array(mask.length);
        let largest = [];

        for (let start = 0; start < mask.length; start += 1) {
            if (!mask[start] || visited[start]) {
                continue;
            }

            const queue = [start];
            const component = [];
            visited[start] = 1;

            for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
                const index = queue[queue_index];
                const x = index % columns;
                const y = Math.floor(index / columns);
                component.push(index);

                const neighbors = [
                    [x + 1, y],
                    [x - 1, y],
                    [x, y + 1],
                    [x, y - 1]
                ];

                for (const neighbor of neighbors) {
                    const next_x = neighbor[0];
                    const next_y = neighbor[1];

                    if (
                        next_x < 0 || next_x >= columns ||
                        next_y < 0 || next_y >= rows
                    ) {
                        continue;
                    }

                    const next_index = next_y * columns + next_x;

                    if (mask[next_index] && !visited[next_index]) {
                        visited[next_index] = 1;
                        queue.push(next_index);
                    }
                }
            }

            if (component.length > largest.length) {
                largest = component;
            }
        }

        const result = new Uint8Array(mask.length);

        for (const index of largest) {
            result[index] = 1;
        }

        return result;
    }

    function distance_from_empty(mask, columns, rows) {
        const distance = new Int32Array(mask.length);
        const queue = [];
        distance.fill(0x3FFFFFFF);

        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < columns; x += 1) {
                const index = y * columns + x;

                if (
                    !mask[index] ||
                    x === 0 || y === 0 ||
                    x === columns - 1 || y === rows - 1
                ) {
                    distance[index] = 0;
                    queue.push(index);
                }
            }
        }

        for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
            const index = queue[queue_index];
            const x = index % columns;
            const y = Math.floor(index / columns);
            const next_distance = distance[index] + 1;
            const neighbors = [
                [x + 1, y],
                [x - 1, y],
                [x, y + 1],
                [x, y - 1]
            ];

            for (const neighbor of neighbors) {
                const next_x = neighbor[0];
                const next_y = neighbor[1];

                if (
                    next_x < 0 || next_x >= columns ||
                    next_y < 0 || next_y >= rows
                ) {
                    continue;
                }

                const next_index = next_y * columns + next_x;

                if (next_distance < distance[next_index]) {
                    distance[next_index] = next_distance;
                    queue.push(next_index);
                }
            }
        }

        return distance;
    }

    function create_blob_field(profile) {
        const random = new Choobs.SeededRandom(
            mix_uint32(profile.seed ^ 0x4D534B31)
        );
        const coarse_size = 5;
        const fine_size = 11;
        const coarse_noise = new Float64Array(coarse_size * coarse_size);
        const fine_noise = new Float64Array(fine_size * fine_size);

        for (let index = 0; index < coarse_noise.length; index += 1) {
            coarse_noise[index] = random.next() * 2 - 1;
        }

        for (let index = 0; index < fine_noise.length; index += 1) {
            fine_noise[index] = random.next() * 2 - 1;
        }

        const center_x = 0.5 + (random.next() - 0.5) * 0.16;
        const center_y = 0.5 + (random.next() - 0.5) * 0.16;
        const radius_x = 0.34 + random.next() * 0.12;
        const radius_y = 0.32 + random.next() * 0.14;
        const harmonics = [];

        for (let harmonic = 2; harmonic <= 10; harmonic += 1) {
            harmonics.push({
                harmonic,
                phase: random.next() * Math.PI * 2,
                amplitude:
                    harmonic <= 4 ?
                        0.045 + random.next() * 0.075 :
                        0.015 + random.next() * 0.045
            });
        }

        const lobes = [];
        const lobe_count = 2 + (mix_uint32(profile.seed ^ 0x51ED270B) % 3);

        for (let index = 0; index < lobe_count; index += 1) {
            const angle = random.next() * Math.PI * 2;
            const distance = 0.1 + random.next() * 0.25;

            lobes.push({
                x: center_x + Math.cos(angle) * distance,
                y: center_y + Math.sin(angle) * distance,
                radius_x: 0.07 + random.next() * 0.12,
                radius_y: 0.06 + random.next() * 0.11,
                strength: 0.12 + random.next() * 0.24
            });
        }

        const dents = [];
        const dent_count = 3 + (mix_uint32(profile.seed ^ 0x7F4A7C15) % 4);

        for (let index = 0; index < dent_count; index += 1) {
            const angle = random.next() * Math.PI * 2;
            const distance = 0.2 + random.next() * 0.28;

            dents.push({
                x: center_x + Math.cos(angle) * distance,
                y: center_y + Math.sin(angle) * distance,
                radius_x: 0.035 + random.next() * 0.085,
                radius_y: 0.035 + random.next() * 0.085,
                strength: 0.18 + random.next() * 0.34
            });
        }

        const field = new Float64Array(profile.columns * profile.rows);
        const values = [];

        for (let y = 0; y < profile.rows; y += 1) {
            for (let x = 0; x < profile.columns; x += 1) {
                const normalized_x = (x + 0.5) / profile.columns;
                const normalized_y = (y + 0.5) / profile.rows;
                const delta_x = (normalized_x - center_x) / radius_x;
                const delta_y = (normalized_y - center_y) / radius_y;
                const radial_distance = Math.hypot(delta_x, delta_y);
                const angle = Math.atan2(delta_y, delta_x);
                let boundary = 1;

                for (const harmonic of harmonics) {
                    boundary += Math.sin(
                        harmonic.harmonic * angle + harmonic.phase
                    ) * harmonic.amplitude;
                }

                let value =
                    boundary - radial_distance +
                    sample_noise_grid(
                        coarse_noise,
                        coarse_size,
                        normalized_x,
                        normalized_y
                    ) * 0.22 +
                    sample_noise_grid(
                        fine_noise,
                        fine_size,
                        normalized_x,
                        normalized_y
                    ) * 0.09;

                for (const lobe of lobes) {
                    const lobe_x = (normalized_x - lobe.x) / lobe.radius_x;
                    const lobe_y = (normalized_y - lobe.y) / lobe.radius_y;
                    value += lobe.strength * Math.exp(
                        -(lobe_x * lobe_x + lobe_y * lobe_y) * 0.5
                    );
                }

                for (const dent of dents) {
                    const dent_x = (normalized_x - dent.x) / dent.radius_x;
                    const dent_y = (normalized_y - dent.y) / dent.radius_y;
                    value -= dent.strength * Math.exp(
                        -(dent_x * dent_x + dent_y * dent_y) * 0.5
                    );
                }

                const index = y * profile.columns + x;
                field[index] = value;
                values.push(value);
            }
        }

        const target_ratio = 0.58 + random.next() * 0.12;
        values.sort((left, right) => left - right);
        const threshold_index = clamp(
            Math.floor(values.length * (1 - target_ratio)),
            0,
            values.length - 1
        );
        const threshold = values[threshold_index];
        let target_mask = new Uint8Array(field.length);

        for (let index = 0; index < field.length; index += 1) {
            target_mask[index] = field[index] >= threshold ? 1 : 0;
        }

        target_mask = keep_largest_cell_component(
            target_mask,
            profile.columns,
            profile.rows
        );

        const distance = distance_from_empty(
            target_mask,
            profile.columns,
            profile.rows
        );
        const hole_mask = new Uint8Array(target_mask.length);
        const minimum_dimension = Math.min(profile.columns, profile.rows);
        const desired_holes =
            minimum_dimension < 16 ? 1 :
            minimum_dimension < 34 ? 2 :
            2 + (mix_uint32(profile.seed ^ 0xC2B2AE35) % 3);
        const center_candidates = [];
        const minimum_clearance = Math.max(2, Math.floor(minimum_dimension * 0.07));

        for (let index = 0; index < target_mask.length; index += 1) {
            if (target_mask[index] && distance[index] >= minimum_clearance) {
                center_candidates.push(index);
            }
        }

        random.shuffle(center_candidates);
        const hole_centers = [];

        for (const center_index of center_candidates) {
            if (hole_centers.length >= desired_holes) {
                break;
            }

            const center_cell_x = center_index % profile.columns;
            const center_cell_y = Math.floor(center_index / profile.columns);
            const separated = hole_centers.every((hole) =>
                Math.hypot(
                    center_cell_x - hole.x,
                    center_cell_y - hole.y
                ) >= Math.max(hole.radius_x, hole.radius_y) * 1.5
            );

            if (!separated) {
                continue;
            }

            const maximum_radius = Math.max(
                1.5,
                Math.min(
                    distance[center_index] - 1,
                    minimum_dimension * (0.07 + random.next() * 0.055)
                )
            );

            if (maximum_radius < 1.25) {
                continue;
            }

            hole_centers.push({
                x: center_cell_x,
                y: center_cell_y,
                radius_x: Math.max(1.25, maximum_radius * (0.75 + random.next() * 0.5)),
                radius_y: Math.max(1.25, maximum_radius * (0.75 + random.next() * 0.5)),
                phase: random.next() * Math.PI * 2,
                warble: 0.12 + random.next() * 0.18
            });
        }

        for (const hole of hole_centers) {
            for (let y = 0; y < profile.rows; y += 1) {
                for (let x = 0; x < profile.columns; x += 1) {
                    const delta_x = (x - hole.x) / hole.radius_x;
                    const delta_y = (y - hole.y) / hole.radius_y;
                    const angle = Math.atan2(delta_y, delta_x);
                    const warped_radius = 1 +
                        Math.sin(angle * 3 + hole.phase) * hole.warble +
                        Math.sin(angle * 5 - hole.phase * 0.7) * hole.warble * 0.45;
                    const normalized_distance = Math.hypot(delta_x, delta_y);
                    const index = y * profile.columns + x;

                    if (target_mask[index] && normalized_distance <= warped_radius) {
                        hole_mask[index] = 1;
                        target_mask[index] = 0;
                    }
                }
            }
        }

        target_mask = keep_largest_cell_component(
            target_mask,
            profile.columns,
            profile.rows
        );

        for (let index = 0; index < hole_mask.length; index += 1) {
            if (target_mask[index]) {
                hole_mask[index] = 0;
            }
        }

        return {
            field,
            target_mask,
            hole_mask,
            target_ratio,
            threshold,
            requested_hole_count: desired_holes,
            seed: mix_uint32(profile.seed ^ 0x4D534B31)
        };
    }

    function build_pipe_adjacency(profile, pipes) {
        const occupancy = new Int32Array(profile.columns * profile.rows);
        const adjacency = Array.from(
            { length: pipes.length },
            () => new Set()
        );

        occupancy.fill(-1);

        for (const pipe of pipes) {
            for (const cell of pipe.cells) {
                occupancy[cell.y * profile.columns + cell.x] = pipe.id;
            }
        }

        for (let y = 0; y < profile.rows; y += 1) {
            for (let x = 0; x < profile.columns; x += 1) {
                const pipe_id = occupancy[y * profile.columns + x];

                if (x + 1 < profile.columns) {
                    const neighbor_id =
                        occupancy[y * profile.columns + x + 1];

                    if (
                        pipe_id >= 0 &&
                        neighbor_id >= 0 &&
                        pipe_id !== neighbor_id
                    ) {
                        adjacency[pipe_id].add(neighbor_id);
                        adjacency[neighbor_id].add(pipe_id);
                    }
                }

                if (y + 1 < profile.rows) {
                    const neighbor_id =
                        occupancy[(y + 1) * profile.columns + x];

                    if (
                        pipe_id >= 0 &&
                        neighbor_id >= 0 &&
                        pipe_id !== neighbor_id
                    ) {
                        adjacency[pipe_id].add(neighbor_id);
                        adjacency[neighbor_id].add(pipe_id);
                    }
                }
            }
        }

        return adjacency;
    }

    function pipe_components(selected, adjacency) {
        const visited = new Set();
        const components = [];

        for (const start_id of selected) {
            if (visited.has(start_id)) {
                continue;
            }

            const queue = [start_id];
            const component = [];
            visited.add(start_id);

            for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
                const pipe_id = queue[queue_index];
                component.push(pipe_id);

                for (const neighbor_id of adjacency[pipe_id]) {
                    if (selected.has(neighbor_id) && !visited.has(neighbor_id)) {
                        visited.add(neighbor_id);
                        queue.push(neighbor_id);
                    }
                }
            }

            components.push(component);
        }

        components.sort((left, right) => right.length - left.length);
        return components;
    }

    function analyze_mask_shape(mask, columns, rows) {
        let occupied_cell_count = 0;
        let minimum_x = columns;
        let minimum_y = rows;
        let maximum_x = -1;
        let maximum_y = -1;
        let perimeter = 0;

        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < columns; x += 1) {
                const index = y * columns + x;

                if (!mask[index]) {
                    continue;
                }

                occupied_cell_count += 1;
                minimum_x = Math.min(minimum_x, x);
                minimum_y = Math.min(minimum_y, y);
                maximum_x = Math.max(maximum_x, x);
                maximum_y = Math.max(maximum_y, y);

                const neighbors = [
                    [x + 1, y],
                    [x - 1, y],
                    [x, y + 1],
                    [x, y - 1]
                ];

                for (const neighbor of neighbors) {
                    const next_x = neighbor[0];
                    const next_y = neighbor[1];

                    if (
                        next_x < 0 || next_x >= columns ||
                        next_y < 0 || next_y >= rows ||
                        !mask[next_y * columns + next_x]
                    ) {
                        perimeter += 1;
                    }
                }
            }
        }

        const exterior = new Uint8Array(mask.length);
        const queue = [];

        function enqueue_empty(x, y) {
            const index = y * columns + x;

            if (!mask[index] && !exterior[index]) {
                exterior[index] = 1;
                queue.push(index);
            }
        }

        for (let x = 0; x < columns; x += 1) {
            enqueue_empty(x, 0);
            enqueue_empty(x, rows - 1);
        }

        for (let y = 0; y < rows; y += 1) {
            enqueue_empty(0, y);
            enqueue_empty(columns - 1, y);
        }

        for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
            const index = queue[queue_index];
            const x = index % columns;
            const y = Math.floor(index / columns);
            const neighbors = [
                [x + 1, y],
                [x - 1, y],
                [x, y + 1],
                [x, y - 1]
            ];

            for (const neighbor of neighbors) {
                const next_x = neighbor[0];
                const next_y = neighbor[1];

                if (
                    next_x < 0 || next_x >= columns ||
                    next_y < 0 || next_y >= rows
                ) {
                    continue;
                }

                const next_index = next_y * columns + next_x;

                if (!mask[next_index] && !exterior[next_index]) {
                    exterior[next_index] = 1;
                    queue.push(next_index);
                }
            }
        }

        const hole_visited = new Uint8Array(mask.length);
        const hole_sizes = [];

        for (let start = 0; start < mask.length; start += 1) {
            if (mask[start] || exterior[start] || hole_visited[start]) {
                continue;
            }

            const hole_queue = [start];
            let hole_size = 0;
            hole_visited[start] = 1;

            for (let queue_index = 0; queue_index < hole_queue.length; queue_index += 1) {
                const index = hole_queue[queue_index];
                const x = index % columns;
                const y = Math.floor(index / columns);
                hole_size += 1;
                const neighbors = [
                    [x + 1, y],
                    [x - 1, y],
                    [x, y + 1],
                    [x, y - 1]
                ];

                for (const neighbor of neighbors) {
                    const next_x = neighbor[0];
                    const next_y = neighbor[1];

                    if (
                        next_x < 0 || next_x >= columns ||
                        next_y < 0 || next_y >= rows
                    ) {
                        continue;
                    }

                    const next_index = next_y * columns + next_x;

                    if (
                        !mask[next_index] &&
                        !exterior[next_index] &&
                        !hole_visited[next_index]
                    ) {
                        hole_visited[next_index] = 1;
                        hole_queue.push(next_index);
                    }
                }
            }

            hole_sizes.push(hole_size);
        }

        hole_sizes.sort((left, right) => right - left);
        const bounding_width = maximum_x >= minimum_x ? maximum_x - minimum_x + 1 : 0;
        const bounding_height = maximum_y >= minimum_y ? maximum_y - minimum_y + 1 : 0;
        const bounding_area = bounding_width * bounding_height;

        return {
            occupied_cell_count,
            occupied_ratio:
                mask.length > 0 ? occupied_cell_count / mask.length : 0,
            bounding_box_fill_ratio:
                bounding_area > 0 ? occupied_cell_count / bounding_area : 0,
            hole_count: hole_sizes.length,
            hole_cell_count: hole_sizes.reduce((total, value) => total + value, 0),
            largest_hole_size: hole_sizes[0] || 0,
            perimeter,
            perimeter_ratio:
                occupied_cell_count > 0 ? perimeter / Math.sqrt(occupied_cell_count) : 0
        };
    }

    function build_selected_mask(profile, pipes, selected) {
        const mask = new Array(profile.columns * profile.rows).fill(0);

        for (const pipe of pipes) {
            if (!selected.has(pipe.id)) {
                continue;
            }

            for (const cell of pipe.cells) {
                mask[cell.y * profile.columns + cell.x] = 1;
            }
        }

        return mask;
    }

    function carve_enclosed_pipe_hole(profile, pipes, selected, adjacency) {
        if (selected.size < 8) {
            return selected;
        }

        const ranked = [];

        for (const pipe_id of selected) {
            const pipe = pipes[pipe_id];
            let minimum_edge_distance = Number.POSITIVE_INFINITY;
            let selected_neighbor_count = 0;

            for (const cell of pipe.cells) {
                minimum_edge_distance = Math.min(
                    minimum_edge_distance,
                    cell.x,
                    cell.y,
                    profile.columns - 1 - cell.x,
                    profile.rows - 1 - cell.y
                );
            }

            for (const neighbor_id of adjacency[pipe_id]) {
                if (selected.has(neighbor_id)) {
                    selected_neighbor_count += 1;
                }
            }

            if (minimum_edge_distance >= 2 && selected_neighbor_count >= 2) {
                ranked.push({
                    pipe_id,
                    score:
                        minimum_edge_distance * 10 +
                        selected_neighbor_count * 4 +
                        pipe.cells.length * 0.08
                });
            }
        }

        ranked.sort((left, right) => right.score - left.score);
        const candidate_ids = ranked
            .slice(0, Math.min(42, ranked.length))
            .map((entry) => entry.pipe_id);
        let best = null;

        function consider(removals) {
            if (selected.size - removals.length < 5) {
                return;
            }

            const trial = new Set(selected);

            for (const pipe_id of removals) {
                trial.delete(pipe_id);
            }

            const components = pipe_components(trial, adjacency);

            if (components.length !== 1 || components[0].length !== trial.size) {
                return;
            }

            const mask = build_selected_mask(profile, pipes, trial);
            const shape = analyze_mask_shape(mask, profile.columns, profile.rows);

            if (shape.hole_count < 1) {
                return;
            }

            const score =
                shape.hole_count * 10000 +
                shape.hole_cell_count * 100 +
                (1 - shape.bounding_box_fill_ratio) * 500 -
                removals.length * 80;

            if (!best || score > best.score) {
                best = { score, trial };
            }
        }

        for (const pipe_id of candidate_ids) {
            consider([pipe_id]);
        }

        if (!best) {
            const candidate_set = new Set(candidate_ids);

            for (const first_id of candidate_ids.slice(0, 26)) {
                for (const second_id of adjacency[first_id]) {
                    if (
                        second_id <= first_id ||
                        !candidate_set.has(second_id) ||
                        !selected.has(second_id)
                    ) {
                        continue;
                    }

                    consider([first_id, second_id]);
                }
            }
        }

        return best ? best.trial : selected;
    }

    function select_blob_pipes(profile, pipes) {
        const blob = create_blob_field(profile);
        const adjacency = build_pipe_adjacency(profile, pipes);
        const pipe_scores = new Array(pipes.length);
        const candidate_thresholds = [0.58, 0.48, 0.38, 0.28, 0.18];
        let selected = new Set();

        for (const pipe of pipes) {
            let target_cells = 0;
            let hole_cells = 0;
            let field_total = 0;
            let edge_cells = 0;

            for (const cell of pipe.cells) {
                const index = cell.y * profile.columns + cell.x;
                target_cells += blob.target_mask[index];
                hole_cells += blob.hole_mask[index];
                field_total += blob.field[index];

                if (
                    cell.x === 0 || cell.y === 0 ||
                    cell.x === profile.columns - 1 ||
                    cell.y === profile.rows - 1
                ) {
                    edge_cells += 1;
                }
            }

            const cell_count = Math.max(1, pipe.cells.length);
            const target_ratio = target_cells / cell_count;
            const hole_ratio = hole_cells / cell_count;
            const edge_ratio = edge_cells / cell_count;

            pipe_scores[pipe.id] = {
                id: pipe.id,
                cell_count: pipe.cells.length,
                target_ratio,
                hole_ratio,
                score:
                    target_ratio * 2.4 +
                    field_total / cell_count * 0.35 -
                    hole_ratio * 8 -
                    edge_ratio * 0.55
            };
        }

        for (const threshold of candidate_thresholds) {
            const candidates = new Set();

            for (const report of pipe_scores) {
                if (
                    report.hole_ratio === 0 &&
                    report.target_ratio >= threshold
                ) {
                    candidates.add(report.id);
                }
            }

            const components = pipe_components(candidates, adjacency);

            if (components.length === 0) {
                continue;
            }

            const component = components[0];

            if (component.length >= 5) {
                selected = new Set(component);
                break;
            }
        }

        if (selected.size < 5) {
            const ranked = pipe_scores
                .filter((report) => report.hole_ratio === 0)
                .sort((left, right) => right.score - left.score);

            for (const report of ranked) {
                selected.add(report.id);

                if (selected.size >= 5) {
                    break;
                }
            }

            const components = pipe_components(selected, adjacency);

            if (components.length > 0) {
                selected = new Set(components[0]);
            }
        }

        // Add only high-quality boundary pipes that touch the selected body. This
        // preserves the noisy silhouette without allowing the selection to grow
        // back into a compact square.
        let expanded = true;

        while (expanded) {
            expanded = false;
            const additions = [];

            for (const report of pipe_scores) {
                if (
                    selected.has(report.id) ||
                    report.hole_ratio > 0 ||
                    report.target_ratio < 0.58
                ) {
                    continue;
                }

                let selected_neighbor_count = 0;

                for (const neighbor_id of adjacency[report.id]) {
                    if (selected.has(neighbor_id)) {
                        selected_neighbor_count += 1;
                    }
                }

                if (selected_neighbor_count > 0) {
                    additions.push(report.id);
                }
            }

            for (const pipe_id of additions) {
                selected.add(pipe_id);
                expanded = true;
            }
        }

        if (selected.size < 5) {
            throw new Error("The generated blob retained too few pipes.");
        }

        selected = carve_enclosed_pipe_hole(
            profile,
            pipes,
            selected,
            adjacency
        );

        const kept_pipes = pipes.filter((pipe) => selected.has(pipe.id));
        const reindexed_pipes = kept_pipes.map((pipe, new_id) => ({
            id: new_id,
            color_index: pipe.color_index,
            cells: pipe.cells.map((cell) => ({ x: cell.x, y: cell.y })),
            direction: { x: pipe.direction.x, y: pipe.direction.y }
        }));
        const mask = new Array(profile.columns * profile.rows).fill(0);

        for (const pipe of reindexed_pipes) {
            for (const cell of pipe.cells) {
                mask[cell.y * profile.columns + cell.x] = 1;
            }
        }

        const shape = analyze_mask_shape(mask, profile.columns, profile.rows);

        return {
            pipes: reindexed_pipes,
            mask,
            blob_seed: blob.seed,
            target_ratio: blob.target_ratio,
            actual_ratio: shape.occupied_ratio,
            shape
        };
    }

    function build_crop_offsets(profile, attempt_count = 30) {
        const margin = Math.abs(profile.curve_size - profile.columns);
        const offsets = [];
        const seen = new Set();

        function add(x, y) {
            const clamped_x = clamp(Math.floor(x), 0, margin);
            const clamped_y = clamp(Math.floor(y), 0, margin);
            const key = `${clamped_x},${clamped_y}`;

            if (!seen.has(key)) {
                seen.add(key);
                offsets.push({ x: clamped_x, y: clamped_y });
            }
        }

        add(margin / 2, margin / 2);
        add(0, 0);
        add(margin, 0);
        add(0, margin);
        add(margin, margin);

        for (let attempt = 0; offsets.length < attempt_count; attempt += 1) {
            const x_hash = mix_uint32(
                profile.seed ^ Math.imul(attempt + 1, 0x9E3779B1)
            );
            const y_hash = mix_uint32(
                profile.seed ^ Math.imul(attempt + 1, 0x85EBCA6B)
            );
            add(
                margin > 0 ? x_hash % (margin + 1) : 0,
                margin > 0 ? y_hash % (margin + 1) : 0
            );

            if (attempt > attempt_count * 4) {
                break;
            }
        }

        return offsets;
    }

    function crop_whole_pipes(profile, pipes, offset) {
        const source_is_larger = profile.curve_size > profile.columns;
        const kept = [];

        for (const pipe of pipes) {
            if (source_is_larger) {
                const minimum_x = offset.x;
                const minimum_y = offset.y;
                const maximum_x = minimum_x + profile.columns;
                const maximum_y = minimum_y + profile.rows;
                const is_inside_crop = pipe.cells.every((cell) =>
                    cell.x >= minimum_x &&
                    cell.x < maximum_x &&
                    cell.y >= minimum_y &&
                    cell.y < maximum_y
                );

                if (!is_inside_crop) {
                    continue;
                }

                kept.push({
                    id: kept.length,
                    color_index: pipe.color_index,
                    cells: pipe.cells.map((cell) => ({
                        x: cell.x - minimum_x,
                        y: cell.y - minimum_y
                    })),
                    direction: { x: pipe.direction.x, y: pipe.direction.y }
                });
                continue;
            }

            kept.push({
                id: kept.length,
                color_index: pipe.color_index,
                cells: pipe.cells.map((cell) => ({
                    x: cell.x + offset.x,
                    y: cell.y + offset.y
                })),
                direction: { x: pipe.direction.x, y: pipe.direction.y }
            });
        }

        return kept;
    }

    function build_blob_candidate(profile, layout, crop_offset, attempt) {
        const cropped_pipes = crop_whole_pipes(
            profile,
            layout.pipes,
            crop_offset
        );

        if (cropped_pipes.length < 5) {
            return null;
        }

        const selection_profile = {
            ...profile,
            seed: mix_uint32(
                profile.seed ^
                Math.imul(attempt + 1, 0x27D4EB2D) ^
                Math.imul(crop_offset.x + 1, 0x165667B1) ^
                Math.imul(crop_offset.y + 1, 0xD3A2646C)
            )
        };
        const blob_selection = select_blob_pipes(
            selection_profile,
            cropped_pipes
        );
        const style = analyze_style(blob_selection.pipes);
        const interlocking = analyze_filtered_interlocking(
            profile,
            blob_selection.pipes
        );

        const shape = blob_selection.shape;
        const minimum_dimension = Math.min(profile.columns, profile.rows);
        const requires_hole = minimum_dimension >= 14;

        const minimum_aimed_ratio = minimum_dimension < 30 ? 0.3 : 0.42;
        const minimum_perpendicular_ratio = minimum_dimension < 30 ? 0.68 : 0.78;

        if (
            interlocking.aimed_pipe_ratio < minimum_aimed_ratio ||
            interlocking.perpendicular_aim_ratio < minimum_perpendicular_ratio ||
            shape.occupied_ratio < 0.18 ||
            shape.occupied_ratio > 0.72 ||
            shape.bounding_box_fill_ratio > 0.94 ||
            (requires_hole && shape.hole_count < 1)
        ) {
            return null;
        }

        const score =
            interlocking.aimed_pipe_ratio * 900 +
            interlocking.perpendicular_aim_ratio * 1200 +
            interlocking.overlapping_aim_ratio * 1000 +
            interlocking.average_ray_blockers * 100 +
            style.turn_density * 400 +
            shape.hole_count * 180 +
            Math.min(shape.hole_cell_count, profile.columns * profile.rows * 0.12) * 3 +
            (1 - shape.bounding_box_fill_ratio) * 900 +
            shape.perimeter_ratio * 35 +
            blob_selection.actual_ratio * 120;

        return {
            blob_selection,
            style,
            interlocking,
            crop_offset,
            score
        };
    }

    function analyze_filtered_interlocking(profile, pipes) {
        const occupancy = new Int32Array(profile.columns * profile.rows);
        const target_counts = new Map();
        let aimed_pipe_count = 0;
        let perpendicular_aim_count = 0;
        let total_ray_blockers = 0;
        let maximum_ray_blockers = 0;

        occupancy.fill(-1);

        for (const pipe of pipes) {
            for (const cell of pipe.cells) {
                occupancy[cell.y * profile.columns + cell.x] = pipe.id;
            }
        }

        for (const pipe of pipes) {
            const head = pipe.cells[pipe.cells.length - 1];
            let x = head.x + pipe.direction.x;
            let y = head.y + pipe.direction.y;
            let first_target_id = -1;
            let first_target_cell_index = -1;
            const blockers = new Set();

            while (is_inside(profile, x, y)) {
                const occupant = occupancy[y * profile.columns + x];

                if (occupant >= 0 && occupant !== pipe.id) {
                    blockers.add(occupant);

                    if (first_target_id < 0) {
                        first_target_id = occupant;
                        first_target_cell_index = locate_pipe_cell(
                            pipes[occupant],
                            x,
                            y
                        );
                    }
                }

                x += pipe.direction.x;
                y += pipe.direction.y;
            }

            if (first_target_id < 0) {
                continue;
            }

            aimed_pipe_count += 1;
            total_ray_blockers += blockers.size;
            maximum_ray_blockers = Math.max(
                maximum_ray_blockers,
                blockers.size
            );
            target_counts.set(
                first_target_id,
                (target_counts.get(first_target_id) || 0) + 1
            );

            if (
                target_pipe_is_perpendicular(
                    pipes[first_target_id],
                    first_target_cell_index,
                    pipe.direction
                )
            ) {
                perpendicular_aim_count += 1;
            }
        }

        let overlapping_aim_count = 0;
        let maximum_shared_target = 0;

        for (const count of target_counts.values()) {
            if (count > 1) {
                overlapping_aim_count += count;
            }

            maximum_shared_target = Math.max(
                maximum_shared_target,
                count
            );
        }

        return {
            aimed_pipe_count,
            aimed_pipe_ratio:
                pipes.length > 0 ? aimed_pipe_count / pipes.length : 0,
            perpendicular_aim_count,
            perpendicular_aim_ratio:
                aimed_pipe_count > 0 ?
                    perpendicular_aim_count / aimed_pipe_count :
                    1,
            overlapping_aim_count,
            overlapping_aim_ratio:
                aimed_pipe_count > 0 ?
                    overlapping_aim_count / aimed_pipe_count :
                    0,
            maximum_shared_target,
            average_ray_blockers:
                aimed_pipe_count > 0 ?
                    total_ray_blockers / aimed_pipe_count :
                    0,
            maximum_ray_blockers
        };
    }

    function build_level_options(level_number) {
        return create_level_profile(level_number);
    }

    function generate(level_number) {
        const profile = create_level_profile(level_number);
        const base_layout_profile = create_layout_profile(profile);
        const crop_offsets = build_crop_offsets(profile);
        const target_attempt_count = 30;
        const variants_per_crop = Math.max(
            1,
            Math.ceil(target_attempt_count / Math.max(1, crop_offsets.length))
        );
        const length_score_weights = [18, 14, 10, 1.25];
        let layout = null;
        let candidates = [];

        for (let weight_index = 0; weight_index < length_score_weights.length; weight_index += 1) {
            const length_score_weight = length_score_weights[weight_index];
            const weighted_profile = {
                ...base_layout_profile,
                length_score_weight
            };
            const candidate_layout = build_best_layout(weighted_profile);
            const weighted_candidates = [];
            let attempt_index = weight_index * 1000;

            for (const crop_offset of crop_offsets) {
                for (let variant = 0; variant < variants_per_crop; variant += 1) {
                    try {
                        const candidate = build_blob_candidate(
                            profile,
                            candidate_layout,
                            crop_offset,
                            attempt_index
                        );

                        if (candidate) {
                            weighted_candidates.push(candidate);
                        }
                    } catch (error) {
                        // Try another deterministic crop and blob field.
                    }

                    attempt_index += 1;
                }
            }

            if (weighted_candidates.length > 0) {
                layout = candidate_layout;
                candidates = weighted_candidates;
                break;
            }
        }

        if (!layout || candidates.length === 0) {
            throw new Error(
                "Could not retain a valid interlocking blob at this grid size."
            );
        }

        candidates.sort((left, right) => right.score - left.score);
        const selected = candidates[0];
        const blob_selection = selected.blob_selection;
        const solution_order = blob_selection.pipes
            .map((pipe) => pipe.id)
            .reverse();
        const style = selected.style;
        const interlocking = selected.interlocking;
        const covered_cell_count = blob_selection.mask.reduce(
            (total, value) => total + value,
            0
        );

        const raw_level = {
            version: 3,
            number: profile.number,
            name: `Level ${profile.number}`,
            source_name: "deterministic warbled holey blob nest",
            created_at: "1970-01-01T00:00:00.000Z",
            palette: create_random_palette(profile.seed),
            columns: profile.columns,
            rows: profile.rows,
            mask: blob_selection.mask,
            pipes: blob_selection.pipes.map((pipe) => ({
                id: pipe.id,
                color_index: pipe.color_index,
                cells: pipe.cells.map((cell) => [cell.x, cell.y]),
                direction: [pipe.direction.x, pipe.direction.y]
            })),
            solution_order,
            settings: {
                procedural: true,
                level_number_seed: profile.number,
                deterministic_seed: profile.seed,
                blob_seed: blob_selection.blob_seed,
                pattern: "variable_grid_warbled_holey_blob_interlocking_nest",
                grid_size: profile.columns,
                size_phase: profile.size_phase,
                size_progress: profile.size_progress,
                size_band: [
                    profile.size_minimum,
                    profile.size_maximum
                ],
                source_curve_size: profile.curve_size,
                crop_offset: [
                    selected.crop_offset.x,
                    selected.crop_offset.y
                ],
                blob_target_ratio: blob_selection.target_ratio,
                blob_actual_ratio: blob_selection.actual_ratio,
                blob_hole_count: blob_selection.shape.hole_count,
                blob_hole_cell_count: blob_selection.shape.hole_cell_count,
                blob_largest_hole_size: blob_selection.shape.largest_hole_size,
                blob_bounding_box_fill_ratio:
                    blob_selection.shape.bounding_box_fill_ratio,
                blob_perimeter_ratio: blob_selection.shape.perimeter_ratio,
                transform: layout.transform,
                reverse_curve: layout.reverse_curve,
                target_pipe_length: layout.partition.target_length,
                maximum_straight_cells: style.maximum_straight_cells,
                turn_count: style.turn_count,
                turn_density: style.turn_density,
                aimed_pipe_count: interlocking.aimed_pipe_count,
                aimed_pipe_ratio: interlocking.aimed_pipe_ratio,
                perpendicular_aim_count:
                    interlocking.perpendicular_aim_count,
                perpendicular_aim_ratio:
                    interlocking.perpendicular_aim_ratio,
                overlapping_aim_count:
                    interlocking.overlapping_aim_count,
                overlapping_aim_ratio:
                    interlocking.overlapping_aim_ratio,
                maximum_shared_target:
                    interlocking.maximum_shared_target,
                average_ray_blockers:
                    interlocking.average_ray_blockers,
                maximum_ray_blockers:
                    interlocking.maximum_ray_blockers,
                covered_cell_count,
                uncovered_cell_count: 0,
                singleton_pipe_count: 0
            }
        };

        return Choobs.normalize_level(raw_level);
    }

    const api = Object.freeze({
        create_level_profile,
        create_random_palette,
        build_level_options,
        generate
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    global_scope.ChoobsProceduralLevels = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
