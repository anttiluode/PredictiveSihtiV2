# Predictive Sihti V2 — Dynamical Dark Field

[Try `index.html` offline](index.html) · a *causal, CPU-only*, multiscale transition-memory experiment born from [Sihti](https://github.com/anttiluode/Sihti), [SihtiAI / ResidueHead](https://github.com/anttiluode/SihtiAI/tree/main/predictive), and the [SaturdayAfterRHproof](https://github.com/anttiluode/SaturdayAfterRHproof) collision witness.

**v2.1 (Nov 21, 2026):** Prototype/novelty-merged patch memory with 16 salient and 2 quiet anchors per scale; patch-shared 12×9 core; flick gestures carrying a two-frame velocity dipole; stricter frozen transfer regression tests.

**Run:** Download the repository and double-click `index.html` in Edge/Chrome. Nothing to install; three JavaScript files are local and there are no network requests. Built-in signals and local video work offline. Webcam permission may need `http://localhost` / HTTPS; `python -m http.server 8000` in this folder is sufficient for the local secure context in modern browsers. The simulation, head and UI are separable (`world.js`, `engine.js`, `app.js`).

## What to try

1. Start on **Bouncing pulse** with **Shape + motion**. Let it run past 168 frames (two 84-frame periods). Observe prediction vs hold-last error.
2. Freeze **Write memories**, switch the address to **Shape only**. With identical positions and opposing motion, a single current-frame address can match contradictory futures. The amber **Collision witness** shows retrieved transition variance. Note that a shape-only predictor can be worse than hold-last; the tool does not hide this.
3. Switch to **Five pulses** without clearing memory to test whether learned local rules transfer from a single moving pulse. This is a deliberately harder, non-identical test; the spatially shared core now sees unfamiliar local combinations rather than an entirely unseen global address. The demo reports the outcome rather than assuming success. For a clean in-domain comparison, clear memory and train the five-pulse world itself.
4. Click **Free-run** after training, then click the **Observed world** panel for a static perturbation, or drag and release for a directional flick. Shift-click subtracts light. Predicted frames feed back as inputs without new observations or memory writes. The system may stall or drift: this is a test, not a guarantee of indefinite coherent motion.
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

`C` now has a spatially shared **5×5 core patch bank** on a downsampled 12×9 field; the global 8×6 whole-frame lookup was removed. Both high-frequency components have separate **5×5 patch banks**; their addresses include local current structure and (optionally) prior temporal change, never absolute x/y. An inexpensive descriptor shortlist is reranked with the full patches. The banks merge near-duplicate address/delta prototypes and preserve differing motion or outcome instead of evicting the last half-cycle with FIFO. Each frame samples 16 spatially separated salient patches and two quiet background patches in each high-frequency bank. The banks store actual observed transitions only when the next frame arrives: `(address at t, component delta at t→t+1)`.

For the retrieved transitions Δ_i at one address, let w_i be nonnegative normalized weights. The predicted delta is the signed mean and collision witness is their dispersion:

```
mean_delta = Σ w_i Δ_i
B = max(0, Σ w_i Δ_i² − mean_delta²)
```

The core computes its B per coarse-grid location (upsampled for display) and each patch head computes its own center B. The displayed image is a **sum of per-head dispersions**, which drops cross-component covariance; it is *not* the exact variance of the complete predicted frame. A high B only means **matched memories disagree**. It does not itself identify a missing latent variable or prove a physical phenomenon. An address with no credible past matches may have low B even when the future is completely unknown; inspect match confidence too.

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
| Bounce | Shape + motion | **58.0%** |
| Bounce | Shape only | **−0.1%** (approximately hold-last) |
| Five pulses | Shape + motion | **83.5%** |
| Five pulses | Shape only | **5.3%** |

### True frozen transfer (added v2.1)

Train **only one bouncing pulse** for 168 frames, freeze all writes, **detach temporal context**, then evaluate 83 measurable transitions from the five-pulse world. No five-pulse observations are used for training.

| Model | One→five transfer MSE improvement vs hold-last |
|---|---:|
| V2 original, shape+motion, 650 patch slots | **35.1%** (locally reproduced baseline) |
| V2.1, shape+motion, novelty-merged shared core/patches | **49.5%** |
| V2.1, shape only | **1.6%** |

Patch bank counts after one-object training were 219 core + 189 middle + 97 fast prototypes, 8,179 matched merges, **zero evictions**. Note the important trade-off: bounce temporal prediction fell from the original **82.3%** to **58.0%** under the replacement core. We did not claim an across-the-board performance win; this version tests local transfer against loss of scene-specific memorization. The 35.1% V2 baseline here uses `patchCapacity=650` and the same detached-context transfer protocol as V2.1; earlier exploratory 28% measurements used different evaluation details. This is exploratory and not a generalized physical law. Verify on out-of-distribution, noisy, non-periodic streams and compare to optical flow / adaptive background models before making performance claims.

Tests cover lossless reconstruction, exact conflicting-future B with ± deltas, preserved counterfactual prototypes after 400 attempted writes to two slots, addressing polarity, coordinate-free patch transfer, no future-leakage, frozen one→five transfer, and directional-gesture no-learning behavior.

## Honest boundaries

- B is conditional recalled variance *under the chosen memory and distance metric*, not a mathematical proof of hidden physics in a live scene. True deterministic aliasing requires controlled equal-observation/different-future witnesses.
- A 5×5 nearest-neighbor patch bank has limited temporal depth, resolution and sample efficiency. Shared patches help with translation; they do not provide genuine scale/rotation invariance.
- Repeated synthetic cycles are much easier than novel physical inputs. Camera jitter, automatic exposure, new objects and direction reversals may break predictions.
- `Free-run` is iterative one-step recall and is not a stable learned simulator. The flick injects a **two-frame moving appearance**, not a physical force or automatically a sustained moving object.
- Browser speed varies. The default 48×36, 12 fps is intentionally small and transparent, not a throughput benchmark.

**Research question:** When do contradictory futures under a coarse address disappear after the *cheapest* additional temporal or spatial measurement? A next experiment should log matched historical witnesses, prove collision pairs under frozen conditions, and distinguish aliasing from distribution shift and measurement noise.

MIT License (repository LICENSE).
