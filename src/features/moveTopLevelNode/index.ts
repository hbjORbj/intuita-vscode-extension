import {buildMoveTopLevelNodeUserCommand, MoveTopLevelNodeOptions} from "./1_userCommandBuilder";
import {buildMoveTopLevelNodeFact} from "./2_factBuilders/2_factBuilder";
import {SourceFileExecution} from "../../utilities";
import { buildMoveTopLevelNodeAstCommand } from "./3_astCommandBuilder";
import { executeMoveTopLevelNodeAstCommand } from "./4_astCommandExecutor";

export const moveTopLevelNode = (
    fileName: string,
    fileText: string,
    fileLine: number,
    options: MoveTopLevelNodeOptions,
): ReadonlyArray<SourceFileExecution> => {
    const userCommand = buildMoveTopLevelNodeUserCommand(
        fileName,
        fileText,
        fileLine,
        options,
    );

    const fact = buildMoveTopLevelNodeFact(
        userCommand,
    );

    const astCommand = buildMoveTopLevelNodeAstCommand(
        userCommand,
        fact,
    );

    if (astCommand === null) {
        return [];
    }

    return executeMoveTopLevelNodeAstCommand(
        astCommand,
    );
};