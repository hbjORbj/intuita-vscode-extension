import { FileSystem, Uri } from 'vscode';
import { CaseManager } from '../cases/caseManager';
import { JobManager } from '../components/jobManager';
import { MessageBus, MessageKind } from '../components/messageBus';
import { debounce } from '../utilities';
import { PersistedState } from './codecs';
import { mapCaseToPersistedCase, mapJobToPersistedJob } from './mappers';

export class PersistedStateService {
	constructor(
		private readonly caseManager: CaseManager,
		private readonly fileSystem: FileSystem,
		private readonly getStorageUri: () => Uri | null,
		private readonly jobManager: JobManager,
		private readonly messageBus: MessageBus,
	) {
		const debouncedOnUpdateElementsMessage = debounce(
			() => this.#onUpdateElementsMessage(),
			1000,
		);

		this.messageBus.subscribe(MessageKind.updateElements, () =>
			debouncedOnUpdateElementsMessage(),
		);
		this.messageBus.subscribe(MessageKind.clearState, () =>
			this.#onClearStateMessage(),
		);
	}

	async #onUpdateElementsMessage() {
		const uri = this.getStorageUri();

		if (!uri) {
			console.error(
				'No storage URI could be found for persisting state.',
			);

			return;
		}

		const persistedState = this.#buildPersistedState();
		const buffer = Buffer.from(JSON.stringify(persistedState));

		await this.fileSystem.createDirectory(uri);

		const localStateUri = Uri.joinPath(uri, 'localState.json');
		this.fileSystem.writeFile(localStateUri, buffer);
	}

	#buildPersistedState(): PersistedState {
		const cases = Array.from(this.caseManager.getCases()).map((kase) =>
			mapCaseToPersistedCase(kase),
		);
		const caseHashJobHashes = Array.from(
			this.caseManager.getCaseHashJobHashSetValues(),
		);

		const jobs = Array.from(this.jobManager.getJobs()).map((job) =>
			mapJobToPersistedJob(job),
		);
		const rejectedJobHashes = Array.from(
			this.jobManager.getRejectedJobHashes(),
		);

		return {
			cases,
			caseHashJobHashes,
			jobs,
			rejectedJobHashes,
		};
	}

	async #onClearStateMessage() {
		const uri = this.getStorageUri();

		if (!uri) {
			console.error(
				'No storage URI found. We cannot clear the state anywhere.',
			);

			return;
		}

		const localStateUri = Uri.joinPath(uri, 'localState.json');

		const persistedState: PersistedState = {
			cases: [],
			caseHashJobHashes: [],
			jobs: [],
			rejectedJobHashes: [],
		};

		const buffer = Buffer.from(JSON.stringify(persistedState));

		this.fileSystem.writeFile(localStateUri, buffer);
	}
}
