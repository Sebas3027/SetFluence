import type { AgentActionLogEntry, PlanDiffEntry } from "@setfluence/shared";

export interface AgentTimelineProps {
  versionNumber: number;
  agentSummary: string;
  actionHistory: AgentActionLogEntry[];
  diffLog: PlanDiffEntry[];
}

export function AgentTimeline({
  versionNumber,
  agentSummary,
  actionHistory,
  diffLog,
}: AgentTimelineProps) {
  return (
    <section className="timeline-panel no-print">
      <div className="timeline-header">
        <div>
          <span className="eyebrow">Bounded Agent Audit Trail</span>
          <h3>Plan v{versionNumber} Decision & Tool Log</h3>
        </div>
        <span className="step-count-badge">
          {actionHistory.length} / 8 max steps used
        </span>
      </div>

      <p className="agent-summary-banner">{agentSummary}</p>

      {diffLog.length > 0 && (
        <div className="diff-log-box">
          <h4>Revision Changes vs. v{versionNumber - 1}</h4>
          <ul>
            {diffLog.map((diff, idx) => (
              <li key={idx}>
                <strong>{diff.stageId}</strong> ({diff.field}):{" "}
                <span className="diff-prev">{diff.previousValue ?? "None"}</span>{" "}
                → <span className="diff-next">{diff.nextValue ?? "None"}</span>{" "}
                — <span className="muted-text">{diff.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="timeline-steps">
        {actionHistory.map((step) => (
          <div key={step.id} className={`timeline-step status-${step.status}`}>
            <div className="timeline-step-top">
              <span className="step-badge">
                Step #{step.stepNumber} · {step.tool}
              </span>
              <span className="step-meta">
                {step.durationMs}ms · {step.status.toUpperCase()}
              </span>
            </div>
            <div className="step-io">
              <div>
                <strong>Input:</strong> {step.inputSummary}
              </div>
              <div>
                <strong>Result:</strong> {step.outputSummary}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
