import { getString } from "../../utils/locale";
import { truncate } from "../../utils/text";
import { createInlineCopyButton } from "../../utils/copyButton";
import type {
  AnnotationBatch,
  AnnotationProposal,
  AnnotationProposalStatus,
} from "./annotationProposals";
import { summarizeBatch } from "./annotationProposals";

export interface ProposalViewHandlers {
  onAccept: (proposalID: string) => void;
  onReject: (proposalID: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAlwaysAllow: () => void;
  onDismiss: () => void;
}

export function renderProposalBatch(
  doc: Document,
  batch: AnnotationBatch,
  handlers: ProposalViewHandlers,
): HTMLDivElement {
  const container = doc.createElement("div");
  container.className = "za-agent-proposal-batch";
  container.setAttribute("data-batch-id", batch.id);

  const header = doc.createElement("div");
  header.className = "za-agent-proposal-header";
  const title = doc.createElement("span");
  title.className = "za-agent-proposal-title";
  title.textContent = getString("agent-proposals-title");
  header.appendChild(title);

  const summary = summarizeBatch(batch);
  const countLabel = doc.createElement("span");
  countLabel.className = "za-agent-proposal-count";
  countLabel.textContent = getString("agent-proposals-summary", {
    args: {
      pending: String(summary.pending),
      accepted: String(summary.accepted),
      rejected: String(summary.rejected),
      failed: String(summary.failed),
    },
  });
  header.appendChild(countLabel);

  const batchActions = doc.createElement("div");
  batchActions.className = "za-agent-proposal-batch-actions";

  if (summary.pending > 0) {
    const acceptAll = doc.createElement("button");
    acceptAll.className =
      "za-agent-proposal-button za-agent-proposal-accept-all";
    acceptAll.textContent = getString("agent-proposals-accept-all");
    acceptAll.addEventListener("click", () => handlers.onAcceptAll());

    const alwaysAllow = doc.createElement("button");
    alwaysAllow.className =
      "za-agent-proposal-button za-agent-proposal-always-allow";
    alwaysAllow.textContent = getString("agent-proposals-always-allow");
    alwaysAllow.addEventListener("click", () => handlers.onAlwaysAllow());

    const rejectAll = doc.createElement("button");
    rejectAll.className =
      "za-agent-proposal-button za-agent-proposal-reject-all";
    rejectAll.textContent = getString("agent-proposals-reject-all");
    rejectAll.addEventListener("click", () => handlers.onRejectAll());

    batchActions.append(acceptAll, alwaysAllow, rejectAll);
  } else {
    const dismiss = doc.createElement("button");
    dismiss.className = "za-agent-proposal-button";
    dismiss.textContent = getString("agent-proposals-dismiss");
    dismiss.addEventListener("click", () => handlers.onDismiss());
    batchActions.append(dismiss);
  }
  header.appendChild(batchActions);
  container.appendChild(header);

  const list = doc.createElement("div");
  list.className = "za-agent-proposal-list";
  for (const proposal of batch.proposals) {
    list.appendChild(renderProposalCard(doc, proposal, handlers));
  }
  container.appendChild(list);
  return container;
}

function renderProposalCard(
  doc: Document,
  proposal: AnnotationProposal,
  handlers: ProposalViewHandlers,
): HTMLDivElement {
  const card = doc.createElement("div");
  card.className = `za-agent-proposal-card za-agent-proposal-${proposal.status}`;
  card.setAttribute("data-proposal-id", proposal.id);

  const top = doc.createElement("div");
  top.className = "za-agent-proposal-top";

  const opBadge = doc.createElement("span");
  opBadge.className = `za-agent-proposal-op za-agent-proposal-op-${proposal.op}`;
  opBadge.textContent = getString(`agent-proposals-op-${proposal.op}`);
  top.appendChild(opBadge);

  const typeBadge = doc.createElement("span");
  typeBadge.className = "za-agent-proposal-type";
  typeBadge.textContent = proposal.resolved.type;
  top.appendChild(typeBadge);

  const pageLabel = doc.createElement("span");
  pageLabel.className = "za-agent-proposal-page";
  pageLabel.textContent = `p.${proposal.resolved.pageLabel}`;
  top.appendChild(pageLabel);

  if (proposal.resolved.color) {
    const swatch = doc.createElement("span");
    swatch.className = "za-agent-proposal-color";
    swatch.style.background = proposal.resolved.color;
    top.appendChild(swatch);
  }

  const statusBadge = doc.createElement("span");
  statusBadge.className = `za-agent-proposal-status za-agent-proposal-status-${proposal.status}`;
  statusBadge.textContent = getString(
    `agent-proposals-status-${proposal.status}`,
  );
  top.appendChild(statusBadge);

  card.appendChild(top);

  const snippet = doc.createElement("div");
  snippet.className = "za-agent-proposal-snippet";
  snippet.textContent = truncate(proposal.sourceSnippet || "", 200);
  if (snippet.textContent) {
    card.appendChild(snippet);
  }

  if (proposal.resolved.comment) {
    const comment = doc.createElement("div");
    comment.className = "za-agent-proposal-comment";
    comment.textContent = truncate(proposal.resolved.comment, 200);
    card.appendChild(comment);
  }

  if (proposal.errorMessage) {
    const error = doc.createElement("div");
    error.className = "za-agent-proposal-error";
    const text = doc.createElement("span");
    text.className = "za-agent-proposal-error-text";
    text.textContent = proposal.errorMessage;
    const copyButton = createInlineCopyButton(
      doc,
      () => proposal.errorMessage || "",
    );
    error.append(text, copyButton);
    card.appendChild(error);
  }

  if (proposal.status === "pending") {
    const actions = doc.createElement("div");
    actions.className = "za-agent-proposal-card-actions";

    const accept = doc.createElement("button");
    accept.className = "za-agent-proposal-button";
    accept.textContent = getString("agent-proposals-accept");
    accept.addEventListener("click", () => handlers.onAccept(proposal.id));

    const reject = doc.createElement("button");
    reject.className = "za-agent-proposal-button za-agent-proposal-reject";
    reject.textContent = getString("agent-proposals-reject");
    reject.addEventListener("click", () => handlers.onReject(proposal.id));

    actions.append(accept, reject);
    card.appendChild(actions);
  }

  return card;
}

export function classifyProposalStatus(
  status: AnnotationProposalStatus,
): "pending" | "resolved" {
  return status === "pending" ? "pending" : "resolved";
}
