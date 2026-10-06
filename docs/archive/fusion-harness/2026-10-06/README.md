# Fusion archive — 2026-10-06

This branch preserves OpenMAIC Fusion code and selected local work. The `workspace/` directory contains the allowlisted root harness snapshot; `manifest.json` records paths and SHA-256 hashes. This is historical material, not the native route's current specification.

DeepTutor archive: `archive/fusion-2026-10-06` at `24de083c39cf7ae88c04cc8ecfee443a06e63306` in `ZhengRanCan/DeepTutor`. OpenMAIC's pre-harness code snapshot is `1c7282e5d429b6892f4273267d2a9a6e39c66aaf`; the commit containing this directory is the complete OpenMAIC code-and-harness snapshot. Resolve its exact SHA with Git or the recorded execution evidence rather than treating the branch name as immutable.

To restore, use separate clean checkouts of the archived OpenMAIC and DeepTutor commits, with sibling directory names `OpenMAIC/` and `DeepTutor/`. Restore `workspace/` files into their shared parent while retaining relative paths, verify manifest hashes, then follow the archived initialization contract. Inspect target files before copying over an existing workspace.

Runtime data, credentials, ignored provider files, original classroom exports, raw logs, incident directories and evidence payloads are excluded. Existing local data remain in their original locations. The original Fusion branches are retained and were not rebased.

F60 is blocked by a product-route freeze; its acceptance checks remain pending. This archive is not a passing claim. The new OpenMAIC route uses official main `7230053af019b89c83d22dcab0a94f38fe193856`; native feature development and retained improvements require their own validation.

The archive-local .gitattributes disables text conversion so manifest hashes remain byte-exact across Git checkouts. Existing source whitespace is preserved.
