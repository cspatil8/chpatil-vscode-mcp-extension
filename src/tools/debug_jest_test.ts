import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
        // Validate the test file path
        if (!testFilePath) {
            return {
                content: [{ type: 'text', text: 'Error: Test file path is required.' }],
                isError: true,
            };
        }

        // Find the workspace folder for the test file
        const fileUri = vscode.Uri.file(testFilePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);

        if (!workspaceFolder) {
            return {
                content: [{ type: 'text', text: `Error: Could not find workspace folder for file: ${testFilePath}` }],
                isError: true,
            };
        }

        // Resolve Jest binary by walking up from the test file directory
        const located = findNearestJestBin(path.dirname(testFilePath));

        if (!located) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Could not find Jest. Install it with "npm i -D jest" in your project or ensure Jest is installed in any parent directory.',
                    },
                ],
                isError: true,
            };
        }

        const { bin: jestJs, root: projectRoot } = located;

        // Convert test file path to relative POSIX format for Jest
        const relTestPath = toPosix(path.relative(projectRoot, testFilePath));

        // Build CLI args exactly like the original extension
        const args = [
            '--runTestsByPath', // tell Jest: "this is a path, not a pattern"
            relTestPath,
            '--runInBand', // single process for easy debugging
            '--no-coverage', // faster
        ];

        if (testNamePattern) {
            args.push('--testNamePattern', testNamePattern);
        }

        // Create the debug configuration
        const debugConfig: vscode.DebugConfiguration = {
            type: 'node', // VS Code will insert --inspect etc. for us
            request: 'launch',
            name: `Debug Jest Test${testNamePattern ? ` (${testNamePattern})` : ''}`,
            program: jestJs, // **MUST be a JS file, not cmd.exe**
            args,
            cwd: projectRoot, // Use the project root (directory containing node_modules), NOT bin folder
            console: 'integratedTerminal',
            internalConsoleOptions: 'neverOpen',
            skipFiles: ['<node_internals>/**', '**/node_modules/**'],
        };

        // Start the debug session
        const debugStarted = await vscode.debug.startDebugging(workspaceFolder, debugConfig);

        if (debugStarted) {
            const message = `Started debugging Jest test${
                testNamePattern ? ` with pattern "${testNamePattern}"` : ''
            } in file: ${path.basename(testFilePath)}`;
            return {
                content: [{ type: 'text', text: message }],
                isError: false,
            };
        } else {
            return {
                content: [{ type: 'text', text: 'Could not start Jest debug session.' }],
                isError: true,
            };
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
