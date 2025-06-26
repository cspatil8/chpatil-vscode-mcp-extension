import * as vscode from 'vscode';

export function setBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): string {
    const column = columnNumber ?? 0; // Default to column 0 if not provided
    const location = new vscode.Location(vscode.Uri.file(fileName), new vscode.Position(lineNumber, column));
    const breakpoint = new vscode.SourceBreakpoint(location);
    vscode.debug.addBreakpoints([breakpoint]);
    return breakpoint.id;
}

export function unsetBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): void {
    const column = columnNumber ?? 0; // Default to column 0 if not provided
    const targetUri = vscode.Uri.file(fileName);

    // Find existing breakpoints that match the location
    const breakpointsToRemove = vscode.debug.breakpoints.filter((bp) => {
        if (bp instanceof vscode.SourceBreakpoint) {
            const bpLocation = bp.location;
            return (
                bpLocation.uri.toString() === targetUri.toString() &&
                bpLocation.range.start.line === lineNumber &&
                bpLocation.range.start.character === column
            );
        }
        return false;
    });

    if (breakpointsToRemove.length > 0) {
        vscode.debug.removeBreakpoints(breakpointsToRemove);
    }
}

// Debug execution control functions
export const debugStepInto = () => vscode.commands.executeCommand('workbench.action.debug.stepInto');
export const debugStepOver = () => vscode.commands.executeCommand('workbench.action.debug.stepOver');
export async function debugContinue(): Promise<string> {
    console.log('[debugContinue] 1. Entered function.');
    // fires the built-in command you already had:
    const wait = waitForNextStop();
    console.log('[debugContinue] 2. Called waitForNextStop.');

    await vscode.commands.executeCommand('workbench.action.debug.continue');

    console.log('[debugContinue] 3. continue command executed, waiting for next stop');

    // now block until the debugger pauses again
    const result = await wait;
    console.log('[debugContinue] 4. wait completed.');
    return result;
}

export function waitForNextStop(
    opts?: { pollIntervalMs?: number; timeoutMs?: number }
  ): Promise<string> {
    console.log('[waitForNextStop] waiting for next stop');
    const poll = opts?.pollIntervalMs ?? 1000;   // 1 s default
    const to   = opts?.timeoutMs      ?? 300_000; // give up after 300 s
    console.log(`[waitForNextStop] options: poll=${poll}ms, timeout=${to}ms`);

    const session = vscode.debug.activeDebugSession;
    if (!session) {
      console.error('[waitForNextStop] No active debug session');
      throw new Error('No active debug session');
    }
    console.log(`[waitForNextStop] active session: ${session.name} (${session.id})`);

    return new Promise<string>((resolve, reject) => {
      console.log('[waitForNextStop] Promise created');
      const started = Date.now();

      const tick = async () => {
        console.log('[waitForNextStop] tick');
        // safety: time-out
        if (Date.now() - started > to) {
          console.error('[waitForNextStop] Timed out');
          return reject(new Error('Timed out while waiting for debugger to stop'));
        }

        try {
          /* 1️⃣ ask for threads --------------- */
          console.log('[waitForNextStop] sending "threads" request');
          const thrRsp: any = await session.customRequest('threads');
          console.log(`[waitForNextStop] "threads" response: ${JSON.stringify(thrRsp)}`);
          const threadId: number | undefined = thrRsp?.threads?.[0]?.id;
          if (typeof threadId !== 'number') {
              console.log('[waitForNextStop] no threads found yet');
              throw new Error('no threads yet');
          }
          console.log(`[waitForNextStop] found threadId: ${threadId}`);

          /* 2️⃣ ask for just one frame -------- */
          console.log('[waitForNextStop] sending "stackTrace" request');
          const stRsp: any = await session.customRequest('stackTrace', {
            threadId,
            startFrame: 0,
            levels: 1,
          });
          console.log(`[waitForNextStop] "stackTrace" response: ${JSON.stringify(stRsp)}`);

          const f = stRsp.stackFrames?.[0];
          if (!f) {
              console.log('[waitForNextStop] not paused (no stack frames)');
              throw new Error('not paused');   // defensive
          }

          // 🎉 paused – build summary & resolve
          console.log('[waitForNextStop] debugger is paused');
          const src = f.source?.path ?? f.source?.name ?? '<unknown>';
          const line = f.line ?? 0;
          const col  = f.column ?? 0;
          const fn   = f.name ?? '<anonymous>';

          const summary =
            '🛑 Debugger stopped\n' +
            `• reason : breakpoint\n` +
            `• at     : ${src}:${line}:${col}\n` +
            `• frame  : ${fn}\n` +
            `• stackFrame : ${JSON.stringify(f, null, 2)}`;
          console.log(`[waitForNextStop] resolving with summary: ${summary}`);
          resolve(summary);
        } catch (err: any) {
          // Most likely still running – poll again
          console.log(`[waitForNextStop] caught error, will poll again: ${err.message}`);
          setTimeout(tick, poll);
        }
      };

      console.log('[waitForNextStop] starting polling');
      tick();
    });
  }
