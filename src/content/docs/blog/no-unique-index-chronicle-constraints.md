---
title: "No UNIQUE index, no problem: how Chronicle enforces invariants at append time"
date: 2026-09-02T12:00:00Z
authors: cratis-team
excerpt: Event sourcing has no table to put a UNIQUE index on, so where does Chronicle check that an email or username stays unique? Inside the kernel, at append time, before the event is ever committed — the concrete shape its Dynamic Consistency Boundary strategy takes for uniqueness.
tags:
  - chronicle
  - event-sourcing
  - consistency
---

Move a team from CRUD to event sourcing and one question stops them at the door, usually within the first day: "if state is derived from events, how do I stop two users from registering the same email?" It's a fair question. There's no table, so there's no `UNIQUE` column to lean on, and "current state" is a read model built after the fact from a log that never gets edited.

The instinct is to read that state first — look up the email, and if nothing comes back, append the registration event. It's the CRUD reflex, and it's the wrong move in an event-sourced system, for a reason that's easy to miss until it bites: the read is eventually consistent, and the check is not the same operation as the write.

## Checking first doesn't save you

In Chronicle, appending an event is committed and ordered immediately, but the read models built from it update afterward, typically within milliseconds. That gap is normally invisible to a user. It stops being invisible the moment two requests land close together: both read the projection, both see no matching email, both pass the check, and both append. The projection didn't lie — it just hadn't caught up yet, and by the time it does, the log already holds two "unique" emails.

This isn't a Chronicle quirk; it's what "read side is eventual" means anywhere events and read models are separate. Enforcing an invariant by reading a model and then deciding is a race, no matter how fast the projection usually is. The fix isn't a faster projection. It's not reading state to enforce the rule at all — [constrain the write instead](https://cratis.io/chronicle/concepts/consistency/).

## The kernel checks before the event is committed

Chronicle's answer is [constraints](https://cratis.io/chronicle/concepts/constraints/): rules that run inside the kernel and are evaluated at the moment an event is appended, against the event store's authoritative state — not against a projection that might be a few milliseconds behind.

```
                 rule holds  ──────────▶  Appended to the event sequence
Append event ──▶ Constraint check
  (kernel)        at append time         rule violated  ──────────▶  Rejected —
                                                                     constraint violation
```

An append that would break the rule is rejected at the source. It never reaches the log, so there's no duplicate event to clean up and no read model to correct afterward. Because the check lives in the kernel rather than in application code, it's the same check for every client and every entry point — a .NET service, a REST call, or a client in a language Chronicle doesn't have yet all hit the identical rule.

## Two shapes of "unique"

Chronicle ships two constraint shapes, both about keeping something singular:

- **Unique property** — a property's value must be unique across every tracked event in the store. This is the email-on-registration case: adorn the property, and any event that would introduce a duplicate value is rejected.
- **Unique event type** — a specific event type can be appended at most once per event source. Registering the same user twice becomes structurally impossible, independent of any property value.

The most direct way to declare either is model-bound — an attribute on the event itself, no separate class:

```csharp
using Cratis.Chronicle.Events;
using Cratis.Chronicle.Events.Constraints;

[EventType]
public record UserRegistered([property: Unique(name: "UniqueEmail")] string Email, string DisplayName);
```

One rule can span more than one event type by name. Give `[Unique(name: "UniqueEmail")]` to both `UserRegistered.Email` and `UserEmailChanged.NewEmail`, and a changed email is checked against every email ever registered — the rule follows the value, not one event type:

```csharp
[EventType]
public record UserRegistered([property: Unique(name: "UniqueEmail")] string Email, string DisplayName);

[EventType]
public record UserEmailChanged([property: Unique(name: "UniqueEmail")] string NewEmail);
```

For rules that don't map cleanly onto one property name — different event types spelling the same concept differently, or a rule that needs a custom violation message — Chronicle also offers a declarative form: implement `IConstraint` and build the rule explicitly against `IConstraintBuilder`. The [model-bound](https://cratis.io/chronicle/constraints/model-bound/unique/) and [declarative](https://cratis.io/chronicle/constraints/declarative/unique/) reference pages cover both in full, including how a constraint can be released when the value it tracks goes away (`RemovedWith`).

## Constraints are Chronicle's Dynamic Consistency Boundary, not a bolt-on

This is where the issue that prompted this post pointed us: constraints aren't a feature bolted onto event sourcing to patch over a gap. They're the concrete form Chronicle's [Dynamic Consistency Boundary](https://cratis.io/chronicle/dynamic-consistency-boundary/) (DCB) strategy takes for uniqueness-shaped decisions.

The traditional event-sourcing answer to "is this decision consistent?" is the aggregate: load every event for the entity, replay it, decide against the result. That boundary is fixed at design time, and it's often wrong for the decision at hand — too wide when the decision only needs one field, too narrow when it spans more than one stream. A [Dynamic Consistency Boundary](https://dcb.events) inverts that: the boundary is whatever the decision actually reads, determined at runtime, not fixed to an aggregate. Chronicle was built around decision-scoped consistency [before DCB had a name](https://cratis.io/chronicle/dynamic-consistency-boundary/chronicle/) — constraints are the piece of it evaluated automatically, in the kernel, for the narrow but common case of "keep this value or event singular." For decisions the constraint vocabulary can't express, Chronicle generalizes the same idea with concurrency scopes: metadata tags (`EventSourceId`, `EventSourceType`, `EventStreamType`, `EventStreamId`, `EventTypes`) that say which streams have to be checked together for a given decision, without requiring a full aggregate load.

## The counterargument: this only covers uniqueness

Constraints are not a general invariant engine, and it would overstate them to present them as one. Today they express exactly two shapes — a property staying unique, an event type appearing once — and nothing else. An invariant like "an account's balance must never go negative" isn't a constraint; it's a decision that needs its own facts read (typically through a projection) and its own concurrency scope to stay correct under concurrent commands. Constraints solve the specific, extremely common uniqueness problem cheaply because the kernel can check it directly against indexed state; they deliberately don't try to be a rules engine for arbitrary business logic.

The other honest limit is client coverage. Constraints, in both the model-bound and declarative forms, are fully specified on the .NET client first; the TypeScript, Kotlin/Java, and Elixir clients are catching up at different paces for each form. If you're not on .NET, check the [constraints reference](https://cratis.io/chronicle/constraints/) for what's implemented in your client before you plan a schema around a specific declaration style.

## Where to start

1. Read [Understanding constraints](https://cratis.io/chronicle/understanding-constraints/) for the mental model behind the mechanism above.
2. Add `[Unique]` to a property on an event type you already have, then fire two concurrent commands at it and watch one get rejected — that race is the whole point.
3. When the invariant isn't shaped like uniqueness, reach for the wider [Dynamic Consistency Boundary](https://cratis.io/chronicle/dynamic-consistency-boundary/chronicle/) pattern: read the exact decision facts through a projection, and scope consistency with a concurrency scope instead of a constraint.
4. If you're building on a client other than .NET, check the [constraints reference](https://cratis.io/chronicle/constraints/) for what's implemented today before committing to a declaration style.
