import * as vscode from 'vscode';
import * as path from 'path';
import { ClosureStatus, LogToFile, YyBoss } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';
import { ProjectMetadata } from 'yy-boss-ts/out/core';
import { StartupOutputSuccess } from 'yy-boss-ts/out/startup';
import * as tasks from './tasks';
import * as lsp from './lsp';
import { Fetch } from 'yy-boss-ts/out/fetch';

let YY_BOSS: YyBoss | undefined = undefined;

export async function activate(context: vscode.ExtensionContext) {
    async function preboot(): Promise<[vscode.WorkspaceFolder, string, YyBoss, ProjectMetadata] | undefined> {
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

        if (yyp_path !== undefined) {
            let log_path = path.join(context.logPath, 'log.log');

            outputChannel.appendLine(`Logging is ${log_path}`);
            outputChannel.appendLine(`Working Directory is ${context.globalStoragePath}`);

            let override: string | undefined = vscode.workspace
                .getConfiguration('gmCode')
                .get('overrideServerPath');
            let boss_path: string;

            // do we not have an override here at all? sometimes it returns null?
            if (override === undefined || override === null) {
                boss_path = await Fetch.fetchYyBoss(context.globalStoragePath, async old_version => {
                    let needs_update =
                        old_version === undefined ||
                        old_version.compare(Fetch.YY_BOSS_CURRENT_VERSION) === -1;

                    if (needs_update) {
                        let output = await vscode.window.showInformationMessage(
                            `Yy-boss ${Fetch.YY_BOSS_CURRENT_VERSION} has released. Would you like to download it?`,
                            'Download',
                            'Cancel'
                        );

                        return output === 'Download';
                    } else {
                        return false;
                    }
                });
            } else {
                boss_path = override;
            }

            // check if Adam is on the path, and if it's current enough...
            const adam_path = await Fetch.fetchAdam(context.globalStoragePath, async old_version => {
                let needs_update =
                    old_version === undefined || old_version.compare(Fetch.ADAM_CURRENT_VERSION) === -1;

                if (needs_update) {
                    let output = await vscode.window.showInformationMessage(
                        `adam ${Fetch.ADAM_CURRENT_VERSION}, required to compile Gms2 projects, has released. Would you like to download it?`,
                        'Download',
                        'Cancel'
                    );

                    return output === 'Download';
                } else {
                    return false;
                }
            });

            outputChannel.appendLine(`Gm Code server is ${boss_path}`);
            const [status, yyp_boss] = await YyBoss.create(
                boss_path,
                yyp_path,
                context.globalStoragePath,
                new LogToFile(log_path)
            );

            if (status.success) {
                const yy_boss = yyp_boss as YyBoss;
                yy_boss.attachUnexpectedShutdownCallback(async () => {
                    let clicked_submit = await vscode.window.showErrorMessage(
                        'Well, this is awkward. The backing Gm Code server has crashed. Please check the Output console for the current log, and submit a bug report.',
                        'Submit a bug report'
                    );

                    if (clicked_submit == 'Submit a bug report') {
                        await vscode.commands.executeCommand(
                            'vscode.open',
                            vscode.Uri.parse('https://github.com/sanbox-irl/gm-code-vsc/issues')
                        );
                    }
                });

                return [
                    f_workspace_folder as vscode.WorkspaceFolder,
                    adam_path,
                    yy_boss,
                    (status as StartupOutputSuccess).projectMetadata,
                ];
            } else {
                outputChannel.appendLine(JSON.stringify(status));
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    let outputChannel = vscode.window.createOutputChannel('gm-code');
    let output = await preboot();
    if (output === undefined) {
        return;
    }

    let [workspaceFolder, adam, yyBoss, projectMetadata] = output;

    const initializer: Initialization = {
        context: context,
        projectMetadata: projectMetadata,
        workspaceFolder: workspaceFolder,
        yyBoss: yyBoss,
        outputChannel: outputChannel,
        adamExePath: adam,

        request_reboot: async () => {
            throw 'not yet implemented';
            await preboot();

            return true;
        },
    };

    lsp.activate(initializer);
    vfs.register(initializer);
    tasks.register(initializer);
}

export async function deactivate() {
    if (YY_BOSS === undefined || YY_BOSS.closureStatus !== ClosureStatus.Open) {
        return;
    }

    YY_BOSS.shutdown();
    lsp.deactivate();
}

export interface Initialization {
    context: vscode.ExtensionContext;
    workspaceFolder: vscode.WorkspaceFolder;
    projectMetadata: ProjectMetadata;
    yyBoss: YyBoss;
    adamExePath: string;
    outputChannel: vscode.OutputChannel;

    request_reboot: () => Promise<boolean>;
}
