// import * as vscode from 'vscode';
import { YyBoss, vfsCommands, ViewPath } from 'yy-boss-ts';
// import * as vscode from 'vscode';
import * as path from 'path';
import { YY_BOSS_EXE, WD } from './config';

// export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
//     constructor(private yyBoss: YyBoss) {}

//     async getChildren(element?: GmItem | undefined): Promise<GmItem[]> {
//         if (element === undefined) {
//             console.log('reading root!');
//             let folder = await this.yyBoss.writeCommand(new vfsCommands.GetFullVfs());

//             console.log('read root!');

//             let output: GmItem[] = [];
//             for (let newFolder of folder.folderGraph.folders) {
//                 output.push(
//                     new GmItem(
//                         newFolder.name,
//                         newFolder.viewPathLocation(),
//                         vscode.TreeItemCollapsibleState.Collapsed
//                     )
//                 );
//             }

//             return output;
//         } else if (element.path !== undefined) {
//             let folder = await this.yyBoss.writeCommand(new vfsCommands.GetFolderVfs(element.path));
//             let output: GmItem[] = [];

//             for (let newFile of folder.folderGraph.files) {
//                 output.push(new GmItem(newFile.name, undefined, vscode.TreeItemCollapsibleState.None));
//             }

//             return output;
//         } else {
//             console.log('impossible?');
//             return [];
//         }
//     }

//     getTreeItem(element: GmItem): vscode.TreeItem {
//         return element;
//     }
// }

// class GmItem extends vscode.TreeItem {
//     constructor(
//         public readonly label: string,
//         public readonly path: string | undefined,
//         public readonly collapsibleState: vscode.TreeItemCollapsibleState
//     ) {
//         super(label, collapsibleState);
//     }

//     get tooltip(): string {
//         return `${this.label}`;
//     }
// }

async function main() {
    // let paths = vscode.workspace.workspaceFolders as readonly vscode.WorkspaceFolder[];
    // let yyp_path: string | undefined = undefined;

    // // try to find a yyp
    // for (let workspace_folder of paths) {
    //     let files = await vscode.workspace.fs.readDirectory(workspace_folder.uri);
    //     for (let [fpath, ftype] of files) {
    //         if (ftype == vscode.FileType.File && fpath.endsWith('.yyp')) {
    //             yyp_path = path.join(workspace_folder.uri.fsPath, fpath);
    //             break;
    //         }
    //     }
    //     if (yyp_path !== undefined) {
    //         break;
    //     }
    // }

    // console.log('...starting up');

    // if (yyp_path !== undefined) {
    const [status, yyp_boss] = await YyBoss.create(
        YY_BOSS_EXE,
        'C:/Users/jjspi/Documents/Projects/Gms2/SwordAndField/FieldsOfMistria.yyp',
        WD
    );

    if (status.success) {
        console.log('success!');

        let folder = await (yyp_boss as YyBoss).writeCommand(new vfsCommands.GetFullVfs());
        console.log(folder.folderGraph.name);

        // vscode.window.registerTreeDataProvider('gmVfs', new GmItemProvider(yyp_boss as YyBoss));
    } else {
        console.log('rats');
    }
    // }
}

main();
