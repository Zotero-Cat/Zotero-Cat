import { assert } from "chai";
import { annotationToolsTestUtils } from "../src/modules/agent/annotationTools";
import { pdfReaderTestUtils } from "../src/modules/tools/pdfReader";
import { pdfAnnotationsTestUtils } from "../src/modules/tools/pdfAnnotations";

function makePage(
  pageIndex: number,
  pageHeight: number,
  spans: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
) {
  return {
    pageIndex,
    pageLabel: String(pageIndex + 1),
    pageWidth: 600,
    pageHeight,
    text: spans.map((s) => s.text).join(" "),
    spans,
  };
}

describe("pdf tools logic", function () {
  describe("pdf reader fuzzy matching", function () {
    it("normalizes whitespace before indexing", function () {
      const page = makePage(0, 800, [
        { text: "Hello   world", x: 0, y: 0, width: 100, height: 10 },
      ]);
      const { normalizedText } = pdfReaderTestUtils.buildNormalizedIndex(
        page.spans,
      );
      assert.equal(normalizedText, "hello world");
    });

    it("matches across adjacent spans", function () {
      const page = makePage(2, 800, [
        { text: "the quick ", x: 0, y: 100, width: 100, height: 12 },
        { text: "brown fox", x: 100, y: 100, width: 80, height: 12 },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "quick brown");
      assert.isNotNull(match);
      assert.equal(match?.pageIndex, 2);
      assert.equal(match?.rects.length, 1);
    });

    it("returns null when text is absent", function () {
      const page = makePage(0, 800, [
        { text: "alpha beta", x: 0, y: 0, width: 80, height: 10 },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "gamma delta");
      assert.isNull(match);
    });

    it("returns null for ambiguous matches without a target page", function () {
      const pages = [0, 1].map((index) =>
        makePage(index, 800, [
          {
            text: "shared phrase",
            x: 0,
            y: 100,
            width: 90,
            height: 10,
          },
        ]),
      );
      const match = pdfReaderTestUtils.findTextRects(
        pages,
        null,
        "shared phrase",
      );
      assert.isNull(match);
    });

    it("reorders search candidates by distance to target page", function () {
      const pages = [0, 1, 2, 3, 4].map((index) =>
        makePage(index, 800, [
          {
            text: `page${index}`,
            x: 0,
            y: 0,
            width: 50,
            height: 10,
          },
        ]),
      );
      const order = pdfReaderTestUtils
        .buildSearchOrder(pages, 2)
        .map((page) => page.pageIndex);
      assert.deepEqual(order, [2, 1, 3, 0, 4]);
    });

    it("constrains text matching to an explicit target page", function () {
      const pages = [0, 1].map((index) =>
        makePage(index, 800, [
          {
            text: index === 0 ? "target page text" : "shared phrase",
            x: 0,
            y: 100,
            width: 90,
            height: 10,
          },
        ]),
      );
      const looseMatch = pdfReaderTestUtils.findTextRects(
        pages,
        0,
        "shared phrase",
      );
      assert.equal(looseMatch?.pageIndex, 1);
      const strictMatch = pdfReaderTestUtils.findTextRects(
        pages,
        0,
        "shared phrase",
        { strictPage: true },
      );
      assert.isNull(strictMatch);
    });

    it("merges rects on the same visual line", function () {
      const spans = [
        { text: "abc", x: 10, y: 200, width: 15, height: 10 },
        { text: "def", x: 25, y: 200, width: 15, height: 10 },
      ];
      const rects = pdfReaderTestUtils.mergeSpanRects(spans, 800);
      assert.equal(rects.length, 1);
      assert.deepEqual(rects[0], [10, 200, 40, 210]);
    });

    it("matches when the PDF uses curly quotes and the model writes ASCII", function () {
      const page = makePage(0, 800, [
        {
          text: "“unusual” ‘insight’",
          x: 0,
          y: 0,
          width: 100,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "\"unusual\" 'insight'");
      assert.isNotNull(match);
    });

    it("matches em-dash / en-dash / minus to ASCII hyphen", function () {
      const page = makePage(0, 800, [
        {
          text: "chapter 3 — results 1–2 − outliers",
          x: 0,
          y: 0,
          width: 200,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.matchPage(
        page,
        "chapter 3 - results 1-2 - outliers",
      );
      assert.isNotNull(match);
    });

    it("matches a Unicode ellipsis to three ASCII dots", function () {
      const page = makePage(0, 800, [
        {
          text: "see appendix…",
          x: 0,
          y: 0,
          width: 60,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "see appendix...");
      assert.isNotNull(match);
    });

    it("strips soft hyphens used as line-break artifacts", function () {
      const page = makePage(0, 800, [
        {
          text: "discov­ery",
          x: 0,
          y: 0,
          width: 60,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.matchPage(page, "discovery");
      assert.isNotNull(match);
    });

    it("decomposes Latin ligatures emitted by PDF extractors", function () {
      const page = makePage(0, 800, [
        {
          text: "the ﬁnding ﬂies ﬀame",
          x: 0,
          y: 0,
          width: 120,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.matchPage(
        page,
        "the finding flies ffame",
      );
      assert.isNotNull(match);
    });

    it("rejoins words split across a PDF line break", function () {
      // pdf.js emits a hyphenated line-break as two text items, which we glue
      // with a space → "syn- chronous". The model writes "synchronous".
      const page = makePage(0, 800, [
        { text: "syn-", x: 0, y: 0, width: 30, height: 10 },
        { text: "chronous events", x: 30, y: 0, width: 90, height: 10 },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "synchronous events",
      );
      assert.isNotNull(match);
    });

    it("preserves inline compound hyphens", function () {
      // No whitespace after the hyphen → "anti-pattern" stays as-is.
      const page = makePage(0, 800, [
        { text: "the anti-pattern", x: 0, y: 0, width: 90, height: 10 },
      ]);
      const exactMatch = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "the anti-pattern",
      );
      assert.isNotNull(exactMatch);
      const noHyphenMatch = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "the antipattern",
      );
      assert.isNull(noHyphenMatch);
    });

    it("falls back for cannot/can not and line-break compound hyphen variants", function () {
      const page = makePage(0, 800, [
        {
          text: "Therefore, clustering cannot only isolate malicious clients but also improve the accuracy of intra-",
          x: 0,
          y: 0,
          width: 540,
          height: 10,
        },
        {
          text: "cluster models.",
          x: 540,
          y: 0,
          width: 80,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "Therefore, clustering can not only isolate malicious clients but also improve the accuracy of intra-cluster models.",
        { strictPage: true },
      );
      assert.isNotNull(match);
      assert.equal(match?.pageIndex, 0);
    });

    it("strips zero-width formatting chars from PDF spans", function () {
      const page = makePage(0, 800, [
        { text: "first​word", x: 0, y: 0, width: 60, height: 10 },
      ]);
      const match = pdfReaderTestUtils.findTextRects([page], 0, "firstword");
      assert.isNotNull(match);
    });

    it("unifies precomposed and decomposed accented characters", function () {
      // PDF span uses precomposed é (U+00E9); model writes decomposed e + ́.
      const page = makePage(0, 800, [
        { text: "café lab", x: 0, y: 0, width: 60, height: 10 },
      ]);
      const match = pdfReaderTestUtils.findTextRects([page], 0, "café lab");
      assert.isNotNull(match);
    });

    it("falls back to the prefix when the model abbreviates with a trailing ellipsis", function () {
      // glm-4.5-air sometimes ends a quote with `…` to elide trailing content.
      // The literal text (ending in an ellipsis) doesn't appear in the PDF, but
      // the prefix before the ellipsis does — accept that prefix as a match.
      const page = makePage(0, 800, [
        {
          text: "Low-Rank Adaptation is one of the most popular and widely used fine-tuning methods. LoRA uses two lower-dimensional matrices to approximate weight updates while the base model is frozen.",
          x: 0,
          y: 0,
          width: 600,
          height: 10,
        },
      ]);
      const unicodeMatch = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "Low-Rank Adaptation is one of the most popular and widely used fine-tuning methods. LoRA uses two lower-dimensional matrices to approximate…",
      );
      assert.isNotNull(unicodeMatch);
      const asciiMatch = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "Low-Rank Adaptation is one of the most popular and widely used fine-tuning methods. LoRA uses two lower-dimensional matrices to approximate...",
      );
      assert.isNotNull(asciiMatch);
    });

    it("falls back to the complete sentence before an ellipsis-truncated fragment", function () {
      const page = makePage(0, 800, [
        {
          text: "In contrast, our method maintains high accuracy in both normal and attack settings, with an average decrease of less than 1%.",
          x: 0,
          y: 0,
          width: 600,
          height: 10,
        },
        {
          text: "The improvement is especially clear in the strongest attack setting.",
          x: 0,
          y: 20,
          width: 480,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        null,
        "In contrast, our method maintains high accuracy in both normal and attack settings, with an average decrease of less than 1%. The improveme…",
      );
      assert.isNotNull(match);
      assert.equal(
        match?.matchedText,
        "In contrast, our method maintains high accuracy in both normal and attack settings, with an average decrease of less than 1%.",
      );
    });

    it("falls back to a complete sentence when a long quote has a nonverbatim continuation", function () {
      const page = makePage(0, 800, [
        {
          text: "We investigate how to train contrastive learning models fine-tuned with LoRA in a federated learning environment.",
          x: 0,
          y: 0,
          width: 600,
          height: 10,
        },
        {
          text: "The proposed protocol combines client sampling with robust aggregation.",
          x: 0,
          y: 20,
          width: 480,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "We investigate how to train contrastive learning models fine-tuned with LoRA in a federated learning environment. We propose an advanced personalized approach for malicious-client resistance.",
        { strictPage: true },
      );
      assert.isNotNull(match);
      assert.equal(
        match?.matchedText,
        "We investigate how to train contrastive learning models fine-tuned with LoRA in a federated learning environment.",
      );
    });

    it("does not accept an over-short prefix when stripping an ellipsis", function () {
      // Guard against eliding the entire quote down to a generic stub.
      assert.isNull(pdfReaderTestUtils.stripTrailingEllipsis("we..."));
      const page = makePage(0, 800, [
        {
          text: "we briefly note that the experiments were small.",
          x: 0,
          y: 0,
          width: 200,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects([page], 0, "we…");
      assert.isNull(match);
    });

    it("falls back to the longest verbatim substring when the model splices in paraphrase", function () {
      // The page contains a verbatim phrase the model copied, but the model
      // wrapped it in its own connective wording that doesn't appear in the
      // PDF. The LCS fallback locates the verbatim island and annotates it.
      const page = makePage(0, 800, [
        {
          text: "We train CLIP by aligning semantically matched images with texts in a contrastive batch.",
          x: 0,
          y: 0,
          width: 600,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "CLIP's training objective is to pair semantically matched images with texts into image-text pairs.",
      );
      assert.isNotNull(match);
      assert.include(
        match!.matchedText.toLowerCase(),
        "semantically matched images with texts",
      );
    });

    it("rejects an LCS fallback shorter than the minimum length", function () {
      const page = makePage(0, 800, [
        { text: "alpha beta gamma delta", x: 0, y: 0, width: 200, height: 10 },
      ]);
      // The only shared substring is "alpha" — far below the 40-char floor.
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        0,
        "alpha epsilon zeta eta theta iota kappa lambda mu",
      );
      assert.isNull(match);
    });

    it("skips the LCS fallback when no target page is given", function () {
      // Without a pinned page, fuzzy matching could over-trigger across pages.
      const page = makePage(0, 800, [
        {
          text: "We train CLIP by aligning semantically matched images with texts.",
          x: 0,
          y: 0,
          width: 600,
          height: 10,
        },
      ]);
      const match = pdfReaderTestUtils.findTextRects(
        [page],
        null,
        "CLIP's training pairs semantically matched images with texts via contrast.",
      );
      assert.isNull(match);
    });
  });

  describe("pdf annotation json builder", function () {
    it("normalizes color input", function () {
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor("#ff0000"),
        "#ff0000",
      );
      assert.equal(pdfAnnotationsTestUtils.normalizeColor("ff0000"), "#ff0000");
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor("not-a-color"),
        "#ffd400",
      );
      assert.equal(
        pdfAnnotationsTestUtils.normalizeColor(undefined),
        "#ffd400",
      );
    });

    it("builds a sort index matching Zotero's PPPPP|YYYYYY|XXXXX format", function () {
      const sortIndex = pdfAnnotationsTestUtils.buildSortIndex(
        3,
        [
          [10, 100, 200, 120],
          [10, 80, 200, 100],
        ],
        800,
      );
      // Zotero validates sortIndex against /^\d{5}\|\d{6,7}\|\d{5}$/
      assert.match(sortIndex, /^\d{5}\|\d{6,7}\|\d{5}$/);
      const parts = sortIndex.split("|");
      assert.equal(parts[0], "00003");
      assert.equal(parts[0].length, 5);
      assert.equal(parts[1].length, 6);
      assert.equal(parts[2].length, 5);
      // distance-from-top = pageHeight (800) - max y2 (120) = 680
      assert.equal(parts[1], "000680");
      // leftmost x = 10
      assert.equal(parts[2], "00010");
    });

    it("falls back to a default page height when none is provided", function () {
      const sortIndex = pdfAnnotationsTestUtils.buildSortIndex(0, [
        [0, 0, 10, 10],
      ]);
      assert.match(sortIndex, /^\d{5}\|\d{6,7}\|\d{5}$/);
    });

    it("generates a key for new annotation json", function () {
      const json = pdfAnnotationsTestUtils.buildAnnotationJSON(
        {
          type: "highlight",
          pageIndex: 0,
          pageLabel: "1",
          rects: [[10, 100, 20, 110]],
          text: "hello",
        },
        { libraryID: 1 } as Zotero.Item,
      );
      assert.match(json.key, /^[A-Z0-9]{8}$/);
      assert.equal(json.id, json.key);
    });

    it("clamps valid rects to the PDF page bounds", function () {
      const rects = pdfAnnotationsTestUtils.normalizeAnnotationRects(
        [[-10, 100, 610, 112]],
        600,
        800,
      );
      assert.deepEqual(rects, [[0, 100, 600, 112]]);
    });

    it("rejects oversized rects that would block PDF clicks", function () {
      const rects = pdfAnnotationsTestUtils.normalizeAnnotationRects(
        [[0, 0, 600, 800]],
        600,
        800,
      );
      assert.deepEqual(rects, []);
      assert.throws(() =>
        pdfAnnotationsTestUtils.buildAnnotationJSON(
          {
            type: "highlight",
            pageIndex: 0,
            pageLabel: "1",
            rects: [[0, 0, 600, 800]],
            pageWidth: 600,
            pageHeight: 800,
            text: "bad",
          },
          { libraryID: 1 } as Zotero.Item,
        ),
      );
    });
  });

  describe("pdf read tool page selection", function () {
    it("parses continuation page requests", function () {
      const request = annotationToolsTestUtils.resolveReadPdfPageRequest(
        "继续读取第4页及以后的内容",
        {},
      );
      assert.deepInclude(request, {
        explicitRange: true,
        fromIndex: 3,
      });
      assert.isUndefined(request.toIndex);
    });

    it("selects requested page ranges", function () {
      const pages = [0, 1, 2, 3, 4].map((index) =>
        makePage(index, 800, [
          {
            text: `page ${index + 1}`,
            x: 0,
            y: 100,
            width: 80,
            height: 10,
          },
        ]),
      );
      const selected = annotationToolsTestUtils.selectReadPdfPages(pages, {
        explicitRange: true,
        fromIndex: 3,
      });
      assert.deepEqual(
        selected.map((page) => page.pageLabel),
        ["4", "5"],
      );
    });

    it("rejects explicit page ranges without extractable selected text", function () {
      const pages = [makePage(0, 800, [])];
      assert.throws(
        () =>
          annotationToolsTestUtils.renderSelectedReadPdfPages(pages, {
            explicitRange: true,
            fromIndex: 0,
            toIndex: 0,
          }),
        /produced no extractable text/,
      );
    });

    it("marks truncated PDF reads so the model requests exact pages", function () {
      const attachment = { key: "ATTACH1", id: 42 } as Zotero.Item;
      const result = annotationToolsTestUtils.formatReadPdfResult(
        attachment,
        "x".repeat(9000),
      );

      assert.include(result, "attachmentKey=ATTACH1");
      assert.include(result, "read_pdf result truncated");
      assert.include(result, "target page");
      assert.include(result, "one page");
    });
  });

  describe("pdf annotation ownership", function () {
    it("accepts annotations owned by the target attachment", function () {
      const attachment = {
        id: 10,
        key: "ATTACH1",
        libraryID: 1,
      } as Zotero.Item;
      const annotation = {
        key: "ANN1",
        libraryID: 1,
        parentID: 10,
      } as Zotero.Item;
      assert.isTrue(
        pdfAnnotationsTestUtils.isAnnotationOnAttachment(
          annotation,
          attachment,
        ),
      );
    });

    it("rejects annotations from another attachment", function () {
      const attachment = {
        id: 10,
        key: "ATTACH1",
        libraryID: 1,
      } as Zotero.Item;
      const annotation = {
        key: "ANN1",
        libraryID: 1,
        parentID: 20,
      } as Zotero.Item;
      assert.isFalse(
        pdfAnnotationsTestUtils.isAnnotationOnAttachment(
          annotation,
          attachment,
        ),
      );
    });
  });
});
