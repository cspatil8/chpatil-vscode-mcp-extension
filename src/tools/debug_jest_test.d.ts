export declare const debugJestTest: (testFilePath: string, testNamePattern?: string, useDebugger?: boolean) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
