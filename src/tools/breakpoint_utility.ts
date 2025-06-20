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
export const debugContinue = () => vscode.commands.executeCommand('workbench.action.debug.continue');
