import * as vscode from 'vscode'
import { discoverProjectThemes, replaceProjectThemeAssets, DEFAULT_PROJECT_THEME_ID } from 'mpx-core'
import { resolveModuleFolder } from './contentCommands.js'
import { themesRootDirectory } from './extension.js'

const SELECT_PROJECT_THEME_COMMAND = 'mpx.selectProjectTheme'

/** Picking a theme (even re-picking the current one) always resyncs
 * assets/ from the extension's bundled copy — the fix for issue #27 (an
 * extension update shipping theme changes an existing project never picks
 * up) doubles as "switch theme" once a second theme exists (issue #6). */
async function executeSelectProjectTheme(context: vscode.ExtensionContext): Promise<void> {
  const moduleFolder = await resolveModuleFolder()
  if (!moduleFolder) {
    return
  }

  const themes = await discoverProjectThemes(themesRootDirectory(context))
  if (themes.length === 0) {
    await vscode.window.showErrorMessage('MPX has no bundled theme to apply.')
    return
  }

  const config = vscode.workspace.getConfiguration('mpx', vscode.Uri.file(moduleFolder))
  const currentThemeId = config.get<string>('projectTheme', DEFAULT_PROJECT_THEME_ID)

  const selection = await vscode.window.showQuickPick(
    themes.map((theme) => ({
      label: theme.name,
      description: theme.id === currentThemeId ? `${theme.description} (current)` : theme.description,
      theme,
    })),
    { placeHolder: 'Select a theme for this project — re-selecting the current one resyncs its assets' },
  )
  if (!selection) {
    return
  }

  await config.update('projectTheme', selection.theme.id, vscode.ConfigurationTarget.WorkspaceFolder)
  await replaceProjectThemeAssets(moduleFolder, selection.theme)

  await vscode.commands.executeCommand('mpx.refreshExplorer')
  await vscode.commands.executeCommand('markdown.preview.refresh')
  await vscode.window.showInformationMessage(`Theme set to "${selection.theme.name}" — assets/ resynced.`)
}

export function registerThemeCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SELECT_PROJECT_THEME_COMMAND, () => executeSelectProjectTheme(context)),
  )
}
