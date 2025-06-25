import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Listens for the 'stopped' DAP event and resolves a promise only when a specific breakpoint is hit.
 * This implementation uses a DebugAdapterTracker, which is the correct way to intercept
 * standard protocol messages.
 *
 * @param session The active debug session to monitor.
 * @param breakpointId The unique string ID of the breakpoint to wait for.
 * @param timeoutMs The maximum time to wait before rejecting.
 * @returns A promise that resolves when the target breakpoint is hit, or rejects on timeout.
 */
function waitForBreakpoint(
    session: vscode.DebugSession,
    breakpointId: string,
    timeoutMs: number = 120000 // 2 minutes timeout
): Promise<void> {
    return new Promise((resolve, reject) => {
        // Find the target breakpoint object from VS Code's list of all breakpoints.
        const targetBreakpoint = vscode.debug.breakpoints.find(bp => bp.id === breakpointId);

        if (!targetBreakpoint || !(targetBreakpoint instanceof vscode.SourceBreakpoint)) {
            return reject(new Error(`Source breakpoint with ID '${breakpointId}' not found or is not a location-based breakpoint.`));
        }

        const targetLocation = targetBreakpoint.location;
        console.log(`[waitForBreakpoint] Waiting for breakpoint at ${path.basename(targetLocation.uri.fsPath)}:${targetLocation.range.start.line + 1}`);

        let factory: vscode.Disposable;

        const timeout = setTimeout(() => {
            factory.dispose(); // Unregister the factory
            reject(new Error(`Timeout: Breakpoint at ${path.basename(targetLocation.uri.fsPath)}:${targetLocation.range.start.line + 1} was not hit within ${timeoutMs}ms.`));
        }, timeoutMs);

        // We register a factory that creates a "tracker" for our specific debug session.
        factory = vscode.debug.registerDebugAdapterTrackerFactory(session.type, {
            createDebugAdapterTracker(currentSession: vscode.DebugSession): vscode.DebugAdapterTracker {
                // We only care about the session we started.
                if (currentSession.id !== session.id) {
                    return {}; // Return an empty tracker for other sessions.
                }

                // Return a tracker with a handler for messages *from* the debug adapter.
                return {
                    onDidSendMessage: async (message) => {
                        // 1. Check if it's the 'stopped' event.
                        if (message.type === 'event' && message.event === 'stopped' && message.body.reason === 'breakpoint') {
                            console.log('[DebugAdapterTracker] Received "stopped" event on breakpoint.');

                            // 2. Get the call stack to find out WHERE we stopped.
                            try {
                                const stackTraceResponse = await session.customRequest('stackTrace', { threadId: message.body.threadId });
                                if (!stackTraceResponse?.stackFrames?.[0]) {
                                    return; // No stack frames to check.
                                }

                                const topFrame = stackTraceResponse.stackFrames[0];
                                const stoppedUri = vscode.Uri.file(topFrame.source.path);
                                const stoppedLine = topFrame.line - 1; // DAP lines are 1-based, VS Code's are 0-based.

                                // 3. Compare the location of the stop with our target breakpoint's location.
                                if (stoppedUri.fsPath === targetLocation.uri.fsPath && stoppedLine === targetLocation.range.start.line) {
                                    console.log(`[waitForBreakpoint] SUCCESS: Paused at the target breakpoint.`);
                                    
                                    // Cleanup and resolve the promise.
                                    clearTimeout(timeout);
                                    factory.dispose(); // Unregister the factory
                                    resolve();
                                }
                            } catch (error) {
                                // This might fail if the session ends while we're querying it.
                                // It's safe to ignore as the session termination will be handled elsewhere.
                                console.warn('[DebugAdapterTracker] Could not get stack trace, session may have ended.', error);
                            }
                        }
                    }
                };
            }
        });
    });
}

/**
 * Debugs a specific Jest test using VS Code's built-in debugger.
 *
 * @param testFilePath The absolute path to the test file
 * @param extensionContext The VS Code extension context for accessing extension resources
 * @param testNamePattern Optional pattern to match specific test names. If not provided, runs all tests in the file.
 * @param breakpointId Optional breakpoint ID to wait for. If provided, the function will only return when execution pauses at this breakpoint.
 * @returns A promise that resolves with the result of the debug session start
 */
