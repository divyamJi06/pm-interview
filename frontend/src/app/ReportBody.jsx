import React, { useMemo } from 'react';
import { Disclosure, Section } from '../components/primitives';
import { verdictPill } from '../components/ui';
import { esc, VERDICT_CLASS, cn } from '../lib/utils';

function list(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c.filter(Boolean);
  }
  return [];
}

function orderPlan(plan, priorityOrder) {
  const items = Array.isArray(plan) ? plan.filter(Boolean) : [];
  if (!Array.isArray(priorityOrder) || !priorityOrder.length) return items;
  const rank = new Map(priorityOrder.map((p, i) => [typeof p === 'string' ? p : p && p.gap, i]));
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ra = rank.has(a.it && a.it.gap) ? rank.get(a.it.gap) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.it && b.it.gap) ? rank.get(b.it.gap) : Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((x) => x.it);
}

// The report used to present verdict, summary, patterns, gaps, coach plan,
// stage verdicts and resources in one undifferentiated stack, so a candidate
// had to read every analytical section before learning anything. This orders
// the same content as: where you stand, what went well, what to improve, your
// plan, and stage detail behind a disclosure.
export default function ReportBody({ payload }) {
  const model = useMemo(() => {
    const outer = (payload && payload.report) || {};
    const isMock = !!outer.report;
    const inner = isMock ? outer.report : null;
    const judge = payload && payload.feedback ? payload.feedback : null;
    const stageVerdicts = list(outer.stageVerdicts);

    const overall = (inner && inner.overall_verdict) || (judge && judge.verdict) || (judge && judge.overall_verdict) || null;
    const summary =
      (inner && inner.summary) ||
      (judge && judge.summary) ||
      (stageVerdicts.length ? stageVerdicts[stageVerdicts.length - 1].verdict.summary : '') ||
      '';

    const strengths = list(
      inner && inner.strengths,
      inner && inner.key_strengths,
      judge && judge.green,
      judge && judge.strengths,
      ...stageVerdicts.map((sv) => sv.verdict && sv.verdict.strengths)
    );

    const improve = list(
      inner && inner.top_things_to_work_on,
      judge && judge.red,
      judge && judge.gaps,
      ...stageVerdicts.map((sv) => sv.verdict && sv.verdict.gaps)
    );

    const patterns = list(inner && inner.cross_stage_patterns);
    const resources = list(inner && inner.recommended_resources);
    const plan = orderPlan(outer.action_plan, outer.priority_order);

    return { isMock, overall, summary, strengths, improve, patterns, resources, plan, stageVerdicts };
  }, [payload]);

  const hasAny = model.overall || model.summary || model.strengths.length || model.improve.length || model.plan.length;

  if (!hasAny) {
    return <p className="text-[18px] text-mute">No report has been generated for this round yet.</p>;
  }

  return (
    <div>
      <Section title="Overall" className="pt-0">
        <div className={cn('display text-[76px] leading-[0.95] md:text-[96px]', VERDICT_CLASS[model.overall] || '')}>
          {model.overall ? String(model.overall) : '—'}
        </div>
        {model.summary ? <p className="mt-6 max-w-[700px] text-[21px] leading-relaxed text-mute">{model.summary}</p> : null}
      </Section>

      {model.strengths.length ? (
        <Section title="What you did well">
          <BulletList items={model.strengths.slice(0, 3)} tone="good" />
        </Section>
      ) : null}

      {model.improve.length ? (
        <Section title="What to improve">
          <BulletList items={model.improve.slice(0, 3)} tone="weak" />
        </Section>
      ) : null}

      {model.plan.length ? (
        <Section title="Your coaching plan">
          <ol className="inset divide-y divide-line px-7">
            {model.plan.map((item, i) => (
              <li key={i} className="flex gap-6 py-5">
                <span className="display w-8 shrink-0 text-[30px] leading-none text-mute">{i + 1}</span>
                <span className="min-w-0 space-y-2">
                  <span className="block display text-[24px] leading-tight">{esc(item.gap || '')}</span>
                  {item.resource ? (
                    <span className="mono block text-[14px] text-mute">{esc(item.resource)}</span>
                  ) : null}
                  {item.how_to_practice ? (
                    <span className="block text-[18px] text-mute">{esc(item.how_to_practice)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {model.patterns.length || model.stageVerdicts.length || model.resources.length ? (
        <Disclosure summary="Explore stage feedback" className="mt-6">
          {model.patterns.length ? (
            <div className="mb-6">
              <div className="mb-2 display text-[24px]">Patterns across stages</div>
              <BulletList items={model.patterns} />
            </div>
          ) : null}

          {model.stageVerdicts.length ? (
            <div className="mb-6 space-y-3">
              <div className="display text-[24px]">Per-stage results</div>
              {model.stageVerdicts.map((sv, i) => (
                <div key={i} className="inset px-6 py-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="display text-[22px] leading-tight">{esc(String(sv.stage || '').replace(/_/g, ' '))}</span>
                    {sv.verdict ? verdictPill(sv.verdict.stage_verdict) : null}
                  </div>
                  {sv.verdict && sv.verdict.summary ? (
                    <p className="mt-2 text-[17px] text-mute">{esc(sv.verdict.summary)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {model.resources.length ? (
            <div>
              <div className="mb-2 display text-[24px]">Resources</div>
              <ul className="list-inside list-disc text-[18px] text-mute">
                {model.resources.map((r, i) => (
                  <li key={i}>{esc((r && (r.title || r.name)) || String(r))}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}

function BulletList({ items, tone }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'weak' ? 'text-weak' : 'text-ink';
  return (
    <ul className={cn('max-w-[820px] space-y-4', cls)}>
      {items.map((it, i) => (
        <li key={i} className="text-[21px] leading-relaxed">
          {esc(String(it))}
        </li>
      ))}
    </ul>
  );
}
