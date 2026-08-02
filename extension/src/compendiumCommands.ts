import * as vscode from 'vscode'
import { createItem, createSpell } from 'mpx-core'
import { registerContentCreationCommand } from './contentCommands.js'

const CREATE_MONSTER_COMMAND = 'mpx.createMonster'

export function registerCompendiumCommands(context: vscode.ExtensionContext): void {
  registerContentCreationCommand(context, 'mpx.createItem', 'Item name', 'New item', createItem)
  registerContentCreationCommand(context, 'mpx.createSpell', 'Spell name', 'New spell', createSpell)

  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_MONSTER_COMMAND, () =>
      vscode.window.showInformationMessage('Create Monster is not implemented yet.'),
    ),
  )
}
