## Intent

Evaluate whether the candidate can design a system end-to-end: requirements and constraints first, then a coherent architecture with the storage, compute, and failure behavior called out. Depth on the tricky pieces beats a breadth-first tour of every component.

## Ideal structure

1. Clarify functional and non-functional requirements (scale, latency, durability)
2. Propose a high-level architecture and name the components
3. Go deep on the 1-2 hardest parts (write path, read path, consistency)
4. State storage choices and justify them (why this DB / cache / queue)
5. Discuss failure modes and how the system degrades

## Scoring dimensions

- Requirements rigor — do they pin down scale and latency before designing?
- Architecture quality — coherent components with clear responsibilities?
- Depth on hard parts — do they go deep on the write/read/consistency path?
- Storage & scaling — do they justify data stores and horizontal scaling?
- Failure handling — do they address what breaks and how it degrades?

## Green flags

- asks about QPS, data size, and latency targets early
- trades off consistency vs. availability explicitly where it matters
- goes deep on one component instead of listing ten shallow ones
- justifies storage choices against the access patterns
- calls out failure modes and retry / backoff / failover behavior
- sanity checks the design against the stated scale

## Red flags

- designs with no requirements — jumps straight to boxes
- lists components without explaining data flow between them
- never touches the write path or the hot read path
- picks storage without reasoning about access patterns
- ignores failure modes entirely
- hand-waves consistency with "use a cache" with no trade-off