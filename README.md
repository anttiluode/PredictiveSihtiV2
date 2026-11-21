# Predictive Sihti V2 — Dynamical Dark Field

[Live demo (GitHub Pages)](https://anttiluode.github.io/PredictiveSihtiV2/) · [Single-file offline version](standalone.html) · [Modular offline version](index.html) · a *causal, CPU-only*, multiscale transition-memory experiment born from [Sihti](https://github.com/anttiluode/Sihti), [SihtiAI / ResidueHead](https://github.com/anttiluode/SihtiAI/tree/main/predictive), and the [SaturdayAfterRHproof](https://github.com/anttiluode/SaturdayAfterRHproof) collision witness.

**Run:** Download the repository and double-click `index.html` in Edge/Chrome. Nothing to install; three JavaScript files are local and there are no network requests. Built-in signals and local video work offline. Webcam permission may need `http://localhost` / HTTPS; `python -m http.server 8000` in this folder is sufficient for the local secure context in modern browsers. The simulation, head and UI are separable (`world.js`, `engine.js`, `app.js`).

## What to try

1. Start on **Bouncing pulse** with **Shape + motion**. Let it run past 168 frames (two 84-frame periods). Observe prediction vs hold-last error.
2. Freeze **Write memories**, switch the address to **Shape only**. With identical positions and opposing motion, a single current-frame address can match contradictory futures. The amber **Collision witness** shows retrieved transition variance. Note that a shape-only predictor can be worse than hold-last; the tool does not hide this.
3. Switch to **Five pulses** without clearing memory to test whether learned local rules transfer from a single moving pulse. This is a deliberately harder, non-identical test; the global head sees a new scene. The demo reports the outcome rather than assuming success. For a clean in-domain comparison, clear memory and train the five-pulse world itself.
4. Click **Free-run** after training, then click/drag the **Observed world** panel. Shift-click is a dark poke. Predicted frames feed back as inputs without new observations or memory writes. The system may stall or drift: this is a test, not a guarantee of indefinite coherent motion.
5. Select **Local video** or **Webcam** and compare error over time. An actual unpredictable stream is the meaningful test beyond synthetic repetition. Export a numeric CSV receipt if useful; no pixels are included.

## Architecture

Decompose each grayscale 48×36 frame into two scales of separable box smoothing:

```
S = blur(frame, radius 2)
C = blur(frame, radius 6)
R_middle = S - C
R_fast = frame - S
frame = C + R_middle + R_fast              (telescoping identity)
```

`C` has a bounded **global core transition bank** keyed by 8×6 downsampled values and optionally their recent temporal change. Both high-frequency components have separate, **spatially shared 5×5 patch banks**; their addresses include local current structure and (optionally) prior temporal change, never absolute x/y. An inexpensive descriptor shortlist is reranked with the full patches. The banks store actual observed transitions only when the next frame arrives: `(address at t, component delta at t→t+1)`.

For the retrieved transitions Δ_i at one address, let w_i be nonnegative normalized weights. The predicted delta is the signed mean and collision witness is their dispersion:

```
mean_delta = Σ w_i Δ_i
B = max(0, Σ w_i Δ_i² − mean_delta²)
```

The core computes its B per output pixel and each patch head computes its own center B. The displayed image is a **sum of per-head dispersions**, which drops cross-component covariance; it is *not* the exact variance of the complete predicted frame. A high B only means **matched memories disagree**. It does not itself identify a missing latent variable or prove a physical phenomenon. An address with no credible past matches may have low B even when the future is completely unknown; inspect match confidence too.

Prediction at t is made from already-completed earlier transitions. Prediction error is scored when t+1 arrives, *before that transition is written*. There is no future leakage, pretraining, gradient descent or inference network. Nearest-neighbor patch prediction and a smoothing pyramid are established engineering components, not presented as new inventions.

## Reproduce the results

Node.js is required **only for tests**:

```sh
node tests/test.cjs
node tests/test.cjs --bench
```

The frozen benchmark writes `results/benchmark.json`. **Protocol:** train on the first 168 synthetic frames, freeze *all* memory writes, evaluate frames 168–251 (84 more frames) against holding the last observation. The built-in bounce has a period of 84 frames; the five-pulse set has that same period but is a deliberately easier periodic in-domain sequence, not a claim about unknown real video.

| Stream | Address | Frozen model error improvement over hold-last |
|---|---|---:|
| Bounce | Shape + motion | **82.3%** |
| Bounce | Shape only | **−112.0%** (worse) |
| Five pulses | Shape + motion | **76.7%** |
| Five pulses | Shape only | **−35.7%** (worse) |

A simple one-object→five-object **frozen transfer** pilot had about **28%** aggregate error reduction with shape+motion and **negative** gain with shape-only; the source-switch shock contributes to that score. This is exploratory and not a generalized physical law. Verify on out-of-distribution, noisy, non-periodic streams and compare to optical flow / adaptive background models before making performance claims.

Tests cover lossless reconstruction, exact conflicting-future B with ± deltas, addressing polarity with and without motion, spatial translation of the patch address, future-leakage prevention and no dream-memory writes.

## Honest boundaries

- B is conditional recalled variance *under the chosen memory and distance metric*, not a mathematical proof of hidden physics in a live scene. True deterministic aliasing requires controlled equal-observation/different-future witnesses.
- A 5×5 nearest-neighbor patch bank has limited temporal depth, resolution and sample efficiency. Shared patches help with translation; they do not provide genuine scale/rotation invariance.
- Repeated synthetic cycles are much easier than novel physical inputs. Camera jitter, automatic exposure, new objects and direction reversals may break predictions.
- `Free-run` is iterative one-step recall and is not a stable learned simulator. `Poke` changes pixels and need not behave like a real force.
- Browser speed varies. The default 48×36, 12 fps is intentionally small and transparent, not a throughput benchmark.

**Research question:** When do contradictory futures under a coarse address disappear after the *cheapest* additional temporal or spatial measurement? A next experiment should log matched historical witnesses, prove collision pairs under frozen conditions, and distinguish aliasing from distribution shift and measurement noise.

MIT License (repository LICENSE).