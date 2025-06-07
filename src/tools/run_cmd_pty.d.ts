export declare const executeCommandInPty: (command: string, interceptPattern?: RegExp) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
export declare function formatTerminalChunk(chunk: string): string;
