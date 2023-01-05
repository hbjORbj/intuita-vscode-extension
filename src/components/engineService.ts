import * as t from 'io-ts';
import prettyReporter from 'io-ts-reporters';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { FileSystem, Uri, window } from 'vscode';
import { CaseKind } from '../cases/types';
import { Configuration } from '../configuration';
import { Container } from '../container';
import { buildCreateFileJob } from '../jobs/createFileJob';
import { buildRewriteFileJob } from '../jobs/rewriteFileJob';
import { Job } from '../jobs/types';
import { buildTypeCodec } from '../utilities';
import { Message, MessageBus, MessageKind } from './messageBus';
import { StatusBarItemManager } from './statusBarItemManager';

export const enum EngineMessageKind {
	change = 1,
	finish = 2,
	rewrite = 3,
	create = 4,
	compare = 5,
	progress = 6,
}

export const messageCodec = t.union([
	buildTypeCodec({
		k: t.literal(EngineMessageKind.change),
		p: t.string,
		r: t.tuple([t.number, t.number]),
		t: t.string,
		c: t.string,
	}),
	buildTypeCodec({
		k: t.literal(EngineMessageKind.rewrite),
		i: t.string,
		o: t.string,
		c: t.string,
	}),
	buildTypeCodec({
		k: t.literal(EngineMessageKind.create),
		p: t.string,
		o: t.string,
		c: t.string,
	}),
	buildTypeCodec({
		k: t.literal(EngineMessageKind.compare),
		i: t.string,
		e: t.boolean,
	}),
	buildTypeCodec({
		k: t.literal(EngineMessageKind.finish),
	}),
	buildTypeCodec({
		k: t.literal(EngineMessageKind.progress),
		p: t.number,
		t: t.number,
	}),
]);

const STORAGE_DIRECTORY_MAP = new Map([
	['node', 'nora-node-engine'],
	['rust', 'nora-rust-engine'],
]);

type Execution = {
	readonly executionId: string;
	readonly childProcess: ChildProcessWithoutNullStreams;
	readonly codemodSetName: string;
	totalFileCount: number;
	halted: boolean;
};

export class EngineService {
	readonly #configurationContainer: Container<Configuration>;
	readonly #fileSystem: FileSystem;
	readonly #messageBus: MessageBus;
	readonly #statusBarItemManager: StatusBarItemManager;

	#execution: Execution | null = null;
	#noraNodeEngineExecutableUri: Uri | null = null;
	#noraRustEngineExecutableUri: Uri | null = null;

	public constructor(
		configurationContainer: Container<Configuration>,
		messageBus: MessageBus,
		fileSystem: FileSystem,
		statusBarItemManager: StatusBarItemManager,
	) {
		this.#configurationContainer = configurationContainer;
		this.#messageBus = messageBus;
		this.#fileSystem = fileSystem;
		this.#statusBarItemManager = statusBarItemManager;

		messageBus.subscribe(MessageKind.enginesBootstrapped, (message) =>
			this.#onEnginesBootstrappedMessage(message),
		);

		messageBus.subscribe(MessageKind.executeCodemodSet, (message) => {
			this.#onExecuteCodemodSetMessage(message);
		});
	}

