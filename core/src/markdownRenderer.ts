import MarkdownIt from 'markdown-it'

// These plugins have no usable published types, so they're loaded via require()
// (typed `any` by @types/node) rather than `import`, matching how the rest of
// the ecosystem consumes them.
const anchor = require('markdown-it-anchor')
const attrs = require('markdown-it-attrs')
const mark = require('markdown-it-mark')
const multimdTable = require('markdown-it-multimd-table')
const sub = require('markdown-it-sub')
const sup = require('markdown-it-sup')
const underline = require('markdown-it-underline')

export function createMarkdownRenderer(): MarkdownIt {
  return new MarkdownIt({ html: true, linkify: true })
    .use(anchor)
    .use(attrs)
    .use(mark)
    .use(multimdTable)
    .use(sub)
    .use(sup)
    .use(underline)
}
