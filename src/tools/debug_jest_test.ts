import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { executeCommandInPty } from './run_cmd_pty'; // Added import

/**
 * Debugs a specific Jest test using VS Code's built-in debugger.
 *
 * @param testFilePath The absolute path to the test file
 * @param testNamePattern Optional pattern to match specific test names. If not provided, runs all tests in the file.
 * @param breakpointId Optional breakpoint ID to wait for. If provided, the function will wait until this breakpoint is hit or timeout occurs.
 * @returns A promise that resolves with the result of the debug session start
 */
export const debugJestTest = async (
    testFilePath: string,
    testNamePattern?: string,
    breakpointId?: string,
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
            stopOnEntry: false, // Don't stop on entry, only at breakpoints
        };

        // Wait for debug session events
        const debugSessionPromise = new Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }>((resolve) => {
            let terminateDisposable: vscode.Disposable;

            const startDisposable = vscode.debug.onDidStartDebugSession((session) => {
                console.log(`[debugJestTest] Debug session started: ${session.name}, breakpointId: ${breakpointId}`);

                // If we have a breakpoint ID to wait for, set up the waiting logic
                if (breakpointId) {
                    console.log(`[debugJestTest] Setting up breakpoint waiting for ID: ${breakpointId}`);
                    startDisposable.dispose();

                    // Set up breakpoint hit detection and timeout
                    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
                    let timeoutHandle: NodeJS.Timeout;
                    let stopDisposable: vscode.Disposable;
                    let changeDisposable: vscode.Disposable;
                    let customEventDisposable: vscode.Disposable;

                    const cleanup = () => {
                        console.log(`[debugJestTest] Cleaning up listeners for breakpoint ${breakpointId}`);
                        if (timeoutHandle) clearTimeout(timeoutHandle);
                        if (stopDisposable) stopDisposable.dispose();
                        if (changeDisposable) changeDisposable.dispose();
                        if (customEventDisposable) customEventDisposable.dispose();
                        if (terminateDisposable) terminateDisposable.dispose();
                    };

                    // Set up timeout
                    timeoutHandle = setTimeout(() => {
                        console.log(`[debugJestTest] Timeout reached for breakpoint ${breakpointId}`);
                        cleanup();
                        resolve({
                            content: [{
                                type: 'text',
                                text: `Timeout: Breakpoint ${breakpointId} was not hit within 5 minutes. Debug session is still active.`
                            }],
                            isError: false
                        });
                    }, TIMEOUT_MS);

                    // Listen for debug session stops (this is the better event for detecting pauses)
                    stopDisposable = vscode.debug.onDidChangeBreakpoints(() => {
                        console.log(`[debugJestTest] Breakpoints changed event fired`);
                    });

                    // Listen for active debug session changes (when execution pauses/resumes)
                    changeDisposable = vscode.debug.onDidChangeActiveDebugSession((activeSession) => {
                        console.log(`[debugJestTest] Active debug session changed. Current session: ${activeSession?.name || 'none'}, our session: ${session.name}`);

                        // Since we only have one debug session running, any active session change indicates our session is active
                        if (activeSession) {
                            console.log(`[debugJestTest] Debug session is now active, checking if it's stopped...`);

                            // Use a more reliable way to check if the session is stopped
                            setTimeout(async () => {
                                try {
                                    // If there's an active debug session, assume our breakpoint was hit
                                    if (vscode.debug.activeDebugSession) {
                                        console.log(`[debugJestTest] Session is active, assuming breakpoint ${breakpointId} was hit`);
                                        cleanup();
                                        resolve({
                                            content: [{
                                                type: 'text',
                                                text: `Debug session paused. Breakpoint ${breakpointId} may have been hit. You can now inspect variables and step through code.`
                                            }],
                                            isError: false
                                        });
                                    }
                                } catch (error) {
                                    console.log(`[debugJestTest] Error checking session state: ${error}`);
                                }
                            }, 500); // Longer delay to ensure state is updated
                        }
                    });

                    // Also listen for debug session custom events which might indicate stopping
                    customEventDisposable = vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
                        console.log(`[debugJestTest] Received custom debug event: ${event.event} for session ${event.session.name}`);
                        // Since we only have one debug session, any custom event is for our session
                        // Check for events that indicate the session has stopped
                        if (event.event === 'stopped' || event.event === 'breakpoint' || event.event === 'step') {
                            console.log(`[debugJestTest] Debug session stopped event detected for breakpoint ${breakpointId}`);
                            cleanup();
                            resolve({
                                content: [{
                                    type: 'text',
                                    text: `Debug session paused at breakpoint. Breakpoint ${breakpointId} was hit. You can now inspect variables and step through code.`
                                }],
                                isError: false
                            });
                        }
                    });

                    // Also handle session termination
                    terminateDisposable = vscode.debug.onDidTerminateDebugSession((terminatedSession) => {
                        console.log(`[debugJestTest] Debug session terminated: ${terminatedSession.name}`);
                        if (terminatedSession === session) {
                            console.log(`[debugJestTest] Our debug session terminated before breakpoint ${breakpointId} was hit`);
                            cleanup();
                            resolve({
                                content: [{
                                    type: 'text',
                                    text: `Debug session terminated before breakpoint ${breakpointId} was hit.`
                                }],
                                isError: true
                            });
                        }
                    });
                } else {
                    // Original behavior when no breakpoint ID is provided
                    console.log(`[debugJestTest] No breakpoint ID provided, returning immediately`);
                    startDisposable.dispose();
                    if (terminateDisposable) terminateDisposable.dispose();
                    const message = `Debugger attached to Jest test${testNamePattern ? ` with pattern "${testNamePattern}"` : ''} in file: ${path.basename(testFilePath)}`;
                    resolve({ content: [{ type: 'text', text: message }], isError: false });
                }
            });

            terminateDisposable = vscode.debug.onDidTerminateDebugSession(() => {
                console.log(`[debugJestTest] Early termination handler triggered`);
                if (!breakpointId) {
                    // Only handle immediate termination if we're not waiting for a breakpoint
                    console.log(`[debugJestTest] No breakpoint ID, handling early termination`);
                    startDisposable.dispose();
                    if (terminateDisposable) terminateDisposable.dispose();
                    resolve({ content: [{ type: 'text', text: 'Debug session terminated before attachment could be confirmed.' }], isError: true });
                } else {
                    console.log(`[debugJestTest] Breakpoint ID provided, ignoring early termination`);
                }
            });
        });

        // Start the debug session
        console.log(`[debugJestTest] Starting debug session with config:`, debugConfig);
        const debugStarted = await vscode.debug.startDebugging(workspaceFolder, debugConfig);

        if (!debugStarted) {
            console.log(`[debugJestTest] Failed to start debug session`);
            return { content: [{ type: 'text', text: 'Could not start debug session.' }], isError: true };
        }

        console.log(`[debugJestTest] Debug session started successfully, waiting for events...`);
        // Wait for either start or terminate event
        return await debugSessionPromise;
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
