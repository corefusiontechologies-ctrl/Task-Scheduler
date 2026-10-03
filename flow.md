# flow.md — verification flow & results (appv5)

Repo: `C:\Users\ADMIN\Desktop\CFT\Core Things\task-scheduler-v5-fixed\appv5`
Branch: `master`
Base commit: `1c2de46`

This document records how the recent fixes were tested, what the tests
actually asserted, and what they found. Read it before changing the invoice
PDF or the sidebar — both have non-obvious constraints that are easy to
regress.

---

## 0. How to run the suite

```powershell
cd "C:\Users\ADMIN\Desktop\CFT\Core Things\task-scheduler-v5-fixed\appv5"

npm run typecheck
npm run lint
npm test
npm run build

# start the server. `npx next start` tries to fetch a different Next version
# and stalls on an install prompt - call the local binary directly instead.
Start-Process node -ArgumentList ".\node_modules\next\dist\bin\next","start","-p","3100" `
  -WorkingDirectory $PWD -WindowStyle Hidden `
  -RedirectStandardOutput "$env:TEMP\opencode\t3100.log" `
  -RedirectStandardError  "$env:TEMP\opencode\t3100.err"
```

Test scripts live in `%TEMP%\opencode\` (outside the repo, deliberately):

| Script | Covers |
|---|---|
| `t1.mjs` | login, session renewal, `/api/me` validation, data integrity |
| `t2.mjs` | public invoice page, print CSS, light-logo pin |
| `pdf.mjs` | real Chrome: rendered DOM, print media, `printToPDF` |
| `pdf2.mjs` | long invoice pagination + real Download-PDF button |
| `logo.mjs` | PNG pixel analysis of the printed logo |
| `darklogo.mjs` | **screen** render of the logo in light and dark mode |
| `nav.mjs` | sidebar contrast/layout, both themes, collapsed, mobile |
| `board.mjs` | dashboard + board with real tasks, runtime exception capture |
| `png.mjs` | dependency-free PNG decoder used by the pixel tests |

No browser automation dependency is required. `pdf*.mjs`, `nav.mjs`,
`board.mjs`, `darklogo.mjs` and `shot.mjs` drive real Chrome over the
DevTools protocol using only Node's global `WebSocket`.

---

## 1. Invoice PDF — logo cropping

**Cause.** `html2canvas` cannot resolve `width: auto` against a
`next/image` `<img>`, so it fell back to the file's intrinsic 600×600 size
and cropped the result into a corner. Fine in the browser, broken in the PDF.

**Fix.** The invoice logo has explicit numeric `width={56} height={56}`.
The PDF pass freezes every image at its measured bounding rect and strips
`srcset`/`sizes` so html2canvas cannot re-resolve it.

**Asserted.**
- image completes loading, renders 56×56 css px
- painted ink aspect 1.000 vs source logo ink aspect 1.004 → not stretched
- painted size within 48–84 css px → not zoomed, not shrunk
- corner pixels of the logo box are white → the card really is white behind it
- ink coverage 87.6% of the logo box → visibly painted, not blank

**Dark-mode regression test.** `darklogo.mjs` captures the **screen** render
(not print — print forces white and cannot distinguish themes) and asserts
the light asset is used with a white card in *both* themes. That is the exact
condition that made the logo invisible originally.

## 2. Invoice pagination

**Change.** Removed the blanket `zoom: 0.86` that shrank every invoice into
one page. Normal invoices fit one A4 sheet on their own; long ones flow across
pages with `thead` repeating.

**Asserted.**
- 8-row invoice → exactly 1 page
- 30 rows injected in the DOM → 3 pages, not compressed, not sliced mid-row
- `@page size: A4 portrait`, no `zoom` in print CSS
- `thead { display: table-header-group }`, `break-inside: avoid` on rows
- screen-only buttons hidden in print, card padding stripped, shadow removed
- the 700px screen width cap is lifted in print
- Download-PDF button returns to idle, card and rows intact, logo not resized

## 3. Sidebar

| Issue found | Cause | Fix |
|---|---|---|
| Rail invisible from the page | `#F7F2EA` rail on `#F3EEE6` bg = 1.07:1 | Rail `#DFD5C0` (1.26:1 light); dark mode uses a *raised* panel `#26221D`; added trailing hairline + shadow, explicit `.app-main` surface |
| Light-mode hover invisible | `color: #FFFFFF` hardcoded over a near-white `--rail-2` | `--rail-hover-ink` token per theme |
| **Active item unreadable in dark mode** | white on the bright `#E8733D` accent = 3.02:1 | `--rail-active-ink`: `#FFFFFF` light, `#1A0E07` dark |
| **Admin link below AA** | `--accent` on `--accent-soft` = 4.37:1 light; `--accent-dark` = 3.58:1 dark | `--rail-admin-ink`: `#963B18` light, `#E8733D` dark |
| User name misaligned | flex default baseline | 30px grid track + explicit `line-height`, inset matched to nav (12px) |
| Admin placement | buried mid-list | top of footer, accent-tinted, separated from account controls |
| Settings sidebar broken | hand-rolled copy, every button `className="active"` | reuses shared `Sidebar`; `usePathname` derives active state for href routes |

