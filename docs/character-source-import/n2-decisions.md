# N2 implementation decision record

The project owner approved option A for all four N2 gates on 2026-07-08. This file records the resulting production boundaries; it is not a capability claim beyond the tested paths named below.

## 1. Structured output: Valibot + `@xsai/generate-object`

- Character candidate and atomic-fact extraction use Valibot schemas passed to `@xsai/generate-object` with strict JSON Schema response format.
- `@valibot/to-json-schema` is owned by `packages/stage-ui`, where xsAI converts the Valibot contract for the Provider request.
- The extractor registers no tools and sends no chat history, runtime perception, character prompt, document hash, path, or job ID.
- Providers that reject `response_format`/`json_schema` fail with `provider_incompatible`. There is no free-JSON, regular-expression extraction, or silent-repair fallback.
- The repository pins the new xsAI package to `0.5.0-beta.2`, matching the existing xsAI package family.

## 2. File types: bounded UTF-8 text only

The first production version supports `.txt`, `.md`, `.json`, `.yaml`, and `.yml` through the bounded Desktop reader. Strict UTF-8 decoding, size checks, read-race checks, cancellation, and request ID isolation apply. DOCX, PDF, OCR, archive formats, and URL fetching remain out of scope and require separate review.

## 3. Provider privacy: configured local or cloud Provider with per-job confirmation

- The picker displays the exact configured Provider and model before each analysis.
- Analysis cannot start until the user confirms that the displayed Provider/model will receive the redacted payload.
- High-confidence secrets and local user paths are redacted before construction of the Provider DTO.
- Existing Provider configuration is reused. Credentials, source hashes, absolute paths, temporary job IDs, full source text, and evidence quotes are not written to job metadata.
- Closing, cancelling, failing, or completing the flow clears the in-memory source lifecycle defined by the import stores.

## 4. Token counting: Provider-aware hybrid

- Known OpenAI model families on explicitly verified Provider IDs use lazily imported `js-tiktoken` rank data (`o200k_base` or `cl100k_base`). Generic OpenAI-compatible endpoints are not assumed to use the tokenizer implied by a model alias.
- Explicit Hugging Face repository IDs for allow-listed open-model organizations may use the existing Transformers.js `AutoTokenizer` path, only for local Provider IDs.
- Tokenizers are cached and concurrent loads are deduplicated. No prompt or world-book content is sent while loading a tokenizer; the counter receives text only after it is ready in-process.
- Unknown, unloaded, or failed mappings never use a character-count estimate. Independent entry/content/recursion hard limits remain active, and the UI reports the exact support state.
- The production chat path passes the verified active-model counter into world-book selection. The budget covers the final rendered lore wrapper, separators, and content, and deterministic priority pruning remains in force.

Targeted verification includes extractor request-shape and compatibility tests, tokenizer mapping/loading/failure tests, world-book runtime tests, and a chat integration assertion that preserves high-priority lore while removing a lower-priority over-budget entry.
