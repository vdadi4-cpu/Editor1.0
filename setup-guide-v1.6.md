# Editor v1.6 – what changed and what to do

## Install
1. Replace `index.html` and `server.js` in the repo (`setup.js` unchanged), commit. GitHub Actions builds the APK; install it over v1.5. The server only changed its version label, so a Render redeploy is optional.

## What's new: adjust every photo in a Collage frame
Open **Collage → Shapes & frames ✨**, add your photos, then tap **✋ Adjust & swap photos (full screen)**. A large editor opens (the small panel was too short to work in accurately).
- **Tap a box** to select it (it gets a blue outline).
- **Drag** to move the photo inside that box.
- **Pinch** with two fingers, use the **Zoom slider** (30% to 400%), or **Ctrl + scroll / touchpad pinch** on the web to zoom only that box's photo. Below 100% the whole photo shrinks so you can fit a whole group; the empty edge is filled with a soft blurred copy of the same photo.
- **Fit whole photo** zooms out so the entire picture is visible in the box. **Fill box** goes back to filling it. **Reset box** clears that box.
- **Swap with another box**: select a box, tap Swap, tap the second box. The photos swap together with their zoom and position.
- **Photo in this box**: a strip of your photos. Tap one to put it in the selected box. If it was in another box the two boxes swap, so no photo gets lost.
- Tap **Done**, then **Add to start / here / end** as before. The picture that is added uses exactly what you arranged.
- Changing the frame, box shape, format, number of boxes, Shuffle or Clear starts the arrangement again.
- The **Layouts** mode of Collage already puts each photo on its own layer, so you can move and zoom those on the timeline as before.

## Tested / not tested
Tested in a desktop browser engine: select, zoom, drag, swap, photo choice, fit, reset, Ctrl+scroll and two-finger pinch (simulated pointer events) on mask frames (Heart, Star) and cell frames (Honeycomb), the exported picture using the adjustments, plus the full earlier regression. Not tested: real fingers on a phone. If dragging feels too sensitive or slow on your phone, tell me and I will tune it.

## Update (same v1.6): Layer order for overlays
- Select an overlay, open **Transform** (or **Layers**) and use the new **Layer order** card:
  - **⬆ Bring forward / ⬇ Send backward** change the order between overlays that are on screen at the same time.
  - **Send behind main video / Bring in front of main video** puts the overlay behind or in front of the main layer (the collage). Behind the main video it only shows through transparent parts of the main layer.
- In **Collage → Shapes & frames** there is a new **Transparent** button next to Background. The collage is then added as a transparent PNG, so an overlay sent behind it shows through the empty parts (a photo or video behind the heart, for example).
- Preview and Export use the same order. Undo works for each change. Mobile and web behave the same.
