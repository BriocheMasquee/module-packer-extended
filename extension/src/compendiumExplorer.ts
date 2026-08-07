import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as vscode from 'vscode'
import {
  findInlineSpells,
  findInlineItems,
  findInlineMonsters,
  findInlineBackgrounds,
  findInlineRollTables,
  readRuleImportZips,
} from 'mpx-core'

const VIEW_ID = 'mpx.compendiumExplorer'
const REVEAL_INLINE_ENTRY_COMMAND = 'mpx.revealInlineEntry'
const REVEAL_RULE_IMPORT_ZIP_COMMAND = 'mpx.revealRuleImportZip'
const REFRESH_COMMAND = 'mpx.refreshCompendiumExplorer'

interface InlineEntrySummary {
  name: string
  pageFilePath: string
  line: number
}

/** mpx.autoDetectRollTables off means nothing will actually build from a
 * page's Markdown tables — mirror that in the panel by reporting no inline
 * entries at all, rather than listing tables a build would just ignore. */
async function findInlineRollTablesIfEnabled(moduleRoot: string): Promise<InlineEntrySummary[]> {
  const config = vscode.workspace.getConfiguration('mpx', vscode.Uri.file(moduleRoot))
  if (!config.get<boolean>('autoDetectRollTables', true)) {
    return []
  }
  return findInlineRollTables(moduleRoot)
}

const CATEGORIES = [
  { label: 'Monsters', folder: 'monsters', icon: 'snake', findInline: findInlineMonsters },
  { label: 'Spells', folder: 'spells', icon: 'wand', findInline: findInlineSpells },
  { label: 'Items', folder: 'items', icon: 'archive', findInline: findInlineItems },
  { label: 'Roll Tables', folder: 'tables', icon: 'list-unordered', findInline: findInlineRollTablesIfEnabled },
  { label: 'Backgrounds', folder: 'backgrounds', icon: 'mortar-board', findInline: findInlineBackgrounds },
] satisfies readonly {
  label: string
  folder: string
  icon: string
  findInline: ((moduleRoot: string) => Promise<InlineEntrySummary[]>) | undefined
}[]

class CompendiumCategoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly folderPath: string,
    readonly icon: string,
    readonly findInline: ((moduleRoot: string) => Promise<InlineEntrySummary[]>) | undefined,
    readonly projectRoot: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon('folder-library')
  }
}

class CompendiumEntryItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly filePath: string,
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.iconPath = new vscode.ThemeIcon(icon)
    this.contextValue = 'mpxDeletableEntry'
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    }
  }
}

/** A Compendium entry authored inline (```spell or ```item block) inside a
 * page's Markdown rather than as its own standalone JSON file — no file to
 * open or delete, so its click behavior reveals the block's location in
 * the page instead (see REVEAL_INLINE_ENTRY_COMMAND). Shares its category's
 * icon (the "inline" description already distinguishes it from a
 * standalone entry — no need for a second visual signal). */
class InlineCompendiumEntryItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly pageFilePath: string,
    readonly line: number,
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.iconPath = new vscode.ThemeIcon(icon)
    this.description = 'inline'
    this.tooltip = `Inline entry in ${basename(pageFilePath)} — click to reveal`
    this.command = {
      command: REVEAL_INLINE_ENTRY_COMMAND,
      title: 'Reveal in Page',
      arguments: [pageFilePath, line],
    }
  }
}

/** The "Rules" category root — unlike the other categories, it has no
 * standalone-file folder of its own (see RuleCategoryItem's children):
 * every entry comes from a raw EncounterPlus export zip in rules/, listed
 * by ImportedRuleEntryItem below. */
class RuleCategoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly projectRoot: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon('folder-library')
  }
}

/** A Compendium entry read straight out of a raw EncounterPlus export zip
 * in rules/ — no MPX file of its own to open, so clicking reveals the
 * export zip itself (see REVEAL_RULE_IMPORT_ZIP_COMMAND) rather than a
 * page location. "imported" distinguishes it from "inline" (authored in a
 * page) — this entry was never authored in MPX at all.
 *
 * Deletable like a standalone entry (mpxDeletableEntry), but there's no
 * per-entry file to remove — deleting it removes the whole import zip,
 * taking every sibling entry from the same export with it. `filePath`
 * points at the zip so the generic delete command's fs.delete just works;
 * `deleteDisplayName`/`deleteWarningNote` correct the confirmation dialog,
 * which would otherwise show only this entry's own name. */
class ImportedRuleEntryItem extends vscode.TreeItem {
  readonly filePath: string
  readonly deleteDisplayName: string
  readonly deleteWarningNote: string

  constructor(
    label: string,
    readonly zipFilePath: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.iconPath = new vscode.ThemeIcon('law')
    this.description = 'imported'
    this.tooltip = `Imported from ${basename(zipFilePath)} — click to reveal the export file, right-click to delete the whole import`
    this.command = {
      command: REVEAL_RULE_IMPORT_ZIP_COMMAND,
      title: 'Reveal Export File',
      arguments: [zipFilePath],
    }
    this.contextValue = 'mpxDeletableEntry'
    this.filePath = zipFilePath
    this.deleteDisplayName = basename(zipFilePath)
    this.deleteWarningNote = 'This removes every rule entry imported from this file, not just this one.'
  }
}

type CompendiumItem =
  | CompendiumCategoryItem
  | CompendiumEntryItem
  | InlineCompendiumEntryItem
  | RuleCategoryItem
  | ImportedRuleEntryItem

