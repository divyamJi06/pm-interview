# Coaching resource bank

This is the curated list the Coach (and Synthesizer, for its resource
picks) is told to choose from — it should never invent a title or link
outside this file. Each entry: what gap it addresses, which dimension(s)
it maps to (matching the scoring dimensions already in each stage's
`rubric.md`), and a real resource.

Covers cross-cutting basics first, then the four stages with finished
rubrics. Strategy, Execution/Metrics, and Technical resources are
included too since they're wired into `stage_order.md`, but flagged where
their rubric dimensions aren't finalized yet — the dimension tags there
are best-guess and should be reconciled once those rubrics are drafted.

---

## Cross-cutting basics (every stage)

These aren't stage-specific — they're delivery problems that undermine an
otherwise good answer in any stage, and are worth the Coach checking for
regardless of which stage a gap was flagged in.

### Rambling / answers running too long
**Dimension:** general_communication
**Problem:** Long-winded, unfocused answers that bury the actual point;
often driven by nervousness or by not having a clear structure in mind
before starting to talk.
**Resource:** [Giving answers that sound good to you (but aren't) — *Interview Speak*](https://livebook.manning.com/book/interview-speak/chapter-10) — covers rambling, over-explaining context before getting to actions, and answers that are too short as the opposite failure mode.

### Filler words and hedging speech habits
**Dimension:** general_communication
**Problem:** Frequent "um," "like," "you know," or an up-talking
sing-song delivery that reads as unprepared or unsure, even when the
content of the answer is solid.
**Resource:** [Six Sloppy Speech Habits — Military.com](https://www.military.com/veteran-jobs/career-advice/6-bad-interview-habits.html) — filler words, up-talk, and sloppy pronunciation, with fixes for each.

### Not actually answering the question asked
**Dimension:** general_communication
**Problem:** Going off on a tangent, answering an adjacent question
instead of the one asked, or padding with irrelevant context instead of
addressing the actual prompt.
**Resource:** [3 interview mistakes smart people make when they try to wing it](https://rallypoint.com/shared-links/3-interview-mistakes-smart-people-make-when-they-try-to-wing-it) — includes interviewer-side perspective on candidates going off-topic and never circling back to the question.

### Overusing "we," underusing "I"
**Dimension:** ownership
**Problem:** Describing team outcomes without ever clarifying personal
contribution — this shows up most in Behavioral but can leak into any
stage that asks "what would you do."
**Resource:** [Giving answers that sound good to you (but aren't) — *Interview Speak*](https://livebook.manning.com/book/interview-speak/chapter-10) — explicitly names "overusing we and underusing I" as a top mistake.

---

## Behavioral

### Not using a clear structure (STAR or equivalent)
**Dimension:** judgment
**Problem:** Disorganized, chronological retelling without a clear
situation → action → result shape, making it hard for the interviewer to
follow the reasoning or extract a signal.
**Resource:** [Mastering the STAR Method: A Guide to Behavioral Tech Interviews](https://dev.to/shashikumar_pattanashetti/mastering-the-star-method-a-guide-to-behavioral-tech-interviews-23gp) — breaks down what each STAR component actually requires, and the difference between using STAR mechanically vs. well.

### Forcing an irrelevant example to fit the question
**Dimension:** judgment
**Problem:** Reaching for a rehearsed story that doesn't quite answer
what was asked, rather than engaging with the actual question — reads as
not listening, or as underprepared for this specific prompt.
**Resource:** [Common STAR Method Mistakes — Educative](https://www.educative.io/courses/mastering-leadership-interviews/common-star-method-mistakes) — specifically on forcing a situation to fit and using irrelevant examples.

### Vague ownership / can't isolate personal contribution
**Dimension:** ownership
**Problem:** Story is told at the team level; when pressed on what the
candidate specifically did, the answer stays generic.
**Resource:** [What are the mistakes in a behavioral interview? — Design Gurus](https://designgurus.io/answers/detail/what-are-the-mistakes-in-a-behavioral-interview) — vague answers without specific examples, and rambling as a related failure mode.

### Missing or unquantified results
**Dimension:** impact
**Problem:** Story ends without a clear outcome, or the outcome is stated
without any way to gauge its scale or significance.
**Resource:** [PM Interview Questions: Real Examples, Frameworks, and Mistakes to Avoid — Best PM Jobs](https://bestpmjobs.typeflo.io/blog/pm-interview-questions) — PM-specific behavioral table calling out vague metrics and missing before/after impact as the key mistake to avoid.

---

## Estimation

### Jumping straight to a number without clarifying
**Dimension:** clarification
**Problem:** Treats the question as a trivia guess rather than a
structured problem — skips establishing scope before calculating.
**Resource:** [PM estimation interviews — RocketBlocks](https://rocketblocks.me/guide/pm/estimation-interviews.php) — explicitly walks through "the wrong way to approach an estimation question": too few assumptions, jumping too quickly to a conclusion.

### No clear equation or structure
**Dimension:** structure
**Problem:** Produces a number without ever showing the components that
were multiplied/divided together to reach it — no way for the interviewer
to audit the logic.
**Resource:** [Estimation interview questions — IGotAnOffer](https://igotanoffer.com/blogs/product-manager/estimation-interview-questions) — 4-step approach (clarify → map calculations → round and calculate → sense-check) with a worked example.

### Unstated or unjustified assumptions
**Dimension:** assumptions
**Problem:** Numbers appear without explanation of where they came from
or why they're reasonable — the interviewer can't tell if the logic holds
even if the process was otherwise fine.
**Resource:** [Tips to ace guesstimates in PM interviews](https://airtribe.substack.com/p/tips-to-ace-guesstimates-in-pm-interviews) — "make and justify reasonable assumptions" as its own explicit step, with the mistake to avoid spelled out directly.

### Over-precision instead of targeting the right ballpark
**Dimension:** execution
**Problem:** Gets bogged down chasing exact figures instead of using
clean, round numbers that are easy to reason with.
**Resource:** [How to answer guesstimate interview questions — Vault](https://legacy.vault.com/blogs/interviewing/how-to-answer-guesstimate-interview-questions) — the "round up and estimate" principle, with the reasoning that the logic matters more than assumption precision.

### No sanity check on the final number
**Dimension:** sanity_check
**Problem:** Arrives at an answer and stops, even when the number is
wildly implausible on reflection.
**Resource:** [Rubric for Estimation Interviews — Exponent](https://www.tryexponent.com/courses/google-pm-interview/estimation/estimation-rubric) — covers what interviewers are actually scoring, including error-checking as a core critical-thinking skill.

---

## Product design

### Jumping to features/solutions before understanding the problem
**Dimension:** user_focus
**Problem:** Starts listing app features in the first 30-60 seconds
without ever establishing who the user is or what problem is being
solved — the single most common product-design failure mode.
**Resource:** [10 Mistakes You Should Avoid When Answering Product Design Questions in PM Interviews](https://neverjobless.beehiiv.com/p/10-mistakes-you-should-avoid-when-answering-product-design-questions-in-pm-interviews-with-example) — "jumping to solutions too quickly" as mistake #1, with a worked before/after example.
**Resource:** [The Secret Framework Top PMs Use to Ace Product Sense Questions](https://pshimanshu.substack.com/p/the-secret-framework-top-pms-use) — a concrete real example of a candidate bombing a product sense answer in the first 60 seconds by doing exactly this.

### Mechanically reciting a framework instead of thinking
**Dimension:** structured_thinking
**Problem:** Checks off framework steps (CIRCLES or similar) without the
answer actually generating any real insight — technically structured,
but hollow.
**Resource:** [Why You Need to Move Beyond PM Interview Frameworks — Exponent](https://www.tryexponent.com/blog/why-move-beyond-pm-interview-frameworks/) — specifically diagnoses this plateau: candidates who know the steps but produce shallow answers because they're checking boxes rather than engaging with the question.
**Resource:** [The best advice I ever got for Product Design interviews](https://breakintopm.substack.com/p/the-best-advice-i-ever-got-for-product) — reframes frameworks as a guide, not a rubric to satisfy.

### Treating users as one homogeneous group
**Dimension:** goal_understanding
**Problem:** Names a single generic user type and never explores
different segments, contexts, or secondary users who also interact with
the product.
**Resource:** [10 Mistakes You Should Avoid When Answering Product Design Questions in PM Interviews](https://neverjobless.beehiiv.com/p/10-mistakes-you-should-avoid-when-answering-product-design-questions-in-pm-interviews-with-example) — covers this alongside the broader list of ten common missteps with fixes.

### No clear final recommendation
**Dimension:** solution_judgment
**Problem:** Generates many ideas but never converges on a prioritized
recommendation, leaving the interviewer without a clear sense of the
candidate's actual judgment.
**Resource:** [Avoid PM Frameworks Trap and Learn How to Answer Product Design Questions](https://upivot.substack.com/p/the-product-design-framework-trap) — on the difference between generating options and demonstrating product judgment by committing to one.

---

## Case study

### No methodical approach / can't articulate the thought process
**Dimension:** problem_structure
**Problem:** Arrives at conclusions without showing the reasoning that
got there — the interviewer can't follow or evaluate the thinking, even
if the final call is reasonable.
**Resource:** [How to solve product management case studies — The Product Folks](https://theproductfolks.com/product-management-blog/how-to-solve-product-management-case-studies) — names lack of methodical approach and failure to articulate thought process as the two core mistakes, plus a clarify-the-parameters step to open with.

### Waiting on the interviewer instead of driving
**Dimension:** ownership_drive
**Problem:** Repeatedly asks the interviewer what to do next instead of
proposing a direction and defending it — case interviews expect the
candidate to lead the conversation.
**Resource:** [How to solve product management case studies — The Product Folks](https://theproductfolks.com/product-management-blog/how-to-solve-product-management-case-studies) — same resource, also covers driving the conversation as a key strategy.

---

## Strategy (rubric not finalized yet — dimension tags below are provisional)

### Treating strategy questions like generic case studies
**Dimension:** (provisional) strategic_reasoning
**Problem:** Applies a case-interview structure without addressing what
makes strategy questions distinct — market entry, competitive dynamics,
long-term positioning — rather than just an operational decision.
**Resource:** [master project management job interviews skills strategies — Udemy course description](https://www.udemy.com/course/master-project-management-job-interviews-skills-strategies/) — describes what tech PM interviews specifically evaluate around strategy and metric hierarchies, useful as an overview even without taking the course.

---

## Execution / metrics

### No clear structure for metrics questions
**Dimension:** (provisional) metrics_reasoning
**Problem:** Lists metrics without organizing them (e.g. into a funnel or
hierarchy) or without tying them back to what's actually being optimized
for.
**Resource:** [Introduction to Analytical Questions — Exponent](https://www.tryexponent.com/courses/pm/analytical/intro-analytical) — covers what metrics questions are testing and common question types.

### Weak root-cause analysis reasoning
**Dimension:** (provisional) diagnostic_reasoning
**Problem:** Jumps to a fix without first narrowing down what actually
caused a metric to move, given multiple plausible explanations.
**Resource:** [Introduction to Execution Questions — Exponent](https://www.tryexponent.com/courses/execution/execution-intro) — explains the root-cause-analysis question format specifically, with real example prompts.

### Not accounting for conflicting or noisy metrics
**Dimension:** (provisional) metrics_reasoning
**Problem:** Treats a single metric in isolation without considering
what else might be moving in the opposite direction, or what could be
inflating/distorting the number.
**Resource:** [Introduction to Analytical/Execution Questions — Exponent](https://www.tryexponent.com/courses/google-pm-interview/analytical/analytical-execution-questions-intro) — covers conflicting-metric follow-ups and newer sources of metric noise.

---

## Technical (rubric not finalized yet)

No dedicated resources gathered yet for this stage — add once the
Technical rubric is drafted, so resources can be tagged against its real
dimensions rather than guessed.