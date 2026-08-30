/**
 * RelayAudio — the four sounds, and where each one comes from.
 *
 * OWNS:      audio components, their pooling, and the spatial placement of the dissolve.
 * EXPECTS:   a host SceneObject to parent its emitters under.
 * MUST NOT:  decide WHEN anything plays. That is the caller's job, so sound stays a
 *            consequence of state changes rather than a second source of truth.
 *
 * No music. Four one-shots, three of them at the head and one of them out in the world.
 *
 * THE DISSOLVE IS THE POINT.
 * Claim, arrival and denied all describe something that happened to YOU, so they play
 * non-spatially — they have no location because they are not anywhere, they are yours.
 * The dissolve is the opposite: it reports something your PARTNER did, to a specific
 * card, at a specific place in the shared space. Playing it at that card's position is
 * what turns "it vanished" into "she took that one, over there" — you hear where they
 * are working before you look.
 */

const SFX_CLAIM: AudioTrackAsset = requireAsset("../GeneratedSFX/relay_claim.wav") as AudioTrackAsset
const SFX_DISSOLVE: AudioTrackAsset = requireAsset("../GeneratedSFX/relay_dissolve.wav") as AudioTrackAsset
const SFX_ARRIVAL: AudioTrackAsset = requireAsset("../GeneratedSFX/relay_arrival.wav") as AudioTrackAsset
const SFX_DENIED: AudioTrackAsset = requireAsset("../GeneratedSFX/relay_denied.wav") as AudioTrackAsset
const SFX_PASS: AudioTrackAsset = requireAsset("../GeneratedSFX/relay_pass.wav") as AudioTrackAsset

/** Enough voices that two partner dissolves close together do not cut each other off. */
const SPATIAL_VOICES = 3
/** The pass is positioned too, so one voice of its own is enough. */
const PASS_VOICES = 1

export class RelayAudio {
  private claim: AudioComponent | null = null
  private arrival: AudioComponent | null = null
  private denied: AudioComponent | null = null

  private spatial: AudioComponent[] = []
  private spatialNext = 0

  private pass: AudioComponent[] = []
  private passNext = 0

  /** The in-flight pass voice, and the path it is currently travelling. */
  private travelVoice: AudioComponent | null = null
  private travelFrom = vec3.zero()
  private travelTo = vec3.zero()
  private travelStartMs = 0
  private travelDurMs = 0

  private built = false

  constructor(private readonly root: SceneObject) {}

  public build(): void {
    if (this.built) return
    this.built = true

    this.claim = this.makeFlat("RelayAudioClaim", SFX_CLAIM, 1.0)
    this.arrival = this.makeFlat("RelayAudioArrival", SFX_ARRIVAL, 0.55)
    this.denied = this.makeFlat("RelayAudioDenied", SFX_DENIED, 0.8)

    for (let i = 0; i < SPATIAL_VOICES; i++) {
      this.spatial.push(this.makeSpatial("RelayAudioDissolve" + i, SFX_DISSOLVE, 1.0))
    }
    for (let i = 0; i < PASS_VOICES; i++) {
      this.pass.push(this.makeSpatial("RelayAudioPass" + i, SFX_PASS, 0.9))
    }

    this.ensureListener()
  }

  /**
   * Spatial audio needs an ear as well as a mouth.
   *
   * Without an AudioListenerComponent in the scene the engine logs
   * "Audio Listener component has to be added to your scene for spatial audio to take
   * effect" and every positioned emitter collapses to a flat, centred sound — the
   * dissolve still plays, it just stops meaning "over there", which is the only reason
   * it is spatialised at all. The listener belongs on the head, so it goes on whichever
   * SceneObject carries the Camera.
   */
  private ensureListener(): void {
    const camera = this.findCameraObject()
    if (!camera) {
      print("[RelayAudio] no Camera found — the dissolve will play without position.")
      return
    }
    const existing = camera.getComponent("Component.AudioListenerComponent")
    if (!isNull(existing)) return
    camera.createComponent("Component.AudioListenerComponent")
  }

