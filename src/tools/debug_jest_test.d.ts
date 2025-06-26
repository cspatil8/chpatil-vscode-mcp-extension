export declare const debugJestTest: (testFilePath: string, testNamePattern?: string) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
export declare function waitForNextStop(opts?: {
    skipEntry?: boolean;
}): Promise<string>;
