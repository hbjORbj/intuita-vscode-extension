import {JobHash} from "../moveTopLevelNode/jobHash";
import {IntuitaRange} from "../../utilities";
import {JobKind} from "../../jobs";

export type RepairCodeJob = Readonly<{
    kind: JobKind.repairCode,
    fileName: string,
    hash: JobHash,
    title: string,
    range: IntuitaRange,
    replacement: string,
}>;