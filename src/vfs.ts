import { YyBoss, vfsCommand, resourceCommand, Resource, util } from 'yy-boss-ts';
import {
    FilesystemPath,
    ProjectMetadata,
    SerializedDataDefault,
    SerializedDataFilepath,
    SerializedDataValue,
    ViewPath,
} from 'yy-boss-ts/out/core';
import * as vscode from 'vscode';
import { YypBossError } from 'yy-boss-ts/out/error';
import { SerializationCommand } from 'yy-boss-ts/out/serialization';
import * as fs from 'fs';

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(public yyBoss: YyBoss) {}

    async getChildren(parent?: GmItem | undefined): Promise<GmItem[]> {
        if (parent === undefined) {
            let result = await this.yyBoss.writeCommand(new vfsCommand.GetFullVfs());

            return await this.createChildrenOfFolder(result.flatFolderGraph, parent);
        } else {
            switch (parent.gmItemType) {
                case GmItemType.Folder:
                    let folderElement = parent as FolderItem;
                    let result = await this.yyBoss.writeCommand(
                        new vfsCommand.GetFolderVfs(folderElement.viewPath)
                    );

                    return await this.createChildrenOfFolder(result.flatFolderGraph, parent);
                case GmItemType.Resource:
                    let resourceElement = parent as ResourceItem;
                    if (resourceElement.resource !== Resource.Object) {
                        return [];
                    }
                    let object = resourceElement as ObjectItem;

                    let data = await this.yyBoss.writeCommand(
                        new resourceCommand.GetAssociatedDataResource(Resource.Object, parent.label, true)
                    );

                    if (this.yyBoss.hasError() === false) {
                        let fpath = data.associatedData as SerializedDataFilepath;
                        let events = fs.readFileSync(fpath.data);
                        let assoc_data = JSON.parse(events.toString());
                        fs.unlinkSync(fpath.data);

                        let fileNames = Object.getOwnPropertyNames(assoc_data);
                        let betterNames = await this.yyBoss.writeCommand(
                            new util.PrettyEventNames(fileNames)
                        );

                        // update capas
                        const capabilities = Object.values(LimitedGmEvent);
                        let output: GmItem[] = [];

                        for (const [fName, prettyName] of betterNames.eventNames) {
                            let name = prettyName;

                            output.push(new EventItem(name, object, fName, parent));

                            const parse = fname_to_ev(fName);
                            if (parse !== undefined) {
                                const idx = capabilities.indexOf(parse);
                                if (idx !== -1) {
                                    capabilities.splice(idx, 1);
                                }
                            }
                        }

                        object.updateContextValue(capabilities);

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

    private async createChildrenOfFolder(
        fg: vfsCommand.outputs.FlatFolderGraph,
        parent: GmItem | undefined
    ): Promise<GmItem[]> {
        const output: GmItem[] = [];
        fg.folders.sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
        for (const newFolder of fg.folders) {
            output.push(new FolderItem(newFolder.name, newFolder.path, parent));
        }

        fg.files.sort((lhs, rhs) => lhs.filesystemPath.name.localeCompare(rhs.filesystemPath.name));
        for (const newFile of fg.files) {
            switch (newFile.resourceDescriptor.resource) {
                case Resource.Object:
                    const fileNames = await ObjectItem.getEventCapabilities(
                        this.yyBoss,
                        newFile.filesystemPath.name
                    );

                    output.push(new ObjectItem(newFile.filesystemPath, parent, fileNames));
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

const enum GmItemType {
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

    public static ITEM_PROVIDER: GmItemProvider | undefined;
    public static PROJECT_METADATA: ProjectMetadata | undefined;
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

    public static async onCreateFolder(folder: FolderItem | undefined) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        const originalName = await vscode.window.showInputBox({
            value: folder?.label ?? 'New Folder',
            prompt: 'New Folder Name',
            async validateInput(str: string): Promise<string | undefined> {
                let newFolder = await yyBoss.writeCommand(
                    new vfsCommand.CreateFolderVfs(folder?.viewPath ?? 'folders', str)
                );

                if (yyBoss.error === undefined) {
                    await yyBoss.writeCommand(
                        new vfsCommand.RemoveFolderVfs(newFolder.createdFolder.path, false)
                    );

                    return undefined;
                } else {
                    return `Error:${YypBossError.error(yyBoss.error)}`;
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
            await yyBoss.writeCommand(new vfsCommand.CreateFolderVfs(folder?.viewPath ?? 'folders', name));

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
            await yyBoss.writeCommand(new SerializationCommand());
            if (yyBoss.error === undefined) {
                GmItem.ITEM_PROVIDER?.refresh(folder);
            }
        }
    }

    // public static async OnRenameFolder(folder: FolderItem) {
    //     const new_folder_name = await vscode.window.showInputBox({
    //         value: folder.label,
    //         prompt: 'New Folder Name',
    //     });

    //     if (new_folder_name !== undefined) {
    //         const yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
    //         await yyBoss.writeCommand(new vfsCommand.RenameFolderVfs(folder.viewPath, new_folder_name));

    //         if (yyBoss.hasError()) {
    //             vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
    //         } else {
    //             await yyBoss.writeCommand(new SerializationCommand());

    //             if (yyBoss.hasError()) {
    //                 vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
    //             } else {
    //                 GmItem.ITEM_PROVIDER?.refresh(folder.parent);
    //             }
    //         }
    //     }
    // }

    public static async onDeleteFolder(folder: FolderItem) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        let output = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${folder.label}? Restoring folders can be difficult by hand.`,
            { modal: true },
            'Delete'
        );

        if (output === 'Delete') {
            await yyBoss.writeCommand(new vfsCommand.RemoveFolderVfs(folder.viewPath, true));

            if (yyBoss.error === undefined) {
                await yyBoss.writeCommand(new SerializationCommand());
                if (yyBoss.error === undefined) {
                    GmItem.ITEM_PROVIDER?.refresh(folder.parent);
                }
            }
        }
    }
}

export abstract class ResourceItem extends GmItem {
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

    public static async onRenameResource(resourceItem: ResourceItem) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        const new_resource_name = await vscode.window.showInputBox({
            value: resourceItem.filesystemPath.name,
            prompt: `Rename ${resourceItem.resource}`,
            async validateInput(input: string): Promise<string | undefined> {
                let response = await yyBoss.writeCommand(new util.CanUseResourceName(input));

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
                new resourceCommand.RenameResource(
                    resourceItem.resource,
                    resourceItem.filesystemPath.name,
                    new_resource_name
                )
            );

            if (yyBoss.hasError()) {
                vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
            } else {
                await yyBoss.writeCommand(new SerializationCommand());

                if (yyBoss.hasError()) {
                    vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
                } else {
                    GmItem.ITEM_PROVIDER?.refresh(resourceItem.parent);
                }
            }
        }
    }

    public static async onDeleteResource(resourceItem: ResourceItem) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        let output = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${resourceItem.label}? Restoring resources can be difficult by hand.`,
            { modal: true },
            'Delete'
        );

        if (output === 'Delete') {
            await yyBoss.writeCommand(
                new resourceCommand.RemoveResource(resourceItem.resource, resourceItem.filesystemPath.name)
            );

            if (yyBoss.hasError()) {
                vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
            } else {
                await yyBoss.writeCommand(new SerializationCommand());

                if (yyBoss.hasError()) {
                    vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
                } else {
                    GmItem.ITEM_PROVIDER?.refresh(resourceItem.parent);
                }
            }
        }
    }

    public static async onCreateResource(parent: FolderItem | undefined, resource: Resource) {
        let yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        const new_resource_name = await vscode.window.showInputBox({
            value: `${resource}`,
            prompt: `Create a new ${resource}`,
            async validateInput(input: string): Promise<string | undefined> {
                let response = await yyBoss.writeCommand(new util.CanUseResourceName(input));

                if (response.nameIsValid) {
                    return undefined;
                } else {
                    return `Name is either taken or is not a valid entry`;
                }
            },
        });

        if (new_resource_name == undefined || new_resource_name.length == 0) {
            return;
        }

        let view_path: ViewPath;

        if (parent === undefined) {
            view_path = GmItem.PROJECT_METADATA?.rootFile as ViewPath;
        } else {
            view_path = {
                name: parent.label,
                path: parent.viewPath,
            };
        }

        let new_resource = await yyBoss.writeCommand(
            new util.CreateResourceYyFile(resource, new_resource_name, view_path)
        );

        await yyBoss.writeCommand(
            new resourceCommand.AddResource(resource, new_resource.resource, new SerializedDataDefault())
        );

        if (yyBoss.hasError()) {
            vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
        } else {
            await yyBoss.writeCommand(new SerializationCommand());

            if (yyBoss.hasError()) {
                vscode.window.showErrorMessage(`Error:${YypBossError.error(yyBoss.error)}`);
            } else {
                GmItem.ITEM_PROVIDER?.refresh(parent);

                // we immediately reveal a script...
                if (resource === Resource.Script) {
                    let path = await yyBoss.writeCommand(new util.ScriptGmlPath(new_resource_name));

                    let document = await vscode.workspace.openTextDocument(path.requestedPath);
                    vscode.window.showTextDocument(document);
                }
            }
        }
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
        let path = await boss.writeCommand(new util.ScriptGmlPath(scriptName));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }
}

export class ObjectItem extends ResourceItem {
    public readonly resource = Resource.Object;

    constructor(
        public readonly filesystemPath: FilesystemPath,
        public readonly parent: GmItem | undefined,
        trackableEvents: LimitedGmEvent[]
    ) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);

        this.updateContextValue(trackableEvents);
    }

    public updateContextValue(trackableEvents: LimitedGmEvent[]) {
        this.contextValue = 'objectItem resourceItem';
        for (const v of trackableEvents) {
            this.contextValue += ` can${v}Event`;
        }
    }

    iconPath = new vscode.ThemeIcon('symbol-class');

    public static async onCreateEvent(objectItem: ObjectItem, eventType: LimitedGmEvent) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        await boss.writeCommand(new util.CreateEvent(objectItem.filesystemPath.name, ev_to_fname(eventType)));

        if (boss.hasError()) {
            vscode.window.showErrorMessage(`Error:${YypBossError.error(boss.error)}`);
        } else {
            await boss.writeCommand(new SerializationCommand());
            if (boss.hasError()) {
                vscode.window.showErrorMessage(`Error:${YypBossError.error(boss.error)}`);
            } else {
                EventItem.onOpenEvent(objectItem.filesystemPath.name, ev_to_fname(eventType));
                GmItem.ITEM_PROVIDER?.refresh(objectItem.parent);
            }
        }
    }

    static async getEventCapabilities(yyBoss: YyBoss, objectName: string): Promise<LimitedGmEvent[]> {
        let data = await yyBoss.writeCommand(
            new resourceCommand.GetAssociatedDataResource(Resource.Object, objectName, true)
        );

        let fpath = data.associatedData as SerializedDataFilepath;
        let events = fs.readFileSync(fpath.data);
        let assoc_data = JSON.parse(events.toString());
        fs.unlinkSync(fpath.data);

        let fileNames = Object.values(LimitedGmEvent);

        for (const name of Object.getOwnPropertyNames(assoc_data)) {
            const parse = fname_to_ev(name);
            if (parse !== undefined) {
                const idx = fileNames.indexOf(parse);
                if (idx !== -1) {
                    fileNames.splice(idx, 1);
                }
            }
        }

        return fileNames;
    }
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
        private object: ObjectItem,
        private eventFname: string,
        public readonly parent: GmItem | undefined
    ) {
        super(eventNamePretty + '.gml', vscode.TreeItemCollapsibleState.None);
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.object.filesystemPath.name + this.label;
    }

    contextValue = 'eventItem';

    command: vscode.Command = {
        command: 'gmVfs.openEvent',
        title: 'Open Event',
        arguments: [this.object.filesystemPath.name, this.eventFname],
        tooltip: 'Open this Event in the Editor',
    };

    iconPath = new vscode.ThemeIcon('file-code');

    public static async onOpenEvent(object_name: string, event_fname: string) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
        let path = await boss.writeCommand(new util.EventGmlPath(object_name, event_fname));

        let document = await vscode.workspace.openTextDocument(path.requestedPath);
        vscode.window.showTextDocument(document);
    }

    public static async onDeleteEvent(event: EventItem) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        let output = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${event.object.filesystemPath.name}'s ${event.eventNamePretty} event? Restoring events can be difficult by hand.`,
            { modal: true },
            'Delete'
        );

        if (output === 'Delete') {
            await boss.writeCommand(new util.DeleteEvent(event.object.filesystemPath.name, event.eventFname));

            if (boss.hasError()) {
                vscode.window.showErrorMessage(`Error:${YypBossError.error(boss.error)}`);
            } else {
                await boss.writeCommand(new SerializationCommand());
                if (boss.hasError()) {
                    vscode.window.showErrorMessage(`Error:${YypBossError.error(boss.error)}`);
                } else {
                    GmItem.ITEM_PROVIDER?.refresh(event.object.parent);
                }
            }
        }
    }
}

