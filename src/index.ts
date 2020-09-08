import * as vscode from 'vscode';
import * as path from 'path';
import { YY_BOSS_DIR, WD } from './config';
import { LogToFile, YyBoss } from 'yy-boss-ts/out/yy_boss';
import * as vfs from './vfs';

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
        const yy_boss_path = path.join(YY_BOSS_DIR, 'yy-boss-cli.exe');
        const [status, yyp_boss] = await YyBoss.create(yy_boss_path, yyp_path, WD, new LogToFile('log.log'));

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
    vfs.GmItem.YY_BOSS = yyBoss;
    vscode.window.registerTreeDataProvider('gmVfs', new vfs.GmItemProvider(yyBoss));

    vscode.commands.registerCommand('gmVfs.openScript', vfs.ResourceItem.onOpenScript);
    vscode.commands.registerCommand('gmVfs.openEvent', vfs.EventItem.onOpenEvent);
}

preboot();
