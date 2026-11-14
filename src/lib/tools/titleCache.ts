// Stub: this feature is not part of this repository; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export type TitleKind = "paperless" | "mail";
export function rememberTitles(_kind: TitleKind, _items: unknown[]): void {}
export function lookupTitle(_kind: TitleKind, _id: number | string): string | undefined {
  return undefined;
}
export function resetTitleCache(): void {}
