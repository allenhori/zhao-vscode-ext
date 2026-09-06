## Branch protection

`master` is protected: PRs required, 1 approval + the `test` status check required,
no force-push/delete. `enforce_admins` is deliberately `false`.

The user has given explicit standing permission for Claude to bypass this protection
via `gh pr merge --admin` when merging its own PRs on this repo (e.g. after CI is
green but no human reviewer is available to approve). This does not need to be
re-confirmed each time.
