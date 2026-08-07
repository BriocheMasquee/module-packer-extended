import { access, copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as vscode from 'vscode'
import { detectManifestFileName, RAW_COMPENDIUM_IMPORT_TYPES, AUTHORED_COMPENDIUM_MANIFESTS } from 'mpx-core'

const IMPORT_COMPENDIUM_COMMAND = 'mpx.importCompendium'
const REFRESH_COMPENDIUM_EXPLORER_COMMAND = 'mpx.refreshCompendiumExplorer'

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

/** Copies a raw EncounterPlus Compendium export (.zip) into the project
 * folder its own manifest identifies — no need for the user to know which
 * folder a given content type belongs in. Only content types with no MPX
 * YAML authoring of their own are accepted (currently just Rule); a zip
 * whose manifest matches an already-authored type (item/spell/monster/
 * background/roll table) is refused rather than silently merged in
 * unvalidated (see AUTHORED_COMPENDIUM_MANIFESTS in
 * core/src/compendiumImportTypes.ts). MPX never unpacks or reshapes the
 * file itself — buildModule reads it straight from the zip at build time,
 * see readRuleImports in core/src/buildModule.ts. */
async function executeImportCompendium(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('Open an MPX project folder first.')
    return
  }

  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'EncounterPlus Compendium Export': ['zip'] },
    openLabel: 'Import Compendium',
    title: 'Select a Compendium export (.zip) from EncounterPlus',
  })
  const sourcePath = selection?.[0]?.fsPath
  if (!sourcePath) {
    return
  }

  const manifestFileName = await detectManifestFileName(sourcePath)
  if (!manifestFileName) {
    await vscode.window.showErrorMessage(
      `"${basename(sourcePath)}" doesn't look like a valid EncounterPlus Compendium export — no single manifest file found at its root.`,
    )
    return
  }

  const authoredLabel = AUTHORED_COMPENDIUM_MANIFESTS[manifestFileName]
  if (authoredLabel) {
    await vscode.window.showErrorMessage(
      `MPX already has full authoring support for ${authoredLabel} — use "Create ${authoredLabel}" instead of importing it raw. Raw import for this type isn't available yet.`,
    )
    return
  }

  const rawType = RAW_COMPENDIUM_IMPORT_TYPES[manifestFileName]
  if (!rawType) {
    await vscode.window.showErrorMessage(`MPX doesn't support raw-importing "${manifestFileName}" yet.`)
    return
  }

  const targetFolder = join(workspaceFolder.uri.fsPath, rawType.folder)
  await mkdir(targetFolder, { recursive: true })
  const destPath = join(targetFolder, basename(sourcePath))

  if (await fileExists(destPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `"${basename(sourcePath)}" already exists in ${rawType.folder}/. Overwrite it?`,
      { modal: true },
      'Overwrite',
    )
    if (overwrite !== 'Overwrite') {
      return
    }
  }

  await copyFile(sourcePath, destPath)
  await vscode.commands.executeCommand(REFRESH_COMPENDIUM_EXPLORER_COMMAND)
  await vscode.window.showInformationMessage(`Imported "${basename(sourcePath)}" into ${rawType.folder}/.`)
}

export function registerCompendiumImportCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(IMPORT_COMPENDIUM_COMMAND, executeImportCompendium),
  )
}
