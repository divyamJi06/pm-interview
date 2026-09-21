# Coaching resource bank — Software Engineering track

This is the curated list the Coach (and Synthesizer, for its resource
picks) is told to choose from — it should never invent a title or link
outside this file. Each entry: what gap it addresses, the gap's
dimension, a title, and a hint about why. Keep entries focused and
specific to engineering interview skills.

## Algorithms and data structures

- **Gap**: choosing between the many complexity-optimal answers (LRU, running median, binary search on answers).
- **Dimension**: algorithms
- **Title**: Competitive Programmer's Handbook
- **Hint**: concise full-coverage reference; good for pattern recognition, less theory-heavy than a textbook.

- **Gap**: getting stuck on a typed whiteboard when asked for complexity and follow-up optimizations.
- **Dimension**: algorithms
- **Title**: Cracking the Coding Interview — "Big O" chapter
- **Hint**: a quick pass on asymptotic reasoning and the classic optimization arc (space/time trade-offs).

## System design

- **Gap**: skipping requirements and jumping straight to boxes on system design prompts.
- **Dimension**: system_design
- **Title**: System Design Interview — An Insider's Guide (Alex Xu)
- **Hint**: step-by-step framework (requirements, estimation, architecture, deep dive) and realistic scale numbers.

- **Gap**: thin depth on the write path or hot read path of a designed system.
- **Dimension**: system_design
- **Title**: "Designing Data-Intensive Applications" — chapters on storage engines and replication
- **Hint**: grounds storage, replication, and consistency choices in real mechanisms.

## Debugging and incident response

- **Gap**: leaping to a root cause from the first hypothesis instead of narrowing with evidence.
- **Dimension**: debugging
- **Title**: The Debugging Mindset chapter in "The Pragmatic Programmer"
- **Hint**: formalizes hypothesis-testing and evidence discipline for software defects.

- **Gap**: stopping at a mitigation and never finding the root cause in incidents.
- **Dimension**: debugging
- **Title**: Google SRE Workbook — "Practicing Incident Response"
- **Hint**: shows the incident timeline, severity handling, and the blameless follow-up loop.

## Distributed systems

- **Gap**: hand-waving consistency trade-offs instead of explaining what breaks in a partition.
- **Dimension**: distributed_systems
- **Title**: "Designing Data-Intensive Applications" — replication and partition chapters
- **Hint**: the standard mental model for consistency, cap trades, and failure handling.

- **Gap**: proposing locks, counters, or queues without reasoning about timeouts and partial failure.
- **Dimension**: distributed_systems
- **Title**: "Understanding Distributed Systems" (Roberto Vitillo)
- **Hint**: short and practical on timeouts, retries, backoff, and cascading failure.

## Behavioral

- **Gap**: answers that stay in "we" and never land on personal ownership or reflection.
- **Dimension**: behavioral
- **Title**: The Progression Guild's Behavioral Interview Guide on patterns like STAR
- **Hint**: gives the closing-the-loop structure: situation, action, result, and the lesson.