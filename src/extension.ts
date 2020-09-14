import * as vscode from 'vscode';
import * as path from 'path';
import { ClosureStatus, LogToFile, YyBoss, YyBossDownloadStatus } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';
import { Resource } from 'yy-boss-ts';
import { ProjectMetadata } from 'yy-boss-ts/out/core';
import { StartupOutputSuccess } from 'yy-boss-ts/out/startup';

let YY_BOSS: YyBoss | undefined = undefined;

export async function activate(context: vscode.ExtensionContext) {
    async function preboot(): Promise<[YyBoss, ProjectMetadata] | undefined> {
        const paths = vscode.workspace.workspaceFolders as readonly vscode.WorkspaceFolder[];
        let yyp_path: string | undefined = undefined;

        // try to find a yyp
        for (const workspace_folder of paths) {
            const files = await vscode.workspace.fs.readDirectory(workspace_folder.uri);
            for (const [fpath, ftype] of files) {
                if (ftype == vscode.FileType.File && fpath.endsWith('.yyp')) {
                    yyp_path = path.join(workspace_folder.uri.fsPath, fpath);
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
                let boss_download_status = await YyBoss.downloadStatus(context.globalStoragePath);

                if (boss_download_status == YyBossDownloadStatus.Success) {
                    // this will just return the subpath actually, which is pretty messy!
                    boss_path = await YyBoss.fetchYyBoss(context.globalStoragePath);
                } else {
                    let output = await vscode.window.showInformationMessage(
                        'Gm Code needs a backend, local server. Would you like to Download it?',
                        'Download',
                        'Cancel'
                    );

                    if (output !== 'Download') {
                        return undefined;
                    }

                    boss_path = await YyBoss.fetchYyBoss(context.globalStoragePath);
                }
            } else {
                boss_path = override;
            }

            console.log(`Gm Code server is ${boss_path}`);

            // let yy_boss_path = await YyBoss.fetchYyBoss(YY_BOSS_DIR);
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

                return [yy_boss, (status as StartupOutputSuccess).projectMetadata];
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

    let [yyBoss, projectMetadata] = output;

    const item_provider = new vfs.GmItemProvider(yyBoss);
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
                let [yyBoss, projectMetadata] = output;

                console.log('reloaded workspace');

                vfs.GmItem.PROJECT_METADATA = projectMetadata;
                item_provider.yyBoss = yyBoss;
                YY_BOSS = yyBoss;

                item_provider.refresh(undefined);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.openScript', vfs.ScriptItem.onOpenScript)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createScript', (parent: vfs.FolderItem) => {
            vfs.ResourceItem.onCreateResource(parent, Resource.Script);
        })
    );
    context.subscriptions.push(vscode.commands.registerCommand('gmVfs.openEvent', vfs.EventItem.onOpenEvent));
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createFolder', vfs.FolderItem.onCreateFolder)
    );
    // for 0.2.0
    // context.subscriptions.push(
    //     vscode.commands.registerCommand('gmVfs.renameFolder', vfs.FolderItem.OnRenameFolder)
    // );
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
    Object.values(vfs.LimitedGmEvent).forEach(value => {
        const cmd_name = `gmVfs.add${value}Event`;
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd_name, (parent: vfs.ObjectItem) => {
                vfs.ObjectItem.onCreateEvent(parent, value);
            })
        );
    });
}

export async function deactivate() {
    if (YY_BOSS === undefined || YY_BOSS.closureStatus !== ClosureStatus.Open) {
        return;
    }

    YY_BOSS.shutdown();
}
