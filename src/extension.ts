import * as vscode from 'vscode';
import * as path from 'path';
import { ClosureStatus, LogToFile, YyBoss } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';
import { Resource } from 'yy-boss-ts';
import { ProjectMetadata } from 'yy-boss-ts/out/core';
import { StartupOutputSuccess } from 'yy-boss-ts/out/startup';
import { AdamTaskProvider } from './tasks';
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

            console.log(`Logging is ${log_path}`);
            console.log(`Working Directory is ${context.globalStoragePath}`);

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

            console.log(`Gm Code server is ${boss_path}`);
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
                console.log(JSON.stringify(status));
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    let output = await preboot();
    if (output === undefined) {
        return;
    }

    let [workspaceFolder, adam, yyBoss, projectMetadata] = output;

    //#region  Vfs
    const item_provider = new vfs.GmItemProvider(yyBoss, workspaceFolder.uri.fsPath);
    vfs.GmItem.ITEM_PROVIDER = item_provider;
    vfs.GmItem.PROJECT_METADATA = projectMetadata;
    YY_BOSS = yyBoss;

    context.subscriptions.push(
        vscode.window.createTreeView('gmVfs', {
            treeDataProvider: item_provider,
            showCollapseAll: true,
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.reloadWorkspace', async () => {
            console.log('reloading workspace');
            if (YY_BOSS !== undefined && YY_BOSS.closureStatus === ClosureStatus.Open) {
                // do not await this
                YY_BOSS.shutdown();
            }

            let output = await preboot();
            if (output === undefined) {
                vscode.window.showErrorMessage(`Error: Could not reload gm-code-server`);
            } else {
                let [_, _adam, yyBoss, projectMetadata] = output;

                console.log('reloaded workspace');

                vfs.GmItem.PROJECT_METADATA = projectMetadata;
                item_provider.yyBoss = yyBoss;
                YY_BOSS = yyBoss;

                item_provider.refresh(undefined);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.open', async (uri: vscode.Uri) => {
            let new_item = await vscode.workspace.openTextDocument(uri);
            vscode.window.showTextDocument(new_item);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createScript', (parent: vfs.FolderItem) => {
            vfs.ResourceItem.onCreateResource(parent, Resource.Script);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createFolder', vfs.FolderItem.onCreateFolder)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.renameFolder', vfs.FolderItem.OnRenameFolder)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.deleteFolder', vfs.FolderItem.onDeleteFolder)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createObject', (parent: vfs.FolderItem) => {
            vfs.ResourceItem.onCreateResource(parent, Resource.Object);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.deleteResource', vfs.ResourceItem.onDeleteResource)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.renameResource', vfs.ResourceItem.onRenameResource)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.deleteEvent', vfs.EventItem.onDeleteEvent)
    );

    // register all our event stuff -- this is a hack until October 2020 when we have submenus
    // when we will explore DIFFERENT hacks
    for (const value of Object.values(vfs.GmEvent)) {
        const cmd_name = `gmVfs.add${value}`;
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd_name, (parent: vfs.ObjectItem) => {
                vfs.ObjectItem.onCreateEvent(parent, value);
            })
        );
    }
    //#endregion
    //#region Task Providers
    const taskProvider = vscode.tasks.registerTaskProvider(
        AdamTaskProvider.TaskType,
        new AdamTaskProvider(workspaceFolder, adam)
    );
    context.subscriptions.push(taskProvider);

    //#endregion
}

export async function deactivate() {
    if (YY_BOSS === undefined || YY_BOSS.closureStatus !== ClosureStatus.Open) {
        return;
    }

    YY_BOSS.shutdown();
}
