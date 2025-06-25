// src/utils/DebugAdapterMessenger.ts

import * as vscode from 'vscode';

/**
 * A utility class to send custom commands to an active debug session
 * using the Debug Adapter Protocol (DAP).
 */
export class DebugAdapterMessenger {
    /**
     * Sends a custom 'runJestTests' command to the specified debug session.
     * This is the handshake signal that tells our bootstrap.js script to proceed.
     *
     * @param session The active VS Code debug session to send the command to.
     * @returns A promise that resolves when the command has been sent.
     */
    public static async sendRunCommand(session: vscode.DebugSession): Promise<void> {
        try {
            console.log(`Sending custom 'runJestTests' request to session ${session.id}`);
            await session.customRequest('runJestTests');
        } catch (error) {
            console.error('Failed to send custom DAP request "runJestTests":', error);
            vscode.window.showErrorMessage('Failed to send start signal to Jest debugger.');
        }
    }
}