async function entryLabel(filePath: string, fallback: string): Promise<string> {
  return readFile(filePath, 'utf8')
    .then((source) => JSON.parse(source) as Record<string, unknown>)
    .then((json) => (typeof json.name === 'string' && json.name.trim() ? json.name : fallback))
    .catch(() => fallback)
}

async function listEntries(folderPath: string, icon: string): Promise<CompendiumEntryItem[]> {
  const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  const items = await Promise.all(
    files.map(async (entry) => {
      const filePath = join(folderPath, entry.name)
      return new CompendiumEntryItem(await entryLabel(filePath, entry.name), filePath, icon)
    }),
  )
  return items.sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

async function listInlineEntries(
  findInline: (moduleRoot: string) => Promise<InlineEntrySummary[]>,
  projectRoot: string,
  icon: string,
): Promise<InlineCompendiumEntryItem[]> {
  const inlineEntries = await findInline(projectRoot).catch(() => [])
  return inlineEntries
    .map((entry) => new InlineCompendiumEntryItem(entry.name, entry.pageFilePath, entry.line, icon))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

async function listRuleEntries(projectRoot: string): Promise<ImportedRuleEntryItem[]> {
  const { succeeded } = await readRuleImportZips(projectRoot)
  const items = succeeded.flatMap((zip) =>
    zip.records.map((record) => {
      const label = typeof record.name === 'string' && record.name.trim() ? record.name : basename(zip.zipFilePath)
      return new ImportedRuleEntryItem(label, zip.zipFilePath)
    }),
  )
  return items.sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

async function countRuleEntries(projectRoot: string): Promise<number> {
  const { succeeded } = await readRuleImportZips(projectRoot)
  return succeeded.reduce((sum, zip) => sum + zip.records.length, 0)
}

class CompendiumExplorerProvider implements vscode.TreeDataProvider<CompendiumItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changeEmitter.event

  refresh(): void {
    this.changeEmitter.fire()
  }

  getTreeItem(element: CompendiumItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: CompendiumItem): Promise<CompendiumItem[]> {
    if (element instanceof CompendiumCategoryItem) {
      const [standalone, inline] = await Promise.all([
        listEntries(element.folderPath, element.icon),
        element.findInline ? listInlineEntries(element.findInline, element.projectRoot, element.icon) : Promise.resolve([]),
      ])
      return [...standalone, ...inline].sort((a, b) => String(a.label).localeCompare(String(b.label)))
    }
    if (element instanceof RuleCategoryItem) {
      return listRuleEntries(element.projectRoot)
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return []
    }
    const projectRoot = workspaceFolder.uri.fsPath

    const categories: CompendiumItem[] = []
    for (const category of CATEGORIES) {
      const folderPath = join(projectRoot, category.folder)
      const entries = await readdir(folderPath).catch(() => [] as string[])
      const standaloneCount = entries.filter((name) => name.endsWith('.json')).length
      const inlineCount = category.findInline ? (await category.findInline(projectRoot).catch(() => [])).length : 0
      const count = standaloneCount + inlineCount
      if (count > 0) {
        categories.push(
          new CompendiumCategoryItem(`${category.label} (${count})`, folderPath, category.icon, category.findInline, projectRoot),
        )
      }
    }
    const ruleCount = await countRuleEntries(projectRoot)
    if (ruleCount > 0) {
      categories.push(new RuleCategoryItem(`Rules (${ruleCount})`, projectRoot))
    }
    return categories
  }
}

export function registerCompendiumExplorer(context: vscode.ExtensionContext): void {
  const provider = new CompendiumExplorerProvider()
  const refresh = () => provider.refresh()

  let watchers: vscode.FileSystemWatcher[] = []

  function rebuildWatchers(): void {
    watchers.forEach((watcher) => watcher.dispose())
    watchers = []

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return
    }

    // Two separate watchers rather than one combined glob — mixing a
    // brace-expanded folder list with a second unrelated pattern in a single
    // string is fragile (a stray top-level comma silently breaks the whole
    // match instead of erroring), so each concern gets its own clear glob.
    const entryWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, '{items,spells,tables,monsters,backgrounds}/**/*.json'),
    )
    const pageWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, 'pages/**/*.md'))
    const ruleImportWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, 'rules/**/*.zip'))
    for (const watcher of [entryWatcher, pageWatcher, ruleImportWatcher]) {
      watcher.onDidCreate(refresh)
      watcher.onDidChange(refresh)
      watcher.onDidDelete(refresh)
    }
    watchers = [entryWatcher, pageWatcher, ruleImportWatcher]
  }

  rebuildWatchers()

  context.subscriptions.push(
    vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true }),
    vscode.commands.registerCommand(REFRESH_COMMAND, refresh),
    vscode.commands.registerCommand(REVEAL_INLINE_ENTRY_COMMAND, async (pageFilePath: string, line: number) => {
      const document = await vscode.workspace.openTextDocument(pageFilePath)
      const editor = await vscode.window.showTextDocument(document)
      const position = new vscode.Position(line, 0)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
    }),
    vscode.commands.registerCommand(REVEAL_RULE_IMPORT_ZIP_COMMAND, async (zipFilePath: string) => {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipFilePath))
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatchers()
      refresh()
    }),
    // Unlike the other mpx.default* settings (which only change how an
    // already-listed entry renders), this one changes whether a page's
    // tables are listed here at all — a plain file/page-content watcher
    // never fires for a settings.json edit, so a config-change listener is
    // needed for the panel to reflect the toggle without a manual refresh.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mpx.autoDetectRollTables')) {
        refresh()
      }
    }),
    new vscode.Disposable(() => watchers.forEach((watcher) => watcher.dispose())),
  )
}
