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
