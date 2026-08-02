import * as vscode from 'vscode'
import { createItem, createMonster, createRollTable, createSpell, resolveMeasurementSystem } from 'mpx-core'
import { registerContentCreationCommand } from './contentCommands.js'

function resolveProjectMeasurement(moduleFolder: string): string {
  const config = vscode.workspace.getConfiguration('mpx', vscode.Uri.file(moduleFolder))
  return resolveMeasurementSystem(
    config.get<string>('defaultMeasurement', 'auto'),
    config.get<string>('contentLanguage', 'en'),
  )
}

export function registerCompendiumCommands(context: vscode.ExtensionContext): void {
  registerContentCreationCommand(context, 'mpx.createItem', 'Item name', 'New item', (moduleFolder, name) =>
    createItem(moduleFolder, name, resolveProjectMeasurement(moduleFolder)),
  )
  registerContentCreationCommand(context, 'mpx.createSpell', 'Spell name', 'New spell', (moduleFolder, name) =>
    createSpell(moduleFolder, name, resolveProjectMeasurement(moduleFolder)),
  )
  registerContentCreationCommand(context, 'mpx.createRollTable', 'Roll table name', 'New roll table', createRollTable)
  registerContentCreationCommand(context, 'mpx.createMonster', 'Monster name', 'New monster', (moduleFolder, name) =>
    createMonster(moduleFolder, name, resolveProjectMeasurement(moduleFolder)),
  )
}
