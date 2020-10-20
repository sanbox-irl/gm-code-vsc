import { YyBoss, vfsCommand, resourceCommand, Resource, util } from 'yy-boss-ts';
import { FilesystemPath, SerializedDataDefault, SerializedDataFilepath, ViewPath } from 'yy-boss-ts';
import * as vscode from 'vscode';
import { YypBossError } from 'yy-boss-ts/out/error';
import { SerializationCommand } from 'yy-boss-ts/out/serialization';
import * as fs from 'fs';
import * as path from 'path';
import { Command, ProjectMetadata } from 'yy-boss-ts/out/core';
import { CommandToOutput } from 'yy-boss-ts/out/input_to_output';
import { Initialization } from './extension';
import { ClosureStatus } from 'yy-boss-ts/out/yy_boss';
import { ev_to_fname, fname_to_ev, GmEvent } from 'yy-boss-ts/out/events';

export function register(init: Initialization) {
    const context = init.context;
    const outputChannel = init.outputChannel;

    const item_provider = new GmItemProvider(
        init.yyBoss,
        init.workspaceFolder.uri.fsPath,
        init.outputChannel
    );
    GmItem.ITEM_PROVIDER = item_provider;
    GmItem.PROJECT_METADATA = init.projectMetadata;

    context.subscriptions.push(
        vscode.window.createTreeView('gmVfs', {
            treeDataProvider: item_provider,
            showCollapseAll: true,
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.open', async (uri: vscode.Uri) => {
            let new_item = await vscode.workspace.openTextDocument(uri);
            vscode.window.showTextDocument(new_item);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createScript', (parent: FolderItem) => {
            ResourceItem.onCreateResource(parent, Resource.Script);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createFolder', FolderItem.onCreateFolder)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.renameFolder', FolderItem.OnRenameFolder)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.deleteFolder', FolderItem.onDeleteFolder)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.createObject', (parent: FolderItem) => {
            ResourceItem.onCreateResource(parent, Resource.Object);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.deleteResource', ResourceItem.onDeleteResource)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.renameResource', ResourceItem.onRenameResource)
    );
    context.subscriptions.push(vscode.commands.registerCommand('gmVfs.deleteEvent', EventItem.onDeleteEvent));

    for (const value of Object.values(GmEvent)) {
        const cmd_name = `gmVfs.add${value}`;
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd_name, (parent: ObjectItem) => {
                ObjectItem.onCreateEvent(parent, value);
            })
        );
    }
    context.subscriptions.push(
        vscode.commands.registerCommand('gmVfs.reloadWorkspace', async () => {
            outputChannel.appendLine('reloading workspace');
            if (
                item_provider.yyBoss !== undefined &&
                item_provider.yyBoss.closureStatus === ClosureStatus.Open
            ) {
                await item_provider.yyBoss.shutdown();
            }

            let output = await init.request_reboot();
            if (output) {
                throw 'Not implemented yet!';

                item_provider.refresh(undefined);
            } else {
                vscode.window.showErrorMessage(`Error: Could not reload gm-code-server`);
            }
        })
    );
}

const ERROR_MESSAGE = `YyBoss has encountered a serious error. You should restart the server, and report an error on the Github page at https://github.com/sanbox-irl/gm-code-vsc/issues/new`;

class GmItemProvider implements vscode.TreeDataProvider<GmItem> {
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
                    let result = await this.writeCommand(new vfsCommand.GetFolderVfs(folderElement.viewPath));

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

abstract class GmItem extends vscode.TreeItem {
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

class FolderItem extends GmItem {
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

class ScriptItem extends ResourceItem {
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

class ObjectItem extends ResourceItem {
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

class ShaderItem extends ResourceItem {
    public readonly resource = Resource.Shader;

    constructor(public readonly filesystemPath: FilesystemPath, public readonly parent: GmItem | undefined) {
        super(filesystemPath.name, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('files');
}

class OtherResource extends ResourceItem {
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

class ShaderFileItem extends GmItem {
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

class EventItem extends GmItem {
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
