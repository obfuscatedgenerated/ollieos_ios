import type {Program} from "ollieos/src/types";
import {call_privileged_capability, privileged_capability_kernel_funcs, write_error} from "./platform_helpers";

const ACTIONS = ["get", "set", "delete"];

export default {
    name: "keychain",
    description: "Stores secrets in the iOS keychain.",
    usage_suffix: "get key | set key value | delete key",
    arg_descriptions: {
        "Arguments:": {
            "get": "Print the value stored for a key.",
            "set": "Store a value for a key, replacing any existing one.",
            "delete": "Remove a key."
        }
    },
    compat: "3.0.0",
    completion: async () => ACTIONS,
    main: async (data) => {
        const {kernel, term, args} = data;

        const [action, key, ...value_parts] = args;
        if (!ACTIONS.includes(action) || !key || (action === "set" && value_parts.length === 0)) {
            write_error(term, "Usage: keychain get key | set key value | delete key");
            return 1;
        }

        const capability_name = `keychain_${action}`;
        const privilege_reason = `Access the keychain (${action} "${key}")`;

        if (action === "get") {
            const result = await call_privileged_capability<{ value: string | null }>(kernel, term, capability_name, privilege_reason, {key});
            if (!result) {
                return 1;
            }
            if (result.value === null) {
                write_error(term, `No value stored for "${key}".`);
                return 1;
            }
            term.writeln(result.value);
            return 0;
        }

        if (action === "set") {
            return await call_privileged_capability(kernel, term, capability_name, privilege_reason, {key, value: value_parts.join(" ")}) ? 0 : 1;
        }

        const result = await call_privileged_capability<{ deleted: boolean }>(kernel, term, capability_name, privilege_reason, {key});
        if (!result) {
            return 1;
        }
        if (!result.deleted) {
            write_error(term, `No value stored for "${key}".`);
            return 1;
        }
        return 0;
    }
} as Program<{kernel_funcs: typeof kernel_funcs}>;

export const kernel_funcs = privileged_capability_kernel_funcs(["keychain_get", "keychain_set", "keychain_delete"]);
