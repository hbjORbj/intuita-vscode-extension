import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { useEffect, useState } from 'react';
import CreateIssue from './CreateIssueView';
import { vscode } from './utilities/vscode';
import WarningMessage from './WarningMessage';
import type { WebviewMessage } from '../../src/components/webview/IntuitaPanel';
declare global {
	interface Window {
		INITIAL_STATE: {
			repositoryPath: string;
			userId: string;
		};
	}
}

type FormState = {
	title: string;
	description: string;
};

function App() {
	const [configuredRepoPath, setConfiguredRepoPath] = useState<string | null>(
		window.INITIAL_STATE.repositoryPath,
	);
	const [linkedAccount, setLinkedAccount] = useState<string | null>(
		window.INITIAL_STATE.userId,
	);
	const [loading, setLoading] = useState(false);
	const [initialFormState, setInitialFormState] = useState<
		Partial<FormState>
	>({});

	useEffect(() => {
		vscode.postMessage({ kind: 'webview.global.afterWebviewMounted' });
	}, []);

	useEffect(() => {
		const handler = (e: MessageEvent<WebviewMessage>) => {
			const message = e.data;

			if (message.kind === 'webview.global.setUserAccount') {
				setLinkedAccount(message.value);
			}

			if (message.kind === 'webview.global.setConfiguration') {
				setConfiguredRepoPath(message.value.repositoryPath);
			}

			if (message.kind === 'webview.createIssue.setLoading') {
				setLoading(message.value);
			}

			if (message.kind === 'webview.createIssue.setFormData') {
				setInitialFormState(message.value);
			}
		};

		window.addEventListener('message', handler);

		return () => {
			window.removeEventListener('message', handler);
		};
	}, []);

	const handleLinkAccount = () => {
		vscode.postMessage({
			kind: 'webview.global.redirectToSignIn',
		});
	};

	const handleOpenExtensionSettings = () => {
		vscode.postMessage({
			kind: 'webview.global.openConfiguration',
		});
	};

	return (
		<main className="App">
			{configuredRepoPath && linkedAccount ? (
				<CreateIssue
					loading={loading}
					initialFormState={initialFormState}
				/>
			) : null}

			{!configuredRepoPath ? (
				<WarningMessage
					message="In order to create issues, configure you repository settings"
					actionButtons={[
						<VSCodeButton onClick={handleOpenExtensionSettings}>
							Open settings
						</VSCodeButton>,
					]}
				/>
			) : null}

			{!linkedAccount ? (
				<WarningMessage
					message="In order to create issues, link your Intuita account"
					actionButtons={[
						<VSCodeButton onClick={handleLinkAccount}>
							Link account{' '}
						</VSCodeButton>,
					]}
				/>
			) : null}
		</main>
	);
}

export default App;
