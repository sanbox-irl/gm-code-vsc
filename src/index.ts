import * as vscode from 'vscode';
import { YyBoss, vfsCommands, ViewPath, resourceCommands, Resource, utilities } from 'yy-boss-ts';
import * as path from 'path';
import { YY_BOSS_EXE, WD } from './config';
import { SerializedDataType, SerializedDataValue } from 'yy-boss-ts/out/core';
import { LogToFile } from 'yy-boss-ts/out/yy_boss';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(private yyBoss: YyBoss) {}

    async getChildren(element?: GmItem | undefined): Promise<GmItem[]> {
        if (element === undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommands.GetFullVfs());

            return this.createChildren(result.flatFolderGraph);
        } else if (element.viewPath !== undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommands.GetFolderVfs(element.viewPath));

            return this.createChildren(result.flatFolderGraph);
        } else if (element.resource === Resource.Object) {
            let data = await this.yyBoss.writeCommand(
                new resourceCommands.GetAssociatedDataResource(element.resource, element.label, false)
            );

            if (this.yyBoss.hasError === false) {
                if (data.associatedData.dataType === SerializedDataType.Value) {
                    let events = data.associatedData as SerializedDataValue;
                    let assoc_data = JSON.parse(events.data);

                    let names = Object.getOwnPropertyNames(assoc_data);

                    let better_names = await this.yyBoss.writeCommand(new utilities.PrettyEventNames(names));

                    let output: GmItem[] = [];
                    for (const name of better_names.eventNames) {
                        output.push(
                            new GmItem(
                                name + '.gml',
                                undefined,
                                element.relativeFilepath,
                                vscode.TreeItemCollapsibleState.None
                            )
                        );
                    }

                    return output;
                } else {
                    return [];
                }
            } else {
                console.log(JSON.stringify(this.yyBoss.error, undefined, 4));
                return [];
            }
        } else {
            return [];
        }
    }

    getTreeItem(element: GmItem): vscode.TreeItem {
        return element;
    }

    private createChildren(fg: vfsCommands.outputs.FlatFolderGraph): GmItem[] {
        const output: GmItem[] = [];
        for (const newFolder of fg.folders) {
            output.push(
                new GmItem(
                    newFolder.name,
                    newFolder.path,
                    undefined,
                    vscode.TreeItemCollapsibleState.Collapsed
                )
            );
        }

        for (const newFile of fg.files) {
            let name = newFile.filesystemPath.name;
            if (newFile.resourceDescriptor.resource == Resource.Script) {
                name += '.gml';
            }

            let state = vscode.TreeItemCollapsibleState.None;
            if (newFile.resourceDescriptor.resource == Resource.Object) {
                state = vscode.TreeItemCollapsibleState.Collapsed;
            }

            output.push(
                new GmItem(
                    name,
                    undefined,
                    newFile.filesystemPath.path,
                    state,
                    newFile.resourceDescriptor.resource
                )
            );
        }

        return output;
    }
}

class GmItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly viewPath: string | undefined,
        public readonly relativeFilepath: string | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resource?: Resource | undefined
    ) {
        super(label, collapsibleState);
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        if (this.viewPath !== undefined) {
            return this.viewPath + this.label;
        } else if (this.relativeFilepath !== undefined) {
            return this.relativeFilepath + this.label;
        } else {
            return this.label;
        }
    }

    get iconPath(): vscode.ThemeIcon {
        switch (this.collapsibleState) {
            case vscode.TreeItemCollapsibleState.None:
                return new vscode.ThemeIcon('file-code');

            case vscode.TreeItemCollapsibleState.Collapsed:
                return new vscode.ThemeIcon('folder');

            case vscode.TreeItemCollapsibleState.Expanded:
                return new vscode.ThemeIcon('folder-opened');
        }
    }
}

async function main() {
    let paths = vscode.workspace.workspaceFolders as readonly vscode.WorkspaceFolder[];
    let yyp_path: string | undefined = undefined;

    // try to find a yyp
    for (let workspace_folder of paths) {
        let files = await vscode.workspace.fs.readDirectory(workspace_folder.uri);
        for (let [fpath, ftype] of files) {
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

        const [status, yyp_boss] = await YyBoss.create(YY_BOSS_EXE, yyp_path, WD, new LogToFile('log.log'));

        if (status.success) {
            console.log('successful parse');

            let yy_boss = yyp_boss as YyBoss;
            vscode.window.registerTreeDataProvider('gmVfs', new GmItemProvider(yy_boss));
        } else {
            console.log(JSON.stringify(status));
        }
    }
}

main();
