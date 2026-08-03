import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { TRANSLATION_OVERRIDES_FILENAME } from 'mpx-core'
import { resolveModuleFolder } from './contentCommands.js'

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

// No "$schema" field needed here: the extension's jsonValidation contribution
// (package.json) already associates any file named translation-overrides.json
// with its bundled schema by file name, the same way module.json/spells/*.json/
// etc. are matched — VSCode resolves that association without the file
// pointing at anything itself.
const OVERRIDES_TEMPLATE = `{
  "en": {},
  "fr": {}
}
`

/** Creates the project's translation-overrides.json if it doesn't already
 * exist (opening it either way) — lets a user rename a specific catalog
 * label (e.g. "Skill.Perception") project-wide, in either language, without
 * forking the extension's own bundled catalog. */
async function executeCreateTranslationOverrides(): Promise<void> {
  const moduleFolder = await resolveModuleFolder()
  if (!moduleFolder) {
    return
  }
  const filePath = join(moduleFolder, TRANSLATION_OVERRIDES_FILENAME)
  if (!(await fileExists(filePath))) {
    await writeFile(filePath, OVERRIDES_TEMPLATE, 'utf8')
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
  await vscode.window.showTextDocument(document)
}

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
    vscode.commands.registerCommand('mpx.createTranslationOverrides', () => executeCreateTranslationOverrides()),
  )
}
