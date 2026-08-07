import * as vscode from 'vscode'

const TOGGLE_BOLD_COMMAND = 'mpx.toggleBold'
const TOGGLE_ITALIC_COMMAND = 'mpx.toggleItalic'

/** Wraps each selection in `marker` (e.g. `**`/`*`), or unwraps it if it's
 * already wrapped — mirrors the classic Cmd/Ctrl+B / Cmd/Ctrl+I behavior
 * VSCode doesn't provide out of the box for Markdown. An empty selection
 * (bare cursor) expands to the word under it, same as most editors. */
async function toggleWrapSelections(editor: vscode.TextEditor, marker: string): Promise<void> {
  const markerLength = marker.length
  const ranges = editor.selections.map(
    (selection) => (selection.isEmpty ? editor.document.getWordRangeAtPosition(selection.active) : selection) ?? selection,
  )

  await editor.edit((editBuilder) => {
    for (const range of ranges) {
      const text = editor.document.getText(range)
      const isWrapped = text.length >= markerLength * 2 && text.startsWith(marker) && text.endsWith(marker)
      const replacement = isWrapped ? text.slice(markerLength, text.length - markerLength) : `${marker}${text}${marker}`
      editBuilder.replace(range, replacement)
    }
  })
  // VSCode tracks each selection's position through the edit automatically
  // (it grows/shrinks with the inserted/removed markers), so the resulting
  // selection already covers the (un)wrapped text with no extra bookkeeping.
}

export function registerFormattingCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(TOGGLE_BOLD_COMMAND, (editor) => toggleWrapSelections(editor, '**')),
    vscode.commands.registerTextEditorCommand(TOGGLE_ITALIC_COMMAND, (editor) => toggleWrapSelections(editor, '*')),
  )
}
