import { join } from 'node:path'
import * as vscode from 'vscode'
import { createModuleProject, detectWorkspaceKind } from 'mpx-core'
import { registerModuleExplorer } from './moduleExplorer.js'

const CREATE_PROJECT_COMMAND = 'mpx.createModuleProject'
const PENDING_MODULE_CONFIGURATION_KEY = 'mpx.pendingModuleConfiguration'

function themeSourceFolder(context: vscode.ExtensionContext): string {
  return join(context.extensionPath, 'resources', 'themes', '5.5e')
}

async function selectWorkspaceFolder(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  placeHolder: string,
): Promise<string | undefined> {
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri.fsPath
  }

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      description: workspaceFolder.uri.fsPath,
      label: workspaceFolder.name,
      projectDirectory: workspaceFolder.uri.fsPath,
    })),
    { placeHolder },
  )

  return selection?.projectDirectory
}

async function resolveTargetFolder(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Create MPX Project Here',
      title: 'Select an empty folder for the new MPX V5 project',
    })
    return selection?.[0]?.fsPath
  }

  return selectWorkspaceFolder(
    workspaceFolders,
    'Select the empty folder in which to create the MPX V5 project',
  )
}

async function executeCreateModuleProject(context: vscode.ExtensionContext): Promise<void> {
  const projectDirectory = await resolveTargetFolder()
  if (!projectDirectory) {
    return
  }

  if ((await detectWorkspaceKind(projectDirectory)) !== 'empty') {
    await vscode.window.showErrorMessage('The new MPX V5 project folder must be empty.')
    return
  }

  await createModuleProject(projectDirectory, themeSourceFolder(context))

  const isAlreadyOpen = (vscode.workspace.workspaceFolders ?? []).some(
    (workspaceFolder) => workspaceFolder.uri.fsPath === projectDirectory,
  )
  if (isAlreadyOpen) {
    // vscode.openFolder is a no-op when the target is already the open folder,
    // so there is no reload to hang the "open module.json" step off of.
    await updateWorkspaceKindContext()
    await openModuleConfiguration(join(projectDirectory, 'module.json'))
    return
  }

  await context.globalState.update(
    PENDING_MODULE_CONFIGURATION_KEY,
    join(projectDirectory, 'module.json'),
  )
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDirectory))
}

async function openModuleConfiguration(modulePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(modulePath))
  await vscode.window.showTextDocument(document)
}

async function openPendingModuleConfiguration(context: vscode.ExtensionContext): Promise<void> {
  const modulePath = context.globalState.get<string>(PENDING_MODULE_CONFIGURATION_KEY)
  if (!modulePath) {
    return
  }

  const isOpenProject = (vscode.workspace.workspaceFolders ?? []).some(
    (workspaceFolder) => join(workspaceFolder.uri.fsPath, 'module.json') === modulePath,
  )
  await context.globalState.update(PENDING_MODULE_CONFIGURATION_KEY, undefined)
  if (!isOpenProject) {
    return
  }

  await openModuleConfiguration(modulePath)
}

async function updateWorkspaceKindContext(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []
  if (workspaceFolders.length === 0) {
    await vscode.commands.executeCommand('setContext', 'mpx.workspaceKind', 'noFolder')
    return
  }

  const kinds = await Promise.all(
    workspaceFolders.map((workspaceFolder) => detectWorkspaceKind(workspaceFolder.uri.fsPath)),
  )
  const workspaceKind = kinds.includes('mpxProject')
    ? 'mpxProject'
    : kinds.every((kind) => kind === 'empty')
      ? 'empty'
      : 'unsupported'
  await vscode.commands.executeCommand('setContext', 'mpx.workspaceKind', workspaceKind)
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_PROJECT_COMMAND, () =>
      executeCreateModuleProject(context),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void updateWorkspaceKindContext()
    }),
  )
  registerModuleExplorer(context)

  void updateWorkspaceKindContext()
  void openPendingModuleConfiguration(context)
}

export function deactivate(): void {}
