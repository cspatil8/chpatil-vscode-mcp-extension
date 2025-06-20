export declare const debugJestTest: (testFilePath: string, testNamePattern?: string, breakpointId?: string) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
