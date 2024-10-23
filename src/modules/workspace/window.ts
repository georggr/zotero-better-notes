import { config } from "../../../package.json";

export async function openWorkspaceWindow(
  item: Zotero.Item,
  options: { lineIndex?: number; sectionName?: string } = {},
) {
  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/workspaceWindow.xhtml`,
    "_blank",
    `chrome,centerscreen,resizable,status,dialog=no`,
    windowArgs,
  )!;
  await windowArgs._initPromise.promise;

  const container = win.document.querySelector(
    "#workspace-container",
  ) as XULBoxElement;
  const workspace = await addon.hooks.onInitWorkspace(container, item);
  workspace?.scrollEditorTo(options);

  win.focus();
  win.updateTitle();
  return win;
}
