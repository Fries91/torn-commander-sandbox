# Arena Commander Stable Build v63.0

This cleanup replaces the stacked v61-v62.8 browser JavaScript fixes with permanent files:

- `public/arena-commander-runtime.js` — pre-app gameplay, artwork, board, priority and stability hooks
- `public/arena-commander-mobile.js` — post-app collapsible hand and one-screen opponent controls
- `public/arena-commander-ui.css` — permanent stylesheet entrypoint that preserves the existing CSS order

The separate rules engines remain in place because they are real gameplay systems, not temporary patches.

The older browser JavaScript fix files were removed after their code was consolidated. The older CSS layers remain as internal imported styles for now so the visual behavior stays identical during testing.

Deploy using Render **Clear build cache & deploy**, then close old browser/app tabs once so the v63 service worker takes control.
