"""Mock enterprise connectors — the 'sensitive workplace data' an agent reasons over.
In a real North-style system these would be live integrations (Confluence, Jira,
Google Workspace) behind a permissions layer. Here they're small, original, in-memory
corpora so the demo is self-contained and runs offline. Each document is a citable unit."""
from typing import TypedDict


class Doc(TypedDict):
    id: str
    connector: str
    title: str
    url: str
    text: str


# ── Company Wiki ──────────────────────────────────────────────────────────────
WIKI: list[Doc] = [
    {"id": "wiki-pto", "connector": "wiki", "title": "Time-Off Policy", "url": "wiki://hr/time-off",
     "text": "Full-time employees accrue 30 working days (6 weeks) of paid vacation per year. "
             "Vacation does not need to be taken in fixed blocks. Unused days roll over up to a "
             "maximum of 10 days into the next calendar year; days beyond that are forfeited on "
             "January 31. Parental leave is topped up to 100% for up to 6 months for either parent."},
    {"id": "wiki-onboard", "connector": "wiki", "title": "Engineering Onboarding", "url": "wiki://eng/onboarding",
     "text": "New engineers ship a small change to production in their first week. Access to the "
             "secure build cluster is granted via the IT request form and requires hardware-key 2FA. "
             "Because of our security posture, several popular open-source libraries are disallowed; "
             "use the internal 'kit' package for UI primitives and the 'haul' client for data fetching."},
    {"id": "wiki-deploy", "connector": "wiki", "title": "Deployment & Release Process", "url": "wiki://eng/deploy",
     "text": "Releases go out behind feature flags. Every deploy must pass the size budget check: the "
             "client bundle may not grow by more than 15 KB gzipped without a written exception, because "
             "North runs in low-resource, air-gapped customer environments. Rollback is a single flag flip."},
    {"id": "wiki-security", "connector": "wiki", "title": "Data Handling & Security", "url": "wiki://sec/data",
     "text": "Customer data never leaves the customer's environment. The frontend may not log message "
             "content to third-party analytics. Citations must link only to sources the requesting user "
             "is authorized to see; the retrieval layer enforces per-user document permissions."},
]

# ── Support Tickets ───────────────────────────────────────────────────────────
TICKETS: list[Doc] = [
    {"id": "tic-4821", "connector": "tickets", "title": "TIC-4821: Citations occasionally point to wrong span",
     "url": "tickets://TIC-4821",
     "text": "Status: Resolved. Customer reported that for long answers, a citation highlighted the wrong "
             "sentence. Root cause: token offsets were computed on the pre-markdown string but applied to "
             "the rendered string. Fix: compute citation offsets against the same plain-text the model saw."},
    {"id": "tic-5093", "connector": "tickets", "title": "TIC-5093: Streaming stalls on slow connections",
     "url": "tickets://TIC-5093",
     "text": "Status: In Progress. On 3G-class links the message list janks while streaming. Mitigation: "
             "virtualize the message list and batch token flushes to one paint per animation frame."},
    {"id": "tic-5110", "connector": "tickets", "title": "TIC-5110: Agent calls a connector the user can't access",
     "url": "tickets://TIC-5110",
     "text": "Status: Open, High priority. The agent occasionally retrieves from a connector the user is not "
             "permitted to read. Required fix: filter tool results by permission BEFORE they reach the model, "
             "not after — never let unauthorized text enter the prompt."},
]

# ── Team Calendar ─────────────────────────────────────────────────────────────
CALENDAR: list[Doc] = [
    {"id": "cal-standup", "connector": "calendar", "title": "Agentic Platform — Daily Standup",
     "url": "calendar://event/standup",
     "text": "Recurring 9:30am. Format: yesterday / today / blockers, kept under 10 minutes. Design review "
             "happens Tuesdays; releases are cut on Thursdays so issues are caught before the weekend."},
    {"id": "cal-review", "connector": "calendar", "title": "North UX Review — Citations Redesign",
     "url": "calendar://event/ux-review",
     "text": "Goal: decide whether citations render inline as numbered chips or as a side panel. Decision: "
             "inline chips that expand on hover, with a 'sources' drawer for the full list, because inline "
             "keeps the claim and its evidence visually connected — better trust, less context-switching."},
]

CONNECTORS = {
    "wiki": {"label": "Company Wiki", "icon": "book", "docs": WIKI},
    "tickets": {"label": "Support Tickets", "icon": "ticket", "docs": TICKETS},
    "calendar": {"label": "Team Calendar", "icon": "calendar", "docs": CALENDAR},
}

ALL_DOCS: list[Doc] = [d for c in CONNECTORS.values() for d in c["docs"]]


def docs_for(connector: str | None) -> list[Doc]:
    if connector is None or connector == "all":
        return ALL_DOCS
    return CONNECTORS.get(connector, {}).get("docs", [])
