# V2.2.1 — narrow-core shortlist correction

Core `corePatch()` zeroed the outer ring of a 5x5 array to represent a 3x3 local field, but `descriptors()` shortlisted candidate prototypes using **only the four zeroed outer-ring neighbors and the center**. That made the candidate shortlist in shape-only mode essentially center-brightness-only (the final full-distance comparison was still 3x3 but operated only on a potentially incorrect set of 28).

This patch selects indices `11,13,7,17` (left/right/up/down one step from center) for **narrow core only**. Other patch banks and wide core preserve indices `10,14,2,22`. Both memory writes and memory queries use the same descriptor mode. `tests/core_descriptor.cjs` forces 40 distinct, identical-center narrow patches so the old scheme misses the matching candidate; the corrected implementation retrieves it.

## Reproducible frozen benchmark

The model trains on 168 bounce observations, freezes memory, then evaluates 84 frames using the same protocol in both versions. Percentage is MSE reduction versus hold-last; negative means worse. The two builds are separately trained using exactly the same deterministic stream and hyperparameters.

| Stream | Read mode | Before | After |
|---|---|---:|---:|
| Bounce | Shape | 1.10% | 1.27% |
| Bounce | Auto | 58.05% | 57.77% |
| Bounce | Always temporal | 67.08% | 66.88% |
| Five (transfer) | Shape | 1.77% | 1.83% |
| Five (transfer) | Auto | 39.64% | 39.59% |
| Five (transfer) | Always temporal | 55.58% | 55.53% |

**Conclusion:** The shortlist bug was real, but it did **not** explain the transfer-performance gap. Core prototypes increased from 103 to 121; stronger transfer requires additional controlled work rather than claiming improvement by construction. See `results/core_descriptor_fix.json` for precise scores.

Run:
```bash
node tests/core_descriptor.cjs
node tests/test.cjs
node tests/self_repair.cjs --bench
node tests/ui_smoke.cjs
```
