import * as vscode from 'vscode'
import { parseModuleTree } from 'mpx-core'
import type { ModuleTreeNode } from 'mpx-core'

const REFRESH_COMMAND = 'mpx.refreshExplorer'
const VIEW_ID = 'mpx.moduleExplorer'

const ICON_BY_KIND: Record<ModuleTreeNode['kind'], string> = {
  page: 'file',
  group: 'folder',
  map: 'map',
  encounter: 'target',
}

class ModuleTreeItem extends vscode.TreeItem {
  readonly filePath: string

  constructor(readonly node: ModuleTreeNode) {
    super(
      node.name,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    this.filePath = node.filePath
    this.iconPath = new vscode.ThemeIcon(ICON_BY_KIND[node.kind])
    this.description = `rank ${node.rank}`
    this.tooltip = node.filePath
    this.contextValue = 'mpxDeletableEntry'
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(node.filePath)],
    }
  }
}

class ModuleExplorerProvider implements vscode.TreeDataProvider<ModuleTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changeEmitter.event

  refresh(): void {
    this.changeEmitter.fire()
  }

  getTreeItem(element: ModuleTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: ModuleTreeItem): Promise<ModuleTreeItem[]> {
    if (element) {
      return element.node.children.map((child) => new ModuleTreeItem(child))
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return []
    }
    const tree = await parseModuleTree(workspaceFolder.uri.fsPath)
    return tree.map((node) => new ModuleTreeItem(node))
  }
}

const WATCHED_GLOB =
  '{module.json,pages/**/*.md,groups/**/*.json,maps/**/*.json,encounters/**/*.json}'

export function registerModuleExplorer(context: vscode.ExtensionContext): void {
  const provider = new ModuleExplorerProvider()
  const refresh = () => provider.refresh()

  let watcher: vscode.FileSystemWatcher | undefined

  function rebuildWatcher(): void {
    watcher?.dispose()
    watcher = undefined

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return
    }

    // Anchoring with RelativePattern (rather than a bare glob string) is what
    // makes VSCode pick up files created inside a brand-new subfolder, e.g.
    // the first page created in a project that has no pages/ yet.
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, WATCHED_GLOB),
    )
    watcher.onDidCreate(refresh)
    watcher.onDidChange(refresh)
    watcher.onDidDelete(refresh)
  }

  rebuildWatcher()

  context.subscriptions.push(
    vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true }),
    vscode.commands.registerCommand(REFRESH_COMMAND, refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatcher()
      refresh()
    }),
    new vscode.Disposable(() => watcher?.dispose()),
  )
}
