import { access } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'

const MANAGED_STYLE_PATHS = ['assets/css/global.css', 'assets/css/custom.css']

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

/** Points the workspace folder's `markdown.styles` setting at the project's
 * own theme CSS — the same files the build bundles into the .module, so the
 * preview and the real output stay visually in sync. Any style entry the
 * user added themselves (not one of ours) is left untouched. */
async function configureModulePreview(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const projectRoot = workspaceFolder.uri.fsPath
  if (!(await fileExists(join(projectRoot, 'module.json')))) {
    return
  }

  const markdownConfig = vscode.workspace.getConfiguration('markdown', workspaceFolder)

  const currentStyles = markdownConfig.get<string[]>('styles') ?? []
  const nonManagedStyles = currentStyles.filter((style) => !MANAGED_STYLE_PATHS.includes(style))
  const managedStyles: string[] = []
  for (const stylePath of MANAGED_STYLE_PATHS) {
    if (await fileExists(join(projectRoot, stylePath))) {
      managedStyles.push(stylePath)
    }
  }
  const nextStyles = [...nonManagedStyles, ...managedStyles]
  if (JSON.stringify(nextStyles) !== JSON.stringify(currentStyles)) {
    await markdownConfig.update('styles', nextStyles, vscode.ConfigurationTarget.WorkspaceFolder)
  }

  // Our own renderer already hides front matter; this is defense-in-depth
  // for anything still going through VSCode's built-in Markdown engine.
  if (markdownConfig.get<string>('preview.frontMatter') !== 'hide') {
    await markdownConfig.update('preview.frontMatter', 'hide', vscode.ConfigurationTarget.WorkspaceFolder)
  }
}

async function configureAllWorkspacePreviews(): Promise<void> {
  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    await configureModulePreview(workspaceFolder).catch((error: unknown) => {
      console.error('MPX: failed to configure preview styles for', workspaceFolder.uri.fsPath, error)
    })
  }
}

export function registerPreviewConfiguration(context: vscode.ExtensionContext): void {
  let watchers: vscode.FileSystemWatcher[] = []

  function rebuildWatchers(): void {
    watchers.forEach((watcher) => watcher.dispose())
    watchers = (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, 'assets/css/{global,custom}.css'),
      )
      const refresh = () => void configureModulePreview(workspaceFolder)
      watcher.onDidCreate(refresh)
      watcher.onDidChange(refresh)
      watcher.onDidDelete(refresh)
      return watcher
    })
  }

  rebuildWatchers()
  void configureAllWorkspacePreviews()

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatchers()
      void configureAllWorkspacePreviews()
    }),
    // The renderer reads mpx.defaultMeasurement/mpx.contentLanguage/
    // mpx.defaultShowSpell* fresh on every render (see extension.ts's
    // extendMarkdownIt), so refreshing the open preview is enough to
    // reflect a changed setting immediately — no Extension Development
    // Host reload needed.
    vscode.workspace.onDidChangeConfiguration((event) => {
      const watchedSettings = [
        'mpx.defaultMeasurement',
        'mpx.contentLanguage',
        'mpx.defaultShowSpellImage',
        'mpx.defaultShowSpellSchoolIcon',
        'mpx.defaultShowSpellAreaEffectIcon',
        'mpx.defaultShowSpellSources',
        'mpx.defaultShowSpellTags',
      ]
      if (watchedSettings.some((setting) => event.affectsConfiguration(setting))) {
        void vscode.commands.executeCommand('markdown.preview.refresh')
      }
    }),
    new vscode.Disposable(() => watchers.forEach((watcher) => watcher.dispose())),
  )
}
