import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { executeCommandInPty } from './run_cmd_pty'; // Added import

/**
 * Debugs a specific Jest test using VS Code's built-in debugger.
 *
 * @param testFilePath The absolute path to the test file
 * @param testNamePattern Optional pattern to match specific test names. If not provided, runs all tests in the file.
 * @returns A promise that resolves with the result of the debug session start
 */
export const debugJestTest = async (
    testFilePath: string,
    testNamePattern?: string,
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
    try {
        // --- All of your existing validation and path-finding logic remains exactly the same ---
        if (!testFilePath) {
            return { content: [{ type: 'text', text: 'Error: Test file path is required.' }], isError: true };
        }

        // Find the workspace folder for the test file
        const fileUri = vscode.Uri.file(testFilePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);

        if (!workspaceFolder) {
            return { content: [{ type: 'text', text: `Error: Could not find workspace folder for file: ${testFilePath}` }], isError: true };
        }
        const located = findNearestJestBin(path.dirname(testFilePath));

        if (!located) {
            // Using the slightly shorter error message from the coworker's snippet
            return { content: [{ type: 'text', text: 'Could not find Jest. Install it with "npm i -D jest"' }], isError: true };
        }

        const { bin: jestJs, root: projectRoot } = located;
        // --- End of unchanged logic ---

        // --- START OF MODIFIED LOGIC ---

        const port = 9229; // Standard debug port
        // 1. PREPARE THE ARGUMENTS FOR DIRECT EXECUTION
        const args = [
            `--inspect-brk=${port}`, // Start debugger server and wait for attach
            jestJs,                 // The path to Jest's own JS file
            '--runTestsByPath',
            toPosix(path.relative(projectRoot, testFilePath)),
            '--runInBand',
            '--no-coverage',
        ];
        if (testNamePattern) {
            args.push('--testNamePattern', testNamePattern);
        }

        // 2. CREATE A PROMISE THAT RESOLVES WHEN THE DEBUGGER IS READY
        const attachPromise = new Promise<void>(resolve => {
            // 3. CALL executeCommandInPty TO LAUNCH THE PROCESS
            // We don't need to 'await' this call; it runs in the background.
            // Its purpose is to start the process in the terminal.
            executeCommandInPty({
                terminalName: `Debug: ${path.basename(testFilePath)}`,
                program: 'node', // We are executing 'node' directly
                args: args,
                cwd: projectRoot,
                interceptPattern: /Debugger listening on ws:\/\//, // The message to watch for
                onIntercept: () => resolve(), // When we see the message, resolve the promise
            });
        });

        // 4. WAIT FOR THE "Debugger listening..." MESSAGE
        await attachPromise; // Potential to hang if onIntercept is never called

        // 5. ATTACH THE VS CODE DEBUGGER
        const debugConfig: vscode.DebugConfiguration = {
            type: 'node',
            request: 'attach', // The crucial change from 'launch'
            name: `Attach to Jest Test${testNamePattern ? ` (${testNamePattern})` : ''}`, // Name from coworker's suggestion
            port: port,        // Connect to the port we specified
            cwd: projectRoot,
            skipFiles: ['<node_internals>/**', '**/node_modules/**'],
        };

        // Start the debug session
        const debugStarted = await vscode.debug.startDebugging(workspaceFolder, debugConfig);

        // --- END OF MODIFIED LOGIC ---

        if (debugStarted) {
            const message = `Debugger attached to Jest test${testNamePattern ? ` with pattern "${testNamePattern}"` : ''} in file: ${path.basename(testFilePath)}`;
            return { content: [{ type: 'text', text: message }], isError: false };
        } else {
            return { content: [{ type: 'text', text: 'Could not attach Jest debug session.' }], isError: true };
        }
    } catch (error: any) {
        console.error('Error debugging Jest test:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `Failed to debug Jest test: ${errorMessage}` }],
            isError: true,
        };
    }
};

/** Walks up from `startDir` until it finds node_modules/jest/bin/jest.js */
function findNearestJestBin(startDir: string): { bin: string; root: string } | undefined {
    let dir = startDir;

    while (true) {
        const bin = path.join(dir, 'node_modules', 'jest', 'bin', 'jest.js');
        if (fs.existsSync(bin)) {
            return { bin, root: dir }; // ✅ found it - keep both bin path and root
        }

        const parent = path.dirname(dir);
        if (parent === dir) break; // Reached filesystem root
        dir = parent;
    }
    return undefined; // ❌ not found
}

// 1️⃣ utility – POSIX path from Windows path
function toPosix(p: string) {
    return p.split(path.sep).join('/');
}
