import * as vscode from 'vscode';
export declare const debugJestTest: (testFilePath: string, extensionContext: vscode.ExtensionContext, testNamePattern?: string, breakpointId?: string) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
