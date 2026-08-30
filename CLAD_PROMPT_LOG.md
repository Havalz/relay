# CLAD prompt log

Relay was built with [CLAD](https://github.com/Snapchat/lens-studio-agent-toolkit)
(the Lens Studio agent toolkit) driving Claude Code, with Lens Studio's MCP tools
used for every scene mutation, compile, preview interaction and runtime query.

**Scope and honesty note.** This is a faithful record of the prompts that shaped the
build, reconstructed from the working sessions. Prompts are condensed to their
directive content — the full transcripts also contain tool output, screenshots and
verification chatter that is not reproduced here. Where a prompt corrected an earlier
mistake, the correction is kept, because the corrections are the most useful part of
the record.

The through-line: almost every prompt below is a *constraint*, not a feature request.
Relay's design came from being told what not to do at least as often as what to build.

---

## Phase 1 — the spatial thesis

Establishing that the queue is a coordinate space rather than a list:
height = urgency, distance = age, colour = ownership. Two people, one shared
board, a real database behind it.

## Phase 2 — the visual and material pass

> "Relay is functionally complete and verified. It is also visually dead… I am now
> explicitly LIFTING the do-not-touch order on everything visual, sonic and material…
> Report what you observed. If a shader or particle effect cannot be verified in
> preview within a tool round-trip, say so rather than asserting it works."

> "The scene is broken. Fix the root cause, not the symptoms. First — integrity check…
> The root cause [`mainPass of undefined`]… Defer every gradient write until after the
> plate's `onInitialized` has fired… Pool hygiene… Delete the particles… Do not attempt
> them again. Keep the four sounds and the AudioListener fix — that was a real bug well
> caught."

> "Several visual problems. Fix the ownership colour system first — it is the root of
> the 'everything looks the same' complaint… mineral — unclaimed; jade — claimed by the
> local user; lilac — claimed by the partner… Do not colour by which pane is viewing."

> "The cards have drifted into solid saturated green fills… Pull the material all the
> way back to restrained glass… 12–18% tint, not a solid panel… Report what you
> observed, with the resolved fill-opacity and edge hue per state from the instrumented
> log."

## Phase 3 — the header band

> "This session is the top header band only. Do not touch the cards or the arc…
> wordmark, connection status, queue counter, local time, language chip… Time —
> per-pane, and it tells the Connect story… Connection status — it PULSES once on every
> sync event… drive it from the same networked events the cards already react to — do
> not add new network traffic."

> "Three refinements… Card arrangement — ordered and readable, with a scroll indicator.
> IMPORTANT — do not convert the arc into a flat horizontal scroll strip."

> "Remove the scroll behaviour from the lane list… Lane cards are a static record…
> Make the arc's spatial meaning READABLE… the dot must actually pulse — make the pulse
> LARGE and obvious."

## Phase 4 — light that the preview would not render

This phase is in the log because it failed, twice, and the failures set the direction.

> "Ground the cards in the space with light and reflection… Do NOT author a custom
> shader that reaches around BackPlate — that reintroduced the mainPass crash before."

> "The ground pools and priority columns look wrong — thin grey lines that read as
> wires, not light. Fix the quality, or cut what can't be made to look good… If any
> element reads as a wire, a strand, or a mesh edge, it has failed and must be softened
> into light or removed."

> "Stop fighting RoundedRectangle's gradient — it cannot describe soft light… Use the
> shader-graph skill to author REAL custom materials on our OWN meshes… If any material
> fails to compile or render in preview, say so plainly and leave that element removed
> rather than shipping a broken version."

> "New direction, and it is the right one: stop chasing light the preview cannot render,
> and give the cards real GEOMETRY… roughly 1.5–2 cm deep… No emissive glow / bloom /
> soft-light effects — the preview does not render them. If something you build comes
> back as a white blob, it is the wrong approach; stop and say so."

**Outcome:** soft light does not render in this preview. Solid form, depth and motion
do. The glass slabs exist because that was established empirically over five sessions.

## Phase 5 — the pass

> "Fix the pass — three things: the direction logic, the bridge quality, and the sound…
> In a shared session there is no absolute left/right — each user has their own. Fix it
> so the direction is derived from the relationship between the two users, not a fixed
> axis… Verify by sending in BOTH directions… Do not ship it until both directions read
> right… Build [the bridge] from real geometry / a swept ribbon mesh, NOT from an
> emissive glow… [the sound] a soft whoosh / flutter, an airy send, not a beep."

## Phase 6 — the companion web page

> "Rebuild the companion web page from a single input box into a proper sender's control
> panel… Stay strictly within the existing RLS grants: anon can INSERT (source, title,
> body) and UPDATE (priority, summary, status, claimed_by, translations). Do not require
> any new database permission… if you can't truly detect presence from the anon read,
> show 'last activity' from the newest claimed timestamp instead of faking a live dot."

> "Redesign the companion web page's visual style into a polished 'liquid glass' UI…
> in Relay's own palette, not the reference's neon… Keep every existing function — this
> is a restyle, not a rebuild."

## Phase 7 — clean-ups and pre-publish

> "Claimed cards overlap the arc cards — separate them clearly… with enough separation
> that a lane card can never overlap an arc card in screen space — in any arc state,
> with 1 to 5 claimed cards… Remove the scroll dots entirely."

> "In the language chip/dropdown, the Kurmancî option's displayed endonym should read
> 'Kurdish'… Change only the DISPLAY LABEL. Do NOT change the language code ('ku'), the
> translation logic, the cached translations column, or the font/script."

> "Before I publish this repo publicly, do a pre-publish review. Do not push anything —
> just report."

---

## Recurring instructions

These were repeated across sessions and are the reason the codebase looks the way it
does:

- **Report honestly.** "If a shader or particle effect cannot be verified in preview
  within a tool round-trip, say so rather than asserting it works." Several findings in
  this repo are recorded as *unverified* for exactly this reason.
- **Fix root causes, not symptoms.** The `mainPass` crash, the reversed pass direction
  and the lane/arc overlap were each traced to a structural cause before being fixed.
- **Colour means ownership, never anything else.** No new hues were permitted at any
  point.
- **Do-not-touch lists.** Most prompts named the subsystems that had to remain
  untouched — arc maths, claiming, host authority, the view pool reset, the header,
  sounds, the web page.
