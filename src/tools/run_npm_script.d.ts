import { WaitOptions } from '../utils/ptyHelper';
export declare const executeCommandInTerminal: (command: string, terminalName?: string, waitOptions?: WaitOptions) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
