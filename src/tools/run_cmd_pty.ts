import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'child_process';
import * as vscode from 'vscode';

/**
 * Executes a shell command inside a VS Code integrated terminal, echoes
 * all I/O, and resolves when the process exits.
 *
 * @param command          Full shell command, e.g. "npm run test"
 * @param interceptPattern Optional RegExp to watch for in the live output
 * @returns                Promise with collected text + success flag
 */
export const executeCommandInPty = async (
  command: string,
  interceptPattern?: RegExp,
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
  if (!command.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: No command provided.' }],
      isError: true
    };
  }

  return new Promise((resolve) => {
    const writeEmitter = new vscode.EventEmitter<string>();
    let child: ChildProcessWithoutNullStreams | undefined;
    let output = '';
    let hadError = false;

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,

      /** Echo user keystrokes; kill on Ctrl+C. */
      handleInput(data: string): void {
        if (data === '\x03') {            // Ctrl+C
          writeEmitter.fire('^C\r\n');
          if (child && !child.killed) killProcessTree(child);
          return;
        }
        writeEmitter.fire(data);          // show what user typed
        child?.stdin.write(data);         // forward to the process
      },

      /** Spawn the command in a shell. */
      open(): void {
        const cwd =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        child = spawn(command, {
          shell: true,        // cmd.exe on Windows, /bin/sh elsewhere
          cwd,
          env: process.env,
          windowsHide: true,  // NO extra console window on Windows
          stdio: 'pipe'
        }) as ChildProcessWithoutNullStreams;

        child.stdout.on('data', (d) => {
          const text = d.toString();
          output += text;
          writeEmitter.fire(text);
          if (interceptPattern?.test(text)) {
            console.log(`Pattern matched: ${interceptPattern}`);
          }
        });

        child.stderr.on('data', (d) => {
          const text = d.toString();
          output += text;
          writeEmitter.fire(text);
          if (interceptPattern?.test(text)) {
            console.log(`Pattern matched: ${interceptPattern}`);
          }
        });

        child.on('close', (code) => {
          hadError = code !== 0;
          writeEmitter.fire(`\r\n\nProcess exited with code ${code}\r\n`);
          setTimeout(() => {
            resolve({
              content: [{ type: 'text', text: output.trim() }],
              isError: hadError
            });
          }, 50); // small delay so final line renders before resolve
        });

        child.on('error', (err) => {
          const msg = `Error spawning process: ${err.message}\r\n`;
          output += msg;
          writeEmitter.fire(msg);
          hadError = true;
        });
      },

      /** Called if the user closes the terminal tab. */
      close(): void {
        child?.kill();
      }
    };

    vscode.window.createTerminal({ name: `Run: ${command}`, pty }).show();
  });
};

/** Kill an entire process tree, cross‑platform but Windows‑first */
function killProcessTree(child: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    } catch { /* ignore if already exited */ }
  } else {
    try {
      // negative PID = process group on Unix
      if (child.pid !== undefined) {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch { /* ignore */ }
  }
}
