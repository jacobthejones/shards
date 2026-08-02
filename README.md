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
- `npm run build:wasm`: compile the C++ simulation runtime
- `npm test`: build the app and verify the rendered HTML
- `npm run lint`: run ESLint

For runtime profiling, add `?metrics=1` to the local URL. Add `&balls=10` to
start with ten balls for a repeatable stress check. The browser logs one-second
windows containing C++ WebAssembly physics time, simulated time, render time,
and frame count.
