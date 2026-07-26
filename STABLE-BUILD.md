# Arena Commander Stable Build v63.0

This cleanup replaces the stacked v61-v62.8 browser JavaScript fixes with permanent files:

- `public/arena-commander-runtime.js` — playmat, full artwork, Leave Match, automation, touch movement and page stability
- `public/arena-commander-multiplayer.js` — six-player focus bar, opponent selection, overview and combat navigation
- `public/arena-commander-mobile.js` — collapsible hand and one-screen mobile board controls
- `public/arena-commander-ui.css` — one permanent stylesheet entrypoint preserving the tested visual order

The separate server rules engines remain because they are real gameplay systems rather than temporary browser patches.

The older browser JavaScript fix files were removed after their behavior was consolidated. The older CSS source layers remain behind one imported stylesheet for now so the visual behavior stays identical during testing. They can be merged into one physical CSS file later after the v63 table passes mobile testing.

Deploy using Render **Clear build cache & deploy**, then close old browser/app tabs once so the v63 service worker takes control.