  private findCameraObject(): SceneObject | null {
    // The Camera is a sibling root of the Relay hierarchy, not an ancestor of it, so
    // this has to sweep every root rather than walking up from our own parent chain.
    const roots = global.scene.getRootObjectsCount()
    for (let i = 0; i < roots; i++) {
      const hit = this.searchForCamera(global.scene.getRootObject(i))
      if (hit) return hit
    }
    return null
  }

  private searchForCamera(obj: SceneObject): SceneObject | null {
    if (!isNull(obj.getComponent("Component.Camera"))) return obj
    const count = obj.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const hit = this.searchForCamera(obj.getChild(i))
      if (hit) return hit
    }
    return null
  }

  /** Head-relative: no position, because these events have none. */
  private makeFlat(name: string, track: AudioTrackAsset, volume: number): AudioComponent {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)
    const audio = obj.createComponent("Component.AudioComponent") as AudioComponent
    audio.audioTrack = track
    audio.volume = volume
    return audio
  }

  /** Positioned: the emitter is moved to the event before it is played. */
  private makeSpatial(name: string, track: AudioTrackAsset, volume: number): AudioComponent {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)
    const audio = obj.createComponent("Component.AudioComponent") as AudioComponent
    audio.audioTrack = track
    audio.volume = volume
    if (audio.spatialAudio) audio.spatialAudio.enabled = true
    return audio
  }

  private fire(audio: AudioComponent | null): void {
    if (!audio) return
    if (audio.isPlaying()) audio.stop(false)
    audio.play(1)
  }

  /** You took a card. Low, short, weighted. */
  public playClaim(): void {
    this.fire(this.claim)
  }

  /** Something entered the queue. Faint enough to ignore, present enough to notice. */
  public playArrival(): void {
    this.fire(this.arrival)
  }

  /** Someone got there first. */
  public playDenied(): void {
    this.fire(this.denied)
  }

  /**
   * The card leaves you and lands with your partner — and the SOUND MAKES THE SAME TRIP.
   *
   * Placing the emitter at one end and firing it is a one-shot at a location; a sheet of
   * paper crossing a room is a source in motion. So the emitter is parked at the origin,
   * started, and then moved along the same path the card takes, frame by frame, for the
   * duration of the flight. The panning changes because the source genuinely moves, which
   * is the only way it reads as travelling rather than as a sound that happens to be
   * somewhere.
   */
  public startPassTravel(from: vec3, to: vec3, durationMs: number, nowMs: number): void {
    if (this.pass.length === 0) return
    const voice = this.pass[this.passNext]
    this.passNext = (this.passNext + 1) % this.pass.length

    this.travelVoice = voice
    this.travelFrom = from
    this.travelTo = to
    this.travelStartMs = nowMs
    this.travelDurMs = durationMs

    voice.getSceneObject().getTransform().setLocalPosition(from)
    this.fire(voice)
  }

  /** One frame of the flight. Driven from the UI's existing tick. */
  public tick(nowMs: number): void {
    if (this.travelVoice === null || this.travelDurMs <= 0) return
    const t = (nowMs - this.travelStartMs) / this.travelDurMs
    if (t >= 1) {
      this.travelVoice.getSceneObject().getTransform().setLocalPosition(this.travelTo)
      this.travelVoice = null
      return
    }
    const k = t < 0 ? 0 : t
    this.travelVoice
      .getSceneObject()
      .getTransform()
      .setLocalPosition(
        new vec3(
          this.travelFrom.x + (this.travelTo.x - this.travelFrom.x) * k,
          this.travelFrom.y + (this.travelTo.y - this.travelFrom.y) * k,
          this.travelFrom.z + (this.travelTo.z - this.travelFrom.z) * k
        )
      )
  }

  /**
   * Your partner took that card, and it was THERE. The emitter is placed at the card's
   * own position so the whisper arrives from the direction they are working in.
   */
  public playDissolveAt(localPosition: vec3): void {
    if (this.spatial.length === 0) return
    const voice = this.spatial[this.spatialNext]
    this.spatialNext = (this.spatialNext + 1) % this.spatial.length
    voice.getSceneObject().getTransform().setLocalPosition(localPosition)
    this.fire(voice)
  }
}
