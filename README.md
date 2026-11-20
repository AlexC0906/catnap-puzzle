# 🐱 Catnap

A cozy logic puzzle with cats that runs right in your browser. No install, no dependencies.
Available in **English** and **Romanian** (*Mustăți*). The language follows your browser, and you can switch it with one button.

**▶ Play: https://alexc0906.github.io/catnap-puzzle/**

## Rules

The N×N board is split into N colored cushions. Place N cats so that:

1. every **row** has exactly one cat;
2. every **column** has exactly one cat;
3. every **colored cushion** has exactly one cat;
4. **no two cats touch**, not even diagonally.

Every puzzle has exactly one solution, so you never need to guess.

## Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Place × | one tap | `X` |
| Place a cat | two taps (or right-click) | `C` |
| Several × at once | drag across cells | |
| Move around the board | | arrow keys |
| Undo | “Undo” button | `Ctrl+Z` |

## Features

- **Daily puzzle**: the same 8×8 for everyone, every day
- Boards from **5×5 to 10×10**, generated endlessly
- Every puzzle has its own link (`#p8-4242`) you can send to a friend
- Mistakes are highlighted instantly; optional auto-× around cats
- Hints, timer, personal records and progress saved locally
- Wordle-style emoji result to copy and share
- Light and dark theme, works on phones
- English / Romanian toggle

## Run locally

Open `index.html` in a browser. That's it.

## Tests

```bash
npm test
```

For every board size, the tests check that generated puzzles are valid, that every region is connected, and that each puzzle has **exactly one solution**.

## How the generator works

1. Randomly place N cats that follow the rules (backtracking).
2. Grow N colored regions outward from each cat (random flood fill).
3. A solver counts solutions. If it finds a second one, it moves one cell between regions to rule it out, then checks again.

Everything is seeded, so the same seed always produces the same puzzle. That's how the daily puzzle stays the same for everyone.

## Project structure

```
index.html       page markup
style.css        all styles (light + dark theme)
src/engine.js    RNG, solver, generator (works in browser and Node)
src/game.js      game UI and input
src/i18n.js      English + Romanian strings
test/            Node tests for the engine
```

## License

MIT
