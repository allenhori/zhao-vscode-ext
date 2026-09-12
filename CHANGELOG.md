# Changelog

## 0.5.2

- Switching "Preview Data" between two models before the first one finished previously left the
  first's query running in the background instead of actually stopping it -- it's now cancelled
  for real, which also avoids a real case of two concurrent warehouse connections (e.g. to
  Databricks) contending with each other.
- The Preview tab's loading message now notes that a first connection to some warehouse targets
  can take up to a minute, so it doesn't look stuck while it's actually just authenticating.

## 0.5.1

- Fixed a race condition where switching "Preview Data" between two models in quick succession
  could show the wrong one's result.
- The Preview tab's own model/seed picker no longer offers sources (which have no query of their
  own to preview), matching the right-click menu.
- Fixed long-but-single-line model names occasionally overflowing their node's box.
- NULL, an empty string, and non-finite numbers (NaN/Infinity) now render distinctly in preview
  results instead of all looking the same.

## 0.5.0

- New **Preview tab**, alongside Lineage in the same panel (now titled just "zhao"). Right-click
  a node and choose "Preview Data" to see a live, row-capped preview of its query results --
  works on both classic dbt-core projects and dbt Fusion projects. Requires `zhao-cli` v0.5.0 or
  later.
- New "Open Model File" right-click action, jumping straight to a node's `.sql`/`.csv` source.
- Lineage nodes now show an icon (model/source/seed) and a color (by materialization --
  table/view/incremental/ephemeral) instead of a plain uniform box, so the graph is scannable at
  a glance.
- Fixed long model names overflowing their node's box -- text now wraps onto a second line
  instead.

## 0.1.3

- Column-level lineage now actually renders: each node box lists its own columns as
  individual rows, with column-to-column edges drawn between them. The "Column-level"
  checkbox previously did nothing visible even though the underlying data was already
  correct.
- Fixed upstream and downstream nodes sometimes landing in the same column in the graph
  (a node one hop upstream and one hop downstream of the focused model could render side
  by side instead of on opposite sides).
- Picks up `zhao-cli` v0.4.1's dbt Fusion improvements: seeds now appear as their own
  nodes in the lineage graph (previously only reachable via an edge, never actually drawn)
  for both dbt-core and Fusion projects.

## 0.1.2

- Fixed `zhao-cli` detection when VS Code is launched from the Dock, Finder, or Spotlight
  rather than from an already-configured terminal: the extension now also resolves PATH
  through your login shell, so an install that's only on PATH via your shell profile
  (`~/.zshrc`, `~/.zprofile`, `~/.bash_profile` -- e.g. `cargo`, Homebrew, `nvm`) is found
  without needing to set `zhao.executablePath` manually or relaunch VS Code from a terminal.

## 0.1.1

- Swapped in a new icon design (Marketplace icon + activity-bar icon).

## 0.1.0

Initial release.

- Lineage panel docked in the bottom panel area (poppable into a full editor tab): depth/direction
  controls, a focus dropdown, column-level lineage, and diff-highlighting against your current
  branch's Baseline.
- Recommended command: with diff highlighting on and `zhao.yml`'s `recommended-command.subcommand`
  configured, copy or run-in-terminal a ready-to-run command rebuilding exactly the impacted
  models -- computed by `zhao-cli`, only displayed by the extension.
- Settings sidebar: active dbt project (auto-detected, searchable picker for monorepos with many
  projects) and active profile target, remembered per workspace.
- Every compile isolated to a temp directory -- never the project's real `target/`.
- Missing-executable warning banner with a link to `zhao-cli`'s releases page.
