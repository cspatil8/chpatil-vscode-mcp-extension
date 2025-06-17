import * as vscode from 'vscode';

export async function tellMeAJoke(): Promise<string> {
    try {
        // Select the chat model
        const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        if (!model) {
            return 'Sorry, no suitable language model available.';
        }

        // Send the chat request to the selected model
        const messages = [new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, 'tell me a joke')];
        const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

        let responseText = '';
        for await (const chunk of chatResponse.text) {
            responseText += chunk;
        }
        return responseText;
    } catch (error: any) {
        console.error('Error getting joke from LM API:', error);
        // Check if it's a LanguageModelError for more specific messages
        if (error instanceof vscode.LanguageModelError) {
            return `Sorry, I couldn't tell a joke right now. LM Error: ${error.message} (Code: ${error.code})`;
        }
        return `Sorry, I couldn't tell a joke right now. Error: ${error.message}`;
    }
}
