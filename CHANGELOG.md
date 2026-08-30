# Changelog

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
