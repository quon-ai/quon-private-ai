// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export function RemoteDocPicker(_props: {
  open: boolean;
  onClose: () => void;
  browse: unknown;
  sourceName: string;
  onPick: (docs: { name: string; text: string }[]) => void;
}): null {
  return null;
}
