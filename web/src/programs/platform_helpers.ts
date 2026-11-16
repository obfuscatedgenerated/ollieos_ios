import type {UserspaceKernel} from "ollieos/src/kernel";
import type {UserspacePlatformAPI} from "ollieos/src/kernel/platform";
import type {UserspaceTerminal} from "ollieos/src/kernel/term_ctl";
import type {Remote} from "ollieos/src/kernel/rpc";
import type {KernelFuncData} from "ollieos/src/types";
import {ANSI} from "ollieos/src/lib/ansi";

interface PrivilegedCapabilityCall {
    capability_name: string;
    args?: unknown;
}

export const write_error = (term: Remote<UserspaceTerminal>, message: string): void => {
    term.writeln(`${ANSI.PREFABS.error}${message}${ANSI.STYLE.reset_all}`);
};

export const describe_error = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

/**
 * Gets the userspace platform API if it supports the capability, otherwise explains why not.
 */
export const require_capability = (kernel: Remote<UserspaceKernel>, term: Remote<UserspaceTerminal>, capability_name: string): Remote<UserspacePlatformAPI> | null => {
    const platform = kernel.get_platform();
    if (!platform?.supports(capability_name)) {
        write_error(term, `This needs the "${capability_name}" platform capability, which isn't available here.`);
        return null;
    }

    return platform;
};

/**
 * Calls a privileged capability through the program's own kernel func (see {@link privileged_capability_kernel_funcs}), which asks the user first.
 * Writes any error or refusal to the terminal.
 * @returns The result, or null if the capability isn't available, the request was refused or the call failed.
 */
export const call_privileged_capability = async <Result>(kernel: Remote<UserspaceKernel>, term: Remote<UserspaceTerminal>, capability_name: string, reason: string, args?: unknown): Promise<Result | null> => {
    if (!kernel.get_platform()?.supports(capability_name)) {
        write_error(term, `This needs the "${capability_name}" platform capability, which isn't available here.`);
        return null;
    }

    try {
        const call: PrivilegedCapabilityCall = {capability_name, args};
        return await kernel.request_kernel_func("call_privileged_capability", reason, call) as Result;
    } catch (error) {
        write_error(term, (error as Error).name === "NotAllowedError" ? "Privilege request denied." : describe_error(error));
        return null;
    }
};

/**
 * The kernel funcs a program needs to call privileged capabilities. Export the result as the program's kernel_funcs.
 * @param allowed_capabilities The only capabilities a granted request can call, so it can't be used for anything else.
 */
export const privileged_capability_kernel_funcs = (allowed_capabilities: readonly string[]) => ({
    call_privileged_capability: async ({kernel}: KernelFuncData, input: PrivilegedCapabilityCall): Promise<unknown> => {
        // input comes from userspace, so nothing about it is assumed
        if (typeof input?.capability_name !== "string" || !allowed_capabilities.includes(input.capability_name)) {
            throw new Error("This program can't call that platform capability.");
        }

        const platform = kernel.get_platform();
        if (!platform) {
            throw new Error("No platform API is available.");
        }

        return await platform.call(input.capability_name, input.args);
    },
});

/**
 * Calls a capability, writing any error to the terminal.
 * @returns The result, or null if the call failed.
 */
export const call_capability = async <Result>(platform: Remote<UserspacePlatformAPI>, term: Remote<UserspaceTerminal>, capability_name: string, args?: unknown): Promise<Result | null> => {
    try {
        return await platform.call(capability_name, args) as Result;
    } catch (error) {
        write_error(term, describe_error(error));
        return null;
    }
};

export const bytes_to_base64 = (bytes: Uint8Array): string => {
    // chunked so large files don't overflow the argument limit of String.fromCharCode
    const chunk_size = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunk_size) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk_size));
    }
    return btoa(binary);
};

export const base64_to_bytes = (base64: string): Uint8Array => {
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
};

export const file_name_from_path = (file_path: string): string => {
    return file_path.split("/").filter(part => part.length > 0).pop() ?? "file";
};
