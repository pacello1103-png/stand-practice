# Stand website: source

- `content.js`: all the text (folders, chapters, squares). Edit words here.
- `core.js` / `core.css`: drawer, folder opening, scrolling animations (shared).
- `paper.*`: Paper Folders look (main page). `app.*`: App Folders look (/app/).
- `build.py`: run `python3 source/build.py` from the site folder. It writes index.html (root) and app/index.html, with the share-preview tags (plus v1_paper.html / v2_app.html drafts you can delete).
- App Store link: set `APP_STORE_URL` at the bottom of `content.js` and rebuild; the button changes to "Download on the App Store". The support email is in privacy.html (search for example.com).
- `classic-original.html`: the /classic/ page before it was wrapped.
- Screenshots live in `../img/`.
