import { basename } from 'node:path'
import * as vscode from 'vscode'

const DELETE_COMMAND = 'mpx.deleteEntry'

interface DeletableTreeItem extends vscode.TreeItem {
  filePath: string
  /** Overrides the confirmation dialog's displayed name — for an item whose
   * `filePath` isn't itself "the thing the user clicked" (e.g. a rule entry
   * read out of a shared import zip), showing the entry's own label would
   * misname what's actually about to be deleted. */
  deleteDisplayName?: string
  /** Extra sentence appended to the confirmation dialog, for a delete whose
   * blast radius is bigger than the single clicked item (e.g. deleting a
   * rule import zip removes every entry inside it, not just the one
   * clicked). */
  deleteWarningNote?: string
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
      const displayName = item.deleteDisplayName ?? (typeof item.label === 'string' ? item.label : basename(item.filePath))
      const warningNote = item.deleteWarningNote ? ` ${item.deleteWarningNote}` : ''
      const confirmation = await vscode.window.showWarningMessage(
        `Delete "${displayName}"?${warningNote} It will be moved to the OS trash.`,
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
