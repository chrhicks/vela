# Alerts

Shows what the server's alert monitor reports for a rig: a banner under the navigation on every
page, and an Alerts card on the rig page. The server owns what is wrong, when it was raised,
whether it was acknowledged and how the phone is getting on; the browser only presents it. See
`apps/server/src/alerts/README.md` for the rules and episodes.

- One `AlertsProvider` in the Shell polls `GET /api/web/rigs/:rigId/alerts` every second for the
  banner and the card. The rig is the route's rig; on pages without one (Home, Explore) it is the
  rig whose capture the navigation follows.
- The provider is mounted once above the routes and keeps each rig's last view for the life of the
  page, so switching pages during an outage cannot drop a known alert. A rig that is no longer
  polled is marked interrupted until a fresh read lands. The poll loop belongs to its effect: one
  loop per rig even when React sets the effect up twice.
- A quiet rig shows no banner. If the poll fails after the server had been watching or showing
  alerts, the banner says the checks are interrupted and keeps the last view, with Acknowledge
  disabled, so silence never reads as safe.
- Acknowledge is not claimed early. The server marks an alert acknowledged only once the phone has
  stopped repeating, so a 502 leaves it unacknowledged and the banner says why.
- The banner mentions the phone only when an emergency is repeating or an alert is not getting
  through. Every alert's `delivery` state is on the card.
- The card's Send test is disabled while no Pushover keys are configured, because the server would
  refuse it.
- The phone alerts switch is `PhoneAlertsSwitch`: "Phone alerts: on" or "off" beside a Turn off / Turn on
  button. It sits on the card always, and on the banner only while phone alerts are off, so a quiet capture
  page still says Chris will not be paged and offers the way back. It is hidden while no Pushover keys are
  set up, and disabled while the view is stale. The control PUTs `{ on }` to
  `/api/rigs/:rigId/alerts/phone` and shows the view the server answers with. Alerts stay in the banner
  while it is off, with delivery "Not sent · phone alerts are off". Send test is disabled while off.
