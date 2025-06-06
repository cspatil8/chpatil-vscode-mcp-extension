import * as vscode from 'vscode';

/**
 * Executes a specified command string in a new VS Code terminal.
 *
 * @param command The command string to execute (e.g., "npm run build", "echo hello").
 * @param terminalName Optional name for the terminal window.
 * @returns A promise that resolves when the command has been sent to the terminal.
 */
export const executeCommandInTerminal = async (
    command: string,
    terminalName: string = 'MCP Command Runner',
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
    if (!command) {
        return { content: [{ type: 'text', text: 'Error: No command provided.' }], isError: true };
    }

    try {
        // Find existing terminal or create a new one
        let terminal = vscode.window.terminals.find((t) => t.name === terminalName);
        if (!terminal) {
            terminal = vscode.window.createTerminal(terminalName);
        }

        // Send the command text to the terminal
        // The second argument `true` adds a newline to execute the command immediately
        terminal.sendText(command, true);

        // Bring the terminal into view
        terminal.show();

        // Return success indication that the command was sent
        return {
            content: [{ type: 'text', text: `Command "${command}" sent to terminal '${terminalName}'.` }],
            isError: false,
        };
    } catch (error: any) {
        console.error(`Error executing command "${command}" in terminal:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `Failed to send command "${command}" to terminal: ${errorMessage}` }],
            isError: true,
        };
    }
};