export const debugJestTest = async (
    testFilePath: string,
    extensionContext: vscode.ExtensionContext,
    testNamePattern?: string,
    breakpointId?: string,
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
    try {
        // --- Stage 1: Validation and Path Finding (No Changes) ---
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
            return { content: [{ type: 'text', text: 'Could not find Jest. Install it with "npm i -D jest"' }], isError: true };
        }

        const { bin: jestJs, root: projectRoot } = located;

        // --- Stage 2: Prepare Arguments for Bootstrap Script (Major Change) ---
        const port = 9229;
        const bootstrapScriptPath = path.join(extensionContext.extensionPath, 'bootstrap.js');

        // These arguments are now passed TO our bootstrap.js script, which will then pass them to Jest.
        const jestArgs = [
            '--runTestsByPath',
            toPosix(path.relative(projectRoot, testFilePath)),
            '--runInBand', // Crucial for predictable debugging.
            '--no-coverage',
        ];
        if (testNamePattern) {
            jestArgs.push('--testNamePattern', testNamePattern);
        }

        // The arguments for the `node` process itself.
        const nodeArgs = [
            `--inspect=${port}`, // Use --inspect, NOT --inspect-brk.
            bootstrapScriptPath,  // Run our bootstrap script first.
            jestJs,               // Arg for bootstrap: path to Jest.
            ...jestArgs,          // All other args for bootstrap to pass along.
        ];

        // --- Stage 3: Start Process and Wait for Debugger Signal ---
        let nodeProcess: any = null; // We'll capture the child process reference

        const attachPromise = new Promise<void>((resolve) => {
            // We need to start the process manually to get a reference to it
            const { spawn } = require('child_process');
            nodeProcess = spawn('node', nodeArgs, {
                cwd: projectRoot,
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // Enable IPC for process.send()
            });

            // Monitor stdout for the debugger ready signal
            nodeProcess.stdout.on('data', (data: Buffer) => {
                const text = data.toString();
                console.log('[Debug Process stdout]:', text);
                if (/Debugger listening on ws:\/\//.test(text)) {
                    console.log('Debugger ready signal received');
                    resolve();
                }
            });

            // Monitor stderr as well
            nodeProcess.stderr.on('data', (data: Buffer) => {
                const text = data.toString();
                console.log('[Debug Process stderr]:', text);
                if (/Debugger listening on ws:\/\//.test(text)) {
                    console.log('Debugger ready signal received (stderr)');
                    resolve();
                }
            });

            nodeProcess.on('error', (err: Error) => {
                console.error('Node process error:', err);
            });
        });

        // Wait for the "Debugger listening..." message before we attempt to attach.
        await attachPromise;

        // --- Stage 4: Attach Debugger and Send Handshake Signal ---
        const debugConfig: vscode.DebugConfiguration = {
            type: 'node',
            request: 'attach',
            name: `Attach to Jest: ${path.basename(testFilePath)}`,
            port: port,
            cwd: projectRoot,
            skipFiles: ['<node_internals>/**', '**/node_modules/**'],
        };

        const attachStarted = await vscode.debug.startDebugging(workspaceFolder, debugConfig);

        if (attachStarted) {
            // Wait a moment for the debugger to be fully attached
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Send the message directly to the Node process via IPC
            if (nodeProcess && nodeProcess.connected) {
                console.log('Sending runJestTests message to bootstrap process');
                nodeProcess.send({ command: 'runJestTests' });

                // Get the active debug session
                const session = vscode.debug.activeDebugSession;
                if (!session) {
                    throw new Error('No active debug session found after attaching.');
                }

                // If a breakpointId is provided, wait for that specific breakpoint to be hit
                if (breakpointId) {
                    console.log(`[debugJestTest] Breakpoint ID provided: ${breakpointId}, setting up listener...`);
                    console.log(`[debugJestTest] Debug session ID: ${session.id}`);
                    try {
                        await waitForBreakpoint(session, breakpointId);
                        const message = `Debugger attached for ${path.basename(testFilePath)}. Tests started and execution paused at breakpoint ${breakpointId}.`;
                        console.log(`[debugJestTest] SUCCESS: ${message}`);
                        return { content: [{ type: 'text', text: message }], isError: false };
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        console.log(`[debugJestTest] ERROR: ${errorMsg}`);
                        return {
                            content: [{ type: 'text', text: `Failed to hit target breakpoint: ${errorMsg}` }],
                            isError: true
                        };
                    }
                } else {
                    // No specific breakpoint to wait for, just return after starting
                    const message = `Debugger attached for ${path.basename(testFilePath)}. Running tests...`;
                    return { content: [{ type: 'text', text: message }], isError: false };
                }
            } else {
                throw new Error('Node process is not available for IPC communication.');
            }
        } else {
            throw new Error('Could not attach Jest debug session.');
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
