# Notification tap investigation

Automatic idle delivery is verified on Windows 11 and Android 17 Vivaldi.
Both devices still opened nothing after the first app-first click fix was
deployed. The cause is not yet confirmed. The second candidate fix and local
diagnostics (tap-v2) are deployed after successful main CI. Actual-device
retesting remains pending.

The handler now calls same-origin openWindow directly during the notification
tap, before any awaited enumeration/storage/navigation. It avoids an additional
focus call after successful opening. If opening rejects, it tries existing app
windows, focusing before navigating. Null browser results are not called success.
This preserves the initial user gesture where possible; it does not prove a
Vivaldi-specific bug has been resolved.

After deployment, reload Nanny on each device. In owner Settings, use **Check
notification taps** to confirm handler **tap-v2** is active. Send a fresh test,
tap the notification body, manually reopen Settings if needed, and check again.
Report each device's handler version, last-tap time and fixed outcome/error.
An old handler that cannot respond gives a bounded timeout message.

- No tap recorded: the event may not have reached this worker, or local storage
  may be unavailable. It does not by itself prove the browser ignored the tap.
- Opened: the browser returned a window; actual visible opening still needs
  owner confirmation.
- No app window: the browser resolved without a WindowClient; opening is unconfirmed.
- Blocked: opening rejected; a fixed error name can identify activation/permission issues.
- Focused/navigated: the existing-window fallback reached those stages.

One local Cache Storage entry holds only handler version, latest tap time,
fixed outcome and allowlisted error name. The worker can read it after restart.
No payload, run URL, endpoint, subscription keys, stack trace or raw exception
is stored. Nothing is uploaded or used to change monitoring or notifications.
Storage failure cannot block navigation. Clearing site data removes the record
and can also remove browser registrations; it is not a troubleshooting prerequisite.

Runtime-independent tests assert the open request happens synchronously, fallback
focus precedes navigation, rejected/null/disappearing-window behavior, storage
failure, restart persistence and safe URL handling. Browser smoke checks the
actual worker message channel and owner diagnostic display. Actual OS notification
taps remain an owner acceptance check.

API reference: https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow
