# Implementation Plan: City Mafia roles, night order, and voting rules

Branch: `codex/extend-city-mafia-rules`
Created: 2026-08-22

## Settings

- Testing: yes — unit coverage, database integration coverage when `TEST_DATABASE_URL` is configured, and an updated manual group acceptance checklist.
- Logging: verbose — `DEBUG` at state-entry, lookup, and decision checkpoints; `INFO` for phase/round transitions and counts; `WARN` for stale, duplicate, or rejected callbacks; `ERROR` for failed persistence or Telegram operations.
- Docs: yes — update user-facing rules, setup limits, README, and manual acceptance steps before completion.

## Goal and confirmed rule set

Replace the current classic four-role game with the referenced city-Mafia rule set, adapted to a Telegram group while preserving secret roles and secret night actions in ephemeral panels. The bot must support exactly 9–15 players for newly created games, use this distribution, and retain `COMMISSIONER` / `COMMISSIONER_CHECK` as technical database values while displaying **Шериф** everywhere player-facing.

| Players | Mafia | Don | Civilians | Шлюха (`PROSTITUTE`) | Sheriff (`COMMISSIONER`) | Doctor | Maniac |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 1 | 1 | 4 | 1 | 1 | 0 | 1 |
| 10 | 1 | 1 | 5 | 1 | 1 | 0 | 1 |
| 11 | 2 | 1 | 5 | 1 | 1 | 0 | 1 |
| 12 | 2 | 1 | 6 | 1 | 1 | 0 | 1 |
| 13 | 3 | 1 | 5 | 1 | 1 | 1 | 1 |
| 14 | 3 | 1 | 6 | 1 | 1 | 1 | 1 |
| 15 | 3 | 1 | 7 | 1 | 1 | 1 | 1 |

### Rule decisions to encode

- **Шлюха acts before everyone else.** A durable `NIGHT_PROSTITUTE` phase delivers only her private panel. When she has no living Шлюха, it advances safely to the regular night without waiting. This is the role called «Путана» in the reference rules.
- A Шлюха must choose a living non-self target and cannot choose the same target two nights in a row. Her visit blocks that target's personal action; visiting any Mafia-faction member blocks the team shot; it gives the target an alibi for the following day. If Mafia or Maniac kills the Шлюха, her selected target also dies, subject to the documented Doctor interaction from the reference rules.
- Doctor must choose one living target every night, cannot treat the same target on consecutive nights, may treat themself once per game, and can prevent only the Mafia shot. The history and one-time self-save are persisted and enforced transactionally.
- Don participates in the normal Mafia council and separately checks one living player for Sheriff. The Sheriff sees Mafia and Don as Mafia, but never sees Maniac as Mafia. The Maniac selects one victim or explicitly skips and wins only as the final `MANIAC + CIVILIAN` pair.
- Mafia wins only after the Maniac has gone and the Mafia faction (Mafia plus Don) reaches parity with civilians. Peaceful wins only after both the Mafia faction and Maniac are gone. Maniac is announced when eliminated; all roles remain secret until final reveal otherwise.
- Telegram adaptation of the city day: normal configured group discussion remains open chat; `/startvote` opens a public nomination round; a moderator closes it using a new group control/command. Zero or one nominated player means no execution and an immediate night. Two or more candidates proceed to a public vote with no free “skip” choice. A first tie creates a 30-second constrained tie-discussion and a revote among only tied candidates. A second tie opens a final binary city decision to eliminate all tied candidates or leave all of them; any alibied candidate remains alive if the eliminating option wins. This keeps the reference rule while making every moderator action and vote visible in the group.
- Vote rounds, nomination candidates, alibis, and night order are persisted. Callback target indexes are resolved against the persisted round, never against a new live-player list. Existing active legacy games without new roles remain operable; the 9–15 limit applies when starting a new game.

## Commit Plan

- **Commit 1** (after tasks 1–3): `feat: add city mafia role and state model`
- **Commit 2** (after tasks 4–6): `feat: implement city mafia night and voting rules`
- **Commit 3** (after tasks 7–9): `test: cover city mafia gameplay rules`

## Tasks

### Phase 1: Domain and persistence foundation

