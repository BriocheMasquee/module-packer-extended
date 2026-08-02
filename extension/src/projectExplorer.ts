import { access, readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import * as vscode from 'vscode'

const VIEW_ID = 'mpx.projectExplorer'

class SummaryItem extends vscode.TreeItem {
  constructor(name: string, description: string | undefined, moduleJsonPath: string) {
    super(name, vscode.TreeItemCollapsibleState.None)
    this.description = description
    this.iconPath = new vscode.ThemeIcon('info')
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(moduleJsonPath)],
    }
  }
}

class ImageResourceItem extends vscode.TreeItem {
  constructor(label: string, filePath: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = basename(filePath)
    this.iconPath = new vscode.ThemeIcon('file-media')
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    }
  }
}

class ProjectFolderItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly folderPath: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed)
    this.resourceUri = vscode.Uri.file(folderPath)
  }
}

class ProjectFileItem extends vscode.TreeItem {
  constructor(filePath: string) {
    super(vscode.Uri.file(filePath), vscode.TreeItemCollapsibleState.None)
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    }
  }
}

type ProjectItem = SummaryItem | ImageResourceItem | ProjectFolderItem | ProjectFileItem

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

async function listFolderChildren(folderPath: string): Promise<ProjectItem[]> {
  const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.name !== '.DS_Store')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) =>
      entry.isDirectory()
        ? new ProjectFolderItem(entry.name, join(folderPath, entry.name))
        : new ProjectFileItem(join(folderPath, entry.name)),
    )
}

class ProjectExplorerProvider implements vscode.TreeDataProvider<ProjectItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changeEmitter.event

  refresh(): void {
    this.changeEmitter.fire()
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: ProjectItem): Promise<ProjectItem[]> {
    if (element instanceof ProjectFolderItem) {
      return listFolderChildren(element.folderPath)
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      return []
    }
    const projectRoot = workspaceFolder.uri.fsPath
    const moduleJsonPath = join(projectRoot, 'module.json')
    if (!(await fileExists(moduleJsonPath))) {
      return []
    }

    const items: ProjectItem[] = []

    const moduleJson = await readFile(moduleJsonPath, 'utf8')
      .then((source) => JSON.parse(source) as Record<string, unknown>)
      .catch(() => undefined)
    if (moduleJson) {
      const name = typeof moduleJson.name === 'string' && moduleJson.name.trim() ? moduleJson.name : 'Module'
      const version = typeof moduleJson.version === 'string' ? moduleJson.version : undefined
      const system = typeof moduleJson.system === 'string' ? moduleJson.system : undefined
      const description = [version ? `v${version}` : undefined, system].filter(Boolean).join(' · ')
      items.push(new SummaryItem(name, description || undefined, moduleJsonPath))

      for (const [field, label] of [
        ['image', 'Cover Image'],
        ['banner', 'Banner'],
      ] as const) {
        const resourcePath = moduleJson[field]
        if (typeof resourcePath === 'string' && resourcePath.trim()) {
          const absolutePath = join(projectRoot, resourcePath)
          if (await fileExists(absolutePath)) {
            items.push(new ImageResourceItem(label, absolutePath))
          }
        }
      }
    }

    items.push(new ProjectFolderItem('images', join(projectRoot, 'images')))
    items.push(new ProjectFolderItem('assets', join(projectRoot, 'assets')))

    return items
  }
}

export function registerProjectExplorer(context: vscode.ExtensionContext): void {
  const provider = new ProjectExplorerProvider()
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
      new vscode.RelativePattern(workspaceFolder, '{module.json,images/**,assets/**}'),
    )
    watcher.onDidCreate(refresh)
    watcher.onDidChange(refresh)
    watcher.onDidDelete(refresh)
  }

  rebuildWatcher()

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWatcher()
      refresh()
    }),
    new vscode.Disposable(() => watcher?.dispose()),
  )
}
