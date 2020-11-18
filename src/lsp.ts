import { resolve } from 'dns';
import { commands } from 'vscode';
import { LanguageClient, LanguageClientOptions, RequestType, RequestType0 } from 'vscode-languageclient';
import { Command, CommandOutput } from 'yy-boss-ts/out/core';
import { CommandOutputError, YypBossError } from 'yy-boss-ts/out/error';
import { CommandToOutput } from 'yy-boss-ts/out/input_to_output';
import { LSP_PATH } from './config';
import { Initialization } from './extension';

export async function activate(init: Initialization): Promise<Server> {
    const initialization_options: InitializationOptions = {
        working_directory: init.context.globalStoragePath,
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for gms2 documents
        documentSelector: [{ scheme: 'file', language: 'gml-gms2' }],
        outputChannel: init.outputChannel,
        traceOutputChannel: init.outputChannel,
        initializationOptions: initialization_options,
    };

    // Create the language client and start the client.
    const client = new LanguageClient('gm-code', 'Gm Code Server', { command: LSP_PATH }, clientOptions);

    // Start the client. This will also launch the server
    client.start();

    await client.onReady();

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
