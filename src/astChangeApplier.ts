import {Node, Project, SourceFile, StructureKind, SyntaxKind, ts, VariableDeclarationKind} from "ts-morph";
import {AstChange, AstChangeKind} from "./getAstChanges";
import {
    calculateStaticPropertyAccessExpressionUpdate,
    isNeitherNullNorUndefined
} from "./utilities";

export class AstChangeApplier {
    protected _changedSourceFiles = new Set<SourceFile>();

    public constructor(
        protected _project: Project,
        protected readonly _astChanges: ReadonlyArray<AstChange>,
    ) {
    }

    public applyChanges(): ReadonlyArray<[string, string]> {
        this._astChanges.forEach((astChange) => {
            switch(astChange.kind) {
                case AstChangeKind.ARROW_FUNCTION_PARAMETER_DELETED:
                    this._applyArrowFunctionParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.FUNCTION_PARAMETER_DELETED:
                    this._applyFunctionParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.CLASS_METHOD_PARAMETER_DELETED:
                    this._applyClassMethodParameterDeletedChange(astChange);
                    return;
                case AstChangeKind.CLASS_SPLIT_COMMAND:
                    this._applyClassSplitCommandChange(astChange);
            }
        });

        const sourceFiles: [string,string][] = [];

        this._changedSourceFiles.forEach(
            (sourceFile) => {
                sourceFiles.push([
                    sourceFile.getFilePath(),
                    sourceFile.getFullText()
                ]);

                sourceFile.saveSync();
            }
        );

        return sourceFiles;
    }

    protected _applyClassMethodParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.CLASS_METHOD_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const classDeclaration = sourceFile.getClass(astChange.className);

        if (!classDeclaration) {
            return;
        }

        const methodDeclaration = classDeclaration.getMethod(astChange.methodName);

        if (!methodDeclaration) {
            return;
        }

        methodDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isPropertyAccessExpression(parentNode)) {
                        return;
                    }

                    const callExpression = parentNode.getParent();

                    if (!Node.isCallExpression(callExpression)) {
                        return;
                    }

                    const argument = callExpression.getArguments()[index];

                    if (!argument) {
                        console.log('no argument')
                        return;
                    }

                    callExpression.removeArgument(argument);
                }
            );
    }

    protected _applyFunctionParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.FUNCTION_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const functionDeclaration = sourceFile.getFunction(astChange.functionName);

        if (!functionDeclaration) {
            return;
        }

        functionDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isCallExpression(parentNode)) {
                        return;
                    }

                    const argument = parentNode.getArguments()[index];

                    if (!argument) {
                        return;
                    }

                    parentNode.removeArgument(argument);
                }
            );
    }

    protected _applyArrowFunctionParameterDeletedChange(
        astChange: AstChange & { kind: AstChangeKind.ARROW_FUNCTION_PARAMETER_DELETED },
    ) {
        const index = astChange.parameters.findIndex(p => p === astChange.parameter);

        if (index === -1) {
            return;
        }

        const sourceFile = this._project.getSourceFile(astChange.filePath)

        if (!sourceFile) {
            return;
        }

        const variableDeclaration = sourceFile.getVariableDeclaration(astChange.arrowFunctionName);

        if (!variableDeclaration) {
            return;
        }

        variableDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .forEach(
                (reference) => {
                    const sourceFile = reference.getSourceFile();

                    this._changedSourceFiles.add(sourceFile);

                    const parentNode = reference.getNode().getParent();

                    if (!Node.isCallExpression(parentNode)) {
                        return;
                    }

                    const argument = parentNode.getArguments()[index];

                    if (!argument) {
                        return;
                    }

                    parentNode.removeArgument(argument);
                }
            );
    }

    protected _applyClassSplitCommandChange(
        astChange: AstChange & { kind: AstChangeKind.CLASS_SPLIT_COMMAND },
    ) {
        const sourceFile = this._project.getSourceFile(astChange.filePath);

        if (!sourceFile) {
            return;
        }

        const classDeclaration = sourceFile
            .getDescendantsOfKind(SyntaxKind.ClassDeclaration)
            .find((cd) => cd.getName() === astChange.className);

        if (!classDeclaration) {
            return;
        }

        const classParentNode = classDeclaration.getParent();

        const members = classDeclaration.getMembers();
        let deletedMemberCount = 0;

        const commentNode = classDeclaration.getPreviousSiblingIfKind(ts.SyntaxKind.SingleLineCommentTrivia);

        const lazyFunctions: (() => void)[] = [];

        if (Node.isCommentStatement(commentNode)) {
            lazyFunctions.push(
                () => commentNode.remove()
            );
        }

        const index = classDeclaration.getChildIndex();

        const newImportDeclarationMap = new Map<SourceFile, string[]>();

        classDeclaration
            .getStaticProperties()
            .forEach(
                staticProperty => {
                    const referencedSymbolEntries = staticProperty
                        .findReferences()
                        .flatMap((rs) => rs.getReferences());

                    const structure = staticProperty.getStructure();

                    if (structure.kind !== StructureKind.Property) {
                        return;
                    }

                    const { initializer } = structure;

                    const name = staticProperty.getName();

                    ++deletedMemberCount;

                    lazyFunctions.push(
                        () => staticProperty.remove(),
                    );

                    if (referencedSymbolEntries.length === 1) {
                        return;
                    }

                    if(Node.isStatemented(classParentNode)) {
                        const modifierFlags = staticProperty.getCombinedModifierFlags();

                        const declarationKind =
                            modifierFlags & ts.ModifierFlags.Readonly
                                ? VariableDeclarationKind.Const
                                : VariableDeclarationKind.Let;

                        const exported = Node.isSourceFile(classParentNode);

                        lazyFunctions.push(
                            () => {
                                const variableStatement = classParentNode.insertVariableStatement(
                                    index,
                                    {
                                        declarationKind,
                                        declarations: [
                                            {
                                                name,
                                                initializer,
                                            }
                                        ],
                                    }
                                );

                                variableStatement.setIsExported(exported);
                            }
                        );
                    }

                    referencedSymbolEntries
                        .map((referencedSymbolEntry) => {
                            return calculateStaticPropertyAccessExpressionUpdate(
                                name,
                                referencedSymbolEntry,
                            );
                        })
                        .filter(isNeitherNullNorUndefined)
                        .forEach(([sourceFile, callback ]) => {
                            this._changedSourceFiles.add(sourceFile);
                            lazyFunctions.push(callback);

                            const names = newImportDeclarationMap.get(sourceFile) ?? [];

                            names.push(name);

                            newImportDeclarationMap.set(sourceFile, names);
                        });
                }
            );

        classDeclaration
            .getStaticMethods()
            .forEach(
                (staticMethod) => {
                    const name = staticMethod.getName();

                    const typeParameterDeclarations = staticMethod
                        .getTypeParameters()
                        .map((tpd) => tpd.getStructure());

                    const parameters = staticMethod
                        .getParameters()
                        .map(parameter => parameter.getStructure());

                    const returnType = staticMethod
                        .getReturnTypeNode()
                        ?.getText() ?? 'void';

                    const bodyText = staticMethod.getBodyText();

                    if(Node.isStatemented(classParentNode)) {
                        lazyFunctions.push(
                            () => {
                                const functionDeclaration = classParentNode.insertFunction(
                                    index,
                                    {
                                        name,
                                    }
                                );

                                functionDeclaration.setIsExported(true);
                                functionDeclaration.addTypeParameters(typeParameterDeclarations);
                                functionDeclaration.addParameters(parameters);
                                functionDeclaration.setReturnType(returnType);

                                if (bodyText) {
                                    functionDeclaration.setBodyText(bodyText);
                                }
                            }
                        );
                    }

                    staticMethod
                        .findReferences()
                        .flatMap((referencedSymbol) => referencedSymbol.getReferences())
                        .forEach((referencedSymbolEntry) => {
                            const sourceFile = referencedSymbolEntry.getSourceFile();

                            this._changedSourceFiles.add(sourceFile);

                            const node = referencedSymbolEntry.getNode();

                            const callExpression = node
                                .getFirstAncestorByKind(
                                    ts.SyntaxKind.CallExpression
                                );

                            if (!callExpression) {
                                return;
                            }

                            let typeArguments = callExpression
                                .getTypeArguments()
                                .map(ta => ta.getText())
                                .join(', ');

                            typeArguments = typeArguments ? `<${typeArguments}>` : '';

                            const args = callExpression
                                .getArguments()
                                .map((arg) => arg.getText())
                                .join(', ');

                            // TODO: maybe there's a programmatic way to do this?
                            const text = `${staticMethod.getName()}${typeArguments}(${args})`;

                            lazyFunctions.push(
                                () => callExpression.replaceWithText(text),
                            );

                            const names = newImportDeclarationMap.get(sourceFile) ?? [];

                            names.push(name);

                            newImportDeclarationMap.set(sourceFile, names);
                        });

                    ++deletedMemberCount;

                    lazyFunctions.push(
                        () => staticMethod.remove(),
                    );

                    this._changedSourceFiles.add(sourceFile);
                }
            );

        const importSpecifierFilePaths = classDeclaration
            .findReferences()
            .flatMap((referencedSymbol) => referencedSymbol.getReferences())
            .map(
                (rse) => {
                    const node = rse.getNode();
                    const parentNode = node.getParent();

                    if (!parentNode || !Node.isImportSpecifier(parentNode)) {
                        return null;
                    }

                    return parentNode
                        .getSourceFile()
                        .getFilePath()
                        .toString();
                }
            )
            .filter(isNeitherNullNorUndefined);

        {
            if (lazyFunctions.length > 0) {
                this._changedSourceFiles.add(sourceFile);
            }

            lazyFunctions.forEach(
                (lazyFunction) => lazyFunction(),
            );
        }

        if (members.length - deletedMemberCount === 0) {
            importSpecifierFilePaths.forEach(
                (filePath) => {
                    const otherSourceFile = this._project.getSourceFile(filePath);

                    if (!otherSourceFile) {
                        return;
                    }

                    otherSourceFile
                        .getImportDeclarations()
                        .filter(
                            (id) => {
                                return id.getModuleSpecifierSourceFile() === sourceFile
                            }
                        )
                        .forEach(
                            (id) => {
                                const namedImports = id.getNamedImports();

                                const namedImport = namedImports
                                    .find(ni => ni.getName()) ?? null;

                                if (!namedImport) {
                                    return;
                                }

                                const count = namedImports.length;

                                // removal
                                namedImport.remove();

                                if (count === 1) {
                                    id.remove();
                                }
                            }
                        );


                }
            )

            newImportDeclarationMap.forEach(
                (names, otherSourceFile) => {
                    if (otherSourceFile === sourceFile) {
                        return;
                    }

                    otherSourceFile.insertImportDeclaration(
                        0,
                        {
                            namedImports: names,
                            moduleSpecifier: otherSourceFile
                                .getRelativePathAsModuleSpecifierTo(sourceFile.getFilePath()),
                        }
                    );
                }
            )

            classDeclaration.remove();
        }
    }
}