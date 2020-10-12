import { YyBoss, vfsCommand, resourceCommand, Resource, util } from 'yy-boss-ts';
import { FilesystemPath, SerializedDataDefault, SerializedDataFilepath, ViewPath } from 'yy-boss-ts';
import * as vscode from 'vscode';
import { YypBossError } from 'yy-boss-ts/out/error';
import { SerializationCommand } from 'yy-boss-ts/out/serialization';
import * as fs from 'fs';
import * as path from 'path';
import { Command, ProjectMetadata } from 'yy-boss-ts/out/core';
import { CommandToOutput } from 'yy-boss-ts/out/input_to_output';

const ERROR_MESSAGE = `YyBoss has encountered a serious error. You should restart the server, and report an error on the Github page at https://github.com/sanbox-irl/gm-code-vsc/issues/new`;

export class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
    constructor(
        public yyBoss: YyBoss,
        public working_directory: string,
        public outputChannel: vscode.OutputChannel
    ) {}

    async getChildren(parent?: GmItem | undefined): Promise<GmItem[]> {
        if (parent === undefined) {
            let result = await this.writeCommand(new vfsCommand.GetFullVfs());

            return await this.createChildrenOfFolder(result.flatFolderGraph, parent);
        } else {
            switch (parent.gmItemType) {
                case GmItemType.Folder:
                    let folderElement = parent as FolderItem;
                    let result = await this.writeCommand(
                        new vfsCommand.GetFolderVfs(folderElement.viewPath)
                    );

                    return await this.createChildrenOfFolder(result.flatFolderGraph, parent);
                case GmItemType.Resource:
                    let resourceElement = parent as ResourceItem;
                    switch (resourceElement.resource) {
                        case Resource.Object: {
                            let object = resourceElement as ObjectItem;

                            let data = await this.writeCommand(
                                new resourceCommand.GetAssociatedDataResource(
                                    Resource.Object,
                                    parent.label,
                                    true
                                )
                            );

                            if (this.yyBoss.hasError() === false) {
                                let fpath = data.associatedData as SerializedDataFilepath;
                                let events = fs.readFileSync(fpath.data);
                                let assoc_data = JSON.parse(events.toString());
                                fs.unlinkSync(fpath.data);

                                let fileNames = Object.getOwnPropertyNames(assoc_data);
                                let betterNames = await this.writeCommand(
                                    new util.PrettyEventNames(fileNames)
                                );

                                // update capas
                                const capabilities = Object.values(GmEvent);
                                let output: GmItem[] = [];

                                for (const [fName, prettyName] of betterNames.eventNames) {
                                    let name = prettyName;

                                    output.push(new EventItem(name, object, fName, object));

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
                                this.outputChannel.appendLine(
                                    JSON.stringify(this.yyBoss.error, undefined, 4)
                                );
                                return [];
                            }
                        }

                        case Resource.Shader: {
                            let shader = resourceElement as ShaderItem;

                            let frag_shad = new ShaderFileItem(ShaderKind.Frag, shader);
                            let vert_shad = new ShaderFileItem(ShaderKind.Vertex, shader);

                            return [frag_shad, vert_shad];
                        }

                        default:
                            return [];
                    }
                case GmItemType.Event:
                case GmItemType.ShaderKind:
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

                case Resource.Shader:
                    output.push(new ShaderItem(newFile.filesystemPath, parent));
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

    public writeCommand<T extends Command>(command: T): Promise<CommandToOutput<T>> {
        this.outputChannel.appendLine(JSON.stringify(command));
        return this.yyBoss.writeCommand(command);
    }
}

const enum GmItemType {
    Folder,
    Resource,
    Event,
    ShaderKind,
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

    public static async OnRenameFolder(folder: FolderItem) {
        const new_folder_name = await vscode.window.showInputBox({
            value: folder.label,
            prompt: 'New Folder Name',
        });

        if (new_folder_name !== undefined) {
            const yyBoss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;
            await yyBoss.writeCommand(new vfsCommand.RenameFolderVfs(folder.viewPath, new_folder_name));

            if (yyBoss.hasError()) {
                vscode.window.showErrorMessage(ERROR_MESSAGE);
                GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                GmItem.ITEM_PROVIDER?.outputChannel.show();
            } else {
                await yyBoss.writeCommand(new SerializationCommand());

                if (yyBoss.hasError()) {
                    vscode.window.showErrorMessage(ERROR_MESSAGE);
                    GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                    GmItem.ITEM_PROVIDER?.outputChannel.show();
                } else {
                    GmItem.ITEM_PROVIDER?.refresh(folder.parent);
                }
            }
        }
    }

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
                vscode.window.showErrorMessage(ERROR_MESSAGE);
                GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                GmItem.ITEM_PROVIDER?.outputChannel.show();
            } else {
                await yyBoss.writeCommand(new SerializationCommand());

                if (yyBoss.hasError()) {
                    vscode.window.showErrorMessage(ERROR_MESSAGE);
                    GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                    GmItem.ITEM_PROVIDER?.outputChannel.show();
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
                vscode.window.showErrorMessage(ERROR_MESSAGE);
                GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                GmItem.ITEM_PROVIDER?.outputChannel.show();
            } else {
                await yyBoss.writeCommand(new SerializationCommand());

                if (yyBoss.hasError()) {
                    vscode.window.showErrorMessage(ERROR_MESSAGE);
                    GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                    GmItem.ITEM_PROVIDER?.outputChannel.show();
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
            vscode.window.showErrorMessage(ERROR_MESSAGE);
            GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
            GmItem.ITEM_PROVIDER?.outputChannel.show();
        } else {
            await yyBoss.writeCommand(new SerializationCommand());

            if (yyBoss.hasError()) {
                vscode.window.showErrorMessage(ERROR_MESSAGE);
                GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(yyBoss.error));
                GmItem.ITEM_PROVIDER?.outputChannel.show();
            } else {
                GmItem.ITEM_PROVIDER?.refresh(parent);

                // we immediately reveal a script...
                if (resource === Resource.Script) {
                    let path = await yyBoss.writeCommand(new util.ScriptGmlPath(new_resource_name));
                    vscode.commands.executeCommand('gmVfs.open', [vscode.Uri.file(path.requestedPath)]);
                }
            }
        }
    }
}

export class ScriptItem extends ResourceItem {
    public readonly resource = Resource.Script;

    constructor(public readonly filesystemPath: FilesystemPath, public readonly parent: GmItem | undefined) {
        super(filesystemPath.name + '.gml', vscode.TreeItemCollapsibleState.None);

        const p = vscode.Uri.file(
            path.join(
                GmItem.ITEM_PROVIDER?.working_directory as string,
                path.dirname(filesystemPath.path),
                filesystemPath.name + '.gml'
            )
        );

        this.command = {
            command: 'gmVfs.open',
            title: 'Open Script',
            arguments: [p],
            tooltip: 'Open this Script in the Editor',
        };
    }

    iconPath = new vscode.ThemeIcon('file-code');
}

export class ObjectItem extends ResourceItem {
    public readonly resource = Resource.Object;

    constructor(
        public readonly filesystemPath: FilesystemPath,
        public readonly parent: GmItem | undefined,
        trackableEvents: GmEvent[]
    ) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);

        this.updateContextValue(trackableEvents);
    }

    public updateContextValue(trackableEvents: GmEvent[]) {
        this.contextValue = 'objectItem resourceItem';
        for (const v of trackableEvents) {
            this.contextValue += ` can${v}Event`;
        }
    }

    iconPath = new vscode.ThemeIcon('symbol-constructor');

    public static async onCreateEvent(objectItem: ObjectItem, eventType: GmEvent) {
        const boss = GmItem.ITEM_PROVIDER?.yyBoss as YyBoss;

        await boss.writeCommand(new util.CreateEvent(objectItem.filesystemPath.name, ev_to_fname(eventType)));

        if (boss.hasError()) {
            vscode.window.showErrorMessage(ERROR_MESSAGE);
            GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(boss.error));
            GmItem.ITEM_PROVIDER?.outputChannel.show();
        } else {
            await boss.writeCommand(new SerializationCommand());
            if (boss.hasError()) {
                vscode.window.showErrorMessage(ERROR_MESSAGE);
                GmItem.ITEM_PROVIDER?.outputChannel.appendLine(YypBossError.error(boss.error));
                GmItem.ITEM_PROVIDER?.outputChannel.show();
            } else {
                const uri = vscode.Uri.file(
                    path.join(
                        GmItem.ITEM_PROVIDER?.working_directory as string,
                        path.dirname(objectItem.filesystemPath.path),
                        ev_to_fname(eventType) + '.gml'
                    )
                );

                vscode.commands.executeCommand('gmVfs.open', [uri]);
                GmItem.ITEM_PROVIDER?.refresh(objectItem.parent);
            }
        }
    }

    static async getEventCapabilities(yyBoss: YyBoss, objectName: string): Promise<GmEvent[]> {
        let data = await yyBoss.writeCommand(
            new resourceCommand.GetAssociatedDataResource(Resource.Object, objectName, true)
        );

        let fpath = data.associatedData as SerializedDataFilepath;
        let events = fs.readFileSync(fpath.data);
        let assoc_data = JSON.parse(events.toString());
        fs.unlinkSync(fpath.data);

        let fileNames = Object.values(GmEvent);

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

export class ShaderItem extends ResourceItem {
    public readonly resource = Resource.Shader;

    constructor(public readonly filesystemPath: FilesystemPath, public readonly parent: GmItem | undefined) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('files');
}

export class OtherResource extends ResourceItem {
    constructor(
        public readonly filesystemPath: FilesystemPath,
        public readonly parentLocation: string,
        public readonly resource: Resource,
        public readonly parent: GmItem | undefined
    ) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.None);
        switch (resource) {
            case Resource.Sprite:
                this.iconPath = new vscode.ThemeIcon('file-media');
                break;
            case Resource.Script:
                this.iconPath = new vscode.ThemeIcon('file-code');
                break;
            case Resource.Object:
                this.iconPath = new vscode.ThemeIcon('symbol-constructor');
                break;
            case Resource.Note:
                this.iconPath = new vscode.ThemeIcon('pencil');
                break;
            case Resource.Shader:
                this.iconPath = new vscode.ThemeIcon('file');
                break;
            case Resource.AnimationCurve:
                this.iconPath = new vscode.ThemeIcon('pulse');
                break;
            case Resource.Extension:
                this.iconPath = new vscode.ThemeIcon('extensions');
                break;
            case Resource.Font:
                this.iconPath = new vscode.ThemeIcon('keyboard');

                break;
            case Resource.Path:
                this.iconPath = new vscode.ThemeIcon('arrow-right');
                break;
            case Resource.Room:
                this.iconPath = new vscode.ThemeIcon('window');
                break;
            case Resource.Sequence:
                this.iconPath = new vscode.ThemeIcon('run-all');
                break;
            case Resource.Sound:
                this.iconPath = new vscode.ThemeIcon('unmute');
                break;
            case Resource.TileSet:
                this.iconPath = new vscode.ThemeIcon('primitive-square');
                break;
            case Resource.Timeline:
                this.iconPath = new vscode.ThemeIcon('list-tree');
                break;
        }
    }

    iconPath = new vscode.ThemeIcon('file-media');
}

