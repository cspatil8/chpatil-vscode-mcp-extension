export declare const executeCommandInTerminal: (command: string, terminalName?: string) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
