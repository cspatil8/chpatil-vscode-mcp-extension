export interface WaitOptions {
    until?: RegExp;
    timeoutMs?: number;
}
export declare function runCmdInTerminal(cmd: string, args?: string[], cwd?: string, wait?: WaitOptions, terminalName?: string): Promise<{
    output: string;
    exit: number | null;
}>;
