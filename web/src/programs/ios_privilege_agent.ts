import type {Program} from "ollieos/src/types";
import type {PrivilegeAgentRequest} from "ollieos/src/kernel";
import type {UserspaceOtherProcessContext} from "ollieos/src/kernel/processes";
import type {UserspaceTerminal} from "ollieos/src/kernel/term_ctl";
import type {UserspacePlatformAPI} from "ollieos/src/kernel/platform";
import type {Remote} from "ollieos/src/kernel/rpc";
import {ANSI, NEWLINE} from "ollieos/src/lib/ansi";
import {REQUEST_STYLES, type RequestStyle} from "ollieos/src/programs/core/default_privilege_agent";
import {describe_error} from "./platform_helpers";

export const IOS_PRIVILEGE_AGENT_NAME = "ios_privilege_agent";

interface AuthenticationResult {
    success: boolean;
    error: string | null;
}

// same prompt as the default agent, used when face id / passcode isn't available
const ask_with_keypress = async (term: Remote<UserspaceTerminal>, style: RequestStyle, pid: number): Promise<boolean> => {
    term.writeln(`${NEWLINE}${style.question} PID ${pid}? (y/n)${ANSI.STYLE.reset_all}${ANSI.CURSOR.invisible}`);
    const event = await term.wait_for_keypress();
    term.write(ANSI.CURSOR.visible);
    return event.key.toLowerCase() === "y";
};

const ask_with_authentication = async (platform: Remote<UserspacePlatformAPI>, term: Remote<UserspaceTerminal>, style: RequestStyle, process: Remote<UserspaceOtherProcessContext>, reason: string): Promise<boolean> => {
    term.writeln(`${NEWLINE}Confirm with Face ID, Touch ID or your passcode to allow this for PID ${process.pid}.${ANSI.STYLE.reset_all}`);

    try {
        // the system sheet shows this, so it names the kind of request as well as the reason
        const result = await platform.call("authenticate", {
            reason: `${process.source_command.command} (PID ${process.pid}) ${style.asking} ${reason}`,
        }) as AuthenticationResult;

        if (!result.success && result.error) {
            term.writeln(`${ANSI.FG.gray}${result.error}${ANSI.STYLE.reset_all}`);
        }
        return result.success;
    } catch (error) {
        term.writeln(`${ANSI.FG.gray}${describe_error(error)}${ANSI.STYLE.reset_all}`);
        return false;
    }
};

export default {
    name: IOS_PRIVILEGE_AGENT_NAME,
    description: "Privilege agent that asks for Face ID, Touch ID or the passcode",
    usage_suffix: "",
    arg_descriptions: {},
    hide_from_help: true,
    compat: "3.0.0",
    main: async (data) => {
        const {kernel, term, args, process: agent_process} = data;

        const channel_id = parseInt(args[0], 10);
        if (isNaN(channel_id)) {
            term.writeln("Error in privilege agent: Invalid or missing channel ID.");
            return 1;
        }

        const ipc = kernel.get_ipc();
        const platform = kernel.get_platform();
        const can_authenticate = platform?.supports("authenticate") ?? false;

        let finished = false;
        let handling_request = false;
        let listening = false;
        let retries = 0;

        // retry until we can listen to the channel (may be some delay between process start and channel assignment)
        while (!listening && retries < 20) {
            listening = await ipc.channel_listen(channel_id, async (msg) => {
                if (handling_request) {
                    return;
                }
                handling_request = true;

                const {process, reason, kind} = msg.data as Remote<PrivilegeAgentRequest>;

                // agents predate kinds, so anything unknown is treated as the most serious
                const style = REQUEST_STYLES[kind] ?? REQUEST_STYLES.kernel;

                // immediately acknowledge the request is being handled
                ipc.channel_send(channel_id, {
                    process,
                    handling: true
                });

                term.writeln(`${NEWLINE}${ANSI.STYLE.bold}${style.background}${ANSI.FG.white}${style.title}${ANSI.STYLE.reset_all}${ANSI.BG.gray}${NEWLINE}`);
                term.writeln(`Process PID ${process.pid} (${process.source_command.command}) ${style.asking}`);

                if (style.reason_from_program) {
                    term.writeln(`The process gave the following reason for the request:${NEWLINE}`);
                    term.writeln(`${ANSI.STYLE.bold}${ANSI.FG.yellow}"${reason}"${ANSI.FG.reset}${ANSI.STYLE.no_bold_or_dim}${NEWLINE}`);
                } else {
                    term.writeln(`${NEWLINE}${ANSI.STYLE.bold}${ANSI.FG.yellow}${reason}${ANSI.FG.reset}${ANSI.STYLE.no_bold_or_dim}${NEWLINE}`);
                }

                term.writeln(style.consequence);

                const granted = can_authenticate && platform
                    ? await ask_with_authentication(platform, term, style, process, reason)
                    : await ask_with_keypress(term, style, process.pid);

                if (granted) {
                    term.writeln(`${NEWLINE}${ANSI.BG.green}${ANSI.FG.white}Request granted.${ANSI.STYLE.reset_all}${NEWLINE}`);
                } else {
                    term.writeln(`${NEWLINE}${ANSI.BG.red}${ANSI.FG.white}Request denied.${ANSI.STYLE.reset_all}${NEWLINE}`);
                }

                ipc.channel_send(channel_id, {
                    process,
                    granted
                });

                // the kernel kills the agent when ready, rather than exiting possibly early (race condition)
            });

            if (!listening) {
                await new Promise(resolve => setTimeout(resolve, 50));
                retries++;
            }
        }

        if (!listening) {
            term.writeln("Error in privilege agent: Failed to listen to channel after multiple attempts.");
            return 1;
        }

        agent_process.add_exit_listener(() => {
            finished = true;
        });

        // wait to handle for up to 10 seconds, overall timeout up to 60 seconds (matches the kernel's wait)
        const start_time = Date.now();
        while ((Date.now() - start_time) < 60000 && !finished && (handling_request || (Date.now() - start_time) < 10000)) {
            const timeout_id = agent_process.create_timeout(() => {}, 100);
            await agent_process.wait_for_timeout(timeout_id);
        }

        return 0;
    }
} as Program;
