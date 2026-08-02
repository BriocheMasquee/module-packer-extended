// Injected into every VSCode Markdown preview (contributes.markdown.previewScripts).
// "catalyst" is the name of EncounterPlus V5's HTML-based rendering engine —
// its theme CSS targets html.catalyst, so this class is required for the
// theme to apply at all.
(function () {
  document.documentElement.classList.add('catalyst')

  // Scales the preview down to roughly match how a page actually looks in
  // the EncounterPlus app, which doesn't render at full browser-tab size.
  document.documentElement.style.zoom = '0.8'

  var VSCODE_THEME_CLASSES = [
    'vscode-light',
    'vscode-dark',
    'vscode-high-contrast',
    'vscode-high-contrast-light',
  ]

  // VSCode's own editor theme classes on <body> override border-color on
  // <hr>, hiding whatever color the project's theme CSS set. This restores
  // the theme's colors by reading them with VSCode's classes removed, then
  // re-applying them as inline styles (which VSCode's rules can't override).
  function preserveProjectHorizontalRuleColors() {
    var body = document.body
    var activeVscodeClasses = VSCODE_THEME_CLASSES.filter(function (className) {
      return body.classList.contains(className)
    })
    activeVscodeClasses.forEach(function (className) {
      body.classList.remove(className)
    })

    var rules = document.querySelectorAll('#page hr')
    rules.forEach(function (rule) {
      var color = getComputedStyle(rule).borderTopColor
      rule.dataset.mpxBorderColor = color
    })

    activeVscodeClasses.forEach(function (className) {
      body.classList.add(className)
    })

    rules.forEach(function (rule) {
      var color = rule.dataset.mpxBorderColor
      if (color) {
        rule.style.borderColor = color
      }
    })
  }

  preserveProjectHorizontalRuleColors()

  // The Markdown preview webview re-renders its DOM on every edit/save —
  // reapply the fix whenever that happens.
  new MutationObserver(preserveProjectHorizontalRuleColors).observe(document.body, {
    childList: true,
    subtree: true,
  })
})()
