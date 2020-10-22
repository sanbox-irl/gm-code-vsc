import { LanguageClient, LanguageClientOptions } from 'vscode-languageclient';
import { LSP_PATH } from './config';
import { Initialization } from './extension';

let client: LanguageClient;

export function activate(init: Initialization) {
    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for gms2 documents
        documentSelector: [{ scheme: 'file', language: 'gml-gms2' }],
        outputChannel: init.outputChannel,
    };

    // Create the language client and start the client.
    client = new LanguageClient('gm-code', 'Gm Code Server', { command: LSP_PATH }, clientOptions);

    // Start the client. This will also launch the server
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
