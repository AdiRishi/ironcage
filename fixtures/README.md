# Financial import fixtures

## Use the private CommBank corpus

Place the original CommBank export folder at `fixtures/commbank/`. Keep its filenames, directory structure, and README unchanged. This directory is Git-ignored and is not included in a fresh clone.

Use the CSV, OFX, and PDF files together to validate the complete import implementation. Account for every file and every extracted observation. Compare source bytes or hashes before and after validation. Fix parser and reconciliation defects rather than editing the source evidence or omitting rejected records.

Run private-corpus checks explicitly against local development storage. Ordinary tests and CI must run without this directory. Keep raw records, account identifiers, source filenames, generated extracts, and screenshots out of tracked files, published docs, build outputs, and uploaded test reports. Local validation output can remain under the ignored corpus directory.

Before staging changes, confirm that Git ignores the corpus:

```sh
git check-ignore fixtures/commbank/README.md
git ls-files -- fixtures/commbank
```

The first command prints the ignored path. The second prints nothing.

## Interpret the original README

`commbank/README.md` describes the previous application's import procedure. Its paired-file requirements, numeric import order, supported profiles, and coverage claims are historical context. The new application's behavior is defined by `docs/product/imports.mdx` and `docs/technical/import-protocol.mdx`.

The new importer accepts individual files or mixed batches. Validate repeated uploads, shuffled order, overlapping windows, and cross-format matches. Establish coverage from source contents and reconciliation. Filenames and the old application's assumptions do not establish complete history.

OFX transaction identifiers are source evidence. Check their consistency within the account before using them to match postings. The import protocol defines how conflicting or reused identifiers are handled.

## Add public fixtures with the implementation

Add synthetic fixtures beside the parser or financial behavior they test. Each fixture must protect a specified outcome or invariant. Public fixtures contain no copied private records.