- [x] **Task 1 — Define the city role model, exact distribution, and faction-aware pure rules.**
  - Deliverable: extend role/action unions with `PROSTITUTE` (displayed as «Шлюха»), Don, and Maniac; add one canonical player-facing role-label helper (with `COMMISSIONER` labelled “Шериф”); replace the 5–20 heuristic with the confirmed 9–15 table; and centralise Mafia-faction, night-actor, target-legality, result-visibility, and win-condition predicates. Rework night and game-finalisation value types to allow zero, one, or multiple eliminations and a Maniac winner without exposing secret targets in public data.
  - Files: `src/domain/game/types.ts`, `src/domain/game/rules.ts`, `src/domain/game/roleAssignment.ts`, `src/domain/game/nightResolution.ts`, `src/domain/game/winConditions.ts`, `src/domain/game/voteResolution.ts`, `src/domain/game/voteDetails.ts`, `src/application/GameFinalizationService.ts`.
  - Logging: pure domain functions add no logs; callers must log only `gameId`, phase/version, outcome kind, faction, and counts. Do not log role assignments, checks, targets, candidate mappings, or private result text.
  - Dependencies: none.

- [x] **Task 2 — Add a forward-only Prisma migration and repository APIs for durable city-rule state.**
  - Deliverable: add `PROSTITUTE`, `DON`, and `MANIAC` to the existing role enum without renaming `COMMISSIONER`; present `PROSTITUTE` as «Шлюха» in player-facing content; add night-action kinds for Шлюха, Don, and Maniac; make an explicit Maniac skip durable; and persist (a) Шлюха’s next-day alibi, (b) Doctor self-save usage and last-target history, (c) Шлюха/Doctor last-target history, and (d) each nomination/vote round with its ordered eligible candidates and round kind. Supply transaction-safe repository methods for create-only actions, history checks, consuming/clearing alibis, and same-phase vote-round transitions.
  - Files: `prisma/schema.prisma`, new `prisma/migrations/<timestamp>_city_mafia_rules/migration.sql`, `src/infrastructure/repositories/NightActionRepository.ts`, `src/infrastructure/repositories/PlayerRepository.ts`, `src/infrastructure/repositories/VoteRepository.ts`, `src/infrastructure/repositories/GameRepository.ts`, plus new focused repositories/models for day effects and vote rounds if they make the ownership clearer.
  - Logging: repositories use `DEBUG` before persistence and `INFO` after state changes with IDs, version, round kind, and counts only; use `WARN` for uniqueness/history rejections and `ERROR` for unexpected database errors. Never log a role, action target, alibi holder, or vote mapping.
  - Dependencies: task 1. Validate generated Prisma client and preserve existing in-flight games; no destructive migration or enum rename.

- [x] **Task 3 — Make the phase machine and recovery understand Шлюха-first night and durable day sub-rounds.**
  - Deliverable: add `NIGHT_PROSTITUTE`, nomination, tie-discussion, and final-decision states (or equivalent persisted substate with the same restart-safe semantics); route phase jobs, optimistic `stateVersion` changes, early completion, and recovery through them. Start a regular night only after the Шлюха stage is complete/skipped, use a 30-second tie-discussion deadline, and never let stale callbacks/jobs advance a new round.
  - Files: `prisma/schema.prisma` and migration if phase enums change, `src/domain/game/types.ts`, `src/application/PhaseService.ts`, `src/application/PhaseClock.ts`, `src/application/RecoveryService.ts`, `src/infrastructure/repositories/GameRepository.ts`, `src/index.ts`, `src/config/env.ts`, `.env.example`.
  - Logging: add `DEBUG` for phase-job eligibility and transitions, `INFO` for phase/round starts and ends, and `WARN` for obsolete deadlines/callbacks. Record only game/chat IDs, versions, phase/round kind, deadlines, and counts.
  - Dependencies: task 2. Preserve idempotent `chatId + gameId + phase + stateVersion` guards.

### Phase 2: Night gameplay and resolution

