# Predictive Sihti V2.2 — Active Collision Routing

**A local, browser-based, causal experiment in associative prediction.** No pretrained model, backpropagation, dependencies, GPU, API, or remote server. It combines Sihti's lossless spatial residue split with shared transition prototypes and a *local decision*: when a familiar address recalls incompatible futures, try a motion-history address; when a newly observed transition is surprising and unfamiliar, allow new memory writes.

[Open the application](index.html) · [Single-file offline version](standalone.html)

Built on [Sihti](https://github.com/anttiluode/Sihti), [SihtiAI / ResidueHead](https://github.com/anttiluode/SihtiAI/tree/main/predictive), and [SaturdayAfterRHproof](https://github.com/anttiluode/SaturdayAfterRHproof).

## Start

Double-click `index.html` in Edge/Chrome. The **Self-repair** address is selected by default. Start **Bouncing pulse**. After roughly 168 observed frames, switch off **Write memories** to test frozen prediction, then switch to **Five pulses** without resetting anything. For comparison, select **Shape only** or **Shape + motion** *with the same stored memories*. Press **Free-run** to disconnect observations, and click or flick the first panel to perturb the synthetic state. The mouse flick is two synthetic observations; it does not train the model.

For webcam use, browser permissions may require a local secure origin:

```bat
python -m http.server 8000
```

Open `http://localhost:8000`, select **Webcam**, and press **Start**. Webcam frames stay on your machine. **Export CSV** captures numeric observations, confidence, disagreement, local recruited fraction, prototype writes, and source labels across changes in input. No video pixels are exported.

## How the self-repair loop actually works

The exact Sihti split is maintained for every frame:

```
S = blur(x, radius=2)
C = blur(x, radius=6)
Rmiddle = S - C
Rfast = x - S
x = C + Rmiddle + Rfast
```

At each scale, the head recalls *previously observed completed transitions* using spatially shared local patches. The slow core has **3×3** patches on a **12×9** grid (12×12 raw pixels for patch centers, before blur support); the middle and fast residues have **5×5** patches in the original 48×36 frame. The underlying 13×13 core blur makes the effective receptive field wider than the 3×3 grid footprint. Core and residue banks retain signed history. Prototype merging preserves competing transitions instead of evicting a half-cycle with FIFO.

Every predicted patch begins with a **shape-only** lookup of previously stored transition deltas:

```
mu_shape = Σ w_i delta_i
B_shape = Σ w_i (delta_i - mu_shape)^2
```

It recruits the motion-history address *only if* shape-only familiarity is ≥0.65, `B_shape` is above both an absolute floor and **3× the rolling median background disagreement** at that scale, and the motion-aware recall is familiar enough (≥0.45) and reduces variance by at least 15%. **Each location makes its own decision.** The background median comes from current predicted addresses and previously stored memories; it never reads the next true frame. The displayed B is **pre-repair** recalled disagreement so the collision remains visible even after the routing succeeds.

When the next **real observation** arrives, the previous prediction is scored *before* learning. A fixed **84-frame initialization period** accumulates prototypes (an explicit calibration budget, not proof of automatic zero-shot discovery). Thereafter, the learner writes candidate patches only when the new observation is locally surprising and shape familiarity is low, plus a bounded fallback for strong contradictions every seventh frame. Familiar redundant patches can be skipped; similar prototypes merge. Free-run never writes, and **Write memories** can be frozen at any time. These are heuristic thresholds, not learned universal optimal gates.

**Very important:** high B means this memory/distance representation recalls disagreeing futures. It does **not** identify a hidden cause, prove that the environment has a hidden variable, or distinguish a genuinely novel arrangement from a genuine aliased state without controlled interventions.

## Deterministic results — tested 21 November 2026

Run the following with Node.js (only used for tests/receipt generation):

```bat
node tests/test.cjs --bench
node tests/self_repair.cjs --bench
```

The first is the legacy V2.1 regression suite. The second writes `results/self_repair.json` with its full protocol and results. Every row below uses **the same stored bank** trained on 168 bounce frames (the first 84 used for calibration, subsequent writes selective), then freezes *all memory writes* and detaches temporal context. Each comparison uses 83 measurable transitions from 84 target frames. Gains are relative reduction in mean-square error against holding the last observed frame.

| Frozen target | Shape only | Always motion | Automatic (V2.2) | Auto motion reads |
|---|---:|---:|---:|---:|
| Bounce | 1.1% | 67.1% | **58.0%** | **7.8%** |
| Five pulses | 1.8% | 55.6% | **39.6%** | **13.0%** |

Thus the automatic strategy recovers much of the benefit of the expensive always-on motion address with sparse, locally justified reads, but **does not match** that upper control. It also does *not* beat the manually temporal V2.1 transfer result. These results come from deliberately simple, periodic synthetic worlds.

### Can an unfamiliar stream activate memory writing?

Starting from the same 168-frame bounce-trained bank, compare **frozen** versus **online selective writes** for three sequential 84-frame blocks of a new signal (the online condition uses the additional observations as legitimate training data):

| New target | Frozen, first → third block | Online self-repair, first → third block | Additional prototypes |
|---|---:|---:|---:|
| Five pulses | 39.6% → 39.7% | **51.2% → 66.1%** | 370 |
| Wave field | 4.8% → 5.5% | **19.7% → 34.1%** | 474 |

This supports **causal online adaptation**, not novel scientific discovery: the online model receives more real data than the frozen control. The training run stored 373 prototype entries (103 core, 179 middle, 91 fast); after the first calibration period, it skipped 4,103 candidate writes. On five pulses, 123 accepted writes were triggered by the low-familiarity surprise rule; a scheduled strong-surprise fallback also contributed. That confirms the unfamiliar-surprise path actually executes instead of being merely a label.

The test suite additionally checks algebraic reconstruction, a controlled ±delta collision witness, an unambiguous/novel address *not* opening the gate, frozen-memory integrity, and no dream writes.

## Audit it in your actual Windows Edge

Double-click `run_v22_audit.bat` (requires **Node.js 22+** and local Edge or Chrome). It runs the regression tests and launches the included dependency-free Chromium DevTools audit against your real browser/UI. The audit exercises automatic, fixed temporal, and shape-only modes with the *same frozen memory*, transfer, online selective writes, free-run, and a mouse flick. It creates:

```
headless_receipt/predictive_sihti_headless_receipt.zip
```

Upload that ZIP for inspection. The runner records raw B arrays, per-frame recruitment, prototype write decisions, full-stage CSV, screenshots and JavaScript errors. Browser permission is not requested and **no camera is opened by the headless audit**. If you prefer an external-wall test, use the visible browser app with a **local video or live webcam**, compare a stable moving background with a perturbation, and export its CSV.

## Limitations and controls

- The address/retrieval/variance approach is established nearest-neighbor associative memory, not a new general AI algorithm. The automatic gate is a testable architecture choice.
- A small, static B can hide uncertainty when no familiar states exist. A large B can occur from mixing dissimilar memories. Treat the novelty versus aliasing dashboard labels as heuristics.
- Pixel-space transition prediction is sensitive to sampling rate, camera motion, exposure changes and unrelated movement; naive hold-last can beat it.
- Motion confidence can brake free-running trajectories. `step=2` interpolation can create stripes under closed-loop feedback; V2.2 **does not claim to solve** those dynamical artifacts. A real-data benchmark should check this explicitly.
- The 84-frame calibration period is chosen for the synthetic 84-frame bounce. It is an explicit initialization budget; in external streams, it is **not** a learned understanding of the physical period.
- The core footprint is smaller, but its smoothing still couples larger regions. Translation-sharing alone cannot guarantee multi-object composition, rotation/scaling invariance or semantics.
- The UI is built to be opened offline; no webcam, video or Chromium UI results have been claimed without direct execution. Node tests give reproducible engine-level evidence only until a headless receipt from a local browser is returned.
