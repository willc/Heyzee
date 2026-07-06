# Heyzee

A Yahtzee-style dice game against an AI opponent. Vanilla JS, no build step, one static folder.

## Play

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 4599
```

Then visit http://localhost:4599.

## Rules

Standard five-dice scoring: roll up to 3 times per turn, hold the dice you like between rolls, then assign the result to an open scorecard category. Upper section (Ones–Sixes) earns a 35-point bonus at 63+. Lower section covers three/four of a kind, full house, small/large straight, Heyzee (five of a kind, 50 pts), and Chance. A second Heyzee after the first scored one is worth a 100-point bonus. Thirteen turns, highest total wins.

## The AI

Greedy expected-value heuristic: it samples reroll outcomes across all 32 hold combinations to pick what to keep, and shapes its final category choice to chase the upper bonus and avoid burning premium slots on junk. Beatable, not perfect.

## Structure

- `index.html` — markup
- `style.css` — felt themes, dice faces, animations
- `ai.js` — scoring rules + AI
- `game.js` — game loop and UI

## Options

- Green felt / burgundy felt toggle
- Classic / inverted dice toggle
- Sound on/off
