# M19 Align and Distribute Implementation Plan

> Executed natively (controller implements, TDD, one final whole-branch review).

**Spec:** `docs/superpowers/specs/2026-09-28-m19-align-distribute-design.md`

1. `src/doc/align.ts` + `src/__tests__/align.test.ts` (TDD): `alignNodes`, `distributeNodes`,
   per-node translation via `inParent`, same-reference no-ops.
2. Store `alignSelection` / `distributeSelection` + a store test (one undo step).
3. UI: `AlignSection` in the Properties panel (id `align` in `SECTION_IDS`), Object-menu group,
   titles and disabled reasons; browser check incl. icon meanings.
4. Docs: README (feature + roadmap), CLAUDE.md (architecture map), CHANGELOG. Final review.
