import { join } from 'node:path'
import * as vscode from 'vscode'
import {
  createMarkdownRenderer,
  createModuleProject,
  detectWorkspaceKind,
  resolveMeasurementSystem,
  normalizeContentLanguage,
  loadCatalogOverrides,
  discoverProjectThemes,
  resolveProjectTheme,
  DEFAULT_PROJECT_THEME_ID,
  type CatalogOverrides,
  type ProjectTheme,
} from 'mpx-core'
import { registerModuleExplorer } from './moduleExplorer.js'
import { registerProjectExplorer } from './projectExplorer.js'
import { registerCompendiumExplorer } from './compendiumExplorer.js'
import { registerCompendiumCommands } from './compendiumCommands.js'
import { registerContentCommands } from './contentCommands.js'
import { registerBuildModuleCommand } from './buildModuleCommand.js'
import { registerConvertMpProjectCommand } from './convertMpProjectCommand.js'
import { registerPreviewConfiguration } from './previewConfiguration.js'
import { registerLocalizationCommands } from './localizationCommands.js'
import { registerDeleteEntryCommand } from './deleteEntryCommand.js'
import { registerCompendiumBlockAssistance } from './compendiumBlockAssistance.js'
import { registerThemeCommands } from './themeCommands.js'
import { registerThemeGatedSnippets } from './themeGatedSnippets.js'

interface MarkdownItExtensionApi {
  extendMarkdownIt: (markdownIt: unknown) => unknown
}

const CREATE_PROJECT_COMMAND = 'mpx.createModuleProject'
const PENDING_MODULE_CONFIGURATION_KEY = 'mpx.pendingModuleConfiguration'

export function themesRootDirectory(context: vscode.ExtensionContext): string {
  return join(context.extensionPath, 'resources', 'themes')
}

/** Module Packer V4's own bundled default theme, copied verbatim — used
 * only as `Convert MP Project`'s fallback when the source MP project has no
 * assets/ of its own (never offered as a selectable project theme; see
 * THIRD-PARTY-LICENSES.md for where it comes from). */
export function mpLegacyFallbackDirectory(context: vscode.ExtensionContext): string {
  return join(context.extensionPath, 'resources', 'mp-legacy-fallback')
}

async function selectWorkspaceFolder(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  placeHolder: string,
): Promise<string | undefined> {
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri.fsPath
  }

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      description: workspaceFolder.uri.fsPath,
      label: workspaceFolder.name,
      projectDirectory: workspaceFolder.uri.fsPath,
    })),
    { placeHolder },
  )

  return selection?.projectDirectory
}

async function resolveTargetFolder(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Create MPX Project Here',
      title: 'Select an empty folder for the new MPX V5 project',
    })
    return selection?.[0]?.fsPath
  }

  return selectWorkspaceFolder(
    workspaceFolders,
    'Select the empty folder in which to create the MPX V5 project',
  )
}

/** Only prompts when there's an actual choice to make — a single-theme
 * QuickPick would just be friction. Once a second theme exists (issue #6's
 * "legacy"), this starts showing one on its own, no call-site change
 * needed. */
async function selectProjectThemeForCreation(context: vscode.ExtensionContext): Promise<ProjectTheme | undefined> {
  const themes = await discoverProjectThemes(themesRootDirectory(context))
  const defaultTheme = resolveProjectTheme(themes, DEFAULT_PROJECT_THEME_ID) ?? themes[0]
  if (themes.length <= 1) {
    return defaultTheme
  }

  const selection = await vscode.window.showQuickPick(
    themes.map((theme) => ({
      label: theme.name,
      description: theme.id === defaultTheme?.id ? `${theme.description} (default)` : theme.description,
      theme,
    })),
    { placeHolder: 'Select a theme for the new project' },
  )
  return selection?.theme ?? defaultTheme
}

