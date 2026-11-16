import type {Program} from "ollieos/src/types";
import {call_privileged_capability, privileged_capability_kernel_funcs} from "./platform_helpers";

interface ScanResult {
    cancelled: boolean;
    text?: string;
    type?: string | null;
}

export default {
    name: "scan",
    description: "Scans a QR code or barcode with the camera and prints its contents.",
    usage_suffix: "",
    arg_descriptions: {},
    compat: "3.0.0",
    completion: async () => [],
    main: async (data) => {
        const {kernel, term} = data;

        const privilege_reason = "Use the camera to scan a code";

        const result = await call_privileged_capability<ScanResult>(kernel, term, "scan_code", privilege_reason);
        if (!result) {
            return 1;
        }

        if (result.cancelled) {
            term.writeln("Scan cancelled.");
            return 1;
        }

        term.writeln(result.text ?? "");
        return 0;
    }
} as Program<{kernel_funcs: typeof kernel_funcs}>;

export const kernel_funcs = privileged_capability_kernel_funcs(["scan_code"]);
