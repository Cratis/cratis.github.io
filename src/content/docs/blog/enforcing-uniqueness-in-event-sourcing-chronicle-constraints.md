---
title: "Enforcing uniqueness in event sourcing: constrain the append, not the read"
date: 2026-09-02
authors: sindre
excerpt: There's no UNIQUE index on an event log, so how do you stop two users registering the same email? Not by reading the projection first — that races. Chronicle's answer is constraints, rules enforced in the kernel at append time, and they're the concrete shape of its Dynamic Consistency Boundary model.
tags:
  - chronicle
  - event-sourcing
  - constraints
---

"How do I stop two users registering the same email if state is derived from events?" is one of the first questions anyone new to event sourcing asks, and it's a fair one. In a CRUD system you put a `UNIQUE` index on a column and the database refuses the second insert. An event log has no such column. State is a projection, computed from history, built *after* the fact — so what exactly do you put the constraint on?

## Why reading first doesn't save you

The instinctive fix is to read before you write: look up the projection, see if the email is taken, append `UserRegistered` if it isn't. It compiles, it passes a manual test, and it's wrong. The projection is eventually consistent — it updates *after* an append, not during one. Fire two registration requests for the same email close enough together and both reads come back "not taken," both commands append, and you now have two `UserRegistered` events for the same address, permanently, because events are facts and facts don't get quietly deleted once someone notices the collision. Checking the read model moved the race, it didn't close it.

## The fix lives in the kernel, not your handler

Chronicle's answer is [constraints](https://cratis.io/chronicle/constraints/) — rules declared next to the event and enforced by the Chronicle kernel itself, checked against authoritative state at the moment an event is appended, not against a read model that might be milliseconds stale. If the rule holds, the event commits. If it doesn't, the append is rejected before the event ever reaches the log. Because the check runs once, server-side, it applies the same way to every client and every entry point — a .NET service, a REST call, an integration nobody's written yet — with no constraint logic duplicated in application code.

The model-bound form declares a rule with an attribute, right on the event that carries the value:

```csharp
using Cratis.Chronicle.Events;
using Cratis.Chronicle.Events.Constraints;

[EventType]
public record UserRegistered([property: Unique(name: "UniqueEmail")] string Email, string DisplayName);

[EventType]
public record UserEmailChanged([property: Unique(name: "UniqueEmail")] string NewEmail);

[EventType]
[RemoveConstraint("UniqueEmail")]
public record UserRemoved(UserId UserId);
```

Give the same `name` to `[Unique]` on both `UserRegistered.Email` and `UserEmailChanged.NewEmail` and one rule follows the *value* across both events, not just the event that first introduced it. `[RemoveConstraint]` is the release valve: mark it on whatever event ends the value's lifetime and the email is claimable again once that user is gone.

## Two shapes of the same rule

Chronicle supports two constraint types. A **unique property** constraint, shown above, keeps one value unique across all events of one or more types. A **unique event type** constraint is coarser: put `[Unique]` on the event type itself and only one instance of that event can ever be appended per event source — useful for facts that can only happen once, like "this user registered," independent of any particular property.

Attributes cover most cases, but not all: the same logical value sometimes shows up under a different property name per event, the comparison needs to ignore casing, or the violation message needs composing from context. For that, implement `IConstraint` and describe the rule with a builder instead — `builder.Unique(u => u.WithName("UniqueEmail").On<UserRegistered>(e => e.Email).On<UserEmailChanged>(e => e.NewEmail).IgnoreCasing().RemovedWith<UserRemoved>())`. Both forms are discovered automatically at startup, no registration call, and both compile down to the exact same kernel-side constraint — which one you reach for is purely about where the rule reads best.

## The bigger idea underneath: Dynamic Consistency Boundary

Constraints aren't a bolt-on feature; they're the practical instrument of a broader idea Chronicle was built around: the [Dynamic Consistency Boundary](https://cratis.io/chronicle/dynamic-consistency-boundary/). Classic event sourcing draws the consistency boundary around a fixed aggregate — to decide anything about an entity, you load the whole thing. A DCB inverts that: the *decision* defines the boundary. You scope consistency to exactly the facts a given decision depends on, no more, no less, and the kernel guarantees correctness over that scope.

Chronicle's own framing of [how DCB maps onto the kernel](https://cratis.io/chronicle/dynamic-consistency-boundary/chronicle/) is direct: decision facts are read from projections, constraints validate that the decision is still correct at the moment of appending, concurrency scopes define which streams must be checked together, and projections update read models asynchronously afterward. Constraints are one half of that — the half that protects a *value* across the whole store, forever. The other half, concurrency scopes, protects a *moment* — rejecting an append that raced against a stale read of the same event source. Reach for a constraint when the worry is "the same value twice"; reach for a concurrency scope when the worry is "two requests at once."

## The honest trade-off

A store-wide uniqueness check is, by construction, a checkpoint every append against a constrained property has to pass through the kernel for — which sounds like exactly the kind of coupling event sourcing is supposed to let you avoid. That tension is real, and Chronicle doesn't hide it: the [consistency model](https://cratis.io/chronicle/concepts/consistency/) is explicit that the write side is consistent now while the read side stays eventual, and constraints are the tool for the narrow set of invariants that genuinely can't wait. The DCB framing is what keeps the cost bounded — a constraint indexes exactly the values it's declared on, not a whole aggregate's history, and you only pay for the invariants you actually declare.

It's also worth knowing the model-bound attribute form ships today for .NET and Elixir clients; Kotlin, Java, and TypeScript don't support it yet, though TypeScript does support the declarative `IConstraint` form. And because a uniqueness index on an email address is itself sensitive, Chronicle hashes constraint values — normalized and SHA-256'd — before they're stored in the index, so the index holds no PII and a violation message names the constraint and the offending property, never the colliding value.

## Where to start

If you're protecting a value that must stay unique across the whole store — a username, an email, a code — declare a unique property constraint on every event that can set it, under one shared name. If the invariant is really "this event happens at most once per event source," reach for a unique event type constraint instead. Start with the attribute form; drop to `IConstraint` only when a name collision, a casing rule, or a composed message forces your hand. And if what you're actually worried about is two requests racing on the same event source rather than the same value appearing twice, that's a concurrency scope, not a constraint — a different problem with a different tool. The [constraints reference](https://cratis.io/chronicle/constraints/) has the full option surface for both.
