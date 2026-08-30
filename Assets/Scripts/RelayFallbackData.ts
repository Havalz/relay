/**
 * RelayFallbackData — the local dataset that keeps Relay alive when the network doesn't.
 *
 * OWNS:      8 hardcoded work items with the IDENTICAL shape to a Supabase row
 *            (all 9 columns, including translations jsonb and created_at).
 * EXPECTS:   nothing.
 * MUST NOT:  diverge in shape from WorkItem. Downstream code must not be able to
 *            tell a fallback item from a fetched one — no marker fields, no nulls
 *            that a real row would not have.
 *
 * created_at is computed relative to load time so the age axis of the spatial
 * encoding stays meaningful forever instead of decaying into "everything is old".
 * Priorities and ages are deliberately varied so height and distance are both
 * visibly exercised when running offline.
 */

import {WorkItem} from "./RelayWorkItem"

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString()
}

/**
 * Built once at module load. Same array identity every call, so repeated fallbacks
 * inside a session produce a stable scene rather than drifting ages.
 */
export const RELAY_FALLBACK_ITEMS: WorkItem[] = [
  {
    id: "fallback-0001-4a7c-9e21-000000000001",
    source: "github",
    title: "Waveguide shader clips at grazing angles",
    body: "Edge highlight disappears when the card is viewed from more than ~60 degrees off axis. Suspect the border derivative term.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 5,
    summary: "Edge highlight vanishes past sixty degrees off-axis",
    translations: {ar: "تلاشي حواف البطاقة عند الزوايا الحادة", ku: "Qerta kartê di goşeyên tûj de winda dibe"},
    hasPriority: true,
    created_at: minutesAgo(2870)
  },
  {
    id: "fallback-0002-4a7c-9e21-000000000002",
    source: "linear",
    title: "Session rejoin drops queue state",
    body: "Second pane occasionally joins before the host has broadcast, leaving an empty deck until the next write.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 5,
    summary: "Guest joins before host broadcasts, deck empty",
    translations: {ar: "فقدان حالة الطابور عند إعادة الانضمام", ku: "Rewşa rêzê di tevlîbûna nû de winda dibe"},
    hasPriority: true,
    created_at: minutesAgo(640)
  },
  {
    id: "fallback-0003-4a7c-9e21-000000000003",
    source: "email",
    title: "Warehouse partner needs updated pick sheet",
    body: "Rotterdam asked for the revised layout before Thursday's container.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 4,
    summary: "Partner blocked without a refreshed pick sheet",
    translations: {ar: "المستودع يطلب ورقة انتقاء محدثة", ku: "Embar pêdiviya bi lîsteya nû ya hilbijartinê heye"},
    hasPriority: true,
    created_at: minutesAgo(4210)
  },
  {
    id: "fallback-0004-4a7c-9e21-000000000004",
    source: "github",
    title: "Cap hand-position sync at 10 Hz",
    body: "Hover broadcast is currently unthrottled and trips the flood disconnect on slow links.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 4,
    summary: "Hand sync exceeds ten hertz, risks disconnect",
    translations: {ar: "تحديد مزامنة اليد عند 10 هرتز", ku: "Hevdemkirina destan li 10 Hz sînordar bike"},
    hasPriority: true,
    created_at: minutesAgo(95)
  },
  {
    id: "fallback-0005-4a7c-9e21-000000000005",
    source: "slack",
    title: "Confirm Kurmancî strings with reviewer",
    body: "Two of the queue labels need a native pass before we ship the translation layer.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 3,
    summary: "Kurmancî strings need native reviewer sign-off",
    translations: {ar: "تأكيد النصوص الكردية مع المراجع", ku: "Bi nirxênerê re nivîsên kurmancî piştrast bike"},
    hasPriority: true,
    created_at: minutesAgo(1580)
  },
  {
    id: "fallback-0006-4a7c-9e21-000000000006",
    source: "linear",
    title: "Card fill reads too bright in daylight",
    body: "Fifteen percent is right indoors; outdoors the plate washes into the sky.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 3,
    summary: "Card fill too bright in direct daylight",
    translations: {ar: "تعبئة البطاقة ساطعة جدا في النهار", ku: "Tijîkirina kartê di ronahiya rojê de pir geş e"},
    hasPriority: true,
    created_at: minutesAgo(310)
  },
  {
    id: "fallback-0007-4a7c-9e21-000000000007",
    source: "email",
    title: "Invoice 2291 awaiting counter-signature",
    body: "Finance will chase on Monday if it is still unsigned.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 2,
    summary: "Invoice waiting on counter-signature, no deadline",
    translations: {ar: "الفاتورة 2291 بانتظار التوقيع المقابل", ku: "Fatûra 2291 li benda îmzeya dijber e"},
    hasPriority: true,
    created_at: minutesAgo(7360)
  },
  {
    id: "fallback-0008-4a7c-9e21-000000000008",
    source: "slack",
    title: "Archive the old prototype recordings",
    body: "Roughly forty gigabytes of screen captures from the first spatial pass.",
    status: "open",
    claimed_by: null,
    claimed_conn: null,
    priority: 1,
    summary: "Old prototype recordings can be archived anytime",
    translations: {ar: "أرشفة تسجيلات النموذج القديم", ku: "Tomarên prototîpa kevn arşîv bike"},
    hasPriority: true,
    created_at: minutesAgo(45)
  }
]
