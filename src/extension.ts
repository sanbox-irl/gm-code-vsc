import * as vscode from 'vscode';
import * as path from 'path';
import * as vfs from './vfs';
import * as lsp from './lsp';
import * as fs from 'fs';

let server: lsp.Server;

export async function activate(context: vscode.ExtensionContext) {
    async function preboot(): Promise<vscode.WorkspaceFolder | undefined> {
        const paths = vscode.workspace.workspaceFolders as readonly vscode.WorkspaceFolder[];
        let yyp_path: string | undefined = undefined;
        let f_workspace_folder: vscode.WorkspaceFolder | undefined = undefined;

        // try to find a yyp
        for (const workspace_folder of paths) {
            const files = await vscode.workspace.fs.readDirectory(workspace_folder.uri);
            for (const [fpath, ftype] of files) {
                if (ftype == vscode.FileType.File && fpath.endsWith('.yyp')) {
                    yyp_path = path.join(workspace_folder.uri.fsPath, fpath);
                    f_workspace_folder = workspace_folder;
                    break;
                }
            }
            if (yyp_path !== undefined) {
                break;
            }
        }
        if (yyp_path === undefined) {
            return undefined;
        }

        let log_path = path.join(context.logUri.path, 'log.log');

        outputChannel.appendLine(`Logging is ${log_path}`);
        outputChannel.appendLine(`Working Directory is ${context.globalStorageUri.fsPath}`);

        outputChannel.appendLine(`${fs.existsSync(context.globalStorageUri.fsPath)}`);

        if (fs.existsSync(context.globalStorageUri.fsPath) == false) {
            fs.mkdir(context.globalStorageUri.fsPath, () => {});
        }

        return f_workspace_folder as vscode.WorkspaceFolder;
    }

    let outputChannel = vscode.window.createOutputChannel('gm-code');
    let output = await preboot();
    if (output === undefined) {
        return;
    }

    let workspaceFolder = output;
    server = await lsp.activate(workspaceFolder.uri.fsPath, outputChannel);

    const initializer: Initialization = {
        context: context,
        workspaceFolder: workspaceFolder,
        outputChannel: outputChannel,

        request_reboot: async () => {
            let output = await preboot();
            if (output === undefined) {
                return false;
            }

            server = await lsp.activate(workspaceFolder.uri.fsPath, outputChannel);

            return true;
        },
    };

    const make_vfs: boolean | undefined = vscode.workspace.getConfiguration('gmCode').get('createVFS');
    if (make_vfs != undefined && make_vfs) {
        vfs.register(initializer, server);
    }
}

export async function deactivate() {
    lsp.deactivate(server.client);
}

export interface Initialization {
    context: vscode.ExtensionContext;
    workspaceFolder: vscode.WorkspaceFolder;
    outputChannel: vscode.OutputChannel;

    request_reboot: () => Promise<boolean>;
}
