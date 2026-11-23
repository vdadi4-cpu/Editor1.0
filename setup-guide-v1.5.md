# Editor v1.5 – what changed and what to do

## Install
1. Replace `index.html` and `server.js` in the repo (`setup.js` unchanged), commit. GitHub Actions builds the APK; install it over v1.4.
2. **Redeploy Render** (the server has the new plan and the OTP-free account). Nothing new to add in Environment.

## What's new
1. **Web only: pinch / Ctrl+scroll on a touchpad zooms the selected layer only.** Select the main clip, an overlay or a text, then pinch on the touchpad. Only that layer gets bigger or smaller (10% to 500%); the page itself no longer zooms. If the layer has keyframes, all of its keyframes scale together so the animation keeps its shape. One pinch = one Undo step. If nothing is selected, the browser behaves as before. Plain two-finger scrolling is untouched. **The Android app is not changed** (the feature is switched off when running inside the app).
2. **Resize of overlay vs main:** I could not reproduce "the main layer changes but the overlay stays" in my test; the size slider and the new pinch both act on whichever layer is shown as selected ("Editing: Overlay · name" above the controls). If it still happens, tell me the exact steps (which tab, whether the overlay has keyframes) and I will fix that path.
3. **Account `Vasukgp856@gmail.com` / `Test@123`:** no OTP at sign-up or login. It gets **no free Pro and no tester powers**: you pay through real Razorpay to unlock Pro, as a normal customer would. (Simulated test payment, AI video and the licensed-audio exception stay with `vdadi4@gmail.com` only.) Switch the skip off any time with `OTP_FREE_USER=off` in Render. If this email was already registered with a different password, the first login with `Test@123` will not work; delete that user in the database or use a fresh email.
4. **New plan: 6 months (180 days) for ₹250** next to 30 days for ₹49. The Pro screen shows both; tap one, then Subscribe, then choose how to pay. The days are counted from the payment day, and a payment made while days remain adds on. Change the price any time with `PRICE180_PAISE` (25000 = ₹250) or fully with `PLANS_JSON`.

## Checking Razorpay
- `https://editor1-0-2.onrender.com/` should show `payKeys` id and secret as true and `pay` as `test` or `live`. In **test** mode no money moves (test card 4111 1111 1111 1111, UPI `success@razorpay`). In **live** mode the ₹250 is real.
- After paying, the header shows the days left (180 for the 6-month plan).

## Tested / not tested
Tested in a desktop browser engine with mocked services: wheel zoom (selected layer only, limits, undo, keyframes, text, native off), plan picker and the plan sent to the server, server plan grants and expiry at 180 days, OTP-free account rules, plus the full earlier regression. Not tested: a real touchpad, a real phone, and a real Razorpay payment.

## Update (same v1.5): menu scroll + Vasukgp856 Pro off
- The side menu now scrolls, so **Log out** is always reachable on short web windows. (It was just below the visible area.)
- Pro on `Vasukgp856@gmail.com` is cleared once, on the server, the next time that account opens the app. Later real payments for it work normally. Redeploy Render for this.

## Update 3 (same v1.5): music search hidden for Razorpay review
- The Music tab no longer shows **Search music on the web** or the language chips (Telugu, Hindi, …). Import music, Extract audio, Own sound, Create music and Saved music are unchanged.
- Nothing was deleted. In `index.html` find `const MUSIC_SEARCH_ON=false;` and change it to `true` to bring the search and languages back.
