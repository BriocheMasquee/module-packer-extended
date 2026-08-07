import type * as vscode from 'vscode'
import { createBackground, createItem, createMonster, createRollTable, createSpell } from 'mpx-core'
import { registerContentCreationCommand } from './contentCommands.js'

// Every Compendium content type's measurement is left empty at creation —
// never prefilled from the project's resolved setting — the build's own
// applyCompendiumAttributeDefaults still fills it in from the project
// setting when empty. An entry's own explicit value, once set, is never
// touched either way; see the "attributes.measurement" doc section.
export function registerCompendiumCommands(context: vscode.ExtensionContext): void {
  registerContentCreationCommand(context, 'mpx.createItem', 'Item name', 'New item', createItem)
  registerContentCreationCommand(context, 'mpx.createSpell', 'Spell name', 'New spell', createSpell)
  registerContentCreationCommand(context, 'mpx.createRollTable', 'Roll table name', 'New roll table', createRollTable)
  registerContentCreationCommand(context, 'mpx.createMonster', 'Monster name', 'New monster', createMonster)
  registerContentCreationCommand(context, 'mpx.createBackground', 'Background name', 'New background', createBackground)
}
