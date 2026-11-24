# Installation and device acceptance

## Icon assets

The existing navy/blue waveform mark is retained. The manifest includes PNGs at
192 and 512 pixels, a separate opaque 512-pixel maskable icon, and the SVG fallback.
The maskable mark stays within the centered 40%-radius safe circle so Android
can crop its background without cutting the symbol. An opaque 180-pixel Apple
touch icon is linked from the page. Push notifications use the 192-pixel PNG.

The root manifest ID, start URL and scope are unchanged, preserving the existing
app identity and device subscriptions. No new install/notification prompts are
triggered by loading the dashboard. Browser installation UI stays browser-managed.

To rebuild checked-in PNGs from `public/icon.svg` using the existing Playwright
dependency:

```sh
npx playwright-core install chromium
node scripts/build-icons.mjs
```

Or set CHROMIUM_PATH to an installed Chromium executable. No new package is needed.
The regular images retain the vector's rounded corners; maskable/Apple images
use the same mark with a full-bleed background. PNG changes belong in the commit.

Browser smoke reads Chromium's parsed manifest, decodes the served PNGs, verifies
dimensions and Apple linkage, and checks maskable opacity/mark safety. This is
asset/manifest verification, not a real OS installation or notification test.

## Owner device checks

The icon release is deployed as Cloudflare version
`a02d1bce-77a3-4099-a6ab-40dbf24e1488`. Hosted assets match the committed PNGs;
actual refreshed launcher/install appearance and Linux notifications are pending.

- Windows: install from Edge's app menu, launch from the installed shortcut,
  and check the icon/title and standalone window. Existing Edge test receipt and
  notification tap-to-open are verified; no re-registration is required solely
  for updated icons.
- Android: Chrome's Install/Add to Home screen flow should use the maskable icon.
  Open the installed app and verify title/icon and standalone layout. Quiet
  notification-shade receipt is successful delivery even without a banner.
  Existing Chrome test tap-to-open is verified. Existing installed apps may take
  time to update their launcher icon; do not clear site data as a prerequisite.
- Linux: use a persistent local browser/profile on the actual desktop, install
  Nanny if the browser offers it, then sign in, label/register that browser and
  send a test to that device. Put Nanny in the background and check the desktop
  notification list as well as banners. Tap the notification to open Nanny.
  Report distribution, desktop environment, browser/version, installation status,
  receipt and visible tap result. If needed, inspect the local tap diagnostic.
- On the next ordinary activity period, verify an automatic idle notification
  and its dashboard **View run on GitHub** link. All monitored repositories must
  finish; first quiet and continued quiet do not send reminders.

Linux OS notification permission, Do Not Disturb and desktop notification-daemon
behavior need a real device check. A headless CI browser does not establish them.
Vivaldi-specific engineering was closed at the owner's request after Edge and
Chrome passed; browser privacy adjustments remain owner-managed. iOS testing is
optional and has not been performed.

Reference: https://web.dev/articles/maskable-icon
