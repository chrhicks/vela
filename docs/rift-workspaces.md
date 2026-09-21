# Parallel tasks with Rift

[Rift](https://github.com/anomalyco/rift) creates independent copy-on-write workspaces. Use one directory and one coding session per task. Files initially share storage; editing one copy leaves the others unchanged.

Each copy has its own Git state, unlike Git worktrees sharing one repository's refs. Rift starts a copy at detached `HEAD`, so create a branch before committing. It copies the source's current index and working-tree state, including uncommitted work; choose the source deliberately.

## Setup

Install the CLI with Bun:

```sh
bun add -g rift-snapshot
```

For Bash, add this once to `~/.bashrc`:

```bash
if command -v rift >/dev/null 2>&1; then
  eval "$(command rift shell-init bash)"
fi
```

Open a new terminal, or run `eval "$(rift shell-init bash)"` in the current one. The wrapper follows `init`, `create`, and `remove` into the resulting directory.

On Chris's Omarchy desktop, `rift-snapshot` 0.0.11 and Bash integration were installed and tested on 2026-09-21. The home filesystem was Btrfs. Initialization, independent task copies, dependency filtering, full copies, and cleanup were verified in a disposable repository. Vela itself was left uninitialized at that point; inspect current state rather than treating this dated observation as a prerequisite still outstanding.

Rift is evolving; consult its upstream README and `rift <command> --help` when installed behavior differs from this guide.

## Initialize a project once

On Btrfs, first initialization converts an ordinary directory into a subvolume at the same path. Do this between active sessions, after stopping processes that use or write that directory, so they do not retain references to the replaced directory.

```sh
cd ~/dev/personal/vela
rift init
```

Rift creates a `.rift` workspace marker and maintains a separate user-local registry. Repeating `rift init` on a registered root does not reconvert it. Keep `.rift` out of commits; it is local workspace identity.

## Start a task

Inspect the source branch and working tree first. For an independent task, use the intended baseline rather than inheriting another task's unfinished changes.

```sh
cd ~/dev/personal/vela
git status --short --branch
rift create --name task-one
git switch -c task-one
pnpm install --frozen-lockfile
```

With Bash integration, `rift create` enters `~/dev/personal/.rifts/vela/task-one/`. Open that directory in its own coding session. Start a sibling task from `~/dev/personal/vela` again, using a different workspace and branch name. Creating from inside a task instead makes a child of that task.

By default, Rift omits regenerable dependencies and build artifacts such as `node_modules`, `dist`, and `coverage`, preserving manifests and lockfiles. Use `rift create --name task-one --copy-all` instead when those artifacts should be included. Build and run Vela using the [development instructions](../README.md#development).

### Agent and non-interactive shells

Without the interactive wrapper, creation prints the new path but does not change the calling shell's directory:

```sh
workspace=$(rift create ~/dev/personal/vela --name task-one)
cd "$workspace"
git switch -c task-one
```

Use the returned directory explicitly for subsequent tool calls, or move the coding session's working directory there when the harness supports it. A `cd` in one shell call need not persist into the next.

### Running multiple tasks

Workspace isolation covers files and Git state. Processes still share the machine's ports and access to observatory devices. Check the existing runtime before starting another; coordinate port/configuration choices and which session operates a rig. Copied environment files may still point at the same external paths and devices. See the [observing runtime instructions](../README.md#observing-from-the-local-network) before running a hardware-backed copy.

## Inspect and deliver

```sh
rift list ~/dev/personal/vela  # Direct active children of the source
rift ancestors               # Parents of the current task, nearest first
git push -u origin task-one
```

Use the normal PR and verification workflow in [AGENTS.md](../AGENTS.md#verification-browser-review-and-merge). Commits and refs in a task copy do not automatically appear in the source or sibling copies; push the task branch and fetch in another copy when it needs those commits.

## Finish a task

Once the work is delivered or deliberately discarded, stop its processes and run from the created task directory:

```sh
rift remove
```

This moves the task and its active descendants into adjacent Rift trash. With Bash integration, the shell returns to the parent workspace. Preserve any needed commits, uncommitted files, and local artifacts before removal.

```sh
rift gc
```

Garbage collection permanently deletes registered Rift trash across projects and prunes missing entries. Use it when that trash is no longer needed.

`rift remove -f ~/dev/personal/vela` has a different purpose: it unregisters the source, preserves its directory, and trashes registered descendants. It is not the command for finishing an individual task.
