import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'child_process';
import * as vscode from 'vscode';

// Define a type for the options to make it clear and type-safe
type PtyOptions = {
  terminalName: string;
  cwd: string;
  interceptPattern?: RegExp;
  onIntercept?: () => void; // Callback to signal when a pattern is matched
} & ({
  command: string; // For shell-based execution
  program?: never;
  args?: never;
  useShell: true;
} | {
  command?: never; // For direct program execution
  program: string;
  args: string[];
  useShell?: false;
  });

/**
 * Executes a shell command inside a VS Code integrated terminal, echoes
 * all I/O, and resolves when the process exits.
 *
 * @param command          Full shell command, e.g. "npm run test"
 * @param interceptPattern Optional RegExp to watch for in the live output
 * @returns                Promise with collected text + success flag
 */
export const executeCommandInPty = async (
  options: PtyOptions
): Promise<{ content: { type: 'text'; text: string }[]; isError: boolean }> => {
  if (!options.command && !options.program) {
    return {
      content: [{ type: 'text', text: 'Error: No command or program provided.' }],
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
        if (options.useShell === true) { // Explicitly check for true
          if (!options.command) {
            throw new Error('Command must be provided when useShell is true');
          }
          child = spawn(options.command, { shell: true, cwd: options.cwd, env: process.env });
        } else if (options.program) { // Check for program directly
          child = spawn(options.program, options.args || [], { cwd: options.cwd, env: process.env });
        } else {
          throw new Error('Invalid options for executeCommandInPty: command or program must be specified.');
        }

        // child = spawn(command, {
        //   shell: true,        // cmd.exe on Windows, /bin/sh elsewhere
        //   cwd,
        //   env: process.env,
        //   windowsHide: true,  // NO extra console window on Windows
        //   stdio: 'pipe'
        // }) as ChildProcessWithoutNullStreams;

        child.stdout.on('data', (d) => {
          const text = formatTerminalChunk(d.toString());
          output += text;
          writeEmitter.fire(text);
          if (options.interceptPattern?.test(text)) {
            console.log(`Pattern matched: ${options.interceptPattern}`);
            options.onIntercept?.();
          }
        });

        child.stderr.on('data', (d) => {
          const text = formatTerminalChunk(d.toString());
          output += text;
          writeEmitter.fire(text);
          if (options.interceptPattern?.test(text)) {
            console.log(`Pattern matched: ${options.interceptPattern}`);
            options.onIntercept?.();
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

    vscode.window.createTerminal({ name: `Run: ${options.terminalName}`, pty }).show();
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

/**
 * Tidies a raw stdout/stderr chunk so it looks good in VS Code’s
 * integrated terminal.
 *
 * • Turns any solitary "\r" (carriage return not already followed by \n)
 *   into "\r\n" so each update lands on a new line instead of overprinting.
 * • Normalises mixed line endings.
 * • Optionally you could strip ANSI colour codes here, but you asked
 *   for “no colour”, so we leave them intact (they will render fine).
 */
export function formatTerminalChunk(chunk: string): string {
    // Step 1 – ensure every CR ends with a LF
    const normalised = chunk.replace(/\r(?!\n)/g, '\n');

    // Step 2/3 – split, trim, filter, then re‑join
    return normalised
      .split('\n')
      .map(line => {
        // remove spaces/tabs AFTER the last visible char, but *before*
        // any trailing ANSI reset codes (e.g. “…foo   \x1B[0m”)
        return line.replace(/[\t ]+(?=(?:\x1B\[[0-9;]*m)*$)/, '');
      })
      .filter(line => line.length)   // discard blank lines
      .join('\r\n');                 // CRLF = safe on all OSs in VS Code
  }
