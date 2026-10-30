// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export type TitleKind = "paperless" | "mail";
export function rememberTitles(_kind: TitleKind, _items: unknown[]): void {}
export function lookupTitle(_kind: TitleKind, _id: number | string): string | undefined {
  return undefined;
}
export function resetTitleCache(): void {}
