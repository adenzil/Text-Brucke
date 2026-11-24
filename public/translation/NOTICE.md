# Offline translation assets

## German to English model

The model comes from the Mozilla Firefox Translations project and is available
under the Mozilla Public License 2.0. The three gzip files are unmodified
exports of the released German to English (`de-en`) base-memory model
`retrain_hr2_WZOW24i4QJmIib61LeHfwg`. The data includes the model weights,
lexical shortlist, and shared SentencePiece vocabulary. [Mozilla model registry](https://mozilla.github.io/translations/model-registry/)
| [Machine-readable registry](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json)
| [Training source and license](https://github.com/mozilla/translations)

The registry reports 31,561,787 bytes and SHA-256
`3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20`
for the decompressed model weights. The original files remain available in
Mozilla's model bucket.

- [model.deen.intgemm.alphas.bin.gz](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/model.deen.intgemm.alphas.bin.gz)
- [lex.50.50.deen.s2t.bin.gz](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/lex.50.50.deen.s2t.bin.gz)
- [vocab.deen.spm.gz](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/vocab.deen.spm.gz)

## Bergamot engine

The worker script, Emscripten JavaScript, and WASM are the unmodified
`worker/` files from MPL-2.0 release `@mkljczk/bergamot-translator@0.4.16`.
The JavaScript/WASM build identifies itself as `v0.4.5+96572c0` and uses
Emscripten 3.1.8. [Bergamot project](https://github.com/browsermt/bergamot-translator)
| [Corresponding C++ source](https://codeberg.org/mkljczk/bergamot-translator/src/commit/96572c0e6e3893430cfd602020ad6ccc6aae0876)
| [npm release source and build instructions](https://codeberg.org/mkljczk/bergamot-translator/src/commit/be5fc207aa56a894ea258a6adc54464f737a7558)
| [npm release archive](https://registry.npmjs.org/@mkljczk/bergamot-translator/-/bergamot-translator-0.4.16.tgz)

The [MPL 2.0 license text](./MPL-2.0.txt) accompanies the translation model
and engine. The native dependencies have their own licenses.

- [Marian](https://github.com/browsermt/marian-dev/tree/2781d735d4a10dca876d61be587afdab2726293c) · [MIT](./licenses/MARIAN-LICENSE.md)
- [ssplit-cpp](https://github.com/browsermt/ssplit-cpp/tree/a311f9865ade34db1e8e080e6cc146f55dafb067) · [ssplit-cpp notices](./licenses/SSPLIT-LICENSE.md)
- [SentencePiece](https://github.com/browsermt/sentencepiece/tree/ae41b7740d7006596bb9257e83340b2620db9d00) · [Apache 2.0](./licenses/SENTENCEPIECE.txt)
- [IntGEMM](https://github.com/kpu/intgemm/tree/f7401513da71758dacce52fed1c7855549abee59) · [MIT](./licenses/INTGEMM.txt)
- [PCRE2](https://github.com/PCRE2Project/pcre2/tree/pcre2-10.39) · [PCRE2 license](./licenses/PCRE2.txt)
- [Emscripten](https://github.com/emscripten-core/emscripten/tree/3.1.8) · [MIT or NCSA](./licenses/EMSCRIPTEN.txt)

## Verify the bundled assets

Run `shasum -a 256 -c SHA256SUMS` in this directory. The extension build
copies the files from `public/translation` into the package.
