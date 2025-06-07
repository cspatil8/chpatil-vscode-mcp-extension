export declare const executeCommandInPty: (command: string, interceptPattern?: RegExp) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
