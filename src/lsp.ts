import { OutputChannel, workspace } from 'vscode';
import { LanguageClientOptions, LanguageClient } from 'vscode-languageclient/node';
import { Command, CommandOutput } from 'yy-boss-api/out/core';
import { CommandOutputError } from 'yy-boss-api/out/error';
import { CommandToOutput } from 'yy-boss-api/out/input_to_output';

export async function activate(working_directory: string, outputChannel: OutputChannel): Promise<Server> {
    const initialization_options: InitializationOptions = {
        working_directory: working_directory,
    };

    let path: string | undefined = workspace.getConfiguration('gmCode').get('languageServerPath');
    if (path === undefined) {
        outputChannel.appendLine('Could not find server path!');
        process.exit(1);
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for gms2 documents
        documentSelector: [{ scheme: 'file', language: 'gml-gms2' }],
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
        initializationOptions: initialization_options,
    };

    // Create the language client and start the client.
    const client = new LanguageClient('gm-code', 'Gm Code Server', { command: path }, clientOptions);

    // Start the client. This will also launch the server
    await client.start();

    return new Server(client);
}

export function deactivate(client: LanguageClient): Thenable<void> | undefined {
    return client.stop();
}

interface InitializationOptions {
    working_directory: string;
}

export class Server {
    constructor(public client: LanguageClient) {}

    public async writeCommand<T extends Command>(
        command: T
    ): Promise<CommandToOutput<T> | CommandOutputError> {
        let cmd: CommandOutput = await this.client.sendRequest('textDocument/yyBoss', command);
        if (cmd.success === false) {
            return cmd as CommandOutputError;
        } else {
            return cmd as CommandToOutput<T>;
        }
    }
}
