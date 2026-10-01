export function computeRegularTabLayout(
  trackWidth: number,
  tabCount: number,
  horizontalPadding = 5,
  selectorInset = 5,
) {
  const safeTabCount = Math.max(1, Math.floor(tabCount));
  const usableWidth = Math.max(0, trackWidth - horizontalPadding * 2);
  const slotWidth = usableWidth / safeTabCount;
  const selectorWidth = Math.max(
    0,
    Math.min(slotWidth, Math.max(52, slotWidth - selectorInset * 2)),
  );
  const selectorLeft = horizontalPadding + (slotWidth - selectorWidth) / 2;

  return {
    usableWidth,
    slotWidth,
    selectorWidth,
    selectorLeft,
    translateXForIndex: (index: number) =>
      Math.max(0, Math.min(safeTabCount - 1, index)) * slotWidth,
  };
}
