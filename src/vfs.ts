import { YyBoss, vfsCommands, ViewPath, resourceCommands, Resource, utilities } from 'yy-boss-ts';
import { SerializedDataValue } from 'yy-boss-ts/out/core';
import * as vscode from 'vscode';
import * as path from 'path';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(private yyBoss: YyBoss) {}

    async getChildren(element?: GmItem | undefined): Promise<GmItem[]> {
        if (element === undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommands.GetFullVfs());

            return this.createChildrenOfFolder(result.flatFolderGraph);
        } else {
            switch (element.gmItemType) {
                case GmItemType.Folder:
                    let folderElement = element as FolderItem;
                    let result = await this.yyBoss.writeCommand(
                        new vfsCommands.GetFolderVfs(folderElement.viewPath)
                    );

                    return this.createChildrenOfFolder(result.flatFolderGraph);
                case GmItemType.Resource:
                    let resourceElement = element as ResourceItem;
                    let data = await this.yyBoss.writeCommand(
                        new resourceCommands.GetAssociatedDataResource(
                            resourceElement.resource,
                            element.label,
                            false
                        )
                    );

                    if (this.yyBoss.hasError === false) {
                        let events = data.associatedData as SerializedDataValue;
                        let assoc_data = JSON.parse(events.data);

                        let fileNames = Object.getOwnPropertyNames(assoc_data);
                        let betterNames = await this.yyBoss.writeCommand(
                            new utilities.PrettyEventNames(fileNames)
                        );

                        let output: GmItem[] = [];
                        for (let i = 0; i < betterNames.eventNames.length; i++) {
                            const name = betterNames.eventNames[i];
                            const this_path = path.join(resourceElement.filePath, fileNames[i]);
                            output.push(new EventItem(name, this_path));
                        }

                        return output;
                    } else {
                        console.log(JSON.stringify(this.yyBoss.error, undefined, 4));
                        return [];
                    }
                case GmItemType.Event:
                    return [];
            }
        }
    }

    getTreeItem(element: GmItem): vscode.TreeItem {
        return element;
    }

    private createChildrenOfFolder(fg: vfsCommands.outputs.FlatFolderGraph): GmItem[] {
        const output: GmItem[] = [];
        for (const newFolder of fg.folders) {
            output.push(new FolderItem(newFolder.name, newFolder.path));
        }

        for (const newFile of fg.files) {
            output.push(
                new ResourceItem(
                    newFile.filesystemPath.name,
                    newFile.filesystemPath.path,
                    newFile.resourceDescriptor.resource
                )
            );
        }

        return output;
    }
}

enum GmItemType {
    Folder,
    Resource,
    Event,
}

abstract class GmItem extends vscode.TreeItem {
    public abstract readonly gmItemType: GmItemType;

    constructor(public label: string, public collapsibleState: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
    }

    abstract get tooltip(): string;
    abstract get id(): string;
    get command(): vscode.Command | undefined {
        return undefined;
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

class FolderItem extends GmItem {
    public gmItemType = GmItemType.Folder;
    public contextValue = 'folderItem';

    constructor(label: string, public readonly viewPath: string) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.label = label;
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.viewPath + this.label;
    }
}

export class ResourceItem extends GmItem {
    public gmItemType = GmItemType.Resource;

    constructor(label: string, public readonly filePath: string, public readonly resource: Resource) {
        super(
            label,
            resource === Resource.Object
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        if (this.resource !== Resource.Object) {
            this.label = label + '.gml';
        }
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.filePath + this.label;
    }

    get command(): vscode.Command | undefined {
        if (this.resource === Resource.Script) {
            return {
                command: 'gmVfs.openScript',
                title: 'Open',
                arguments: [this],
                tooltip: 'Open this Script in the Editor',
            };
        } else {
            return undefined;
        }
    }

    public static async onOpenScript(filePath: string) {
        await vscode.workspace.openTextDocument(filePath);
    }
}

class EventItem extends GmItem {
    public gmItemType = GmItemType.Event;

    constructor(label: string, public readonly relativeFilepath: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label + '.gml';
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.relativeFilepath + this.label;
    }

    get command(): vscode.Command | undefined {
        return undefined;
    }
}
