import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCmdInTerminal, WaitOptions } from '../utils/ptyHelper';

/**
 * Runs a specific Jest test and captures the output, or debugs it using VS Code's built-in debugger.
 *
 * @param testFilePath The absolute path to the test file
 * @param testNamePattern Optional pattern to match specific test names. If not provided, runs all tests in the file.
 * @param useDebugger Optional flag to use VS Code debugger instead of capturing output (defaults to false)
 * @returns A promise that resolves with the Jest test output or debug session result
 */
export const debugJestTest = async (
    testFilePath: string,
    testNamePattern?: string,
    useDebugger: boolean = false,
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

        // Build CLI args
        const args = [
            '--runTestsByPath', // tell Jest: "this is a path, not a pattern"
            relTestPath,
            '--runInBand', // single process for easy debugging
            '--no-coverage', // faster
            '--verbose', // More detailed output for better parsing
        ];

        if (testNamePattern) {
            args.push('--testNamePattern', testNamePattern);
        }

        // If debugger mode is requested, use the original debug approach
        if (useDebugger) {
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
        }

        // Use runCmdInTerminal to capture Jest output
        const terminalName = `Jest Test: ${path.basename(testFilePath)}`;

        // Set up wait options to detect Jest completion
        const waitOptions: WaitOptions = {
            // Jest typically ends with summary lines like "Tests: 1 passed" or "FAIL"
            until: /(?:Tests:\s+\d+.*?(?:passed|failed)|Test Suites:\s+\d+.*?(?:passed|failed)|FAIL|PASS.*?(?:\d+\.\d+s|\d+ms))/,
            timeoutMs: 3000000, // 30 second timeout
        };

        // Use Node.js to run Jest (since jestJs is a .js file)
        const result = await runCmdInTerminal('node', [jestJs, ...args], projectRoot, waitOptions, terminalName);

        // Determine if there were test failures
        const hasFailures =
            result.output.includes('FAIL') ||
            result.output.includes('failed') ||
            (result.exit !== null && result.exit !== 0);

        return {
            content: [
                {
                    type: 'text',
                    text: result.output || `Jest test completed for ${path.basename(testFilePath)}`,
                },
            ],
            isError: hasFailures,
        };
    } catch (error: any) {
        console.error('Error running Jest test:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Handle timeout specifically
        const isTimeout = errorMessage.includes('timeout');
        const message = isTimeout
            ? `Jest test timed out for file: ${path.basename(testFilePath)}`
            : `Failed to run Jest test: ${errorMessage}`;

        return {
            content: [{ type: 'text', text: message }],
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
