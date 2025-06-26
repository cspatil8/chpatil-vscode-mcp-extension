import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { executeCommandInPty } from './run_cmd_pty';

/**
 * Debugs a specific Jest test by launching it in a new process with the inspector
 * enabled and then attaching the VS Code debugger.
 *
 * @param testFilePath The absolute path to the test file.
 * @param testNamePattern Optional pattern to match specific test names.
 * @returns A promise that resolves with the result of the operation.
 */
export const debugJestTest = async (
    testFilePath: string,
    testNamePattern?: string,
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
    try {
        if (!testFilePath) {
            return { content: [{ type: 'text', text: 'Error: Test file path is required.' }], isError: true };
        }

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
        const port = 9229; // Standard debug port

        // 1. Launch Jest in a separate process with the debugger enabled.
        // This will wait until the "Debugger listening on..." message is seen.
        console.log(`Launching Jest in debug mode: ${jestJs} in ${projectRoot}`);
        await launchJestProcess(jestJs, projectRoot, testFilePath, port, testNamePattern);

        // 2. Attach the VS Code debugger and wait for a stop.
        console.log(`Attaching debugger and waiting for stop...`);
        const pauseInfo = await attachAndAwaitStop(workspaceFolder, projectRoot, port, testNamePattern);
        console.log('Debugger has stopped:', pauseInfo);

        return { content: [{ type: 'text', text: pauseInfo }], isError: false };

    } catch (error: any) {
        console.error('Error debugging Jest test:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `Failed to debug Jest test: ${errorMessage}` }],
            isError: true,
        };
    }
};

/**
 * Launches Jest via Node in a pseudo-terminal with the --inspect-brk flag.
 * Resolves once the debugger is listening.
 */
function launchJestProcess(
    jestJsPath: string,
    projectRoot: string,
    testFilePath: string,
    port: number,
    testNamePattern?: string
): Promise<void> {
    const args = [
        `--inspect-brk=${port}`,
        jestJsPath,
        '--runTestsByPath',
        toPosix(path.relative(projectRoot, testFilePath)),
        '--runInBand',
        '--no-coverage',
    ];
    if (testNamePattern) {
        args.push('--testNamePattern', testNamePattern);
    }

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout: Jest process did not start the debugger within 30 seconds.'));
        }, 30000);

        // We don't await the promise returned by executeCommandInPty, as it only
        // resolves when the process terminates. Instead, we use the onIntercept
        // callback to resolve this promise when the debugger is ready.
        executeCommandInPty({
            terminalName: `Debug: ${path.basename(testFilePath)}`,
            program: 'node',
            args: args,
            cwd: projectRoot,
            interceptPattern: /Debugger listening on ws:\/\//,
            onIntercept: () => {
                clearTimeout(timeout);
                resolve();
            },
        }).then(result => {
            // This block runs when the process terminates. If it terminates with an
            // error before the debugger starts, the timeout above will catch it.
            if (result.isError) {
                console.log(`Jest process exited with an error. See terminal for details.`);
            }
        });
    });
}

function getDebugConfig(projectRoot: string, port: number, testNamePattern?: string): vscode.DebugConfiguration {
    return {
        type: 'node',
        request: 'attach',
        name: `Attach to Jest Test${testNamePattern ? ` (${testNamePattern})` : ''}`,
        port: port,
        cwd: projectRoot,
        skipFiles: ['<node_internals>/**', '**/node_modules/**'],
        continueOnAttach: false,
    };
}

async function attachAndAwaitStop(
    workspaceFolder: vscode.WorkspaceFolder,
    projectRoot: string,
    port: number,
    testNamePattern?: string
): Promise<string> {
    console.log('[debug_jest_test] Attaching debugger and waiting for stop...');
    const debugConfig = getDebugConfig(projectRoot, port, testNamePattern);

    // start debugging (as before)
    const ok = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
    if (!ok) {
        throw new Error('Could not start debug session.');
    }

    // wait until we actually pause
    return await waitForNextStop();
}

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


/* ------------------------------------------------------------------ *
 *  🛑  Generic helper – waits for the next debugger stop, then         *
 *      returns a short human/LLM-friendly summary.                    *
 *                                                                    *
 *  • Listens to *all* sessions (parent + remote-process children).    *
 *  • By default skips the initial "entry" pause and waits for the     *
 *    first *real* breakpoint / step / pause button event.            *
 * ------------------------------------------------------------------ */
export async function waitForNextStop(opts?: {
    /** skip the "reason:entry" stop that happens on --inspect-brk attach   */
    skipEntry?: boolean;
  }): Promise<string> {
    const { skipEntry = true } = opts ?? {};

    return new Promise<string>((resolve, reject) => {
      let done = false;                        // make sure we resolve once
      const disposables: vscode.Disposable[] = [];

      const cleanup = () => disposables.forEach(d => d.dispose());

      disposables.push(
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
          createDebugAdapterTracker(session) {
            return {
              async onDidSendMessage(msg: any) {
                if (done || msg.event !== 'stopped') return;

                const { threadId, reason, description } = msg.body;
                if (reason === 'entry' && skipEntry) {
                  // auto-continue past the bootstrap pause
                  session.customRequest('continue', { threadId });
                  return;
                }

                try {
                  const rsp: any = await session.customRequest('stackTrace', {
                    threadId,
                    startFrame: 0,
                    levels: 1,
                  });
                  const f     = rsp.stackFrames?.[0] ?? {};
                  const src   = f.source?.path ?? f.source?.name ?? '<unknown>';
                  const line  = f.line   ?? 0;
                  const col   = f.column ?? 0;
                  const fn    = f.name   ?? '<anonymous>';

                  const summary =
                    '🛑 Debugger stopped\n' +
                    `• reason : ${reason}${description ? ` – ${description}` : ''}\n` +
                    `• at     : ${src}:${line}:${col}\n` +
                    `• frame  : ${fn}`;

                  done = true;
                  cleanup();
                  resolve(summary);
                } catch (err) {
                  done = true;
                  cleanup();
                  reject(err);
                }
              },

              onWillStopSession() {
                if (!done) {
                  done = true;
                  cleanup();
                  reject(new Error('Debug session terminated before hitting a breakpoint.'));
                }
              },
            };
          },
        }),
      );
    });
  }
