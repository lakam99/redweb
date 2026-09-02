# JSX performance-verifier correction

This changes the acceptance check, not Redweb's renderer. The previous predicate
counted 10,000 `<li ` occurrences and required only one escaped label. Executing
that exact predicate against malformed markup demonstrated a false pass despite
missing numeric children and closing tags. A separate duplicate-index regression
also failed before the correction: the verifier accepted the corrupted output.
Neither result demonstrates that the actual renderer produces incorrect markup.

One short-lived function now compares the complete expected list: every class,
index, escaped label, numeric child and closing tag. Its independent literal
oracle does not use the renderer under test. Validation runs after stopping the
render timer, and its temporary data is out of scope before retained-heap sampling.

The 10,000-row workload, original timing boundary, two GC calls, cleared page and
output references, negative-growth clamp, five-second render threshold and 32 MiB
retained-heap limit are unchanged. The stronger oracle is a harness revision;
it is not a rendering optimization or byte-identical repeat of historical heap
measurements.

A performance comparison cannot interrupt stuck synchronous JavaScript. CI now
supervises the default command with a two-minute external deadline. Native tests
run real CLI subprocesses with 10/30-second command bounds and owned termination;
the outer test allows 80 seconds for operations and cleanup. Direct manual command
invocations still need an external supervisor if a hard execution deadline is
required. No extra runtime worker or timer abstraction was added.

## Scoped verification

Windows / Node 22.21.0: the final maintained command passed 14 tests across two
suites in 2.408 seconds (the initial focused run passed in 2.560 seconds). The
maintained `npm run verify:jsx:coverage` command measures the original verifier:
27 statements, eight branches, four functions and 23 lines, all 100%. CI retains
this report on success or failure with a separate three-minute deadline.

Thirteen explicitly labelled boundary units cover malformed markup, missing GC,
slow rendering, excess retained heap, exact limit acceptance, negative-growth
clamping, sampling order and suppression of success output after failure. The
native integration test uses the real renderer, process, clock and GC for both
missing-GC rejection and the complete 10,000-row CLI workload, without API mocks.
It is separate from clean performance measurement; no native non-finite clock or
heap defect is claimed from fault injection.

Source `scripts/verify-jsx-performance.js` SHA-256:
`31e4a1d88a55cecdc3c604d8fb87e911d4e79a180a22517880903830e340aeca`.
Report `coverage/jsx-performance-tools/coverage-final.json` SHA-256:
`eb88af0e3318c48abd24fbf30e34ce4819a7ea98287a1c10c6cfb52cbcf0a7ef`.

The senior critic approved the scoped implementation, sampling parity, native
command budgets and separation of real evidence from boundary fault injection.
After the full regression exited and before rerunning scoped coverage, one clean
default JSX command passed 10,000 rows in 48.8 ms with 0.6 MiB retained, against
the unchanged 5,000 ms / 32 MiB limits. The smaller reported retained heap is not
claimed as a runtime improvement; the validation allocation pattern changed.
These 14 tests were added after the preceding full regression had selected its
test inventory; they are not retroactively included in that run. Hosted review,
remaining private-tool coverage and the separate unresolved throughput benchmark
remain distinct release requirements. No npm publication, deployment or merge is
claimed.
