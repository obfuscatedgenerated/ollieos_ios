import type {Program} from "ollieos/src/types";
import {call_capability, call_privileged_capability, privileged_capability_kernel_funcs, require_capability} from "./platform_helpers";

export default {
    name: "clip",
    description: "Reads or writes the clipboard.",
    usage_suffix: "[text]",
    arg_descriptions: {
        "Arguments:": {
            "text": "Text to copy. If omitted, the clipboard is printed (needs privileges)."
        }
    },
    compat: "3.0.0",
    completion: async () => [],
    main: async (data) => {
        const {kernel, term, args} = data;

        if (args.length > 0) {
            const platform = require_capability(kernel, term, "clipboard_write");
            if (!platform) {
                return 1;
            }

            return await call_capability(platform, term, "clipboard_write", {text: args.join(" ")}) ? 0 : 1;
        }

        const privilege_reason = "Read the clipboard";

        const clipboard = await call_privileged_capability<{ text: string | null }>(kernel, term, "clipboard_read", privilege_reason);
        if (!clipboard) {
            return 1;
        }

        if (clipboard.text !== null) {
            term.writeln(clipboard.text);
        }
        return 0;
    }
} as Program<{kernel_funcs: typeof kernel_funcs}>;

export const kernel_funcs = privileged_capability_kernel_funcs(["clipboard_read"]);
