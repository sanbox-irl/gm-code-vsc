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
import { FilesystemPath, SerializedDataValue } from 'yy-boss-ts/out/core';
import * as vscode from 'vscode';
import { VfsCommandType } from 'yy-boss-ts/out/vfs';
import { YypBossError } from 'yy-boss-ts/out/error';
import { GetResource } from 'yy-boss-ts/out/resource';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(public yyBoss: YyBoss) {}

    async getChildren(parent?: GmItem | undefined): Promise<GmItem[]> {
        if (parent === undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommand.GetFullVfs());

            return this.createChildrenOfFolder(result.flatFolderGraph, parent);
        } else {
            switch (parent.gmItemType) {
                case GmItemType.Folder:
                    let folderElement = parent as FolderItem;
                    let result = await this.yyBoss.writeCommand(
                        new vfsCommand.GetFolderVfs(folderElement.viewPath)
                    );

                    return this.createChildrenOfFolder(result.flatFolderGraph, parent);
                case GmItemType.Resource:
                    let resourceElement = parent as ResourceItem;
                    let data = await this.yyBoss.writeCommand(
                        new resourceCommands.GetAssociatedDataResource(
                            resourceElement.resource,
                            parent.label,
                            false
                        )
                    );

                    if (this.yyBoss.hasError() === false) {
                        let events = data.associatedData as SerializedDataValue;
                        let assoc_data = JSON.parse(events.data);

                        let fileNames = Object.getOwnPropertyNames(assoc_data);
                        let betterNames = await this.yyBoss.writeCommand(
                            new utilities.PrettyEventNames(fileNames)
                        );

                        let output: GmItem[] = [];
                        for (let i = 0; i < betterNames.eventNames.length; i++) {
                            const name = betterNames.eventNames[i];
                            output.push(
                                new EventItem(name, resourceElement.filesystemPath.name, fileNames[i], parent)
                            );
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

    getParent(element: GmItem): vscode.ProviderResult<GmItem> {
        return element.parent;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<GmItem | undefined> = new vscode.EventEmitter<
        GmItem | undefined
    >();

    readonly onDidChangeTreeData: vscode.Event<GmItem | undefined> = this._onDidChangeTreeData.event;

    refresh(item?: GmItem | undefined): void {
        this._onDidChangeTreeData.fire(item);
    }

    private createChildrenOfFolder(
        fg: vfsCommand.outputs.FlatFolderGraph,
        parent: GmItem | undefined
    ): GmItem[] {
        const output: GmItem[] = [];
        for (const newFolder of fg.folders) {
            output.push(new FolderItem(newFolder.name, newFolder.path, parent));
        }

        for (const newFile of fg.files) {
            switch (newFile.resourceDescriptor.resource) {
                case Resource.Object:
                    output.push(new ObjectItem(newFile.filesystemPath, parent));
                    break;

                case Resource.Script:
                    output.push(new ScriptItem(newFile.filesystemPath, parent));
                    break;

                default:
                    output.push(
                        new OtherResource(
                            newFile.filesystemPath,
                            newFile.resourceDescriptor.parentLocation,
                            newFile.resourceDescriptor.resource,
                            parent
                        )
                    );
                    break;
            }
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
    public abstract readonly parent: GmItem | undefined;

    constructor(public label: string, public collapsibleState: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
    }

    abstract tooltip: string;
    abstract id: string;
    command: vscode.Command | undefined = undefined;
    abstract iconPath: vscode.ThemeIcon;

    public static async onEditResource(gmItem: GmItem) {
        switch (gmItem.gmItemType) {
            case GmItemType.Event:
                break;
            case GmItemType.Folder:
                const folder = gmItem as FolderItem;
                const new_folder_name = await vscode.window.showInputBox({
                    value: folder.label,
                    prompt: 'New Folder Name',
                });

                if (new_folder_name !== undefined) {
                    const yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
                    await yyBoss.writeCommand(
                        new vfsCommand.RenameFolderVfs(folder.viewPath, new_folder_name)
                    );

                    if (yyBoss.hasError() == false) {
                        await yyBoss.writeCommand(new serializationCommand.SerializationCommand());

                        if (yyBoss.hasError()) {
                            console.log(yyBoss.error.error.type);
                        } else {
                            GmItem.ITEM_PROVIDER?.refresh(folder.parent);
                        }
                    } else {
                        console.log(yyBoss.error?.error.type);
                    }
                }

                break;
            case GmItemType.Resource:
                const resource = gmItem as ResourceItem;
                let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

                const new_resource_name = await vscode.window.showInputBox({
                    value: resource.filesystemPath.name,
                    prompt: `Rename ${resource.resource}`,
                    async validateInput(input: string): Promise<string | undefined> {
                        let response = await yyBoss.writeCommand(new utilities.CanUseResourceName(input));

                        if (response.nameIsValid) {
                            return undefined;
                        } else {
                            return `Name is either taken or is not a valid entry`;
                        }
                    },
                });

                if (new_resource_name !== undefined && new_resource_name.length > 0) {
                    const yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
                    await yyBoss.writeCommand(
                        new resourceCommands.RenameResource(
                            resource.resource,
                            resource.filesystemPath.name,
                            new_resource_name
                        )
                    );

                    if (yyBoss.hasError()) {
                        vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error.error)}`);
                    } else {
                        await yyBoss.writeCommand(new serializationCommand.SerializationCommand());

                        if (yyBoss.hasError()) {
                            vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error.error)}`);
                        } else {
                            GmItem.ITEM_PROVIDER?.refresh(resource.parent);
                        }
                    }
                }

                break;
        }
    }

    public static ITEM_PROVIDER: GmItemProvider | undefined;
}

export class FolderItem extends GmItem {
    public gmItemType = GmItemType.Folder;
    public contextValue = 'folderItem';

    constructor(
        public readonly label: string,
        public readonly viewPath: string,
        public readonly parent: GmItem | undefined
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.viewPath + this.label;
    }

    iconPath = new vscode.ThemeIcon('folder');

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
                    return `Error:${YypBossError.error(yyBoss.error.error)}`;
                }
            },
        });

        if (originalName === undefined || originalName.length === 0) {
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
                GmItem.ITEM_PROVIDER?.refresh(folder.parent);
            }
        }
    }
}

