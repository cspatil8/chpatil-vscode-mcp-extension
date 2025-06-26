export declare function setBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): string;
export declare function unsetBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): void;
export declare const debugStepInto: () => Thenable<unknown>;
export declare const debugStepOver: () => Thenable<unknown>;
export declare function debugContinue(): Promise<string>;
export declare function waitForNextStop(opts?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
}): Promise<string>;
