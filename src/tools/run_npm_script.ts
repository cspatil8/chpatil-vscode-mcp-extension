import * as vscode from 'vscode';
import { runCmdInTerminal, WaitOptions } from '../utils/ptyHelper';

/**
 * Executes a specified command string in a VS Code terminal and captures the output.
 *
 * @param command The command string to execute (e.g., "npm run build", "echo hello").
 * @param terminalName Optional name for the terminal window.
 * @param waitOptions Optional wait conditions for command completion.
 * @returns A promise that resolves with the command output and execution status.
 */
export const executeCommandInTerminal = async (
    command: string,
    terminalName: string = 'MCP Command Runner',
    waitOptions?: WaitOptions,
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
    if (!command) {
        return { content: [{ type: 'text', text: 'Error: No command provided.' }], isError: true };
    }

    try {
        // Parse the command string into command and arguments
        const parts = command.split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);

        // Get the current workspace folder as working directory
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath;

        // Execute the command using runCmdInTerminal
        const result = await runCmdInTerminal(cmd, args, cwd, waitOptions, terminalName);

        // Check if the command failed based on exit code
        const isError = result.exit !== null && result.exit !== 0;

        return {
            content: [
                {
                    type: 'text',
                    text:
                        result.output || `Command "${command}" completed ${isError ? 'with errors' : 'successfully'}.`,
                },
            ],
            isError,
        };
    } catch (error: any) {
        console.error(`Error executing command "${command}" in terminal:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Handle timeout specifically
        const isTimeout = errorMessage.includes('timeout');
        const message = isTimeout
            ? `Command "${command}" timed out.`
            : `Failed to execute command "${command}": ${errorMessage}`;

        return {
            content: [{ type: 'text', text: message }],
            isError: true,
        };
    }
};
