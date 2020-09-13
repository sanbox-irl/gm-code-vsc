import * as vscode from 'vscode';
import * as path from 'path';
import { YY_BOSS_PATH, WD } from './config';
import { LogToFile, YyBoss } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';
import { Resource } from 'yy-boss-ts';

let YY_BOSS: YyBoss | undefined = undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    async function preboot(): Promise<YyBoss | undefined> {
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

            // let yy_boss_path = await YyBoss.fetchYyBoss(YY_BOSS_DIR);
            const [status, yyp_boss] = await YyBoss.create(
                YY_BOSS_PATH,
                yyp_path,
                context.globalStoragePath,
                new LogToFile(log_path)
            );

            if (status.success) {
                console.log('successful parse');

                let yy_boss = yyp_boss as YyBoss;
                return yy_boss;
            } else {
                console.log(JSON.stringify(status));
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    let yyBoss = await preboot();
    if (yyBoss === undefined) {
        return;
    }

    const item_provider = new vfs.GmItemProvider(yyBoss);
    vfs.GmItem.ITEM_PROVIDER = item_provider;
    YY_BOSS = yyBoss;

    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.reloadWorkspace', async () => {
            await deactivate();

            let yyBoss = await preboot();

            if (yyBoss === undefined) {
                vscode.window.showErrorMessage(`Error: Could not reload gm-code-server`);
            } else {
                let provider = vfs.GmItem.ITEM_PROVIDER as vfs.GmItemProvider;
                provider.yyBoss = yyBoss;
                YY_BOSS = yyBoss;

                provider.refresh(undefined);
            }
        })
    );

    context.subscriptions.push(vscode.window.registerTreeDataProvider('gmVfs', item_provider));
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

export async function deactivate(): Promise<void> {
    if (YY_BOSS === undefined || YY_BOSS.hasClosed) {
        return;
    }

    await YY_BOSS.shutdown();
}
