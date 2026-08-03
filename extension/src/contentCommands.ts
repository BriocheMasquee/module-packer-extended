import * as vscode from 'vscode'
import {
  createEncounterReference,
  createGroup,
  createMapReference,
  createPage,
} from 'mpx-core'
import type { CreatedContentEntry } from 'mpx-core'

export async function resolveModuleFolder(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    await vscode.window.showErrorMessage('Open an MPX module project first.')
    return undefined
  }
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri.fsPath
  }

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      moduleFolder: workspaceFolder.uri.fsPath,
    })),
    { placeHolder: 'Select the module project to add this to' },
  )
  return selection?.moduleFolder
}

export async function promptName(prompt: string, defaultValue: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value: defaultValue,
    validateInput: (value) => (value.trim().length > 0 ? undefined : 'A name is required.'),
  })
}

export async function openCreatedEntry(entry: CreatedContentEntry): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.filePath))
  await vscode.window.showTextDocument(document)
  // Shared by both the Module Explorer's content (pages/groups/maps/
  // encounters) and the Compendium's (items/spells/monsters/tables) — each
  // command is a no-op if its own panel isn't showing the created kind, so
  // refreshing both unconditionally is simpler than threading which kind
  // owns which panel through this shared helper.
  await vscode.commands.executeCommand('mpx.refreshExplorer')
  await vscode.commands.executeCommand('mpx.refreshCompendiumExplorer')
}

export function registerContentCreationCommand(
  context: vscode.ExtensionContext,
  command: string,
  prompt: string,
  defaultName: string,
  create: (moduleFolder: string, name: string) => Promise<CreatedContentEntry>,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async () => {
      const moduleFolder = await resolveModuleFolder()
      if (!moduleFolder) {
        return
      }
      const name = await promptName(prompt, defaultName)
      if (!name) {
        return
      }
      try {
        await openCreatedEntry(await create(moduleFolder, name))
      } catch (error) {
        await vscode.window.showErrorMessage((error as Error).message)
      }
    }),
  )
}

export function registerContentCommands(context: vscode.ExtensionContext): void {
  registerContentCreationCommand(context, 'mpx.createPage', 'Page name', 'New page', createPage)
  registerContentCreationCommand(context, 'mpx.createGroup', 'Group name', 'New group', createGroup)
  registerContentCreationCommand(
    context,
    'mpx.createMapReference',
    'Map name',
    'New map',
    createMapReference,
  )
  registerContentCreationCommand(
    context,
    'mpx.createEncounterReference',
    'Encounter name',
    'New encounter',
    createEncounterReference,
  )
}