abstract class ResourceItem extends GmItem {
    public gmItemType = GmItemType.Resource;
    public abstract readonly resource: Resource;
    public abstract readonly filesystemPath: FilesystemPath;

    public contextValue = 'resourceItem';

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.filesystemPath.path + this.label;
    }
}

export class ScriptItem extends ResourceItem {
    public readonly resource = Resource.Script;

    constructor(public readonly filesystemPath: FilesystemPath, public readonly parent: GmItem | undefined) {
        super(filesystemPath.name + '.gml', vscode.TreeItemCollapsibleState.None);
    }

    iconPath = new vscode.ThemeIcon('file-code');

    command: vscode.Command = {
        command: 'gmVfs.openScript',
        title: 'Open Script',
        arguments: [this.filesystemPath.name],
        tooltip: 'Open this Script in the Editor',
    };

    public static async onOpenScript(scriptName: string) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
        let path = await boss.writeCommand(new utilities.ScriptGmlPath(scriptName));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }
}

export class ObjectItem extends ResourceItem {
    public readonly resource = Resource.Object;

    constructor(public readonly filesystemPath: FilesystemPath, public readonly parent: GmItem | undefined) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('group-by-ref-type');

    // commands will live here!
    // command: vscode.Command = {
    //     command: 'gmVfs.openScript',
    //     title: 'Open Script',
    //     arguments: [this.resourceName],
    //     tooltip: 'Open this Script in the Editor',
    // };
}

export class OtherResource extends ResourceItem {
    constructor(
        public readonly filesystemPath: FilesystemPath,
        public readonly parentLocation: string,
        public readonly resource: Resource,
        public readonly parent: GmItem | undefined
    ) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('file-media');
}

export class EventItem extends GmItem {
    public gmItemType = GmItemType.Event;

    constructor(
        private eventNamePretty: string,
        private objectName: string,
        private eventFname: string,
        public readonly parent: GmItem | undefined
    ) {
        super(eventNamePretty, vscode.TreeItemCollapsibleState.None);
        this.label = eventNamePretty + '.gml';
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.objectName + this.label;
    }

    command: vscode.Command = {
        command: 'gmVfs.openEvent',
        title: 'Open Event',
        arguments: [this.objectName, this.eventFname],
        tooltip: 'Open this Event in the Editor',
    };

    iconPath = new vscode.ThemeIcon('file-code');

    public static async onOpenEvent(object_name: string, event_fname: string) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
        let path = await boss.writeCommand(new utilities.EventGmlPath(object_name, event_fname));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }
}

function test() {
    class Foo {
        constructor(public me: number | undefined) {}

        mutate_me(): void {
            this.me = 3;
        }
    }

    let foo = new Foo(3);

    if (foo.me === undefined) {
        foo.mutate_me();
        let x: undefined = foo.me;
    }
}
