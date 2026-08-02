import { basename } from 'node:path'
import * as vscode from 'vscode'

const DELETE_COMMAND = 'mpx.deleteEntry'

interface DeletableTreeItem extends vscode.TreeItem {
  filePath: string
}

function isDeletableTreeItem(item: unknown): item is DeletableTreeItem {
  return typeof item === 'object' && item !== null && typeof (item as DeletableTreeItem).filePath === 'string'
}

export function registerDeleteEntryCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(DELETE_COMMAND, async (item: unknown) => {
      if (!isDeletableTreeItem(item)) {
        return
      }
      const displayName = typeof item.label === 'string' ? item.label : basename(item.filePath)
      const confirmation = await vscode.window.showWarningMessage(
        `Delete "${displayName}"? It will be moved to the OS trash.`,
        { modal: true },
        'Delete',
      )
      if (confirmation !== 'Delete') {
        return
      }
      await vscode.workspace.fs.delete(vscode.Uri.file(item.filePath), { useTrash: true })
    }),
  )
}
