(() => {
    "use strict";

    const GRID_SIZE = 50;
    const IMAGE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

    function wait_for_app() {
        return new Promise((resolve) => {
            const started = performance.now();
            const check = () => {
                if (globalThis.ChoobsCreatorApp) {
                    resolve(globalThis.ChoobsCreatorApp);
                } else if (performance.now() - started > 5000) {
                    resolve(null);
                } else {
                    window.setTimeout(check, 20);
                }
            };
            check();
        });
    }

    function strip_extension(file_name) {
        return String(file_name || "image")
            .replace(/\.[^.]+$/, "")
            .trim() || "image";
    }

    function level_file_name(level_number) {
        return `level_${String(level_number).padStart(3, "0")}.json`;
    }

    async function decode_image(file) {
        if ("createImageBitmap" in window) {
            return createImageBitmap(file);
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            const url = URL.createObjectURL(file);
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Could not decode ${file.name}.`));
            };
            image.src = url;
        });
    }

    async function pad_image_to_grid(file) {
        const image = await decode_image(file);
        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        if (!width || !height) {
            if (typeof image.close === "function") image.close();
            throw new Error(`${file.name} has no usable dimensions.`);
        }

        const maximum_dimension = Math.max(width, height);
        const scale = GRID_SIZE / maximum_dimension;
        const target_width = Math.max(1, Math.round(width * scale));
        const target_height = Math.max(1, Math.round(height * scale));
        const target_x = Math.floor((GRID_SIZE - target_width) * 0.5);
        const target_y = Math.floor((GRID_SIZE - target_height) * 0.5);
        const canvas = document.createElement("canvas");
        canvas.width = GRID_SIZE;
        canvas.height = GRID_SIZE;
        const context = canvas.getContext("2d", { alpha: true });
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
        context.drawImage(
            image,
            0,
            0,
            width,
            height,
            target_x,
            target_y,
            target_width,
            target_height
        );

        if (typeof image.close === "function") image.close();

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
                if (result) resolve(result);
                else reject(new Error(`Could not prepare ${file.name}.`));
            }, "image/png");
        });

        return new File([blob], file.name, {
            type: "image/png",
            lastModified: file.lastModified || Date.now()
        });
    }

    function download_blob(blob, file_name) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file_name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function write_text_file(directory_handle, file_name, text) {
        const file_handle = await directory_handle.getFileHandle(file_name, {
            create: true
        });
        const writable = await file_handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async function get_next_folder_number(directory_handle, requested_start) {
        let highest = 0;

        if (!directory_handle || typeof directory_handle.values !== "function") {
            return requested_start;
        }

        for await (const entry of directory_handle.values()) {
            if (entry.kind !== "file") continue;
            const match = /^level_(\d+)\.json$/i.exec(entry.name);
            if (match) highest = Math.max(highest, Number(match[1]));
        }

        return Math.max(requested_start, highest + 1);
    }

    function crc32_table() {
        const table = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = value & 1 ?
                    0xedb88320 ^ (value >>> 1) :
                    value >>> 1;
            }
            table[index] = value >>> 0;
        }
        return table;
    }

    const CRC_TABLE = crc32_table();

    function crc32(bytes) {
        let value = 0xffffffff;
        for (const byte of bytes) {
            value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
        }
        return (value ^ 0xffffffff) >>> 0;
    }

    function dos_timestamp(date = new Date()) {
        const year = Math.max(1980, date.getFullYear());
        return {
            time: (date.getHours() << 11) |
                (date.getMinutes() << 5) |
                Math.floor(date.getSeconds() / 2),
            date: ((year - 1980) << 9) |
                ((date.getMonth() + 1) << 5) |
                date.getDate()
        };
    }

    function write_u16(view, offset, value) {
        view.setUint16(offset, value, true);
    }

    function write_u32(view, offset, value) {
        view.setUint32(offset, value >>> 0, true);
    }

    function concatenate(chunks) {
        const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const output = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.length;
        }
        return output;
    }

    function create_zip(files) {
        const encoder = new TextEncoder();
        const local_chunks = [];
        const central_chunks = [];
        let local_offset = 0;
        const stamp = dos_timestamp();

        for (const file of files) {
            const name = encoder.encode(file.name);
            const data = typeof file.text === "string" ?
                encoder.encode(file.text) : file.data;
            const checksum = crc32(data);
            const local = new Uint8Array(30 + name.length);
            const local_view = new DataView(local.buffer);
            write_u32(local_view, 0, 0x04034b50);
            write_u16(local_view, 4, 20);
            write_u16(local_view, 6, 0x0800);
            write_u16(local_view, 8, 0);
            write_u16(local_view, 10, stamp.time);
            write_u16(local_view, 12, stamp.date);
            write_u32(local_view, 14, checksum);
            write_u32(local_view, 18, data.length);
            write_u32(local_view, 22, data.length);
            write_u16(local_view, 26, name.length);
            write_u16(local_view, 28, 0);
            local.set(name, 30);
            local_chunks.push(local, data);

            const central = new Uint8Array(46 + name.length);
            const central_view = new DataView(central.buffer);
            write_u32(central_view, 0, 0x02014b50);
            write_u16(central_view, 4, 20);
            write_u16(central_view, 6, 20);
            write_u16(central_view, 8, 0x0800);
            write_u16(central_view, 10, 0);
            write_u16(central_view, 12, stamp.time);
            write_u16(central_view, 14, stamp.date);
            write_u32(central_view, 16, checksum);
            write_u32(central_view, 20, data.length);
            write_u32(central_view, 24, data.length);
            write_u16(central_view, 28, name.length);
            write_u16(central_view, 30, 0);
            write_u16(central_view, 32, 0);
            write_u16(central_view, 34, 0);
            write_u16(central_view, 36, 0);
            write_u32(central_view, 38, 0);
            write_u32(central_view, 42, local_offset);
            central.set(name, 46);
            central_chunks.push(central);
            local_offset += local.length + data.length;
        }

        const central_data = concatenate(central_chunks);
        const end = new Uint8Array(22);
        const end_view = new DataView(end.buffer);
        write_u32(end_view, 0, 0x06054b50);
        write_u16(end_view, 4, 0);
        write_u16(end_view, 6, 0);
        write_u16(end_view, 8, files.length);
        write_u16(end_view, 10, files.length);
        write_u32(end_view, 12, central_data.length);
        write_u32(end_view, 16, local_offset);
        write_u16(end_view, 20, 0);
        return new Blob([...local_chunks, central_data, end], {
            type: "application/zip"
        });
    }

    function inject_styles() {
        const style = document.createElement("style");
        style.textContent = `
            .bulk_creator_row{display:grid;gap:.6rem}
            .bulk_creator_row button{width:100%}
            .bulk_progress{display:grid;gap:.35rem;margin-top:.55rem}
            .bulk_progress_track{height:.45rem;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden}
            .bulk_progress_track span{display:block;height:100%;transform-origin:left;transform:scaleX(0);background:#7ee3c5;transition:transform .18s ease}
            .bulk_progress_text{font-size:.78rem;opacity:.72}
            .export_destination_overlay{position:fixed;inset:0;z-index:2200;display:grid;place-items:center;padding:1rem;background:rgba(5,7,11,.84);backdrop-filter:blur(12px)}
            .export_destination_overlay.hidden{display:none}
            .export_destination_dialog{width:min(30rem,100%);background:#121720;color:#f5f7fb;border:1px solid rgba(255,255,255,.14);border-radius:1rem;padding:1.1rem;box-shadow:0 1.5rem 5rem rgba(0,0,0,.55)}
            .export_destination_dialog h2{margin:0 0 .45rem}.export_destination_dialog p{margin:.35rem 0;color:rgba(255,255,255,.68);line-height:1.45}
            .export_destination_actions{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
            .bulk_quantizing .quantization_overlay{visibility:hidden}
        `;
        document.head.append(style);
    }

    function create_destination_dialog() {
        const overlay = document.createElement("div");
        overlay.className = "export_destination_overlay hidden";
        overlay.setAttribute("aria-hidden", "true");
        const dialog = document.createElement("section");
        dialog.className = "export_destination_dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "export_destination_title");
        const title = document.createElement("h2");
        title.id = "export_destination_title";
        title.textContent = "Choose export folder";
        const description = document.createElement("p");
        const compatibility = document.createElement("p");
        const actions = document.createElement("div");
        actions.className = "export_destination_actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "secondary_button";
        cancel.textContent = "Cancel";
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "primary_button";
        actions.append(cancel, choose);
        dialog.append(title, description, compatibility, actions);
        overlay.append(dialog);
        document.body.append(overlay);
        return { overlay, description, compatibility, cancel, choose };
    }

    function choose_destination(dialog, bulk) {
        return new Promise((resolve) => {
            const supports_directory = typeof window.showDirectoryPicker === "function";
            dialog.description.textContent = bulk ?
                "Choose the campaign folder that should receive the sequential level JSON files." :
                "Choose the campaign folder that should receive this level JSON file.";
            dialog.compatibility.textContent = supports_directory ?
                "The selected folder is written directly. Existing files with the same number are replaced." :
                bulk ?
                    "Direct folder writing is unavailable in this browser. The levels will be exported as one ZIP archive instead." :
                    "Direct folder writing is unavailable in this browser. The browser download flow will be used instead.";
            dialog.choose.textContent = supports_directory ?
                "Choose folder" : bulk ? "Export ZIP" : "Download file";
            dialog.overlay.classList.remove("hidden");
            dialog.overlay.setAttribute("aria-hidden", "false");

            const finish = (value) => {
                dialog.overlay.classList.add("hidden");
                dialog.overlay.setAttribute("aria-hidden", "true");
                dialog.cancel.onclick = null;
                dialog.choose.onclick = null;
                resolve(value);
            };

            dialog.cancel.onclick = () => finish(null);
            dialog.choose.onclick = async () => {
                if (!supports_directory) {
                    finish({ type: "download" });
                    return;
                }
                try {
                    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
                    finish({ type: "directory", handle });
                } catch (error) {
                    if (error && error.name !== "AbortError") {
                        console.error("Folder selection failed.", error);
                    }
                }
            };
        });
    }

    async function wait_for_quantization_dialog(app) {
        const started = performance.now();
        while (!app.pending_quantization_resolve) {
            if (performance.now() - started > 15000) {
                throw new Error("Automatic quantisation did not start.");
            }
            await new Promise((resolve) => window.setTimeout(resolve, 10));
        }
    }

    async function install(app) {
        if (!app || app.__choobs_bulk_creator_installed) return;
        app.__choobs_bulk_creator_installed = true;
        inject_styles();

        const original_load_source_image = app.load_source_image.bind(app);
        const destination_dialog = create_destination_dialog();
        let bulk_cancel_requested = false;

        app.prepare_padded_image = pad_image_to_grid;
        app.load_source_image = async function (file) {
            const padded_file = await pad_image_to_grid(file);
            const applied = await original_load_source_image(padded_file);
            if (applied) {
                this.elements.source_name_text.textContent =
                    this.elements.source_name_text.textContent
                        .replace("cropped and quantised", "padded and quantised");
            }
            return applied;
        };

        const source_help = app.elements.image_input
            .closest(".panel_section")
            ?.querySelector(".field_help:last-child");
        if (source_help) {
            source_help.textContent =
                "Images are fitted inside a transparent square using letterboxing or pillarboxing, then reduced to 50 × 50 with nearest-neighbour sampling. No source pixels are cropped.";
        }
        const quantization_description = document.getElementById("quantization_description");
        if (quantization_description) {
            quantization_description.innerHTML =
                "<strong id=\"quantization_source_name\">Uploaded image</strong> has been fitted inside a transparent square and reduced to 50 × 50 without smoothing. Choose exact target colours; transparent padding remains empty.";
            app.elements.quantization_source_name =
                document.getElementById("quantization_source_name");
        }

        const bulk_section = document.createElement("div");
        bulk_section.className = "panel_section";
        const heading = document.createElement("h2");
        heading.textContent = "bulk campaign export";
        const help = document.createElement("p");
        help.className = "field_help";
        help.textContent =
            "Select multiple images. Each image is automatically padded, quantised, converted to pipework, named from its filename, numbered in sequence, and exported to one campaign folder.";
        const controls = document.createElement("div");
        controls.className = "bulk_creator_row";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = true;
        input.hidden = true;
        const choose_button = document.createElement("button");
        choose_button.type = "button";
        choose_button.className = "primary_button";
        choose_button.textContent = "bulk convert images";
        const cancel_button = document.createElement("button");
        cancel_button.type = "button";
        cancel_button.className = "secondary_button";
        cancel_button.textContent = "cancel bulk export";
        cancel_button.hidden = true;
        const progress = document.createElement("div");
        progress.className = "bulk_progress";
        progress.hidden = true;
        const progress_track = document.createElement("div");
        progress_track.className = "bulk_progress_track";
        const progress_fill = document.createElement("span");
        progress_track.append(progress_fill);
        const progress_text = document.createElement("div");
        progress_text.className = "bulk_progress_text";
        progress.append(progress_track, progress_text);
        controls.append(choose_button, cancel_button, input, progress);
        bulk_section.append(heading, help, controls);

        const level_file_section = app.elements.export_button.closest(".panel_section");
        level_file_section?.before(bulk_section);

        choose_button.addEventListener("click", () => input.click());
        cancel_button.addEventListener("click", () => {
            bulk_cancel_requested = true;
            cancel_button.disabled = true;
            progress_text.textContent = "Stopping after the current image…";
        });

        app.export_level = async function () {
            const level = this.sync_level_metadata();
            if (!level) {
                this.set_status("Generate or import a level before exporting.");
                return;
            }
            const destination = await choose_destination(destination_dialog, false);
            if (!destination) {
                this.set_status("Export cancelled.");
                return;
            }
            const file_name = level_file_name(level.number);
            const text = JSON.stringify(level, null, 2);
            if (destination.type === "directory") {
                await write_text_file(destination.handle, file_name, text);
                this.set_status(`Exported ${file_name} to ${destination.handle.name}.`);
            } else {
                download_blob(new Blob([text], { type: "application/json" }), file_name);
                this.set_status(`Exported ${file_name}.`);
            }
        };

        input.addEventListener("change", async () => {
            const files = Array.from(input.files || [])
                .filter((file) => file.type.startsWith("image/") || IMAGE_PATTERN.test(file.name));
            input.value = "";
            if (files.length === 0) return;

            const destination = await choose_destination(destination_dialog, true);
            if (!destination) {
                app.set_status("Bulk export cancelled.");
                return;
            }

            bulk_cancel_requested = false;
            choose_button.disabled = true;
            cancel_button.hidden = false;
            cancel_button.disabled = false;
            progress.hidden = false;
            document.body.classList.add("bulk_quantizing");
            const exported = [];
            let processed_count = 0;
            const requested_start = Math.max(
                1,
                Math.floor(Number(app.elements.level_number_input.value) || 1)
            );
            const start_number = destination.type === "directory" ?
                await get_next_folder_number(destination.handle, requested_start) :
                requested_start;
            const base_seed = Math.max(
                0,
                Math.floor(Number(app.elements.seed_input.value) || 1)
            );

            try {
                for (let index = 0; index < files.length; index += 1) {
                    if (bulk_cancel_requested) break;
                    const file = files[index];
                    const level_number = start_number + index;
                    const level_name = strip_extension(file.name);
                    progress_fill.style.transform = `scaleX(${index / files.length})`;
                    progress_text.textContent =
                        `${index + 1} of ${files.length}: ${file.name}`;
                    app.set_status(`Preparing ${file.name}…`);

                    const padded_file = await pad_image_to_grid(file);
                    const load_promise = original_load_source_image(padded_file);
                    await wait_for_quantization_dialog(app);
                    app.finish_quantization_dialog(true);
                    const applied = await load_promise;
                    if (!applied) throw new Error(`${file.name} was not applied.`);

                    app.elements.level_number_input.value = String(level_number);
                    app.elements.level_name_input.value = level_name;
                    app.elements.seed_input.value = String((base_seed + index) >>> 0);
                    app.current_level = null;
                    await app.generate_preview();
                    if (!app.current_level) {
                        throw new Error(`Pipe generation failed for ${file.name}.`);
                    }
                    const level = app.sync_level_metadata();
                    const file_name = level_file_name(level_number);
                    const text = JSON.stringify(level, null, 2);

                    if (destination.type === "directory") {
                        await write_text_file(destination.handle, file_name, text);
                    } else {
                        exported.push({ name: file_name, text });
                    }
                    processed_count += 1;
                }

                if (destination.type === "download" && exported.length > 0) {
                    const zip = create_zip(exported);
                    download_blob(zip, `choobs_campaign_${Date.now()}.zip`);
                }
                progress_fill.style.transform = "scaleX(1)";
                const completed = processed_count;
                app.set_status(
                    bulk_cancel_requested ?
                        `Bulk export stopped after ${completed} level${completed === 1 ? "" : "s"}.` :
                        `Bulk exported ${completed} sequential level${completed === 1 ? "" : "s"}.`
                );
                progress_text.textContent = app.elements.editor_status.textContent;
            } catch (error) {
                console.error(error);
                app.set_status(`Bulk export failed: ${error.message}`);
                progress_text.textContent = app.elements.editor_status.textContent;
            } finally {
                document.body.classList.remove("bulk_quantizing");
                choose_button.disabled = false;
                cancel_button.hidden = true;
                cancel_button.disabled = false;
            }
        });
    }

    wait_for_app().then(install).catch((error) => {
        console.error("Bulk creator tools failed to initialize.", error);
    });
})();
