import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import dedent from 'dedent';
import express, { Request, Response } from 'express';
import * as http from 'http';
import * as vscode from 'vscode';
import packageJson from '../package.json';
import { executeCommandInTerminal } from './tools/run_npm_script';
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
            const result = await executeCommandInTerminal(commandToRun, 'Build Process'); // Call the new function with the command and a terminal name
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
