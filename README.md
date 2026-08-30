# Relay

**Two people share one spatial work queue. Claiming a card transfers ownership, so it
vanishes from your partner's view the moment you take it.**

Built for Snap Spectacles in Lens Studio.

- **Demo video:** https://drive.google.com/file/d/1Uz2kg321gxzQwrwnZdW2tuxV92j8ipGf/view?usp=sharing
- **Companion sender page:** `https://havalz.github.io/relay/web/` (runs locally from
  [`web/index.html`](web/index.html) with no server)

---

## What it connects

Relay is a Connect project in three literal senses.

**It connects people.** Two people wearing Spectacles join one colocated session and
see the same board. Not a shared screen — a shared *space*. When your partner takes a
card, it dissolves from your view with a whisper played at the position it occupied,
so you hear where they are working before you look. Presence, the queue counter and
each person's local clock sit in the header: two people, two places, one board.

**It connects platforms.** The queue is a real Supabase Postgres table, not a fixture.
A third person — support, a manager, whoever is fielding the work — opens a companion
web page, composes an item, sets its priority, and it appears on both headsets within
three seconds. The web page also reads the board back, so the sender watches items get
claimed in real time.

**It connects an everyday workflow.** Triaging a shared queue is ordinary, unglamorous
work that two people currently do by talking over each other in Slack. Relay is that
workflow, in space, where "who has what" is answered by looking rather than asking.

---

## The spatial encoding

The central thesis: **the space carries the data.** A list needs columns and labels to
tell you what matters. A room does not.

| Axis | Meaning | How it reads |
|---|---|---|
| **Height** | urgency | urgent floats high, calm settles low |
| **Distance** | age | the longer something waits, the closer it comes |
| **Colour** | ownership | mineral = unclaimed, jade = yours, lilac = your partner's |

Cards sit on a shallow arc so that the two encoded axes stay independent — the slot
angle only spreads cards apart, it carries no data. Age is normalised on a **log**
scale, because queue ages are heavy-tailed: four items minutes old next to one a day
old is normal, and a linear axis lets the stale item own the whole range and flatten
everything else.

Claimed cards drop into a lane of their own, below and in front of the arc, separated
by construction rather than by tuning: the arc has a hard floor at −10.77°, the lane's
highest edge sits at −12.88°, and that 2.11° gap holds in every arc state and at every
lane count from one card to five.

---

## How it's built

| Piece | What it does |
|---|---|
| **CLAD + Claude Code** | the whole build, agent-driven — see [`CLAD_PROMPT_LOG.md`](CLAD_PROMPT_LOG.md) |
| **Spectacles Sync Kit** | colocated two-user session, host election, event transport |
| **Spectacles Interaction Kit / UI Kit** | pinch targeting, drag-to-pass, the glass plates |
| **Supabase** | the live queue (`work_items`), read and written by both the lens and the web page |
| **Gemini via Remote Service Gateway** | triage (priority + an eight-word summary) and on-demand translation into 6 languages |
| **`web/index.html`** | the sender's control panel — no build step, no dependencies |

Sounds are generated procedurally (`tempAssetGen/gen_sfx_relay.js`); the card slabs and
the pass ribbon are real meshes with hand-authored shader graphs.

---

## Five engineering decisions

**1. Host authority is a structural property, not a lock.**
Exactly one client owns the store (`syncEntity.doIOwnStore()`), and every claim is a
*request* to that client. The arbiter decides and broadcasts the outcome — including to
the loser, who sees an explicit "claimed by partner" rather than a card that silently
fails to move. A double-claim is not prevented by timing or a mutex; it is impossible
because only one machine is ever entitled to decide.

**2. Gemini triage is batched, lazy and idempotent.**
The whole queue is triaged in one request rather than one request per item, only on the
host, and only for items that arrive without a priority or summary. Translation is
lazier still: nothing is translated until somebody actually picks a language, then the
whole queue is filled in a single call and cached in the row. An item that arrives with
a hand-written summary skips the model entirely — which is exactly how the web page's
"write my own" toggle works.

**3. Claiming does not transfer a SyncEntity.**
The obvious implementation is to move ownership of a synced object to the claimer. We
refused it. Ownership lives in the `work_items` row as data, and the sync layer only
carries *events*. That keeps the database the single source of truth, survives a client
dropping mid-claim, and means the board reconstructs correctly from a cold fetch —
whereas transferred entity ownership would have been state that exists only in the
session and dies with it.

**4. Views are pooled, never destroyed.**
Destroying card SceneObjects poisoned SIK's interactable cache and killed targeting for
the entire client after the first claim. Cards are now recycled through a pool, and a
view returning to the pool is fully scrubbed — every field reset, every animation
cleared — so a recycled object can never render stale content, not even for one frame.
`relay-claim-three` exists specifically to guard this: three consecutive claims is the
shape that caught the original bug.

