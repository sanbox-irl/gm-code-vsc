import * as vscode from 'vscode';
import * as path from 'path';
import { YY_BOSS_PATH, WD } from './config';
import { LogToFile, YyBoss } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';
import { Resource } from 'yy-boss-ts';
import { parentPort } from 'worker_threads';

async function preboot() {
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
        console.log(`...starting up with ${yyp_path}`);

        // let yy_boss_path = await YyBoss.fetchYyBoss(YY_BOSS_DIR);
        const [status, yyp_boss] = await YyBoss.create(YY_BOSS_PATH, yyp_path, WD, new LogToFile('log.log'));

        if (status.success) {
            console.log('successful parse');

            let yy_boss = yyp_boss as YyBoss;
            main(yy_boss);
        } else {
            console.log(JSON.stringify(status));
        }
    }
}

async function main(yyBoss: YyBoss) {
    const item_provider = new vfs.GmItemProvider(yyBoss);
    vfs.GmItem.ITEM_PROVIDER = item_provider;

    vscode.window.registerTreeDataProvider('gmVfs', item_provider);

    vscode.commands.registerCommand('gmVfs.openScript', vfs.ScriptItem.onOpenScript);
    vscode.commands.registerCommand('gmVfs.createScript', (parent: vfs.FolderItem) => {
        vfs.ResourceItem.onCreateResource(parent, Resource.Script);
    });
    vscode.commands.registerCommand('gmVfs.openEvent', vfs.EventItem.onOpenEvent);
    vscode.commands.registerCommand('gmVfs.createFolder', vfs.FolderItem.onCreateFolder);
    vscode.commands.registerCommand('gmVfs.deleteFolder', vfs.FolderItem.onDeleteFolder);

    vscode.commands.registerCommand('gmVfs.createObject', (parent: vfs.FolderItem) => {
        vfs.ResourceItem.onCreateResource(parent, Resource.Object);
    });
    vscode.commands.registerCommand('gmVfs.deleteResource', vfs.ResourceItem.onDeleteResource);
    vscode.commands.registerCommand('gmVfs.renameResource', vfs.ResourceItem.onRenameResource);
}

preboot();
