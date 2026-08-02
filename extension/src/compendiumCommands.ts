import * as vscode from 'vscode'
import { createItem, createMonster, createRollTable, createSpell } from 'mpx-core'
import { registerContentCreationCommand } from './contentCommands.js'

export function registerCompendiumCommands(context: vscode.ExtensionContext): void {
  registerContentCreationCommand(context, 'mpx.createItem', 'Item name', 'New item', createItem)
  registerContentCreationCommand(context, 'mpx.createSpell', 'Spell name', 'New spell', createSpell)
  registerContentCreationCommand(context, 'mpx.createRollTable', 'Roll table name', 'New roll table', createRollTable)
  registerContentCreationCommand(context, 'mpx.createMonster', 'Monster name', 'New monster', createMonster)
}
