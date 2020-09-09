import {
    YyBoss,
    vfsCommands as vfsCommand,
    ViewPath,
    resourceCommands,
    Resource,
    utilities,
    serializationCommands as serializationCommand,
    vfsCommands,
} from 'yy-boss-ts';
import { SerializedDataValue } from 'yy-boss-ts/out/core';
import * as vscode from 'vscode';
import { VfsCommandType } from 'yy-boss-ts/out/vfs';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(public yyBoss: YyBoss) {}

    async getChildren(element?: GmItem | undefined): Promise<GmItem[]> {
        if (element === undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommand.GetFullVfs());

            return this.createChildrenOfFolder(result.flatFolderGraph);
        } else {
            switch (element.gmItemType) {
                case GmItemType.Folder:
                    let folderElement = element as FolderItem;
                    let result = await this.yyBoss.writeCommand(
                        new vfsCommand.GetFolderVfs(folderElement.viewPath)
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
                            output.push(new EventItem(name, resourceElement.resourceName, fileNames[i]));
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

    private _onDidChangeTreeData: vscode.EventEmitter<GmItem | undefined> = new vscode.EventEmitter<
        GmItem | undefined
    >();

    readonly onDidChangeTreeData: vscode.Event<GmItem | undefined> = this._onDidChangeTreeData.event;

    refresh(item?: GmItem | undefined): void {
        this._onDidChangeTreeData.fire(item);
    }

    private createChildrenOfFolder(fg: vfsCommand.outputs.FlatFolderGraph): GmItem[] {
        const output: GmItem[] = [];
        for (const newFolder of fg.folders) {
            output.push(new FolderItem(newFolder.name, newFolder.path));
        }

        for (const newFile of fg.files) {
            output.push(
                new ResourceItem(
                    newFile.filesystemPath.name,
                    newFile.filesystemPath.path,
                    newFile.resourceDescriptor.resource,
                    this.yyBoss
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

export abstract class GmItem extends vscode.TreeItem {
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

    public static async onEditResource(gmItem: GmItem) {
        switch (gmItem.gmItemType) {
            case GmItemType.Event:
                break;
            case GmItemType.Folder:
                // const folder = gmItem as FolderItem;
                // const new_name = await vscode.window.showInputBox({
                //     value: folder.label,
                //     prompt: 'New Folder Name',
                // });

                // if (new_name !== undefined) {
                //     const yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
                //     yyBoss.writeCommand(new vfsCommand.EDIT_VFS?());
                // }

                break;
            case GmItemType.Resource:
                break;
        }
    }

    public static ITEM_PROVIDER: GmItemProvider | undefined;
}

export class FolderItem extends GmItem {
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

    public static async onCreateFolder(folder: FolderItem) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        const originalName = await vscode.window.showInputBox({
            value: folder.label,
            prompt: 'New Folder Name',
            async validateInput(str: string): Promise<string | undefined> {
                let newFolder = await yyBoss.writeCommand(
                    new vfsCommand.CreateFolderVfs(folder.viewPath, str)
                );

                if (yyBoss.error === undefined) {
                    await yyBoss.writeCommand(
                        new vfsCommand.RemoveFolderVfs(newFolder.createdFolder.path, false)
                    );

                    return undefined;
                } else {
                    return `Cannot use that name: ${yyBoss.error.error}`;
                }
            },
        });

        if (originalName === undefined) {
            return;
        }

        let name = originalName;
        let i = 0;
        let success = false;
        while (true) {
            await yyBoss.writeCommand(new vfsCommand.CreateFolderVfs(folder.viewPath, name));

            if (yyBoss.error === undefined) {
                success = true;
                break;
            } else {
                i++;
                name = `New Folder ${i}`;

                if (i === 10) {
                    break;
                }
            }
        }

        if (success) {
            await yyBoss.writeCommand(new serializationCommand.SerializationCommand());
            if (yyBoss.error === undefined) {
                GmItem.ITEM_PROVIDER?.refresh(folder);
            }
        }
    }

    public static async onDeleteFolder(folder: FolderItem) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        await yyBoss.writeCommand(new vfsCommand.RemoveFolderVfs(folder.viewPath, true));

        if (yyBoss.error === undefined) {
            await yyBoss.writeCommand(new serializationCommand.SerializationCommand());
            if (yyBoss.error === undefined) {
                GmItem.ITEM_PROVIDER?.refresh(undefined);
            }
        }
    }
}

export class ResourceItem extends GmItem {
    public gmItemType = GmItemType.Resource;

    constructor(
        public readonly resourceName: string,
        public readonly filePath: string,
        public readonly resource: Resource,
        private yyBoss: YyBoss
    ) {
        super(
            resourceName,
            resource === Resource.Object
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        if (this.resource !== Resource.Object) {
            this.label = resourceName + '.gml';
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
                title: 'Open Script',
                arguments: [this.resourceName],
                tooltip: 'Open this Script in the Editor',
            };
        } else {
            return undefined;
        }
    }

    public static async onOpenScript(scriptName: string) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
        let path = await boss.writeCommand(new utilities.ScriptGmlPath(scriptName));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }
}

export class EventItem extends GmItem {
    public gmItemType = GmItemType.Event;

    constructor(private eventNamePretty: string, private objectName: string, private eventFname: string) {
        super(eventNamePretty, vscode.TreeItemCollapsibleState.None);
        this.label = eventNamePretty + '.gml';
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.objectName + this.label;
    }

    get command(): vscode.Command {
        return {
            command: 'gmVfs.openEvent',
            title: 'Open Event',
            arguments: [this.objectName, this.eventFname],
            tooltip: 'Open this Event in the Editor',
        };
    }

    public static async onOpenEvent(object_name: string, event_fname: string) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
        let path = await boss.writeCommand(new utilities.EventGmlPath(object_name, event_fname));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }
}
