import { basename } from 'node:path'
import * as vscode from 'vscode'
import { convertMpProject, detectWorkspaceKind } from 'mpx-core'
import { mpLegacyFallbackDirectory } from './extension.js'

const CONVERT_COMMAND = 'mpx.convertMpProject'

async function selectMpSourceFolder(): Promise<string | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select MP Project',
    title: 'Select the MP (Module Packer V4) project folder to convert',
  })
  return selection?.[0]?.fsPath
}

async function selectMpxDestinationFolder(): Promise<string | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Convert Here',
    title: 'Select an empty folder for the converted MPX V5 project',
  })
  return selection?.[0]?.fsPath
}

function reportNotices(outputChannel: vscode.OutputChannel, sourceDirectory: string, notices: readonly { code: string; message: string; path?: string }[]): void {
  outputChannel.clear()
  outputChannel.appendLine(`MPX converted "${basename(sourceDirectory)}" with ${notices.length} notice(s):`)
  for (const notice of notices) {
    outputChannel.appendLine(`  [${notice.code}] ${notice.path ? `${notice.path} — ` : ''}${notice.message}`)
  }
  outputChannel.show(true)
}

async function executeConvertMpProject(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
  const sourceDirectory = await selectMpSourceFolder()
  if (!sourceDirectory) {
    return
  }

  const destinationDirectory = await selectMpxDestinationFolder()
  if (!destinationDirectory) {
    return
  }

  if ((await detectWorkspaceKind(destinationDirectory)) !== 'empty') {
    await vscode.window.showErrorMessage('The destination folder for the converted MPX project must be empty.')
    return
  }

  // Module Packer V4's own default theme, not MPX's — a converted project's
  // assets/ should look like what MP itself would have produced when the
  // source project never had a theme of its own to begin with.
  const fallbackTheme = {
    id: 'mp-legacy-fallback',
    name: 'Module Packer V4 default theme',
    description: '',
    themeDirectory: mpLegacyFallbackDirectory(context),
  }

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'MPX is converting the MP project…' },
      () => convertMpProject(sourceDirectory, destinationDirectory, { fallbackTheme }),
    )

    if (result.notices.length > 0) {
      reportNotices(outputChannel, sourceDirectory, result.notices)
    }

    const selection = await vscode.window.showInformationMessage(
      `Converted to MPX: ${result.pageCount} page(s), ${result.groupCount} group(s), ${result.imageCount} image(s).` +
        (result.notices.length > 0 ? ` ${result.notices.length} notice(s) — see the "MPX" output channel.` : ''),
      'Open Converted Project',
    )
    if (selection === 'Open Converted Project') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destinationDirectory))
    }
  } catch (error) {
    await vscode.window.showErrorMessage(`MPX conversion failed: ${(error as Error).message}`)
  }
}

export function registerConvertMpProjectCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CONVERT_COMMAND, () => executeConvertMpProject(context, outputChannel)),
  )
}
