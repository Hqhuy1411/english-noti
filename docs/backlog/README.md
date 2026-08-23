# Backlog

Work items as numbered markdown files in git, indexed by `docs/STATUS.md`. No
external tracker, no separate account, and the board is diffable and reviewable
alongside the code that satisfies it.

A ticket exists so a future session — human or agent — can pick the work up without
asking what was already decided. If it does not answer *"how will we know this is
done?"*, it is not a ticket yet.

## Template

```markdown
# NNNN — <one-line title>

**State:** open | in progress | blocked | done | dropped
**Opened:** YYYY-MM-DD · **Closed:** —

## Goal
What outcome, in one paragraph. Not the implementation.

## Why now
What is worse today because this is not done.

## Constraints
Existing decisions this must respect, by ADR number. The point is to stop the
work from re-opening a settled question.

## Acceptance criteria
- [ ] Checkable, observable statements. A command and its expected output beats
      an adjective.

## Files likely touched
Best guess, so a reader can judge blast radius before starting.

## Notes
Anything learned while the ticket was open. A dead end recorded here is worth
more than a clean-looking ticket.
```

## Rules

- Next free number, `NNNN-<slug>.md`. Numbers are never reused.
- Add a row to `docs/STATUS.md` when you open one, and change its state there when
  it moves. A ticket whose state only lives in the file is invisible.
- Closing means the acceptance criteria were **run**, not judged plausible. Say what
  was executed and what it printed.
- If work reveals a decision, that is an ADR in `docs/decisions/`, not a paragraph
  buried in a ticket. Link it both ways.
- A dropped ticket stays, with `State: dropped` and a sentence on why. Deleting it
  loses the reason and invites someone to propose it again.
