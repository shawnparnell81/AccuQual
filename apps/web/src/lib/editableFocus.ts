/**
 * Global shortcuts must not steal keystrokes from a field the person is typing in.
 * A date input, a rich-text box, and a node inside that box all count.
 */
export function isEditableFocusTarget(target: EventTarget | null): boolean {
  let node = target as {
    nodeType?: number;
    parentElement?: typeof target | null;
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null;
  if (!node || typeof node !== "object") return false;
  if (node.nodeType === 3) node = (node.parentElement as typeof node) ?? null;

  while (node) {
    const tag = (node.tagName ?? "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (node.isContentEditable) return true;
    const role = node.getAttribute?.("role");
    if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
    const editable = node.getAttribute?.("contenteditable");
    if (editable != null && editable !== "false") return true;
    node = (node.parentElement as typeof node) ?? null;
  }
  return false;
}
