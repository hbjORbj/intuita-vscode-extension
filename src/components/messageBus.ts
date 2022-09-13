import { Disposable, EventEmitter, FilePermission, Uri } from 'vscode';
import { IntuitaRange } from '../utilities';

export const enum MessageKind {
    readingFileFailed = 0,
    writeFile = 1,
    deleteFile = 2,
    changePermissions = 3,
    createRepairCodeJob = 4,
}

type Message =
    | Readonly<{
        kind: MessageKind.readingFileFailed,
        uri: Uri,
    }>
    | Readonly<{
        kind: MessageKind.writeFile,
        uri: Uri,
        content: Uint8Array,
        permissions: FilePermission | null,
    }>
    | Readonly<{
        kind: MessageKind.deleteFile,
        uri: Uri,
    }>
    | Readonly<{
        kind: MessageKind.changePermissions,
        uri: Uri,
        permissions: FilePermission | null,
    }>
    | Readonly<{
        kind: MessageKind.createRepairCodeJob,
        uri: Uri,
        range: IntuitaRange,
        replacement: string,
    }>;

export class MessageBus {
    protected _disposables: Disposable[] | undefined = undefined;
    protected _emitter = new EventEmitter<Message>();

    public setDisposables(
        disposables: Disposable[]
    ): void {
        this._disposables = disposables;
    }

    subscribe(
        fn: (message: Message) => void,
    ): void {
        this._emitter.event(fn, this._disposables);
    }

    publish(
        message: Message,
    ): void {
        this._emitter.fire(message);
    }
}