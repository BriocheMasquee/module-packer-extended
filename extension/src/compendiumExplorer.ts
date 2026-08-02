import * as vscode from 'vscode'

const VIEW_ID = 'mpx.compendiumExplorer'
const CREATE_MONSTER_COMMAND = 'mpx.createMonster'

class CompendiumExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changeEmitter.event

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    return []
  }
}

export function registerCompendiumExplorer(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, new CompendiumExplorerProvider()),
    vscode.commands.registerCommand(CREATE_MONSTER_COMMAND, () =>
      vscode.window.showInformationMessage('Create Monster is not implemented yet.'),
    ),
  )
}
