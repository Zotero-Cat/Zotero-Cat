import { assert } from "chai";
import {
  acceptAllPending,
  addProposals,
  annotationProposalsTestUtils,
  clearBatch,
  createBatch,
  getPendingApprovalKeys,
  getProposalApprovalKey,
  getBatchForConversation,
  hasPendingBatch,
  rejectAllPending,
  setProposalStatus,
  summarizeBatch,
} from "../src/modules/agent/annotationProposals";
import {
  annotationRepairTestUtils,
  buildFailedAnnotationRepairPrompt,
  shouldRepairFailedAnnotationBatch,
} from "../src/modules/agent/annotationRepair";

const SAMPLE = {
  op: "create" as const,
  attachmentKey: "ATTACH1",
  attachmentID: 42,
  resolved: {
    type: "highlight" as const,
    pageIndex: 2,
    pageLabel: "3",
    rects: [[10, 20, 30, 40]],
    text: "hello",
  },
  sourceSnippet: "hello",
};

describe("annotation proposals state machine", function () {
  beforeEach(function () {
    annotationProposalsTestUtils.reset();
  });

  it("creates a batch with pending proposals", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE]);
    assert.equal(batch.proposals.length, 2);
    assert.equal(batch.proposals[0].status, "pending");
    assert.isTrue(hasPendingBatch("conv1"));
  });

  it("preserves failed proposal inputs as non-actionable", function () {
    const batch = createBatch("conv1", 3, [
      {
        ...SAMPLE,
        status: "failed",
        errorMessage: "Could not locate text.",
      },
    ]);
    assert.equal(batch.proposals[0].status, "failed");
    assert.isFalse(hasPendingBatch("conv1"));
    assert.lengthOf(acceptAllPending("conv1"), 0);
  });

  it("recognizes failed quote-location proposals as repairable", function () {
    const batch = createBatch("conv1", 3, [
      {
        ...SAMPLE,
        status: "failed",
        errorMessage: "Could not locate the quoted text in the PDF.",
      },
    ]);

    assert.isTrue(
      shouldRepairFailedAnnotationBatch(batch, {
        alreadyRepaired: false,
        depth: 1,
        maxDepth: 3,
      }),
    );
    assert.isFalse(
      shouldRepairFailedAnnotationBatch(batch, {
        alreadyRepaired: true,
        depth: 1,
        maxDepth: 3,
      }),
    );
  });

  it("builds a repair prompt grounded in PDF tool results", function () {
    const batch = createBatch("conv1", 3, [
      {
        ...SAMPLE,
        status: "failed",
        errorMessage: "Could not locate the quoted text in the PDF.",
      },
    ]);
    const prompt = buildFailedAnnotationRepairPrompt(
      batch,
      "[tool:read-pdf]\n[p.3]\nhello world",
      "en",
    );

    assert.include(prompt, "continuous verbatim span");
    assert.include(prompt, "cross-page");
    assert.include(prompt, "hello world");
    assert.include(prompt, "propose_annotation");
  });

  it("collects repair targets only from highlight/underline locate failures", function () {
    const batch = createBatch("conv1", 3, [
      {
        ...SAMPLE,
        status: "failed",
        errorMessage: "Could not locate the quoted text in the PDF.",
      },
      {
        ...SAMPLE,
        resolved: { ...SAMPLE.resolved, type: "note", pageIndex: 5 },
        status: "failed",
        errorMessage: "Could not locate the quoted text in the PDF.",
      },
      {
        ...SAMPLE,
        attachmentID: 99,
        resolved: { ...SAMPLE.resolved, pageIndex: 7 },
        status: "failed",
        errorMessage: "Multiple PDF attachments found.",
      },
      {
        ...SAMPLE,
        resolved: { ...SAMPLE.resolved, pageIndex: 8 },
        status: "pending",
      },
    ]);
    const targets = annotationRepairTestUtils.collectRepairTargets(batch);
    // Only the highlight + "could not locate" entry survives.
    assert.equal(targets.size, 1);
    const pages = targets.get(42);
    assert.isDefined(pages);
    assert.deepEqual([...(pages || [])], [2]);
  });

  it("expands the repair page neighborhood by one on each side and clamps", function () {
    const { expandPageNeighborhood } = annotationRepairTestUtils;
    assert.deepEqual(
      [...expandPageNeighborhood(new Set([0, 3]), 5)].sort((a, b) => a - b),
      [0, 1, 2, 3, 4],
    );
    assert.deepEqual(
      [...expandPageNeighborhood(new Set([0]), 1)].sort((a, b) => a - b),
      [0],
    );
    assert.deepEqual(
      [...expandPageNeighborhood(new Set([4]), 5)].sort((a, b) => a - b),
      [3, 4],
    );
  });

  it("groups approval by operation and annotation type", function () {
    const batch = createBatch("conv1", 3, [SAMPLE]);
    assert.equal(
      getProposalApprovalKey(batch.proposals[0]),
      "create:highlight",
    );
    assert.deepEqual(getPendingApprovalKeys(batch), ["create:highlight"]);
    acceptAllPending("conv1");
    assert.deepEqual(getPendingApprovalKeys(batch), []);
  });

  it("caps proposals at the batch limit", function () {
    const over = Array.from(
      { length: annotationProposalsTestUtils.maxPerBatch + 5 },
      () => SAMPLE,
    );
    const batch = createBatch("conv1", 3, over);
    assert.equal(
      batch.proposals.length,
      annotationProposalsTestUtils.maxPerBatch,
    );
  });

  it("appends to an existing batch for the same assistant message", function () {
    createBatch("conv1", 3, [SAMPLE]);
    addProposals("conv1", 3, [SAMPLE, SAMPLE]);
    const batch = getBatchForConversation("conv1");
    assert.equal(batch?.proposals.length, 3);
  });

  it("replaces the batch when the assistant message index changes", function () {
    createBatch("conv1", 3, [SAMPLE]);
    addProposals("conv1", 4, [SAMPLE, SAMPLE]);
    const batch = getBatchForConversation("conv1");
    assert.equal(batch?.assistantMessageIndex, 4);
    assert.equal(batch?.proposals.length, 2);
  });

  it("marks proposals accepted individually", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "accepted");
    const summary = summarizeBatch(
      getBatchForConversation("conv1") as ReturnType<
        typeof getBatchForConversation
      > &
        object,
    );
    assert.equal(summary.accepted, 1);
    assert.equal(summary.pending, 1);
  });

  it("accepts or rejects all pending only", function () {
    const batch = createBatch("conv1", 3, [SAMPLE, SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "rejected");
    const accepted = acceptAllPending("conv1");
    assert.equal(accepted.length, 2);
    assert.isFalse(hasPendingBatch("conv1"));

    const batch2 = createBatch("conv1", 4, [SAMPLE, SAMPLE]);
    setProposalStatus("conv1", batch2.proposals[0].id, "failed", "bad");
    const rejected = rejectAllPending("conv1");
    assert.equal(rejected.length, 1);
  });

  it("clears batches", function () {
    createBatch("conv1", 3, [SAMPLE]);
    assert.isTrue(clearBatch("conv1"));
    assert.isFalse(hasPendingBatch("conv1"));
    assert.isNull(getBatchForConversation("conv1"));
  });

  it("keeps error messages when status is failed", function () {
    const batch = createBatch("conv1", 3, [SAMPLE]);
    setProposalStatus("conv1", batch.proposals[0].id, "failed", "boom");
    const updated = getBatchForConversation("conv1");
    assert.equal(updated?.proposals[0].errorMessage, "boom");
  });
});
