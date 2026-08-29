# zhao: dbt Lineage for VS Code

A companion VS Code extension for [zhao-cli](https://github.com/allenhori/zhao-cli): a
depth-scoped, diff-aware dbt lineage view docked right in your editor.

Free and open source (Apache 2.0). No dbt Cloud connection required, no network calls of any
kind -- it runs `zhao-cli` locally and reads the JSON it writes, the same way you'd run it from
a terminal.

## What it does

- **Lineage panel**, docked alongside your Terminal/Output/Debug Console tabs (poppable into a
  full editor tab for a denser graph). Auto-detects which model the file you have open belongs
  to, and shows a depth-and-direction-scoped view of its upstream/downstream lineage -- adjust
  either directly in the panel, no re-running a command by hand.
- **Column-level lineage**, toggled on top of the model-level graph, for tracing a specific
  column's provenance.
- **Diff highlighting**: see which models were actually changed on your current branch, and
  which downstream models are genuinely reached by that change -- the same data `zhao check`/
  `zhao diff` already compute in CI, now visible before you even open a PR.
- **Settings sidebar**: which dbt project is active (auto-detected in a monorepo, always
  overridable) and which profile target `zhao` compiles against, remembered per workspace.
- **Isolated compiles**: every compile this extension triggers writes to a temp directory, never
  your project's real `target/` -- it can't collide with a `dbt run` you triggered yourself.
  Refreshing is an explicit action by default; auto-refresh-on-save is available as an opt-in
  setting.

## Requirements

[`zhao-cli`](https://github.com/allenhori/zhao-cli) on your `PATH` (or pointed at via the
`zhao.executablePath` setting), and a dbt project with a working `dbt` install. The extension
shows a warning banner with a download link if `zhao` isn't found.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `zhao.depth` | `3` | Default number of upstream/downstream hops shown. |
| `zhao.direction` | `"both"` | Default direction: `upstream`, `downstream`, or `both`. |
| `zhao.autoRefreshOnSave` | `false` | Re-compile and refresh automatically on save. |
| `zhao.executablePath` | `"zhao"` | Path to the `zhao-cli` executable. |

## How this compares to the official dbt extension

The official dbt VS Code extension's lineage view requires a paid dbt Cloud connection and shows
only the currently-open model with no depth control. This extension is offline, free, lets you
scope how many hops are shown, and layers diff-highlighting on top -- useful on its own or
alongside the official extension.

## License

Apache 2.0 -- see [LICENSE](LICENSE).