	#onEnginesBootstrappedMessage(
		message: Message & { kind: MessageKind.enginesBootstrapped },
	) {
		this.#noraNodeEngineExecutableUri = message.noraNodeEngineExecutableUri;
		this.#noraRustEngineExecutableUri = message.noraRustEngineExecutableUri;
	}

	shutdownEngines() {
		if (!this.#execution) {
			return;
		}

		this.#execution.halted = true;
		this.#execution.childProcess.stdin.write('shutdown\n');
	}

	async #onExecuteCodemodSetMessage(
		message: Message & { kind: MessageKind.executeCodemodSet },
	) {
		if (this.#execution) {
			await window.showErrorMessage(
				'Wait until the previous codemod set execution has finished',
			);

			return;
		}

		if (
			!this.#noraNodeEngineExecutableUri ||
			!this.#noraRustEngineExecutableUri
		) {
			await window.showErrorMessage(
				'Wait until the engines have been bootstrapped to execute the operation',
			);

			return;
		}

		const { storageUri } = message.command;

		const storageDirectory =
			message.command.engine === 'node'
				? 'nora-node-engine'
				: 'nora-rust-engine';

		const outputUri = Uri.joinPath(
			message.command.storageUri,
			storageDirectory,
		);

		const executableUri =
			message.command.engine === 'node'
				? this.#noraNodeEngineExecutableUri
				: this.#noraRustEngineExecutableUri;

		await this.#fileSystem.createDirectory(storageUri);
		await this.#fileSystem.createDirectory(outputUri);

		const { fileLimit } = this.#configurationContainer.get();

		const buildArguments = () => {
			const args: string[] = [];

			if (message.command.engine === 'node' && 'uri' in message.command) {
				args.push(
					'-p',
					Uri.joinPath(message.command.uri, '**/*.tsx').fsPath,
				);
				args.push('-p', '!**/node_modules');

				args.push('-l', String(fileLimit));
			} else if (
				message.command.engine === 'rust' &&
				'uri' in message.command
			) {
				args.push('-d', message.command.uri.fsPath);
				args.push(
					'-p',
					`"${Uri.joinPath(message.command.uri, '**/*.tsx').fsPath}"`,
				);
				args.push('-a', '**/node_modules/**/*');
			}

			if ('fileUri' in message.command) {
				args.push('-f', message.command.fileUri.fsPath);
			}

			if ('group' in message.command) {
				args.push('-g', message.command.group);
			}

			args.push('-o', outputUri.fsPath);

			return args;
		};

		const args = buildArguments();

		const caseKind =
			message.command.engine === 'node'
				? CaseKind.REWRITE_FILE_BY_NORA_NODE_ENGINE
				: CaseKind.REWRITE_FILE_BY_NORA_RUST_ENGINE;

		const childProcess = spawn(executableUri.fsPath, args, {
			stdio: 'pipe',
		});

		childProcess.stderr.on('data', (data) => {
			console.error(data.toString());
		});

		const executionId = message.executionId;

		const codemodSetName =
			'group' in message.command ? message.command.group : '';

		this.#execution = {
			childProcess,
			executionId,
			codemodSetName,
			halted: false,
			totalFileCount: 0, // that is the lower bound
		};

		const interfase = readline.createInterface(childProcess.stdout);

		const noraRustEngineExecutableUri = this.#noraRustEngineExecutableUri;

		interfase.on('line', async (line) => {
			if (!this.#execution) {
				return;
			}

			const either = messageCodec.decode(JSON.parse(line));

			if (either._tag === 'Left') {
				const report = prettyReporter.report(either);

				console.error(report);
				return;
			}

			const message = either.right;

			if (message.k === EngineMessageKind.progress) {
				this.#statusBarItemManager.moveToProgress(message.p, message.t);

				this.#execution.totalFileCount = message.t;
				return;
			}

			if (
				message.k === EngineMessageKind.finish ||
				message.k === EngineMessageKind.compare ||
				message.k === EngineMessageKind.change
			) {
				return;
			}

			let job: Job;

			const codemodName = message.c;

			if (message.k === EngineMessageKind.create) {
				const inputUri = Uri.file(message.p);
				const outputUri = Uri.file(message.o);

				job = buildCreateFileJob(
					inputUri,
					outputUri,
					codemodSetName,
					codemodName,
				);
			} else {
				const inputUri = Uri.file(message.i);
				const outputUri = Uri.file(message.o);

				job = buildRewriteFileJob(
					inputUri,
					outputUri,
					codemodSetName,
					codemodName,
				);
			}

			this.#messageBus.publish({
				kind: MessageKind.compareFiles,
				noraRustEngineExecutableUri,
				job,
				caseKind,
				caseSubKind: message.c,
				executionId,
				codemodSetName,
				codemodName,
			});
		});

		interfase.on('close', () => {
			this.#statusBarItemManager.moveToStandby();

			if (this.#execution) {
				this.#messageBus.publish({
					kind: MessageKind.codemodSetExecuted,
					executionId: this.#execution.executionId,
					codemodSetName: this.#execution.codemodSetName,
					halted: this.#execution.halted,
					fileCount: this.#execution.totalFileCount,
				});
			}

			this.#execution = null;
		});
	}

	async clearOutputFiles(storageUri: Uri) {
		for (const storageDirectory of STORAGE_DIRECTORY_MAP.values()) {
			const outputUri = Uri.joinPath(storageUri, storageDirectory);

			await this.#fileSystem.delete(outputUri, {
				recursive: true,
				useTrash: false,
			});
		}
	}
}