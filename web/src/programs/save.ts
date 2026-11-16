import type {Program} from "ollieos/src/types";
import {bytes_to_base64, call_privileged_capability, file_name_from_path, privileged_capability_kernel_funcs, write_error} from "./platform_helpers";

export default {
    name: "save",
    description: "Saves a file from OllieOS to the Files app.",
    usage_suffix: "file",
    arg_descriptions: {
        "Arguments:": {
            "file": "The file to save."
        }
    },
    compat: "3.0.0",
    completion: async () => [],
    main: async (data) => {
        const {kernel, term, args} = data;

        if (args.length !== 1) {
            write_error(term, "Give exactly one file.");
            return 1;
        }

        const fs = kernel.get_fs();
        const file_path = fs.absolute(args[0]);
        if (!(await fs.exists(file_path))) {
            write_error(term, `No such file: ${args[0]}`);
            return 1;
        }

        const privilege_reason = "Save a file to the Files app";

        const file_bytes = await fs.read_file(file_path, true) as Uint8Array;
        const result = await call_privileged_capability<{ exported: boolean }>(kernel, term, "export_file", privilege_reason, {
            name: file_name_from_path(file_path),
            data_base64: bytes_to_base64(file_bytes),
        });
        if (!result) {
            return 1;
        }

        term.writeln(result.exported ? "Saved." : "Save cancelled.");
        return result.exported ? 0 : 1;
    }
} as Program<{kernel_funcs: typeof kernel_funcs}>;

export const kernel_funcs = privileged_capability_kernel_funcs(["export_file"]);
