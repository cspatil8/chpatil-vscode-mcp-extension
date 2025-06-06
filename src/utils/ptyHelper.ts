import * as nodePty from 'node-pty';
import * as vscode from 'vscode';

export interface WaitOptions {
    until?: RegExp; // ✔️ stop when this shows up
    timeoutMs?: number; //  ⏰ optional
}

export function runCmdInTerminal(
    cmd: string,
    args: string[] = [],
    cwd?: string,
    wait?: WaitOptions,
    terminalName?: string,
): Promise<{ output: string; exit: number | null }> {
    console.log('[ptyHelper] Starting command:', { cmd, args, cwd, terminalName });
    return new Promise((resolve, reject) => {
        let output = '';
        const emitter = new vscode.EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: emitter.event,
            open: () => {
                console.log('[ptyHelper] PTY opened, spawning process...');
                // ① launch inside a *real* PTY
                const proc = nodePty.spawn(cmd, args, {
                    name: 'xterm-256color',
                    cols: 120,
                    rows: 30,
                    cwd,
                    env: { ...process.env, TERM: 'xterm-256color' }, // colour!
                });
                console.log('[ptyHelper] Process spawned with PID:', proc.pid);

                // ② stream to VS Code + capture
                proc.onData((data) => {
                    console.log('[ptyHelper] Received chunk:', data.length, 'chars');
                    output += data;
                    emitter.fire(data);
                    if (wait?.until?.test(output)) {
                        console.log('[ptyHelper] Wait pattern matched, finishing...');
                        finish(null);
                    }
                });
                proc.onExit(({ exitCode }) => {
                    console.log('[ptyHelper] Process exited with code:', exitCode);
                    finish(exitCode);
                });

                function finish(code: number | null) {
                    console.log('[ptyHelper] Finishing with code:', code, 'output length:', output.length);
                    cleanup();
                    resolve({ output, exit: code });
                }
                function cleanup() {
                    console.log('[ptyHelper] Cleaning up...');
                    clearTimeout(timer);
                    proc.kill();
                }
            },
            close: () => {
                /* ignore */
            },
            handleInput: (data) => {
                void data; // TODO: optional: forward to cp.stdin
            },
        };

        const term = vscode.window.createTerminal({ name: terminalName || 'AI-Agent', pty });
        console.log('[ptyHelper] Terminal created with name:', terminalName || 'AI-Agent');
        term.show();
        console.log('[ptyHelper] Terminal shown');

        const timer = wait?.timeoutMs ? setTimeout(() => reject(new Error('timeout')), wait.timeoutMs) : undefined;
    });
}
