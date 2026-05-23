const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const ROOT_HEIGHT_RATIO = 0.85;

const resizeObservers = new WeakMap<HTMLDivElement, ResizeObserver>();

export interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isNearBottom(messages: HTMLDivElement): boolean {
  const distance =
    messages.scrollHeight - (messages.scrollTop + messages.clientHeight);
  return distance <= SCROLL_BOTTOM_THRESHOLD_PX;
}

export function scrollToBottom(messages: HTMLDivElement): void {
  messages.scrollTop = messages.scrollHeight;
  const view = messages.ownerDocument?.defaultView;
  if (!view) {
    return;
  }
  view.requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
  view.setTimeout(() => {
    messages.scrollTop = messages.scrollHeight;
  }, 24);
}

export function captureScrollState(messages: HTMLDivElement): ScrollState {
  return {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
  };
}

export function restoreScrollPosition(
  messages: HTMLDivElement,
  state: ScrollState,
): void {
  const previousDistanceFromBottom = Math.max(
    0,
    state.scrollHeight - (state.scrollTop + state.clientHeight),
  );
  messages.scrollTop = Math.max(
    0,
    messages.scrollHeight - messages.clientHeight - previousDistanceFromBottom,
  );
}

function firstPositive(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return 480;
}

function computeFixedRootHeight(body: HTMLDivElement): number {
  const doc = body.ownerDocument;
  if (!doc) {
    return 360;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  const baseHeight = firstPositive(
    doc.defaultView ? Math.floor(doc.defaultView.innerHeight) : 0,
    doc.documentElement?.clientHeight,
    paneContent?.clientHeight,
    body.parentElement?.clientHeight,
    body.clientHeight,
  );
  return Math.max(220, Math.floor(baseHeight * ROOT_HEIGHT_RATIO));
}

function computeAvailableWidth(body: HTMLDivElement): number {
  const doc = body.ownerDocument;
  if (!doc) {
    return 300;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  return firstPositive(
    body.clientWidth,
    body.parentElement?.clientWidth,
    paneContent?.clientWidth,
  );
}

export function applyRootDimensions(
  root: HTMLDivElement,
  body: HTMLDivElement,
): void {
  const fixedHeight = computeFixedRootHeight(body);
  const availableWidth = computeAvailableWidth(body);
  root.style.height = `${fixedHeight}px`;
  root.style.minHeight = `${fixedHeight}px`;
  root.style.maxHeight = `${fixedHeight}px`;
  root.style.width = "100%";
  root.style.maxWidth = `${availableWidth}px`;
  root.style.overflow = "hidden";
}

export function ensureBodyResizeObserver(body: HTMLDivElement): void {
  if (resizeObservers.has(body)) {
    return;
  }
  const win = body.ownerDocument?.defaultView;
  if (!win) {
    return;
  }
  const ObserverCtor = (win as unknown as Record<string, unknown>)
    .ResizeObserver as
    | (new (callback: ResizeObserverCallback) => ResizeObserver)
    | undefined;
  if (!ObserverCtor) {
    return;
  }
  const observer = new ObserverCtor(() => {
    const root = body.querySelector<HTMLDivElement>(".za-agent-root");
    if (root) {
      applyRootDimensions(root, body);
    }
  });
  observer.observe(body);
  resizeObservers.set(body, observer);
}
