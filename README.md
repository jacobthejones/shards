# shards

An idle game prototype about a field of fractured shards that slowly regenerates.

## Requirements

- Node.js `>=22.13.0`

## Run locally

```bash
npm install
npm run dev -- --port 3000
```

Open [http://localhost:3000](http://localhost:3000).

## Useful commands

- `npm run build`: build the app
- `npm test`: build the app and verify the rendered HTML
- `npm run lint`: run ESLint
- `npm run balance`: run deterministic headless balance simulations
- `npm run check-voronoi`: check randomized fields for overlapping cells

The headless balance runner uses the same seeded, fixed-timestep simulation
engine as the canvas game. It buys an Add ball upgrade whenever possible and
reports upgrade intervals grouped by game-time bracket.
