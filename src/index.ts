import * as vscode from 'vscode';
import { YyBoss, quickstartYyBoss } from 'yy-boss-ts';
import * as fs from 'fs';
import * as path from 'path';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(private yyBoss: YyBoss) {}

    getChildren(element?: GmItem | undefined): vscode.ProviderResult<GmItem[]> {
        throw new Error('Method not implemented.');
    }

    getTreeItem(element: GmItem): vscode.TreeItem {
        return element;
    }
}

class GmItem extends vscode.TreeItem {}

async function main() {
    let paths = vscode.workspace.workspaceFolders as readonly vscode.WorkspaceFolder[];
    let yyp_path: string | undefined = undefined;

    // try to find a yyp
    for (let workspace_folder of paths) {
        let files = await vscode.workspace.fs.readDirectory(workspace_folder.uri);
        for (let [fpath, ftype] of files) {
            if (ftype == vscode.FileType.File && fpath.endsWith('.yyp')) {
                yyp_path = path.join(workspace_folder.uri.path, fpath);
                break;
            }
        }
        if (yyp_path !== undefined) {
            break;
        }
    }

    console.log('hmmm');

    if (yyp_path !== undefined) {
        try {
            const yyp_boss = await quickstartYyBoss('GUAH', yyp_path, './tmp');
        } catch (e) {
            console.log(e);
        }
        console.log('pretty amazing we made it here, you know');
    } else {
        console.log('wuh');
    }
}

main();
