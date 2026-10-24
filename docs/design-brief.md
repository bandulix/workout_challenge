# Design brief

App-wide visual redesign. Behaviour and scoring stay as they are. No-shaming copy stays. Dark is the only theme.

The Mobbin references (WHOOP, Tempo, Runbuds, Eight Sleep, Visible, Bevel, QUITTR, Ladder, Strava, Gentler Streak, Finch, Hevy, DAZN, Runna, NRC, Duolingo, Tonal, Fi, Garmin, Peloton, Noom, Google Health, komoot, Tolan) are pattern notes. Implement from this document.

## Global foundations

Tokens live in one place and are used everywhere.

- Palette: canvas `#0b0b0c`; `--surface-1` `#151517`; `--surface-2` `#1e1e21`; hairline `rgba(255,255,255,.08)`.
- `--volt` `#d7ff3e` is only for you, your progress, the primary action, and earned moments. It is never decoration and never another person's data.
- Semantic bands: `--good` `#3ee08f`, `--mid` `#ffc53d`, `--low` `#ff6b5b` (readiness and gaps).
- Another person's data uses a desaturated blue-grey (`--other`), never volt.
- Type: numbers are the hero. Display 56/60 for scores, H1 28/32, H2 20/24, Body 15/22, Label 11/14 uppercase with +0.08em tracking, Micro 12/16.
- `font-variant-numeric: tabular-nums` on every changing number.
- Spacing: 4-pt grid, 16px gutter, 12px between cards, 16–20px padding, 20px card radius, 999px pills.
- Cards are flat. No drop shadows. State is a hairline or a tinted border.
- One ring component in three sizes (96 / 56 / 28), plus a 270° arc gauge for scores.
- Contributor bars carry a weight label ("40% of score"). Comparisons use paired bars. Time series use a smooth area line.
- UI icons are a 1.75px-stroke outline set. Colourful stamp glyphs stay collectibles. Locked items are outlines at 40% opacity.
- Motion eases with `cubic-bezier(.22,1,.36,1)`. Rings draw from 0 over 700ms on first view. Numbers count up over 400ms. Earned moments get a one-shot volt flash. `prefers-reduced-motion` turns the motion off.
- Empty and pending states never show a bare 0. Use a placeholder ring (`--%`) and a card that says what is missing, the one action to take, and when it updates.

## Screens

1. **Coach / Home.** A three-ring header (Today % of goal, Readiness, Week), then the coach's line of the day as the first insight card, a status pill (for example "Primed"), then the Close-the-Gap rival card as two avatars on a track with the gap in points and one call to action (Duel them).
2. **Readiness and check-in.** An arc gauge with the band colour and one sentence of meaning. Expandable "why" rows with weighted bars. The coach persona's insight sits under the gauge. A missing-data card appears when a source did not sync. The check-in is a dark bottom sheet with a five-emoji row, one tap, then it closes.
3. **Order of the Day.** A volt-bordered hero card. An Easier / Steady / Harder intensity row pre-selected by readiness. A rest day is framed positively ("Day to rest and recover") with chips.
4. **Duels.** An invite card with an expiry line ("expires in 23 h"), Accept and Decline buttons, and Counter as a text button. The live view is a two-avatar versus hero (including a dead-heat state), paired daily bars, and a day-dot grid for the duel length. The W-L-T record is form pills.
5. **Results and sharing.** A celebration screen, then a share-card carousel with three styles. A full-bleed volt moment for a big achievement.
6. **Leaderboard.** A top-3 podium, a highlighted "you" row with neighbours, a supportive catch-up banner, ranks below you faded, and last place never labelled. Dark filter chips. A week-result card ("you finished #9").
7. **Feed and workout detail.** Cards with an avatar and title, a three-stat row, and reaction avatars. Photo remixes are photo-first. The detail view has a dark stat strip and split bars. Stamps sit where like and comment would.
8. **Coach chat.** A dark thread with persona bubbles, suggested-reply chips above the composer ("Roast me", "Plan tomorrow"), and structured replies (headings and bullets inside bubbles).
9. **Stamps, relics, Hall of Roasts, Legend Echoes.** A collection grid with locked outlines, a "You earned N" toast, earned-count chips, "New" tags, and ring progress toward relics (1/3, 2/3).
10. **Streaks and the training heatmap.** A week-dot row, a streak calendar with joined perfect runs, and a weekly streak tracker.
11. **Expedition.** A vertical path with milestone nodes and your current position. Storm weeks tint a segment. A group goal progress bar.
12. **Connect sources.** A logo-card grid with a clear connected state, as a radio-style group (one source per athlete; picking one visibly marks the others as not importing).
13. **Push opt-in.** A pre-prompt with a live notification preview before the browser dialog, plus per-category toggles (duels, coach, season), still respecting quiet hours.

Priority when time is tight: 1, 2, 6, 4, then volt discipline and the celebration system, then the rest.
