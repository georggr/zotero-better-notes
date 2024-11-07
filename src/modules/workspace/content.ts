import { Workspace } from "../../elements/workspace/workspace";
import { waitUtilAsync } from "../../utils/wait";

export async function initWorkspace(
  container: XULBoxElement,
  item: Zotero.Item,
) {
  if (!container) {
    return;
  }

  container.style.minWidth = "0px";
  container.style.minHeight = "0px";

  // @ts-ignore
  const customElements = container.ownerGlobal
    .customElements as CustomElementRegistry;

  await waitUtilAsync(() => !!customElements.get("bn-workspace"));

  const workspace = new (customElements.get("bn-workspace")!)() as Workspace;
  container.append(workspace);
  workspace.item = item;
  workspace.containerType = "tab";
  await workspace.render();
  return workspace;
}
