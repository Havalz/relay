# Relay

**A shared spatial work queue for two people on Specs.**
CLAD Summer Hackathon · Week 3 · *Connect*

Relay hangs one work queue in the air between two people wearing Specs. Claiming a card transfers ownership — it lifts into your lane and dissolves from your partner's view, so the board answers "who has what" without either of you asking. It's spatial because the queue's two most important facts are positions rather than fields: urgent work floats higher, and the longer something waits the closer it drifts toward you.

---

## What it is

A list tells you what exists. Relay tells you **what's urgent, what's been ignored, and whose it is** — through where a card hangs and what colour it is, so a glance does the work of a status meeting.

- **Claim a card** — pinch it. One client arbitrates every claim, so two people reaching for the same card can never both win.
- **Ownership transfers** — it settles into your lane in jade and dissolves from your partner's view, with a whisper played at the position it left, so you hear where they're working before you look.
- **Pass it across** — drag a card out of your lane and it travels the space between you along a swept ribbon, arriving on their side facing them.
- **Read it in your own language** — six languages, translated on demand by Gemini and cached in the row, so you both read one queue in two scripts.
- **Send work from anywhere** — a companion web page composes an item and sets its priority; it reaches both headsets within three seconds.

## Interaction & feel

The whole lens runs on one input — the SIK pinch — with a drag for the pass, so there is nothing to learn. Sound carries what vision can't: claims land with the weight of a lifted stone, and a partner's dissolve plays *spatially*, at the card's own position, which turns "it vanished" into "she took that one, over there". Cards are real slabs with 1.8 cm of depth and a tinted-glass surface, and colour is spent on exactly one thing — mineral for unclaimed, jade for yours, lilac for your partner's, identical on both screens.

## Why it fits *Connect*

The theme asks for experiences that connect people, platforms, or everyday workflows. Relay does all three at once: two people in one colocated session sharing a single board, a real Supabase queue with a companion web page feeding it from outside the headset, and the most ordinary shared workflow there is — triaging a queue that two people are working at the same time. It replaces the "who's taking this?" message with a card that visibly leaves your partner's hands.

## Built with CLAD

Relay was built end to end with CLAD — scene, scripts, shaders, meshes, procedural audio and the web page were generated and iterated through AI-assisted development, then verified in the Lens Studio preview. The full prompt-by-prompt account, including the design reversals and the two visual approaches that were cut on evidence, is in [`CLAD_PROMPT_LOG.md`](./CLAD_PROMPT_LOG.md).

A few things worth calling out:
- **Host authority as a structural property** — one client owns the store and decides every claim, so a double-claim isn't prevented by timing, it's impossible. Ownership lives in the database row, never in a transferred SyncEntity, so the board survives a client dropping mid-claim.
- **Batched, lazy Gemini triage** — the whole queue is triaged in one call on the host, and nothing is translated until someone picks a language. An item that arrives with a hand-written summary skips the model entirely.
- **Views are pooled, never destroyed** — destroying card objects poisoned SIK's interactable cache and killed targeting after the first claim. Recycled views are fully scrubbed, so a pooled card can't render stale content for even one frame.
- **Regression-tested with LEAF** — ✅ `relay-queue-renders`, `relay-claim-three`, `relay-language-chip` and `relay-empty-state` all pass, run as two passes: `relay-empty-state` needs an emptied queue where the other three need it populated, and `relay-claim-three` is single-client, so run it against one pane for a clean result. ⚠️ Everything genuinely two-user — a claim clearing the partner's board, the pass, the spatial audio — is verified by hand, because LEAF runs inside a single lens instance and can't observe the other headset.

## Tech

Snap Specs · Lens Studio · CLAD · Spectacles Sync Kit · Spectacles Interaction Kit · Gemini via Remote Service Gateway · Supabase · TypeScript

## Demo

📹 **[Demo video](https://drive.google.com/file/d/1Uz2kg321gxzQwrwnZdW2tuxV92j8ipGf/view?usp=sharing)**

🌐 **[Companion sender page](https://havalz.github.io/relay/web/)**

## Notes for running locally

This is a Specs project reviewed in the Lens Studio preview, with two panes open and Multiplayer started in each. The Remote Service Gateway tokens in `Assets/Scene.scene` are intentionally blank — RSG tokens are tied to an individual Snap account, so to run live triage and translation you'll generate your own via *Window → Remote Service Gateway Token* and paste them into the `RemoteServiceGatewayCredentials` object. Without them the queue still renders; only the AI summaries and translations are unavailable.

The Supabase key in this repo is the **publishable** key, and it is public by design — Supabase publishable keys are meant to ship in client code, and access is enforced in the database instead. Row Level Security admits inserts only with `status = 'open'`, and column-level grants let anonymous callers write just `(source, title, body)` on insert and `(priority, summary, status, claimed_by, translations)` on update. The `service_role` key is not in this repository, and neither are database passwords or model keys.

Generated Lens Studio caches, the debug signing key and local editor configuration are intentionally excluded from this repository.
