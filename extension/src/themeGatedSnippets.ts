import * as vscode from 'vscode'
import { DEFAULT_PROJECT_THEME_ID } from 'mpx-core'

/** Themes whose CSS has no styling for these blockquote variants (PHB-24
 * dropped .paper/.flavortext entirely, see its theme.json) — the snippet
 * stays out of markdown autocomplete for projects on one of these themes,
 * since inserting it would just produce an unstyled blockquote. Static
 * (theme-independent) snippets stay in resources/snippets/markdown.json;
 * only the ones that need this per-theme gate live here. */
const THEMES_WITHOUT_PAPER_AND_FLAVORTEXT = new Set(['phb-24'])

interface ThemeGatedSnippet {
  prefix: string
  body: readonly string[]
  description: string
}

const THEME_GATED_SNIPPETS: readonly ThemeGatedSnippet[] = [
  {
    prefix: 'mpx-paper',
    body: ['> ${1:Text on parchment.}', '{.paper}', '$0'],
    description: 'Insert a parchment-style blockquote',
  },
  {
    prefix: 'mpx-flavortext',
    body: ['> ${1:Flavor text.}', '{.flavortext}', '$0'],
    description: 'Insert a flavor text blockquote',
  },
]

class ThemeGatedSnippetProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument): vscode.CompletionItem[] | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    const config = vscode.workspace.getConfiguration('mpx', workspaceFolder?.uri)
    const themeId = config.get<string>('projectTheme', DEFAULT_PROJECT_THEME_ID)
    if (THEMES_WITHOUT_PAPER_AND_FLAVORTEXT.has(themeId)) {
      return undefined
    }

    return THEME_GATED_SNIPPETS.map((snippet) => {
      const item = new vscode.CompletionItem(snippet.prefix, vscode.CompletionItemKind.Snippet)
      item.insertText = new vscode.SnippetString(snippet.body.join('\n'))
      item.detail = snippet.description
      return item
    })
  }
}

export function registerThemeGatedSnippets(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new ThemeGatedSnippetProvider()),
  )
}
