import {JobHash} from "../features/moveTopLevelNode/jobHash";
import {assertsNeitherNullOrUndefined, calculateLastPosition, getSeparator, IntuitaRange} from "../utilities";
import {Position, Range, Selection, TextEditor, TextEditorRevealType, window, workspace} from "vscode";
import {buildJobUri, IntuitaFileSystem} from "./intuitaFileSystem";
import {Container} from "../container";
import {Configuration} from "../configuration";
import {JobOutput} from "../jobs";
import {JobManager} from "./jobManager";

export const acceptJob = (
    configurationContainer: Container<Configuration>,
    intuitaFileSystem: IntuitaFileSystem,
    jobManager: JobManager,
) => {
    const getJobOutput = (
        jobHash: JobHash,
        characterDifference: number,
    ): JobOutput | null => {
        const content = intuitaFileSystem.readNullableFile(
            buildJobUri(jobHash as JobHash),
        );

        if (!content) {
            return jobManager
                .executeJob(
                    jobHash,
                    characterDifference,
                );
        }

        const text = content.toString();
        const separator = getSeparator(text);

        const position = calculateLastPosition(text, separator);

        const range: IntuitaRange = [
            0,
            0,
            position[0],
            position[1],
        ];


        return {
            text,
            position,
            range,
        };
    };

    return async (arg0: unknown, arg1: unknown) => {
        // factor in tree-data commands and regular commands

        let jobHash: string;
        let characterDifference: number;

        if (typeof arg0 === 'object' && arg0) {
            jobHash = (arg0 as any).hash;
            characterDifference = 0;
        } else {
            if (typeof arg0 !== 'string') {
                throw new Error('The job hash argument must be a string');
            }
    
            if (typeof arg1 !== 'number') {
                throw new Error('The characterDifference argument must be a number');
            }

            jobHash = arg0;
            characterDifference = arg1;
        }

        const fileName = jobManager.getFileNameFromJobHash(jobHash as JobHash);

        assertsNeitherNullOrUndefined(fileName);

        const result = getJobOutput(
            jobHash as JobHash,
            characterDifference
        );

        assertsNeitherNullOrUndefined(result);

        const textEditors = window
            .visibleTextEditors
            .filter(
                ({ document }) => {
                    return document.fileName === fileName;
                },
            );

        const textDocuments = workspace
            .textDocuments
            .filter(
                (document) => {
                    return document.fileName === fileName;
                },
            );

        const activeTextEditor = window.activeTextEditor ?? null;

        const range = new Range(
            new Position(
                result.range[0],
                result.range[1],
            ),
            new Position(
                result.range[2],
                result.range[3],
            ),
        );

        const {
            saveDocumentOnJobAccept,
        } = configurationContainer.get();

        const changeTextEditor = async (textEditor: TextEditor) => {
            await textEditor.edit(
                (textEditorEdit) => {
                    textEditorEdit.replace(
                        range,
                        result.text,
                    );
                }
            );

            if (!saveDocumentOnJobAccept) {
                return;
            }

            return textEditor.document.save();
        };

        await Promise.all(
            textEditors.map(
                changeTextEditor,
            )
        );

        if (textEditors.length === 0) {
            textDocuments.forEach(
                (textDocument) => {
                    window
                        // TODO we can add a range here
                        .showTextDocument(textDocument)
                        .then(
                            changeTextEditor,
                        );
                }
            );
        }

        if (activeTextEditor?.document.fileName === fileName) {
            const position = new Position(
                result.position[0],
                result.position[1],
            );

            const selection = new Selection(
                position,
                position
            );

            activeTextEditor.selections = [ selection ];

            activeTextEditor.revealRange(
                new Range(
                    position,
                    position
                ),
                TextEditorRevealType.AtTop,
            );
        }

        const allTextDocuments = textEditors
            .map(({ document }) => document)
            .concat(
                textDocuments
            );

        if (allTextDocuments[0]) {
            jobManager
                .onFileTextChanged(
                    allTextDocuments[0],
                );
        }
    };
};