async function executeCreateModuleProject(context: vscode.ExtensionContext): Promise<void> {
  const projectDirectory = await resolveTargetFolder()
  if (!projectDirectory) {
    return
  }

  if ((await detectWorkspaceKind(projectDirectory)) !== 'empty') {
    await vscode.window.showErrorMessage('The new MPX V5 project folder must be empty.')
    return
  }

  const theme = await selectProjectThemeForCreation(context)
  if (!theme) {
    await vscode.window.showErrorMessage('MPX has no bundled theme to create a project with.')
    return
  }

  await createModuleProject(projectDirectory, theme)

  const isAlreadyOpen = (vscode.workspace.workspaceFolders ?? []).some(
    (workspaceFolder) => workspaceFolder.uri.fsPath === projectDirectory,
  )
  if (isAlreadyOpen) {
    // vscode.openFolder is a no-op when the target is already the open folder,
    // so there is no reload to hang the "open module.json" step off of.
    await updateWorkspaceKindContext()
    await openModuleConfiguration(join(projectDirectory, 'module.json'))
    return
  }

  await context.globalState.update(
    PENDING_MODULE_CONFIGURATION_KEY,
    join(projectDirectory, 'module.json'),
  )
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDirectory))
}

async function openModuleConfiguration(modulePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(modulePath))
  await vscode.window.showTextDocument(document)
}

async function openPendingModuleConfiguration(context: vscode.ExtensionContext): Promise<void> {
  const modulePath = context.globalState.get<string>(PENDING_MODULE_CONFIGURATION_KEY)
  if (!modulePath) {
    return
  }

  const isOpenProject = (vscode.workspace.workspaceFolders ?? []).some(
    (workspaceFolder) => join(workspaceFolder.uri.fsPath, 'module.json') === modulePath,
  )
  await context.globalState.update(PENDING_MODULE_CONFIGURATION_KEY, undefined)
  if (!isOpenProject) {
    return
  }

  await openModuleConfiguration(modulePath)
}

// Loaded once at activation and refreshed whenever translation-overrides.json
// changes on disk — unlike measurement/language, this is a project *file*,
// not a VSCode setting, so there's no onDidChangeConfiguration to hook into.
// A synchronous getter (see extendMarkdownIt below) always reads this cache
// rather than the file directly, since createMarkdownRenderer's options must
// resolve synchronously on every render.
let cachedCatalogOverrides: CatalogOverrides = {}

async function refreshCatalogOverrides(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    cachedCatalogOverrides = {}
    return
  }
  const { overrides, issues } = await loadCatalogOverrides(workspaceFolder.uri.fsPath)
  cachedCatalogOverrides = overrides
  if (issues.length > 0) {
    const messages = issues.map((issue) => issue.message).join(' ')
    await vscode.window.showWarningMessage(`translation-overrides.json: ${messages}`)
  }
}

async function updateWorkspaceKindContext(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    await vscode.commands.executeCommand('setContext', 'mpx.workspaceKind', 'noFolder')
    return
  }

  const kinds = await Promise.all(
    workspaceFolders.map((workspaceFolder) => detectWorkspaceKind(workspaceFolder.uri.fsPath)),
  )
  const workspaceKind = kinds.includes('mpxProject')
    ? 'mpxProject'
    : kinds.every((kind) => kind === 'empty')
      ? 'empty'
      : 'unsupported'
  await vscode.commands.executeCommand('setContext', 'mpx.workspaceKind', workspaceKind)
}

export function activate(context: vscode.ExtensionContext): MarkdownItExtensionApi {
  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_PROJECT_COMMAND, () =>
      executeCreateModuleProject(context),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void updateWorkspaceKindContext()
      void refreshCatalogOverrides()
    }),
  )
  const overridesWatcher = vscode.workspace.createFileSystemWatcher('**/translation-overrides.json')
  context.subscriptions.push(
    overridesWatcher,
    overridesWatcher.onDidCreate(() => void refreshCatalogOverrides()),
    overridesWatcher.onDidChange(() => void refreshCatalogOverrides()),
    overridesWatcher.onDidDelete(() => void refreshCatalogOverrides()),
  )
  registerProjectExplorer(context)
  registerModuleExplorer(context)
  registerCompendiumExplorer(context)
  registerCompendiumCommands(context)
  registerContentCommands(context)
  const mpxOutputChannel = vscode.window.createOutputChannel('MPX')
  context.subscriptions.push(mpxOutputChannel)
  registerBuildModuleCommand(context, mpxOutputChannel)
  registerConvertMpProjectCommand(context, mpxOutputChannel)
  registerPreviewConfiguration(context)
  registerLocalizationCommands(context)
  registerThemeCommands(context)
  registerDeleteEntryCommand(context)
  registerCompendiumBlockAssistance(context)
  registerThemeGatedSnippets(context)

  void updateWorkspaceKindContext()
  void openPendingModuleConfiguration(context)
  void refreshCatalogOverrides()

  return {
    // VSCode ignores the markdown-it instance it passes in and just uses
    // whatever this returns — our renderer needs preview-specific behavior
    // (hidden front matter, adjusted image paths, #page wrapper) that the
    // build's renderer doesn't, so we build our own rather than extend theirs.
    //
    // VSCode calls this once (not per-file), so the markdown-it instance
    // itself is fixed for the session — but passing a getter instead of a
    // resolved value means every render still reads the live setting, so a
    // changed mpx.defaultMeasurement/mpx.contentLanguage takes effect on the
    // next preview refresh (see the onDidChangeConfiguration listener below)
    // without needing to reload the Extension Development Host.
    extendMarkdownIt: () => {
      const resolveMeasurement = (): ReturnType<typeof resolveMeasurementSystem> => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return resolveMeasurementSystem(
          config.get<string>('defaultMeasurement', 'auto'),
          config.get<string>('contentLanguage', 'en'),
        )
      }
      const resolveContentLanguage = () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return normalizeContentLanguage(config.get<string>('contentLanguage', 'en'))
      }
      const resolveOverrides = (): CatalogOverrides => cachedCatalogOverrides
      const resolveSpellDisplayDefaults = () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return {
          showImage: config.get<boolean>('defaultShowSpellImage', true),
          showSchoolIcon: config.get<boolean>('defaultShowSpellSchoolIcon', true),
          showAreaEffectIcon: config.get<boolean>('defaultShowSpellAreaEffectIcon', true),
          showSources: config.get<boolean>('defaultShowSpellSources', true),
          showTags: config.get<boolean>('defaultShowSpellTags', true),
        }
      }
      const resolveItemDisplayDefaults = () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return {
          showImage: config.get<boolean>('defaultShowItemImage', true),
          showSources: config.get<boolean>('defaultShowItemSources', true),
          showTags: config.get<boolean>('defaultShowItemTags', true),
        }
      }
      const resolveMonsterDisplayDefaults = () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return {
          showImage: config.get<boolean>('defaultShowMonsterImage', true),
          showToken: config.get<boolean>('defaultShowMonsterToken', true),
          showSources: config.get<boolean>('defaultShowMonsterSources', true),
          showTags: config.get<boolean>('defaultShowMonsterTags', true),
        }
      }
      const resolveBackgroundDisplayDefaults = () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return {
          showImage: config.get<boolean>('defaultShowBackgroundImage', true),
          showSources: config.get<boolean>('defaultShowBackgroundSources', true),
          showTags: config.get<boolean>('defaultShowBackgroundTags', true),
        }
      }
      const resolveAutoDetectRollTables = (): boolean => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
        return config.get<boolean>('autoDetectRollTables', true)
      }
      return createMarkdownRenderer({
        preview: true,
        measurement: resolveMeasurement,
        language: resolveContentLanguage,
        overrides: resolveOverrides,
        spellDisplayDefaults: resolveSpellDisplayDefaults,
        itemDisplayDefaults: resolveItemDisplayDefaults,
        monsterDisplayDefaults: resolveMonsterDisplayDefaults,
        backgroundDisplayDefaults: resolveBackgroundDisplayDefaults,
        autoDetectRollTables: resolveAutoDetectRollTables,
      })
    },
  }
}

export function deactivate(): void {}