export class ShaderFileItem extends GmItem {
    public gmItemType = GmItemType.ShaderKind;

    constructor(shaderKind: ShaderKind, public readonly parent: ShaderItem) {
        super(shaderKind == ShaderKind.Frag ? 'Fragment' : 'Vertex', vscode.TreeItemCollapsibleState.None);
        let par_direct = path.dirname(parent.filesystemPath.path);

        this.resourceUri = vscode.Uri.file(
            path.join(
                GmItem.ITEM_PROVIDER?.working_directory as string,
                par_direct,
                parent.filesystemPath.name + (shaderKind == ShaderKind.Frag ? '.fsh' : '.vsh')
            )
        );

        this.command = {
            command: 'gmVfs.open',
            title: 'Open Shader File',
            arguments: [this.resourceUri],
            tooltip: 'Open this Shader in the Editor',
        };
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.parent.filesystemPath.name + this.label;
    }

    contextValue = 'shaderFileItem';

    iconPath = new vscode.ThemeIcon('file');
}

export class EventItem extends GmItem {
    public gmItemType = GmItemType.Event;

    constructor(
        private eventNamePretty: string,
        private object: ObjectItem,
        private eventFname: string,
        public readonly parent: ObjectItem
    ) {
        super(eventNamePretty + '.gml', vscode.TreeItemCollapsibleState.None);

        const uri = vscode.Uri.file(
            path.join(
                GmItem.ITEM_PROVIDER?.working_directory as string,
                path.dirname(parent.filesystemPath.path),
                eventFname + '.gml'
            )
        );

        this.command = {
            command: 'gmVfs.open',
            title: 'Open Event',
            arguments: [uri],
            tooltip: 'Open this Event in the Editor',
        };
    }