// Right now, we're only supporting these until submenus are stabilized in October 2020.
export enum LimitedGmEvent {
    Create = 'Create',
    CleanUp = 'CleanUp',
    Step = 'Step',
    StepEnd = 'StepEnd',
    Draw = 'Draw',
    DrawEnd = 'DrawEnd',
    RoomStart = 'RoomStart',
    RoomEnd = 'RoomEnd',
}

function ev_to_fname(gm_e: LimitedGmEvent): string {
    switch (gm_e) {
        case LimitedGmEvent.Create:
            return 'Create_0';
        case LimitedGmEvent.Step:
            return 'Step_0';
        case LimitedGmEvent.StepEnd:
            return 'Step_2';
        case LimitedGmEvent.Draw:
            return 'Draw_0';
        case LimitedGmEvent.DrawEnd:
            return 'Draw_73';
        case LimitedGmEvent.RoomStart:
            return 'Other_4';
        case LimitedGmEvent.RoomEnd:
            return 'Other_5';
        case LimitedGmEvent.CleanUp:
            return 'CleanUp_0';
    }
}

function fname_to_ev(fname: string): LimitedGmEvent | undefined {
    switch (fname) {
        case 'Create_0':
            return LimitedGmEvent.Create;
        case 'Step_0':
            return LimitedGmEvent.Step;
        case 'Step_2':
            return LimitedGmEvent.StepEnd;
        case 'Draw_0':
            return LimitedGmEvent.Draw;
        case 'Draw_73':
            return LimitedGmEvent.DrawEnd;
        case 'Other_4':
            return LimitedGmEvent.RoomStart;
        case 'Other_5':
            return LimitedGmEvent.RoomEnd;
        case 'CleanUp_0':
            return LimitedGmEvent.CleanUp;
        default:
            return undefined;
    }
}
