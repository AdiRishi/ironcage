# Fixtures

`commbank/` holds the private CommBank corpus and is git-ignored. It contains 99 files for four accounts: 26 CSV and OFX pairs and 47 PDF statements. The original copy lives outside the repository; restore this directory from it if needed.

File names follow `NNN[a|b]_cba_<account>_<start>_<end>.<ext>`. A numeric prefix with `a` and `b` is one CSV and OFX pair covering the same window. A prefix without a letter is a statement PDF and includes its issue date. Names are labels only; account identity and coverage come from file contents.

Tests in CI use synthetic fixtures colocated with their tests. Never copy rows from `commbank/` into tracked files, snapshots, or logs.
