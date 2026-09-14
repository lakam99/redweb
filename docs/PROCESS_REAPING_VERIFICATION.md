# Descendant-reaping test synchronization

PR CI at `d24d734`, [run 33353677136, Node 22 job
99371666483](https://github.com/lakam99/redweb/actions/runs/33353677136/job/99371666483),
failed one test: the descendant PID was still addressable immediately after a
timed-out build returned. The job passed 915 tests, skipped five platform-specific
cases and failed one; library coverage remained all-four 100%. Its recovery step
was correctly skipped, not counted as passed. Other matrix and lifecycle jobs passed.

The frozen process helper sends a process-group kill on POSIX and awaits the root
process exit. That event does not notify the test that every descendant has been
reaped. Linux's [kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html) and
[wait(2)](https://man7.org/linux/man-pages/man2/waitpid.2.html) documentation explain
that an exited process can retain a visible PID until reaping. The failed log
does not establish whether that PID was running, dying, a zombie, or reused; the
historical failure is not relabelled as proven harmless.

The three descendant checks now reuse the existing bounded condition observer.
They require actual `ESRCH` within five seconds, preserve the final strict
process-existence assertion, and reject every other error. The observer neither
sends a signal nor treats zombies as absent. A new real-process negative control
proves a live survivor times out and remains alive until the test's separate
owner explicitly stops it. Original build/cleanup deadlines and frozen helpers
are unchanged; outer test deadlines now cover the sum of the existing phases
plus the bounded observation.

All eight actual-process tests passed locally on Windows/Node 22.21.0 in 4.84
seconds. Linux verification follows through ordinary CI, not selective retries.
The senior critic approved the synchronization contract and negative control;
this is a test correction, not a server recovery-policy or runtime change.
