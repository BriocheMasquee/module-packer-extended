import { access } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { generatePreviewFontStyles, PREVIEW_FONT_STYLE_PATH } from 'mpx-core'

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

  // A .ttc/.otc font collection under assets/font/ never resolves in
  // VSCode's own preview webview, even though a real browser/EncounterPlus
  // reads it fine — so each face is extracted into its own file under
  // .vscode/mpx-preview-fonts/ (preview-only, excluded from the built
  // .module) and declared here under the same font-family name the
  // project's own CSS already uses.
  const previewFontStylePath = await generatePreviewFontStyles(projectRoot).catch((error: unknown) => {
    console.error('MPX: failed to generate preview font styles for', projectRoot, error)
    return undefined
  })

  const allManagedStylePaths = [...MANAGED_STYLE_PATHS, PREVIEW_FONT_STYLE_PATH]
  const currentStyles = markdownConfig.get<string[]>('styles') ?? []
  const nonManagedStyles = currentStyles.filter((style) => !allManagedStylePaths.includes(style))
  const managedStyles: string[] = []
  for (const stylePath of MANAGED_STYLE_PATHS) {
    if (await fileExists(join(projectRoot, stylePath))) {
      managedStyles.push(stylePath)
    }
  }
  if (previewFontStylePath) {
    managedStyles.push(previewFontStylePath)
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
    watchers = (vscode.workspace.workspaceFolders ?? []).flatMap((workspaceFolder) => {
      const styleWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, 'assets/css/{global,custom}.css'),
      )
      const refresh = () => void configureModulePreview(workspaceFolder)
      styleWatcher.onDidCreate(refresh)
      styleWatcher.onDidChange(refresh)
      styleWatcher.onDidDelete(refresh)

      const fontWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, 'assets/font/**/*.{otc,ttc}'),
      )
      fontWatcher.onDidCreate(refresh)
      fontWatcher.onDidChange(refresh)
      fontWatcher.onDidDelete(refresh)

      // extension.ts's own watcher reloads the cached override values; this
      // one tells any already-open preview panel to actually re-render with
      // them (same reason mpx.contentLanguage below triggers a refresh).
      const overridesWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, 'translation-overrides.json'),
      )
      const refreshPreview = () => void vscode.commands.executeCommand('markdown.preview.refresh')
      overridesWatcher.onDidCreate(refreshPreview)
      overridesWatcher.onDidChange(refreshPreview)
      overridesWatcher.onDidDelete(refreshPreview)

      return [styleWatcher, fontWatcher, overridesWatcher]
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
    // mpx.defaultShowSpell*/mpx.defaultShowItem*/mpx.defaultShowMonster*/
    // mpx.defaultShowBackground* fresh on every render (see extension.ts's
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
        'mpx.defaultShowItemImage',
        'mpx.defaultShowItemSources',
        'mpx.defaultShowItemTags',
        'mpx.defaultShowMonsterImage',
        'mpx.defaultShowMonsterToken',
        'mpx.defaultShowMonsterSources',
        'mpx.defaultShowMonsterTags',
        'mpx.defaultShowBackgroundImage',
        'mpx.defaultShowBackgroundSources',
        'mpx.defaultShowBackgroundTags',
        'mpx.autoDetectRollTables',
      ]
      if (watchedSettings.some((setting) => event.affectsConfiguration(setting))) {
        void vscode.commands.executeCommand('markdown.preview.refresh')
      }
    }),
    new vscode.Disposable(() => watchers.forEach((watcher) => watcher.dispose())),
  )
}
