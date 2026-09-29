# Local automation: safety model (proposal for Brian's approval)

MengAI's operator cat can act on the owner's own Mac, the way a desktop
assistant does. This document is the safety model that the automation
module and the native helper must implement. Nothing in it is optional.
It is written before the code so the rules can be reviewed first.

## 1. Where it runs and who controls it

- Only on the machine where the MengAI app is installed, only in local
  mode. In server mode the automation module is not mounted at all.
- Only for the person sitting at that machine. There is no remote control
  path: the helper talks to the app over stdio pipes, never opens a
  network socket, never installs a login item or launch agent, and dies
  when the app quits.
- Every capability is OFF on a fresh install. The owner turns each one on
  in Settings, one at a time, with a visible scope.
- macOS itself gates the sensitive parts: the app asks for Accessibility
  and Screen Recording through the system prompts. If the owner declines,
  the capability stays unavailable and the UI says so.

## 2. Capabilities and modes

| Capability | What it covers | Default |
|---|---|---|
| fs | files outside the project workspace | off |
| shell | commands outside the project workspace | off |
| browser | open a URL, read the visible page | off |
| input | mouse and keyboard | off |
| screen | screenshots and the accessibility tree | off |
| apps | open, activate, quit apps | off |
| network | egress from tools | off |

Modes per capability: `off`, `ask` (confirm every action that changes
something), `auto_read` (read-only actions run, anything that changes
something asks). Grants can carry a scope (folders, command prefixes,
hosts) and an expiry.

## 3. Risk classes and what always asks

Every action is classified before it runs:

- `read`: looks at something, changes nothing.
- `write`: changes something reversible inside the granted scope.
- `destructive`: delete, overwrite, install, uninstall, privilege
  elevation, killing processes, disk operations.
- `sensitive`: sending data out, anything touching password fields,
  keychains, payment or "send" controls, two-factor prompts.

`destructive` and `sensitive` always require an explicit yes in the
approval sheet, in every mode, and can never be auto-approved by a
session grant. The approval sheet shows the exact action: the command,
the path, the diff, the URL, or the target rectangle drawn on the last
screenshot. Approvals expire after five minutes.

## 4. Hard refusals built into the helper

- Typing is refused while macOS reports secure event input (a password
  field has focus), whatever the grant says.
- Values of secure text fields are never read or returned.
- No action targets the MengAI app itself, its data directory, or the
  keychain items it owns.
- The helper accepts only the methods in `packages/shared/src/hands.ts`
  and rejects anything else.

## 5. Audit log and kill switch

- Every action, approval, denial and kill is appended to a hash-chained
  audit log (each row carries the hash of the previous row). The
  Automation screen can verify the chain and export it. Rows are never
  edited or deleted by the app.
- The kill switch is always visible in the app header, in the tray menu,
  and on a global shortcut. It stops every run, aborts in-flight tool
  calls, tells the helper to release any held input, denies pending
  approvals, revokes session-scoped approvals, and is itself audited.
- While any capability is active, the app shows a persistent indicator.

## 6. What the operator cat can and cannot learn

- Successful multi-step procedures can be saved as named skills, but a
  skill is only a recipe: replaying it goes through the same
  classification and approval gates as the first run.
- No screenshots, accessibility trees or typed text are sent to a model
  unless the run's provider is configured by the owner and the capability
  that produced them is on. Screenshots for the live view are downscaled
  and stored locally only.

## 7. Build plan (after approval)

1. `apps/api/src/modules/automation`: grants, classifier, approvals,
   audit chain, kill switch hooks, status and permission-request routes.
2. `apps/api/src/core/adapters/hands-stdio.ts`: the stdio JSON-RPC client
   with timeouts and restart limits.
3. `services/hands` (Rust): the helper that implements the contract with
   the system frameworks, plus a contract test driven from Bun.
4. UI: capability toggles with scope, the approval sheet, the audit view
   with chain verification, the live operator view.

Approve, change, or strike any rule above and the build follows it.
