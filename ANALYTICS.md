# FocusPact Privacy-First Telemetry Schema (ANALYTICS.md)

This document specifies all PostHog custom events tracked in FocusPact.

## Core Privacy Invariants
1. **Zero Free-Text / Zero PII**: No commitment text, names, handles, partner phone numbers, emails, excuses, or raw file data are ever captured.
2. **Safe Wrapper (`track`)**: Every event passes through a global `track(event, props)` helper that sanitizes keys, ensures ad-blocker resilience (no uncaught exceptions when blocked), and limits strings to enum values.
3. **Session Recording**: Session recording is disabled by default (`disable_session_recording: true`) with input masking (`maskAllInputs: true`, `maskTextSelector: '*'`).
4. **DOM Protection**: All user input fields and dynamic text displays carry the `ph-no-capture` class to block PostHog autocapture from reading private text.

---

## Event Catalog

| Event Name | Trigger Location (Function) | Allowed Properties Schema | Purpose |
| :--- | :--- | :--- | :--- |
| **`first_commitment_saved`** | `saveGoals()` | `{ count: number }` | Funnel-ready step indicating user created their first daily commitments. |
| **`commitments_saved`** | `saveGoals()`, `saveInlineGoals()` | `{ count: number, is_edit: boolean }` | Tracks whenever user commits to or updates their 3 daily goals. |
| **`returning_user_day2`** | `initApp()` | `{ hours_since_signup: number }` | Fired once when a user returns 24 to 72 hours after initial onboarding. |
| **`tone_selected`** | `selectTone()` | `{ tone: 'brutal' \| 'firm' \| 'gentle' }` | Accountability persona chosen by the user. |
| **`proof_uploaded`** | `processAuditImageFile()` | `{ file_type: string, file_size_kb: number }` | Telemetry on visual proof uploaded (MIME type and size in KB only). |
| **`audit_run`** | `executeVisionAudit()` | `{ goal_index: number }` | User initiated automated AI verification on a milestone. |
| **`verdict_generated`** | `renderAuditOutcome()` | `{ verified: boolean, is_unavailable: boolean }` | Result of proof inspection (indicates pass/fail/unavailable; no image content). |
| **`checkin_submitted`** | `submitCheckin()` | `{ completed_count: number, is_all_completed: boolean, has_proof: boolean, was_shielded: boolean }` | Daily evening check-in submission with discrete counts. |
| **`streak_hit`** | `submitCheckin()` | `{ streak_length: number }` | Fired when unbroken streak increments after full completion. |
| **`focus_session_completed`** | `completeSession()` | `{ duration_minutes: number, is_strict: boolean }` | Completed deep work timer session. |
| **`partner_report_sent`** | `sendPartnerWhatsApp()`, `sendPartnerSMS()`, `sendPartnerEmail()`, `copyPartnerReport()` | `{ channel: 'whatsapp' \| 'sms' \| 'email' \| 'clipboard' }` | Channel selected for dispatching accountability report. |
| **`card_shared`** | `downloadCard()`, `shareOrCopyCard()` | `{ streak_length: number, method: 'download' \| 'share_api' }` | User shared or downloaded their milestone achievement card. |
| **`verdict_failed`** | `submitCheckin()` catch | `{ reason: 'api_unavailable' }` | Diagnostic error count when upstream AI verdict call fails. |

---

## Verification & Anti-Leak Proof
- Every property in the payload is either an integer, a boolean, or an enum from the table above.
- No `posthog.identify()` is called with user names, emails, or personal identifiers.
- PostHog autocapture of text is blocked by `ph-no-capture` across all form inputs and text display containers.