- [x] **Task 4 — Implement ordered private night panels and storage-enforced role actions.**
  - Deliverable: deliver Шлюха’s panel alone in `NIGHT_PROSTITUTE`; then fan out regular panels only to unblocked living action roles. Шлюха produces a create-only visit; a blocked Sheriff, Doctor, Don check, or Maniac action is shown as blocked and considered complete, while a visit to any Mafia-faction player prevents the Mafia shot after the council completes. Let Don participate in every Mafia council predicate and make the separate Sheriff check create-only. Let Maniac choose one eligible target or use an explicit skip callback. Enforce all repeat/self restrictions in repositories/transactions, then reflect them in candidate buttons as an aid rather than the authority.
  - Files: `src/application/NightActionService.ts`, `src/application/NightResolutionService.ts`, `src/application/EphemeralPanelService.ts`, `src/infrastructure/repositories/NightActionRepository.ts`, `src/infrastructure/repositories/PlayerRepository.ts`, `src/bot/callbacks/callbackData.ts`, `src/bot/callbacks/ephemeralCallbacks.ts`, `src/bot/views/ephemeralPanelView.ts`, `src/bot/views/phaseView.ts`, `src/application/TestGameService.ts`.
  - Logging: verbose safe progress logs for delivery attempts, `actionPlayersCompleted/actionPlayersTotal`, blocked/accepted/skipped *counts*, and phase transitions; `WARN` for duplicate/invalid selections. Do not log role names, targets, panel content, Mafia draft details, or Sheriff/Don results.
  - Dependencies: tasks 1–3. Keep the existing ephemeral-in-group transport, compact callback payloads, and single-use uniqueness guarantees.

- [x] **Task 5 — Resolve the complete night deterministically and apply all winner conditions.**
  - Deliverable: implement the ordered resolution table: Шлюха blocks, the confirmed Mafia council shot, Doctor protection against that shot only, the independent Maniac shot/skip, and Шлюха’s linked death. Encode the source’s two special Doctor/Шлюха/Mafia cases exactly, deduplicate a player hit by multiple effects, eliminate all resolved players idempotently, retain a safe public dawn summary, and finalise Mafia, Peaceful, or Maniac victories with the confirmed predicates.
  - Files: `src/domain/game/nightResolution.ts`, `src/domain/game/winConditions.ts`, `src/application/NightResolutionService.ts`, `src/application/GameFinalizationService.ts`, `src/infrastructure/repositories/PlayerRepository.ts`, `src/application/PhaseService.ts`, `src/bot/views/nightEventView.ts`, `src/bot/views/finalView.ts`, `src/bot/callbacks/ephemeralCallbacks.ts`.
  - Logging: log resolution kind, affected-player count, save count, and final faction only; retain `ERROR` context for failed mutations. Explicitly omit all role, target, identity-to-target, check result, and private-panel fields.
  - Dependencies: tasks 1–4. A deadline may resolve incomplete actions consistently, but early completion must remain immediate once every required/blocked action is complete.

### Phase 3: City day and voting workflow

- [x] **Task 6 — Replace the one-round vote with durable city nominations, revote, alibi, and final decision flow.**
  - Deliverable: add a group-contained nomination UI/control; persist every candidate set and resolve button indexes against it; remove the generic skip option; move to night without execution for zero/one nominee; resolve the primary vote; start a constrained tie-discussion and revote for the first tie; and create the binary “all leave / all stay” final round after the second tie. Apply a Шлюха alibi during outcome resolution (not only in the view), announce it without revealing the role source, permit multiple eliminations in the final decision, and reset expired effect/round state after use. Preserve configurable normal discussion and manual organizer controls.
  - Files: `src/domain/game/voteResolution.ts`, `src/domain/game/voteDetails.ts`, `src/application/DayService.ts`, `src/application/VotingService.ts`, `src/application/PhaseService.ts`, `src/infrastructure/repositories/VoteRepository.ts`, `src/infrastructure/repositories/GameRepository.ts`, new day-vote-round/effect repositories, `src/bot/callbacks/callbackData.ts`, `src/bot/callbacks/voteCallbacks.ts`, `src/bot/views/dayView.ts`, `src/bot/views/voteView.ts`, `src/bot/views/phaseView.ts`, `src/bot/commands/lobbyCommands.ts`, `src/bot/commands/commandMenu.ts`, `src/index.ts`.
  - Logging: `DEBUG` round/candidate counts and vote progress; `INFO` for nomination closure, vote outcome, alibi application count, and phase changes; `WARN` for stale/duplicate/out-of-round votes. Never log nominated player IDs, voter-to-candidate mappings, or Шлюха identity.
  - Dependencies: tasks 1–3. The new round record and phase/version must change atomically so a restart cannot reopen an unrestricted vote.

