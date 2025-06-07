import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import dedent from 'dedent';
import express, { Request, Response } from 'express';
import * as http from 'http';
import * as vscode from 'vscode';
import { z } from 'zod'; // Added import
import packageJson from '../package.json';
import {
    debugContinue,
    debugStepInto,
    debugStepOver,
    setBreakpoint,
    unsetBreakpoint,
} from './tools/breakpoint_utility'; // Updated import
import { debugJestTest } from './tools/debug_jest_test';
import { tellMeAJoke } from './tools/llm';
import { executeCommandInPty } from './tools/run_cmd_pty';
import { resolvePort } from './utils/port';

const extensionName = 'chpatil-mcp-server';
const extensionDisplayName = 'chpatil MCP Server';

export const activate = async (context: vscode.ExtensionContext) => {
    // Create the output channel for logging
    const outputChannel = vscode.window.createOutputChannel(extensionDisplayName);

    // Write an initial message to ensure the channel appears in the Output dropdown
    outputChannel.appendLine(`Activating ${extensionDisplayName}...`);
    // Uncomment to automatically switch to the output tab and this extension channel on activation
    // outputChannel.show();

    // Initialize the MCP server instance
    const mcpServer = new McpServer({
        name: extensionName,
        version: packageJson.version,
    });

    // Register 'run_build_command' tool
    mcpServer.tool(
        'run_build_command', // Changed tool name
        dedent`
            Executes the predefined 'npm run build' command in the VS Code terminal.
            Use this tool to trigger the workspace build process.
        `.trim(), // Updated description
        {}, // No parameters needed for this specific command tool
        async () => {
            // Removed params
            const commandToRun = 'npm run build'; // Hardcoded command
            const result = await executeCommandInPty(commandToRun); // Call the new function with the command and a terminal name
            return {
                ...result,
                content: result.content.map((c) => ({
                    ...c,
                    text: typeof c.text === 'string' ? c.text : String(c.text),
                    type: 'text',
                })),
            };
        },
    );

    // Register 'set_breakpoint' tool
    mcpServer.tool(
        'set_breakpoint',
        dedent`
            Sets a breakpoint in a specified file at a given line and column number.
            The line and column numbers are 0-based.
            If the column number is not provided, it defaults to 0.
        `.trim(),
        {
            fileName: z.string().describe('The absolute path to the file where the breakpoint should be set.'),
            lineNumber: z.number().int().min(0).describe('The 0-based line number for the breakpoint.'),
            columnNumber: z
                .number()
                .int()
                .min(0)
                .default(0)
                .describe('The 0-based column number for the breakpoint. Defaults to 0 if not provided.'),
        },
        async (params: { fileName: string; lineNumber: number; columnNumber?: number }) => {
            try {
                setBreakpoint(params.fileName, params.lineNumber, params.columnNumber);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Breakpoint set at ${params.fileName}:${params.lineNumber}${
                                params.columnNumber !== undefined ? ':' + params.columnNumber : ''
                            }`,
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error setting breakpoint: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'unset_breakpoint' tool
    mcpServer.tool(
        'unset_breakpoint',
        dedent`
            Removes a breakpoint from a specified file at a given line and column number.
            The line and column numbers are 0-based.
            If the column number is not provided, it defaults to 0.
        `.trim(),
        {
            fileName: z.string().describe('The absolute path to the file where the breakpoint should be removed.'),
            lineNumber: z.number().int().min(0).describe('The 0-based line number for the breakpoint to remove.'),
            columnNumber: z
                .number()
                .int()
                .min(0)
                .default(0)
                .describe('The 0-based column number for the breakpoint to remove. Defaults to 0 if not provided.'),
        },
        async (params: { fileName: string; lineNumber: number; columnNumber?: number }) => {
            try {
                unsetBreakpoint(params.fileName, params.lineNumber, params.columnNumber);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Breakpoint removed from ${params.fileName}:${params.lineNumber}${
                                params.columnNumber !== undefined ? ':' + params.columnNumber : ''
                            }`,
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error removing breakpoint: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'debug_jest_test' tool
    mcpServer.tool(
        'debug_jest_test',
        dedent`
            Starts a Jest test in debug mode using VS Code's built-in debugger.
            This allows debugging specific test files and optionally specific test cases within those files.
            The debugger will attach and allow stepping through test code and breakpoints.
        `.trim(),
        {
            testFilePath: z.string().describe('The absolute path to the Jest test file to debug.'),
            testNamePattern: z
                .string()
                .optional()
                .describe(
                    'Optional pattern to match specific test names. If not provided, runs all tests in the file.',
                ),
        },
        async (params: { testFilePath: string; testNamePattern?: string }) => {
            try {
                const result = await debugJestTest(params.testFilePath, params.testNamePattern);
                return {
                    ...result,
                    content: result.content.map((c) => ({
                        ...c,
                        text: typeof c.text === 'string' ? c.text : String(c.text),
                        type: 'text',
                    })),
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error debugging Jest test: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'debug_step_into' tool
    mcpServer.tool(
        'debug_step_into',
        dedent`
            Steps into the current line of code during debugging.
            This will enter into function calls, allowing you to debug the internal implementation.
            The debugger must be active and paused for this command to work.
        `.trim(),
        {}, // No parameters needed
        async () => {
            try {
                await debugStepInto();
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Debug step into executed successfully.',
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing debug step into: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'debug_step_over' tool
    mcpServer.tool(
        'debug_step_over',
        dedent`
            Steps over the current line of code during debugging.
            This will execute the current line without entering into function calls.
            The debugger must be active and paused for this command to work.
        `.trim(),
        {}, // No parameters needed
        async () => {
            try {
                await debugStepOver();
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Debug step over executed successfully.',
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing debug step over: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'debug_continue' tool
    mcpServer.tool(
        'debug_continue',
        dedent`
            Continues execution during debugging until the next breakpoint is hit or the program completes.
            The debugger must be active and paused for this command to work.
        `.trim(),
        {}, // No parameters needed
        async () => {
            try {
                await debugContinue();
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Debug continue executed successfully.',
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing debug continue: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Register 'tell_me_a_joke' tool
    mcpServer.tool(
        'tell_me_a_joke',
        dedent`
            Tells a joke using the VS Code Language Model API.
        `.trim(),
        {}, // No parameters needed
        async () => {
            try {
                const joke = await tellMeAJoke();
                return {
                    content: [
                        {
                            type: 'text',
                            text: joke,
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error telling a joke: ${error.message}`,
                        },
                    ],
                };
            }
        },
    );

    // Set up an Express app to handle SSE connections
    const app = express();
    const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
    const port = await resolvePort(mcpConfig.get<number>('port', 6010));

    let sseTransport: SSEServerTransport | undefined;

    // GET /sse endpoint: the external MCP client connects here (SSE)
    app.get('/sse', async (_req: Request, res: Response) => {
        outputChannel.appendLine('SSE connection initiated...');
        sseTransport = new SSEServerTransport('/messages', res);
        try {
            await mcpServer.connect(sseTransport);
            outputChannel.appendLine('MCP Server connected via SSE.');
            outputChannel.appendLine(`SSE Transport sessionId: ${sseTransport.sessionId}`);
        } catch (err) {
            outputChannel.appendLine('Error connecting MCP Server via SSE: ' + err);
        }
    });

    // POST /messages endpoint: the external MCP client sends messages here
    app.post('/messages', express.json(), async (req: Request, res: Response) => {
        // Log in output channel
        outputChannel.appendLine(`POST /messages: Payload - ${JSON.stringify(req.body, null, 2)}`);

        if (sseTransport) {
            // Log the session ID of the transport to confirm its initialization
            outputChannel.appendLine(`SSE Transport sessionId: ${sseTransport.sessionId}`);
            try {
                // Note: Passing req.body to handlePostMessage is critical because express.json()
                // consumes the request stream. Without this, attempting to re-read the stream
                // within handlePostMessage would result in a "stream is not readable" error.
                await sseTransport.handlePostMessage(req, res, req.body);
                outputChannel.appendLine('Handled POST /messages successfully.');
            } catch (err) {
                outputChannel.appendLine('Error handling POST /messages: ' + err);
            }
        } else {
            res.status(500).send('SSE Transport not initialized.');
            outputChannel.appendLine('POST /messages failed: SSE Transport not initialized.');
        }
    });

    // Create and start the HTTP server
    const server = http.createServer(app);
    function startServer(port: number): void {
        server.listen(port, () => {
            outputChannel.appendLine(`MCP SSE Server running at http://127.0.0.1:${port}/sse`);
        });

        // Add disposal to shut down the HTTP server and output channel on extension deactivation
        context.subscriptions.push({
            dispose: () => {
                server.close();
                outputChannel.dispose();
            },
        });
    }
    const startOnActivate = mcpConfig.get<boolean>('startOnActivate', true);
    if (startOnActivate) {
        startServer(port);
    } else {
        outputChannel.appendLine('MCP Server startup disabled by configuration.');
    }

    // COMMAND PALETTE COMMAND: Stop the MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.stopServer', () => {
            if (!server.listening) {
                vscode.window.showWarningMessage('MCP Server is not running.');
                outputChannel.appendLine('Attempted to stop the MCP Server, but it is not running.');
                return;
            }
            server.close(() => {
                outputChannel.appendLine('MCP Server stopped.');
                vscode.window.showInformationMessage('MCP Server stopped.');
            });
        }),
    );

    // COMMAND PALETTE COMMAND: Start the MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.startServer', async () => {
            if (server.listening) {
                vscode.window.showWarningMessage('MCP Server is already running.');
                outputChannel.appendLine('Attempted to start the MCP Server, but it is already running.');
                return;
            }
            const newPort = await resolvePort(mcpConfig.get<number>('port', 6010));
            startServer(newPort);
            outputChannel.appendLine(`MCP Server started on port ${newPort}.`);
            vscode.window.showInformationMessage(`MCP Server started on port ${newPort}.`);
        }),
    );

    // COMMAND PALETTE COMMAND: Set the MCP server port and restart the server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.setPort', async () => {
            const newPortInput = await vscode.window.showInputBox({
                prompt: 'Enter new port number for the MCP Server:',
                value: String(port),
                validateInput: (input) => {
                    const num = Number(input);
                    if (isNaN(num) || num < 1 || num > 65535) {
                        return 'Please enter a valid port number (1-65535).';
                    }
                    return null;
                },
            });
            if (newPortInput && newPortInput.trim().length > 0) {
                const newPort = Number(newPortInput);
                // Update the configuration so that subsequent startups use the new port
                await vscode.workspace
                    .getConfiguration('mcpServer')
                    .update('port', newPort, vscode.ConfigurationTarget.Global);
                // Restart the server: close existing server and start a new one
                server.close();
                startServer(newPort);
                outputChannel.appendLine(`MCP Server restarted on port ${newPort}`);
                vscode.window.showInformationMessage(`MCP Server restarted on port ${newPort}`);
            }
        }),
    );

    outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
    // Clean-up is managed by the disposables added in the activate method.
}
