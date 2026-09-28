// dtab in the Monaco editor. The VS Code grammar colors each line through vscode-textmate, and the key and tag of
// every multiline string's header get semantic tokens, as in the VS Code extension, since a grammar cannot see that
// a deeper line follows. Needs vscode-textmate and vscode-oniguruma installed, 'semanticHighlighting.enabled': true
// in the editor's options, and theme rules for the grammar's scopes, HEADER_SCOPES included.
import textmate from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
import grammar from './vscode/syntaxes/dtab.tmLanguage.json' with {type: 'json'}
import headerDetection from './vscode/headers.js'

const {headers} = headerDetection   // a CommonJS module reaches Node's ESM only as its default export

// The scopes of a header's key and of its tag; vscode/package.json maps the extension's header tokens onto the same two
export const HEADER_SCOPES = ['entity.name.function.block-key.dtab', 'entity.other.attribute-name.block-tag.dtab']

/** Monaco's line state: a vscode-textmate rule stack, which is immutable, so the state is its own clone. */
class State {
    constructor(stack) { this.stack = stack }
    clone() { return this }
    equals(other) { return other.stack.equals(this.stack) }
}

/**
 * Pure function. Monaco's encoding of semantic tokens (line delta, start delta, length, type, modifiers) for the
 * key (type 0) and the tag (type 1) of each header.
 * @example headerTokens(['query sql', '\tSELECT 1'])   // Uint32Array [0, 0, 5, 0, 0, 0, 6, 3, 1, 0]
 */
function headerTokens(lines) {
    let previous = 0
    return new Uint32Array(headers(lines).flatMap(({line, key, tag}) => {
        const delta = line - previous
        previous = line
        return [delta, key[0], key[1] - key[0], 0, 0, 0, tag[0] - key[0], tag[1] - tag[0], 1, 0]
    }))
}

/**
 * Command (registers Monaco providers). Colors a registered Monaco language with the dtab grammar and its headers.
 *
 * @param {object} monaco - the monaco-editor module
 * @param {object} options
 * @param {Response|ArrayBuffer|Promise} options.wasm - vscode-oniguruma's onig.wasm, e.g. fetch(its URL from the bundler)
 * @param {object} [options.grammars] - TextMate grammars for the languages multiline strings embed, by scope name
 * @param {string} [options.language] - the Monaco language id
 * @example await highlight(monaco, {wasm: fetch(onigUrl), grammars: {'source.sql': sqlGrammar}})
 */
export async function highlight(monaco, {wasm, grammars = {}, language = 'dtab'}) {
    await oniguruma.loadWASM(await wasm)
    const registry = new textmate.Registry({
        onigLib: Promise.resolve(oniguruma),
        // A language with no grammar gets an empty one: vscode-textmate drops a rule whose grammar is missing, which
        // would read that language's strings as dtab lines instead of plain text
        loadGrammar: async scope => ({...grammars, 'source.dtab': grammar})[scope] ?? {scopeName: scope, patterns: []},
    })
    const dtab = await registry.loadGrammar('source.dtab')
    monaco.languages.setTokensProvider(language, {
        getInitialState: () => new State(textmate.INITIAL),
        tokenize: (line, state) => {
            const {tokens, ruleStack} = dtab.tokenizeLine(line, state.stack)
            return {endState: new State(ruleStack), tokens: tokens.map(token => ({startIndex: token.startIndex, scopes: token.scopes.at(-1)}))}
        },
    })
    monaco.languages.registerDocumentSemanticTokensProvider(language, {
        getLegend: () => ({tokenTypes: HEADER_SCOPES, tokenModifiers: []}),
        provideDocumentSemanticTokens: model => ({data: headerTokens(model.getLinesContent())}),
        releaseDocumentSemanticTokens: () => {},
    })
}
