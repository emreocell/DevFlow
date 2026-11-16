---
id: PY-STOCK-LOW
scope:
  modules: [python-unittest]
  include: ["examples/python-unittest/**"]
testing:
  levels: [unit]
  testFirst: true
---

# Report inventory that needs restocking

The inventory example can reserve and receive stock, but it has no deterministic way to show
which known products need restocking. Add a query that reports their current quantities without
changing inventory.

## Requirements

- FR-1: `Stock` exposes a low-stock query that returns each known SKU and its current quantity
  when that quantity is less than or equal to the requested threshold.
- FR-2: Results are ordered by SKU so callers can display a stable report.
- FR-3: A negative threshold is rejected with `ValueError`, and a query does not mutate stock.

## Acceptance Criteria

- [ ] **AC-1**: Low-stock products are reported at the inclusive threshold (covers: FR-1, FR-2) (unit)
  - Given the known stock levels are `mug: 2`, `plate: 0`, and `tea: 5`
  - When the low-stock query uses a threshold of `2`
  - Then it returns `mug: 2` and `plate: 0` in SKU order
- [ ] **AC-2**: A negative threshold is rejected without changing stock (covers: FR-3) (unit)
  - Given the inventory contains `mug: 2`
  - When the low-stock query uses a threshold of `-1`
  - Then it raises `ValueError` and the mug level remains `2`
- [ ] **AC-3**: Products above the requested threshold are omitted (covers: FR-1)
  - Given the known stock levels are `mug: 2` and `tea: 5`
  - When the low-stock query uses a threshold of `1`
  - Then it returns an empty result

## Constraints

- Do not add a runtime dependency; this example uses only the Python standard library.
- A query must not change any stock level.

## Definition of Done

- Every acceptance criterion has a passing automated unit test.
- The existing `python-unittest` example and DevFlow checks pass without regressions.