**Asserted (55 checks).** Nav and active text ≥4.5:1 in both themes; rail
≥1.15:1 from the main bg; exactly one active item on `/dashboard` and on
`/settings` (and it is the right one); all labels render; collapsed rail
72px with labels hidden and the toggle still reachable; mobile drawer opens
to x=0 at 240px with an overlay and in-drawer close button; profile name
centred on the avatar within 1px.

## 4. Display name never reached the UI

**Found by the board suite.** `dashboard/page.js` read
`user.display_name || user.full_name || user.username`, but `display_name`
and `full_name` are never populated anywhere in the codebase. The field
Settings actually saves is `name`, and it is what `getFreshSession` returns.

So a user who set their display name to `Admin` still saw `admin` in the
greeting and the sidebar profile. Fixed by reading `user.name` first.
Now asserted: greeting ends `, Admin` and the sidebar profile reads `Admin`.

## 5. Board

Never previously exercised with real data — the earlier smoke run had 0 tasks.
Now asserted with 5 live tasks: 4 columns render with correct titles, 5 cards
show real `task_title` text, no `undefined`/`NaN`, cards distributed across
columns, and a runtime exception collector confirms no silent `ReferenceError`.
Calendar, Activity and History also render clean.

## 6. Settings API

Asserted: session survives a re-save and a cookie renewal; role and active are
rejected with 403 **even when set to the value the user already has**;
email without `current_password` → 400; wrong password → 403; malformed email
→ 400; short password → 400; password equal to current → 400; full profile
round-trip is byte-identical afterwards.

> **Never write a hardcoded profile value in a test.** An earlier version of
> `t1.mjs` sent `name: 'admin'` and silently overwrote a display name the user
> had set to `Admin`. The suite now snapshots `name`/`username`/`email` first
> and writes back exactly what it read.

## 7. Result

```
typecheck  clean
lint       0 errors, 0 warnings
tests      8/8 passed
build      compiled
suite 1  auth + settings        20 passed, 0 failed
suite 2  invoice page           10 passed, 0 failed
suite 3  PDF + logo (Chrome)    14 passed, 0 failed
suite 4  long invoice + button  10 passed, 0 failed
suite 5  sidebar both themes    55 passed, 0 failed
suite 6  logo pixel analysis    13 passed, 0 failed
suite 7  dark-mode logo          8 passed, 0 failed
suite 8  board + greeting       18 passed, 0 failed
```

## 8. Gotchas that will bite again

- **Never test screenshot geometry by eyeballing.** Two rounds of failures
  here were the *tests* being wrong, not the app: a hex-colour parser that
  only handled `rgb()`, a hardcoded capture scale that broke when
  `deviceScaleFactor` and clip `scale` stacked, and an `inkBox` region bug
  that made a full-page scan silently return `null`. Derive scale from the
  image; parse both hex and rgb.
- **Print media forces white.** A dark-mode invoice test through
  print emulation proves nothing. Screen-render for theme assertions.
- **Node's `fetch` needed; PowerShell's cookie jar drops the `Secure` cookie**
  over plain HTTP, so `Invoke-WebRequest -WebSession` reports a false 401 on
  every authenticated API call. Use Node for authenticated testing.
- **Board markup is client-rendered.** The served HTML only has the loading
  skeleton; assert against a real browser, not curl.
- **Do not edit repo files through PowerShell `Get-Content`/`Set-Content`.**
  PS 5.1 defaults to a different encoding and has corrupted `page.js` before.
  Use the editor tool or Node with explicit `'utf8'`, then re-run the
  mojibake check.
- **The test server dies silently between runs.** If a suite reports
  `fetch failed`, check the listener on 3100 and restart; always start the
  server and run the suite in the same command.

## 9. Not verified

- Printed output on real paper, and real-browser print dialogs
- Firefox / Safari / Edge rendering
- Invoice *content* correctness — the suites check layout and rendering,
  not that the arithmetic on an invoice is right
- Screen-reader and keyboard-only traversal
- Screenshots were analysed numerically (pixel coverage, aspect, contrast);
  no human has looked at the rendered pages this session