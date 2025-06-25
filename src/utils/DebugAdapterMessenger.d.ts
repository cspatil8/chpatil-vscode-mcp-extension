import * as vscode from 'vscode';
export declare class DebugAdapterMessenger {
    static sendRunCommand(session: vscode.DebugSession): Promise<void>;
}
