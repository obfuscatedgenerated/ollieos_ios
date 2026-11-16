import type {Program} from "ollieos/src/types";
import type {UserspaceFileSystem} from "ollieos/src/kernel/filesystem";
import type {Remote} from "ollieos/src/kernel/rpc";
import {ANSI} from "ollieos/src/lib/ansi";
import {base64_to_bytes, call_privileged_capability, privileged_capability_kernel_funcs, write_error} from "./platform_helpers";

interface PickedFile {
    name: string;
    data_base64: string;
}

interface PhotoResult {
    cancelled: boolean;
    name?: string;
    data_base64?: string;
}

// avoids overwriting: photo.jpg -> photo (1).jpg -> photo (2).jpg
const find_free_path = async (fs: Remote<UserspaceFileSystem>, directory: string, file_name: string): Promise<string> => {
    const extension_index = file_name.lastIndexOf(".");
    const base_name = extension_index > 0 ? file_name.slice(0, extension_index) : file_name;
    const extension = extension_index > 0 ? file_name.slice(extension_index) : "";

    let candidate = fs.absolute(`${directory}/${file_name}`);
    for (let copy_number = 1; await fs.exists(candidate); copy_number++) {
        candidate = fs.absolute(`${directory}/${base_name} (${copy_number})${extension}`);
    }
    return candidate;
};

export default {
    name: "pick",
    description: "Imports files from the Files app, or a photo, into OllieOS.",
    usage_suffix: "[-p] [-m] [directory]",
    arg_descriptions: {
        "Flags:": {
            "-p": "Pick a photo instead of a file.",
            "-m": "Allow picking multiple files."
        },
        "Arguments:": {
            "directory": "Where to save the imported files. Defaults to the current directory."
        }
    },
    compat: "3.0.0",
    completion: async () => [],
    main: async (data) => {
        const {kernel, term, args} = data;
        const {PREFABS, STYLE} = ANSI;

        const remaining_args = [...args];
        let pick_photo = false;
        let multiple = false;

        while (remaining_args[0] === "-p" || remaining_args[0] === "-m") {
            if (remaining_args.shift() === "-p") {
                pick_photo = true;
            } else {
                multiple = true;
            }
        }

        const fs = kernel.get_fs();
        const directory = fs.absolute(remaining_args[0] ?? ".");
        if (!(await fs.dir_exists(directory))) {
            write_error(term, `No such directory: ${remaining_args[0]}`);
            return 1;
        }

        const capability_name = pick_photo ? "pick_photo" : "pick_file";
        const privilege_reason = pick_photo ? "Import a photo" : "Import files from the Files app";

        let picked_files: PickedFile[];
        if (pick_photo) {
            const photo = await call_privileged_capability<PhotoResult>(kernel, term, "pick_photo", privilege_reason);
            if (!photo) {
                return 1;
            }
            picked_files = photo.cancelled || photo.name === undefined || photo.data_base64 === undefined ? [] : [{name: photo.name, data_base64: photo.data_base64}];
        } else {
            const result = await call_privileged_capability<{ files: PickedFile[] }>(kernel, term, "pick_file", privilege_reason, {multiple});
            if (!result) {
                return 1;
            }
            picked_files = result.files;
        }

        if (picked_files.length === 0) {
            term.writeln("Nothing picked.");
            return 1;
        }

        for (const picked_file of picked_files) {
            const destination = await find_free_path(fs, directory, picked_file.name);
            await fs.write_file(destination, base64_to_bytes(picked_file.data_base64));
            term.writeln(`Saved ${PREFABS.file_path}${destination}${STYLE.reset_all}`);
        }

        return 0;
    }
} as Program<{kernel_funcs: typeof kernel_funcs}>;

export const kernel_funcs = privileged_capability_kernel_funcs(["pick_photo", "pick_file"]);
