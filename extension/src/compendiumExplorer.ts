import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'

const VIEW_ID = 'mpx.compendiumExplorer'

const CATEGORIES = [
  { label: 'Monsters', folder: 'monsters', icon: 'snake' },
  { label: 'Spells', folder: 'spells', icon: 'wand' },
  { label: 'Items', folder: 'items', icon: 'archive' },
  { label: 'Roll Tables', folder: 'tables', icon: 'list-unordered' },
] as const

class CompendiumCategoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly folderPath: string,
    readonly icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon('folder-library')
  }
}

class CompendiumEntryItem extends vscode.TreeItem {
  constructor(label: string, filePath: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.iconPath = new vscode.ThemeIcon(icon)
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    }
  }
}

type CompendiumItem = CompendiumCategoryItem | CompendiumEntryItem

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
      return listEntries(element.folderPath, element.icon)
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return []
    }
    const projectRoot = workspaceFolder.uri.fsPath

    const categories: CompendiumCategoryItem[] = []
    for (const category of CATEGORIES) {
      const folderPath = join(projectRoot, category.folder)
      const entries = await readdir(folderPath).catch(() => [] as string[])
      if (entries.some((name) => name.endsWith('.json'))) {
        categories.push(new CompendiumCategoryItem(category.label, folderPath, category.icon))
      }
    }
    return categories
  }
}

export function registerCompendiumExplorer(context: vscode.ExtensionContext): void {
  const provider = new CompendiumExplorerProvider()
  const refresh = () => provider.refresh()

  let watcher: vscode.FileSystemWatcher | undefined

  function rebuildWatcher(): void {
    watcher?.dispose()
    watcher = undefined

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return
    }

    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, '{items,spells,tables,monsters}/**/*.json'),
    )
    watcher.onDidCreate(refresh)
    watcher.onDidChange(refresh)
    watcher.onDidDelete(refresh)
  }

  rebuildWatcher()

  context.subscriptions.push(
    vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatcher()
      refresh()
    }),
    new vscode.Disposable(() => watcher?.dispose()),
  )
}
