type PtyOptions = {
    terminalName: string;
    cwd: string;
    interceptPattern?: RegExp;
    onIntercept?: () => void;
} & ({
    command: string;
    program?: never;
    args?: never;
    useShell: true;
} | {
    command?: never;
    program: string;
    args: string[];
    useShell?: false;
});
export declare const executeCommandInPty: (options: PtyOptions) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
export declare function formatTerminalChunk(chunk: string): string;
export {};