    get tooltip(): string {
        return this.label;
    }

    get id(): string {
        return this.object.filesystemPath.name + this.label;
    }

    contextValue = 'eventItem';

    iconPath = new vscode.ThemeIcon('list-selection');

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

const enum ShaderKind {
    Vertex,
    Frag,
}
export enum GmEvent {
    Create = 'Create',
    Destroy = 'Destroy',
    CleanUp = 'CleanUp',
    Step = 'Step',
    BeginStep = 'BeginStep',
    EndStep = 'EndStep',
    Alarm0 = 'Alarm0',
    Alarm1 = 'Alarm1',
    Alarm2 = 'Alarm2',
    Alarm3 = 'Alarm3',
    Alarm4 = 'Alarm4',
    Alarm5 = 'Alarm5',
    Alarm6 = 'Alarm6',
    Alarm7 = 'Alarm7',
    Alarm8 = 'Alarm8',
    Alarm9 = 'Alarm9',
    Alarm10 = 'Alarm10',
    Alarm11 = 'Alarm11',
    Draw = 'Draw',
    DrawBegin = 'DrawBegin',
    DrawEnd = 'DrawEnd',
    DrawGui = 'DrawGui',
    DrawGuiBegin = 'DrawGuiBegin',
    DrawGuiEnd = 'DrawGuiEnd',
    PreDraw = 'PreDraw',
    PostDraw = 'PostDraw',
    WindowResize = 'WindowResize',
    OutsideRoom = 'OutsideRoom',
    IntersectBoundary = 'IntersectBoundary',
    OutsideView0 = 'OutsideView0',
    OutsideView1 = 'OutsideView1',
    OutsideView2 = 'OutsideView2',
    OutsideView3 = 'OutsideView3',
    OutsideView4 = 'OutsideView4',
    OutsideView5 = 'OutsideView5',
    OutsideView6 = 'OutsideView6',
    OutsideView7 = 'OutsideView7',
    IntersectView0Boundary = 'IntersectView0Boundary',
    IntersectView1Boundary = 'IntersectView1Boundary',
    IntersectView2Boundary = 'IntersectView2Boundary',
    IntersectView3Boundary = 'IntersectView3Boundary',
    IntersectView4Boundary = 'IntersectView4Boundary',
    IntersectView5Boundary = 'IntersectView5Boundary',
    IntersectView6Boundary = 'IntersectView6Boundary',
    IntersectView7Boundary = 'IntersectView7Boundary',
    GameStart = 'GameStart',
    GameEnd = 'GameEnd',
    RoomStart = 'RoomStart',
    RoomEnd = 'RoomEnd',
    AnimationEnd = 'AnimationEnd',
    AnimationUpdate = 'AnimationUpdate',
    AnimationEvent = 'AnimationEvent',
    PathEnded = 'PathEnded',
    UserEvent0 = 'UserEvent0',
    UserEvent1 = 'UserEvent1',
    UserEvent2 = 'UserEvent2',
    UserEvent3 = 'UserEvent3',
    UserEvent4 = 'UserEvent4',
    UserEvent5 = 'UserEvent5',
    UserEvent6 = 'UserEvent6',
    UserEvent7 = 'UserEvent7',
    UserEvent8 = 'UserEvent8',
    UserEvent9 = 'UserEvent9',
    UserEvent10 = 'UserEvent10',
    UserEvent11 = 'UserEvent11',
    UserEvent12 = 'UserEvent12',
    UserEvent13 = 'UserEvent13',
    UserEvent14 = 'UserEvent14',
    UserEvent15 = 'UserEvent15',
    BroadcastMessage = 'BroadcastMessage',
    AsyncAudioPlayback = 'AsyncAudioPlayback',
    AsyncAudioRecording = 'AsyncAudioRecording',
    AsyncCloud = 'AsyncCloud',
    AsyncDialog = 'AsyncDialog',
    AsyncHttp = 'AsyncHttp',
    AsyncInAppPurchase = 'AsyncInAppPurchase',
    AsyncImageLoaded = 'AsyncImageLoaded',
    AsyncNetworking = 'AsyncNetworking',
    AsyncPushNotification = 'AsyncPushNotification',
    AsyncSaveLoad = 'AsyncSaveLoad',
    AsyncSocial = 'AsyncSocial',
    AsyncSteam = 'AsyncSteam',
    AsyncSystem = 'AsyncSystem',
}

function ev_to_fname(gm_e: GmEvent): string {
    switch (gm_e) {
        case GmEvent.Create:
            return 'Create_0';
        case GmEvent.Destroy:
            return 'Destroy_0';
        case GmEvent.CleanUp:
            return 'CleanUp_0';
        case GmEvent.Step:
            return 'Step_0';
        case GmEvent.BeginStep:
            return 'Step_1';
        case GmEvent.EndStep:
            return 'Step_2';
        case GmEvent.Alarm0:
            return 'Alarm_0';
        case GmEvent.Alarm1:
            return 'Alarm_1';
        case GmEvent.Alarm2:
            return 'Alarm_2';
        case GmEvent.Alarm3:
            return 'Alarm_3';
        case GmEvent.Alarm4:
            return 'Alarm_4';
        case GmEvent.Alarm5:
            return 'Alarm_5';
        case GmEvent.Alarm6:
            return 'Alarm_6';
        case GmEvent.Alarm7:
            return 'Alarm_7';
        case GmEvent.Alarm8:
            return 'Alarm_8';
        case GmEvent.Alarm9:
            return 'Alarm_9';
        case GmEvent.Alarm10:
            return 'Alarm_10';
        case GmEvent.Alarm11:
            return 'Alarm_11';
        case GmEvent.Draw:
            return 'Draw_0';
        case GmEvent.DrawBegin:
            return 'Draw_72';
        case GmEvent.DrawEnd:
            return 'Draw_73';
        case GmEvent.DrawGui:
            return 'Draw_64';
        case GmEvent.DrawGuiBegin:
            return 'Draw_74';
        case GmEvent.DrawGuiEnd:
            return 'Draw_75';
        case GmEvent.PreDraw:
            return 'Draw_76';
        case GmEvent.PostDraw:
            return 'Draw_77';
        case GmEvent.WindowResize:
            return 'Draw_65';
        case GmEvent.OutsideRoom:
            return 'Other_0';
        case GmEvent.IntersectBoundary:
            return 'Other_1';
        case GmEvent.OutsideView0:
            return 'Other_40';
        case GmEvent.OutsideView1:
            return 'Other_41';
        case GmEvent.OutsideView2:
            return 'Other_42';
        case GmEvent.OutsideView3:
            return 'Other_43';
        case GmEvent.OutsideView4:
            return 'Other_44';
        case GmEvent.OutsideView5:
            return 'Other_45';
        case GmEvent.OutsideView6:
            return 'Other_46';
        case GmEvent.OutsideView7:
            return 'Other_47';
        case GmEvent.IntersectView0Boundary:
            return 'Other_50';
        case GmEvent.IntersectView1Boundary:
            return 'Other_51';
        case GmEvent.IntersectView2Boundary:
            return 'Other_52';
        case GmEvent.IntersectView3Boundary:
            return 'Other_53';
        case GmEvent.IntersectView4Boundary:
            return 'Other_54';
        case GmEvent.IntersectView5Boundary:
            return 'Other_55';
        case GmEvent.IntersectView6Boundary:
            return 'Other_56';
        case GmEvent.IntersectView7Boundary:
            return 'Other_57';
        case GmEvent.GameStart:
            return 'Other_2';
        case GmEvent.GameEnd:
            return 'Other_3';
        case GmEvent.RoomStart:
            return 'Other_4';
        case GmEvent.RoomEnd:
            return 'Other_5';
        case GmEvent.AnimationEnd:
            return 'Other_7';
        case GmEvent.AnimationUpdate:
            return 'Other_58';
        case GmEvent.AnimationEvent:
            return 'Other_59';
        case GmEvent.PathEnded:
            return 'Other_8';
        case GmEvent.UserEvent0:
            return 'Other_10';
        case GmEvent.UserEvent1:
            return 'Other_11';
        case GmEvent.UserEvent2:
            return 'Other_12';
        case GmEvent.UserEvent3:
            return 'Other_13';
        case GmEvent.UserEvent4:
            return 'Other_14';
        case GmEvent.UserEvent5:
            return 'Other_15';
        case GmEvent.UserEvent6:
            return 'Other_16';
        case GmEvent.UserEvent7:
            return 'Other_17';
        case GmEvent.UserEvent8:
            return 'Other_18';
        case GmEvent.UserEvent9:
            return 'Other_19';
        case GmEvent.UserEvent10:
            return 'Other_20';
        case GmEvent.UserEvent11:
            return 'Other_21';
        case GmEvent.UserEvent12:
            return 'Other_22';
        case GmEvent.UserEvent13:
            return 'Other_23';
        case GmEvent.UserEvent14:
            return 'Other_24';
        case GmEvent.UserEvent15:
            return 'Other_25';
        case GmEvent.BroadcastMessage:
            return 'Other_76';
        case GmEvent.AsyncAudioPlayback:
            return 'Other_74';
        case GmEvent.AsyncAudioRecording:
            return 'Other_73';
        case GmEvent.AsyncCloud:
            return 'Other_67';
        case GmEvent.AsyncDialog:
            return 'Other_63';
        case GmEvent.AsyncHttp:
            return 'Other_62';
        case GmEvent.AsyncInAppPurchase:
            return 'Other_66';
        case GmEvent.AsyncImageLoaded:
            return 'Other_60';
        case GmEvent.AsyncNetworking:
            return 'Other_68';
        case GmEvent.AsyncPushNotification:
            return 'Other_71';
        case GmEvent.AsyncSaveLoad:
            return 'Other_72';
        case GmEvent.AsyncSocial:
            return 'Other_70';
        case GmEvent.AsyncSteam:
            return 'Other_69';
        case GmEvent.AsyncSystem:
            return 'Other_75';
    }
}

function fname_to_ev(fname: string): GmEvent | undefined {
    switch (fname) {
        case 'Create_0':
            return GmEvent.Create;
        case 'Destroy_0':
            return GmEvent.Destroy;
        case 'CleanUp_0':
            return GmEvent.CleanUp;
        case 'Step_0':
            return GmEvent.Step;
        case 'Step_1':
            return GmEvent.BeginStep;
        case 'Step_2':
            return GmEvent.EndStep;
        case 'Alarm_0':
            return GmEvent.Alarm0;
        case 'Alarm_1':
            return GmEvent.Alarm1;
        case 'Alarm_2':
            return GmEvent.Alarm2;
        case 'Alarm_3':
            return GmEvent.Alarm3;
        case 'Alarm_4':
            return GmEvent.Alarm4;
        case 'Alarm_5':
            return GmEvent.Alarm5;
        case 'Alarm_6':
            return GmEvent.Alarm6;
        case 'Alarm_7':
            return GmEvent.Alarm7;
        case 'Alarm_8':
            return GmEvent.Alarm8;
        case 'Alarm_9':
            return GmEvent.Alarm9;
        case 'Alarm_10':
            return GmEvent.Alarm10;
        case 'Alarm_11':
            return GmEvent.Alarm11;
        case 'Draw_0':
            return GmEvent.Draw;
        case 'Draw_72':
            return GmEvent.DrawBegin;
        case 'Draw_73':
            return GmEvent.DrawEnd;
        case 'Draw_64':
            return GmEvent.DrawGui;
        case 'Draw_74':
            return GmEvent.DrawGuiBegin;
        case 'Draw_75':
            return GmEvent.DrawGuiEnd;
        case 'Draw_76':
            return GmEvent.PreDraw;
        case 'Draw_77':
            return GmEvent.PostDraw;
        case 'Draw_65':
            return GmEvent.WindowResize;
        case 'Other_0':
            return GmEvent.OutsideRoom;
        case 'Other_1':
            return GmEvent.IntersectBoundary;
        case 'Other_40':
            return GmEvent.OutsideView0;
        case 'Other_41':
            return GmEvent.OutsideView1;
        case 'Other_42':
            return GmEvent.OutsideView2;
        case 'Other_43':
            return GmEvent.OutsideView3;
        case 'Other_44':
            return GmEvent.OutsideView4;
        case 'Other_45':
            return GmEvent.OutsideView5;
        case 'Other_46':
            return GmEvent.OutsideView6;
        case 'Other_47':
            return GmEvent.OutsideView7;
        case 'Other_50':
            return GmEvent.IntersectView0Boundary;
        case 'Other_51':
            return GmEvent.IntersectView1Boundary;
        case 'Other_52':
            return GmEvent.IntersectView2Boundary;
        case 'Other_53':
            return GmEvent.IntersectView3Boundary;
        case 'Other_54':
            return GmEvent.IntersectView4Boundary;
        case 'Other_55':
            return GmEvent.IntersectView5Boundary;
        case 'Other_56':
            return GmEvent.IntersectView6Boundary;
        case 'Other_57':
            return GmEvent.IntersectView7Boundary;
        case 'Other_2':
            return GmEvent.GameStart;
        case 'Other_3':
            return GmEvent.GameEnd;
        case 'Other_4':
            return GmEvent.RoomStart;
        case 'Other_5':
            return GmEvent.RoomEnd;
        case 'Other_7':
            return GmEvent.AnimationEnd;
        case 'Other_58':
            return GmEvent.AnimationUpdate;
        case 'Other_59':
            return GmEvent.AnimationEvent;
        case 'Other_8':
            return GmEvent.PathEnded;
        case 'Other_10':
            return GmEvent.UserEvent0;
        case 'Other_11':
            return GmEvent.UserEvent1;
        case 'Other_12':
            return GmEvent.UserEvent2;
        case 'Other_13':
            return GmEvent.UserEvent3;
        case 'Other_14':
            return GmEvent.UserEvent4;
        case 'Other_15':
            return GmEvent.UserEvent5;
        case 'Other_16':
            return GmEvent.UserEvent6;
        case 'Other_17':
            return GmEvent.UserEvent7;
        case 'Other_18':
            return GmEvent.UserEvent8;
        case 'Other_19':
            return GmEvent.UserEvent9;
        case 'Other_20':
            return GmEvent.UserEvent10;
        case 'Other_21':
            return GmEvent.UserEvent11;
        case 'Other_22':
            return GmEvent.UserEvent12;
        case 'Other_23':
            return GmEvent.UserEvent13;
        case 'Other_24':
            return GmEvent.UserEvent14;
        case 'Other_25':
            return GmEvent.UserEvent15;
        case 'Other_76':
            return GmEvent.BroadcastMessage;
        case 'Other_74':
            return GmEvent.AsyncAudioPlayback;
        case 'Other_73':
            return GmEvent.AsyncAudioRecording;
        case 'Other_67':
            return GmEvent.AsyncCloud;
        case 'Other_63':
            return GmEvent.AsyncDialog;
        case 'Other_62':
            return GmEvent.AsyncHttp;
        case 'Other_66':
            return GmEvent.AsyncInAppPurchase;
        case 'Other_60':
            return GmEvent.AsyncImageLoaded;
        case 'Other_68':
            return GmEvent.AsyncNetworking;
        case 'Other_71':
            return GmEvent.AsyncPushNotification;
        case 'Other_72':
            return GmEvent.AsyncSaveLoad;
        case 'Other_70':
            return GmEvent.AsyncSocial;
        case 'Other_69':
            return GmEvent.AsyncSteam;
        case 'Other_75':
            return GmEvent.AsyncSystem;
        default:
            return undefined;
    }
}
