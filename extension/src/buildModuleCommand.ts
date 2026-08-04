import * as vscode from 'vscode'
import { buildModule, ModuleBuildError, resolveMeasurementSystem, normalizeContentLanguage, loadCatalogOverrides } from 'mpx-core'

const BUILD_COMMAND = 'mpx.buildModule'

async function resolveModuleFolder(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    await vscode.window.showErrorMessage('Open an MPX module project first.')
    return undefined
  }
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri.fsPath
  }

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      moduleFolder: workspaceFolder.uri.fsPath,
    })),
    { placeHolder: 'Select the module project to build' },
  )
  return selection?.moduleFolder
}

function reportIssues(outputChannel: vscode.OutputChannel, error: ModuleBuildError): void {
  outputChannel.clear()
  outputChannel.appendLine(`MPX build failed with ${error.issues.length} issue(s):`)
  for (const issue of error.issues) {
    outputChannel.appendLine(`  ${issue.file}: ${issue.message}`)
  }
  outputChannel.show(true)
}

async function executeBuildModule(outputChannel: vscode.OutputChannel): Promise<void> {
  const moduleFolder = await resolveModuleFolder()
  if (!moduleFolder) {
    return
  }

  await vscode.workspace.saveAll(false)

  const config = vscode.workspace.getConfiguration('mpx', vscode.Uri.file(moduleFolder))
  const autoIncrementVersion = config.get<boolean>('autoIncrementVersion', true)
  const contentLanguage = normalizeContentLanguage(config.get<string>('contentLanguage', 'en'))
  const defaultMeasurement = resolveMeasurementSystem(config.get<string>('defaultMeasurement', 'auto'), contentLanguage)
  const { overrides: catalogOverrides, issues: overrideIssues } = await loadCatalogOverrides(moduleFolder)
  if (overrideIssues.length > 0) {
    await vscode.window.showWarningMessage(
      `translation-overrides.json: ${overrideIssues.map((issue) => issue.message).join(' ')}`,
    )
  }
  const spellDisplayDefaults = {
    showImage: config.get<boolean>('defaultShowSpellImage', true),
    showSchoolIcon: config.get<boolean>('defaultShowSpellSchoolIcon', true),
    showAreaEffectIcon: config.get<boolean>('defaultShowSpellAreaEffectIcon', true),
    showSources: config.get<boolean>('defaultShowSpellSources', true),
    showTags: config.get<boolean>('defaultShowSpellTags', true),
  }
  const itemDisplayDefaults = {
    showImage: config.get<boolean>('defaultShowItemImage', true),
    showSources: config.get<boolean>('defaultShowItemSources', true),
    showTags: config.get<boolean>('defaultShowItemTags', true),
  }
  const monsterDisplayDefaults = {
    showImage: config.get<boolean>('defaultShowMonsterImage', true),
    showToken: config.get<boolean>('defaultShowMonsterToken', true),
    showSources: config.get<boolean>('defaultShowMonsterSources', true),
    showTags: config.get<boolean>('defaultShowMonsterTags', true),
  }
  const autoDetectRollTables = config.get<boolean>('autoDetectRollTables', true)

  try {
    const summary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'MPX is building the module…' },
      () =>
        buildModule(moduleFolder, {
          autoIncrementVersion,
          defaultMeasurement,
          contentLanguage,
          catalogOverrides,
          spellDisplayDefaults,
          itemDisplayDefaults,
          monsterDisplayDefaults,
          autoDetectRollTables,
        }),
    )

    const versionNote = summary.nextVersion
      ? ` module.json is now set to ${summary.nextVersion} for the next build.`
      : ''
    const selection = await vscode.window.showInformationMessage(
      `Module built as version ${summary.builtVersion}: ${summary.pageCount} page(s), ` +
        `${summary.groupCount} group(s), ${summary.mapCount} map(s), ${summary.encounterCount} encounter(s), ` +
        `${summary.itemCount} item(s), ${summary.spellCount} spell(s), ${summary.tableCount} roll table(s), ` +
        `${summary.monsterCount} monster(s).` +
        versionNote,
      'Reveal Module',
    )
    if (selection === 'Reveal Module') {
      await vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(summary.outputPath),
      )
    }
    await vscode.commands.executeCommand('mpx.refreshExplorer')
  } catch (error) {
    if (error instanceof ModuleBuildError) {
      reportIssues(outputChannel, error)
      await vscode.window.showErrorMessage(
        `MPX build failed with ${error.issues.length} issue(s) — see the "MPX" output channel for details.`,
      )
      return
    }
    await vscode.window.showErrorMessage(`MPX module build failed: ${(error as Error).message}`)
  }
}

export function registerBuildModuleCommand(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('MPX')
  context.subscriptions.push(
    outputChannel,
    vscode.commands.registerCommand(BUILD_COMMAND, () => executeBuildModule(outputChannel)),
  )
}