**5. Colour encodes ownership and nothing else.**
No hue is ever spent on status, source, urgency or which headset you happen to be
wearing. Both people see a card in the *same* colour — jade means "the local user owns
this" on both screens, which is what makes ownership legible at a glance instead of
something you have to decode per-pane. Urgency uses height and brightness; the per-pane
difference is ambient light in the room, not the cards.

---

## Test coverage (LEAF)

LEAF scenarios live in [`Assets/Scripts/Leaf/`](Assets/Scripts/Leaf/) and run inside
the lens.

| Scenario | Status | Notes |
|---|---|---|
| `relay-queue-renders` | ✅ **passing** | asserts the header says *live from Supabase*, that 1–5 cards reached the arc, and that every headline is non-empty |
| `relay-language-chip` | ✅ **passing** | dropdown opens, every row is enabled and clear of the chip's hit volume, English selects, the list collapses again |
| `relay-claim-three` | ✅ **passing** | three consecutive claims; guards the pooling regression; asserts lane scale |
| `relay-empty-state` | ✅ **passing** | zero open rows produce a real empty state, and the local fallback dataset is *not* substituted |

All four pass — but not in a single run, and the reason is worth stating plainly.

**`relay-empty-state` requires the opposite precondition to the other three.** It asserts
against a queue where every row is non-open, and its own docstring says so: *"against a
populated queue it will fail, and that failure is correct — it means the precondition was
not met."* The Lens cannot empty its own queue, so the database state is arranged from
outside:

```sql
-- for relay-queue-renders / relay-language-chip / relay-claim-three
update work_items set status='open', claimed_by=null;
-- for relay-empty-state
update work_items set status='claimed' where status='open';
```

**`relay-claim-three` is a single-client scenario.** Both preview panes run the suite
simultaneously, and both reach for the same top card; the host grants one and denies the
other, which is host arbitration working correctly, but it means the losing pane's
assertion fails. It passes on the pane that wins. Run it against one pane for a clean
result.

### What LEAF cannot cover, and why

**LEAF runs inside a single lens instance.** It can drive one client's hands and read
one client's scene. It cannot observe the other headset. So every genuinely two-user
behaviour is verified **manually**, across two preview panes:

| Behaviour | Verification |
|---|---|
| A claim on pane A removes the card from pane B | manual, two panes |
| Direct pass — drag a card to your partner | manual; the harness cannot deliver SIK `onDragEnd` |
| Pass direction mirrors correctly from both panes | manual, sent in both directions |
| Spatial dissolve audio at the partner's card position | manual, by ear |
| Web page submit → both panes within 3 s | manual, verified end-to-end |
| The language dropdown's hover-revealed labels | manual; the synthetic hand is blocked by an interaction plane |

The local half of "a claim removes it from the partner's view" — the card leaving *this*
arc and landing in *this* lane — is automated. The partner's half is not observable
from inside one lens instance and stays a manual check.

---

## Security

**The Supabase key in this repo is the publishable key, and it is public by design.**

Supabase publishable keys are meant to ship in client code. What actually restricts
access is enforced in the database:

- **Row Level Security** — `SELECT` is open; `INSERT` is admitted only with
  `status = 'open'`; `UPDATE` is policy-gated.
- **Column-level grants** — anon may `INSERT` only `(source, title, body)` and `UPDATE`
  only `(priority, summary, status, claimed_by, translations)`. Nothing else is
  writable.

That grant split is why the web page submits in two requests — insert the columns it
may insert, then patch priority and summary — rather than one. It needs no permission
the project did not already have.

The `service_role` key appears nowhere in this repository, and neither do database
passwords or model API keys. Gemini is reached through Remote Service Gateway, which
holds its own credentials outside the project.

---

## Running it

1. Open `Relay.esproj` in Lens Studio (5.23+, SPECS 27).
2. Point `RELAY_SUPABASE_URL` and `RELAY_SUPABASE_PUBLISHABLE_KEY` in
   `Assets/Scripts/RelayConfig.ts` at your own Supabase project, with a `work_items`
   table and the grants above. The same two values are set at the top of the
   `<script>` block in `web/index.html`.
3. Generate Remote Service Gateway tokens (**Window → Remote Service Gateway Token**)
   for Gemini triage and translation. The token fields ship blank on purpose.
4. Open two preview panes and start **Multiplayer** in each.
5. Open `web/index.html` in a browser to send work to the board.

Without Supabase configured the lens falls back to local sample data and says so in the
header — it never pretends a fixture is a live queue.