- [x] **Task 7 — Update Telegram views, callback publishing, restoration, and test-game orchestration for the new rules.**
  - Deliverable: render all new roles, neutral controls, City voting stages, role-appropriate private feedback, public Maniac reveal on death, and multiple-elimination outcomes. Keep private actions and investigation results in ephemeral panels. Ensure every callback/recovery path republishes the correct neutral control, handles a new phase/round after restart, and produces a nine-player test game that exercises the new roster without exposing secrets. Align actual group vote visibility with city rules by showing public vote details consistently and updating the docs that previously claimed otherwise.
  - Files: `src/bot/views/ephemeralPanelView.ts`, `src/bot/views/nightEventView.ts`, `src/bot/views/dayView.ts`, `src/bot/views/voteView.ts`, `src/bot/views/finalView.ts`, `src/bot/views/phaseView.ts`, `src/bot/callbacks/ephemeralCallbacks.ts`, `src/bot/callbacks/voteCallbacks.ts`, `src/bot/callbacks/callbackData.ts`, `src/application/EphemeralPanelService.ts`, `src/application/RecoveryService.ts`, `src/application/TestGameService.ts`, `src/index.ts`.
  - Logging: log delivery/restore success or failure and public phase/round/count metadata only; use `WARN` for a failed ephemeral delivery or stale callback. Treat all button text and private content as sensitive and do not write it to logs.
  - Dependencies: tasks 3–6.

### Phase 4: Verification and documentation

- [x] **Task 8 — Add regression, concurrency, migration, and interaction coverage for city Mafia.**
  - Deliverable: cover all nine distribution rows; labels and faction predicates; Шлюха ordering, blocks, alibi, death, and Doctor edge cases; Don council/check; Sheriff/Mafia/Maniac checks; Maniac skip and three-way win conditions; persisted target restrictions; early and deadline night completion; all nomination/voting/tie/final-decision paths; multiple elimination and alibi; stale/concurrent callbacks; recovery in every new state; generated Prisma schema and migration behaviour; and 9-player virtual-test flow. Update existing unit fixtures rather than keeping obsolete 5-player assumptions. Run database integration tests only with an explicit disposable `TEST_DATABASE_URL` and report a skip accurately otherwise.
  - Files: `tests/unit/game/rules.test.ts`, `tests/unit/game/resolution.test.ts`, `tests/unit/application/nightActionService.test.ts`, `tests/unit/application/nightResolutionService.test.ts`, `tests/unit/application/phaseService.test.ts`, `tests/unit/application/votingService.test.ts`, `tests/unit/application/dayService.test.ts`, `tests/unit/application/testGameService.test.ts`, `tests/unit/bot/ephemeralCallbacks.test.ts`, `tests/unit/bot/voteCallbacks.test.ts`, `tests/unit/bot/privatePanels.test.ts`, `tests/unit/bot/lobbyCommands.test.ts`, `tests/unit/infrastructure/*`, `tests/integration/gameLifecycle.test.ts`, and new narrowly focused test files where clearer.
  - Logging: test assertions must verify that production logs contain only permitted IDs/phase/count fields and never target, role, secret result, or token data. Test harness logging stays controlled by `LOG_LEVEL`.
  - Dependencies: tasks 1–7.

- [x] **Task 9 — Document the final city rules and perform the complete quality gate.**
  - Deliverable: update the README limits/description, gameplay rules, setup configuration (including the 30-second tie discussion if configurable), and manual acceptance checklist for every role, sequence, privacy boundary, public city vote, group controls, recovery case, and safe log inspection. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, Prisma validation/generation, and the integration suite when its database is actually available; record precisely which checks ran and which external integration checks were skipped.
  - Files: `README.md`, `docs/game-rules.md`, `docs/getting-started.md`, `docs/manual-acceptance-checklist.md`, `.env.example`, `package.json` only if scripts need an explicit migration/verification command.
  - Logging: document `LOG_LEVEL=debug` for development and `info`/`warn` for production; explicitly list the allowed diagnostic fields and the prohibited role/target/check/panel data.
  - Dependencies: tasks 1–8.
