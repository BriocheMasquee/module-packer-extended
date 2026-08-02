import * as vscode from 'vscode'
import { resolveModuleFolder } from './contentCommands.js'

interface SettingChoice {
  label: string
  value: string
  description: string
}

async function pickAndUpdateSetting(key: string, choices: SettingChoice[], placeHolder: string): Promise<void> {
  const moduleFolder = await resolveModuleFolder()
  if (!moduleFolder) {
    return
  }

  const config = vscode.workspace.getConfiguration('mpx', vscode.Uri.file(moduleFolder))
  const current = config.get<string>(key)

  const selection = await vscode.window.showQuickPick(
    choices.map((choice) => ({
      label: choice.label,
      description: choice.value === current ? `${choice.description} (current)` : choice.description,
      value: choice.value,
    })),
    { placeHolder },
  )
  if (!selection) {
    return
  }
  await config.update(key, selection.value, vscode.ConfigurationTarget.WorkspaceFolder)
}

export function registerLocalizationCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mpx.selectContentLanguage', () =>
      pickAndUpdateSetting(
        'contentLanguage',
        [
          { label: 'English', value: 'en', description: 'Display generated preview labels in English.' },
          { label: 'Français', value: 'fr', description: 'Display generated preview labels in French.' },
        ],
        'Select the content language for this project',
      ),
    ),
    vscode.commands.registerCommand('mpx.selectDefaultMeasurement', () =>
      pickAndUpdateSetting(
        'defaultMeasurement',
        [
          { label: 'Auto', value: 'auto', description: 'Use imperial units for English and metric units for French.' },
          {
            label: 'Imperial',
            value: 'imperial',
            description: 'Use imperial units unless an entity explicitly requests metric units.',
          },
          {
            label: 'Metric',
            value: 'metric',
            description: 'Use metric units unless an entity explicitly requests imperial units.',
          },
        ],
        'Select the default measurement system for this project',
      ),
    ),
  )
}
