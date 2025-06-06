export declare function setBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): void;
export declare function unsetBreakpoint(fileName: string, lineNumber: number, columnNumber?: number): void;
export declare const debugStepInto: () => Thenable<unknown>;
export declare const debugStepOver: () => Thenable<unknown>;
export declare const debugContinue: () => Thenable<unknown>;
