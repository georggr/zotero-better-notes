import { Plugin, PluginKey } from "prosemirror-state";
import { md2html } from "../../utils/convert";

export { initPasteMarkdownPlugin };

declare const _currentEditorInstance: {
  _editorCore: EditorCore;
};

function initPasteMarkdownPlugin() {
  const core = _currentEditorInstance._editorCore;
  console.log("Init BN Paste Markdown Plugin");
  const key = new PluginKey("pasteDropPlugin");
  const oldPlugins = core.view.state.plugins;
  const oldPastePluginIndex = oldPlugins.findIndex(
    (plugin) => plugin.props.handlePaste && plugin.props.handleDrop,
  );
  if (oldPastePluginIndex === -1) {
    console.error("Paste plugin not found");
    return;
  }
  const oldPastePlugin = oldPlugins[oldPastePluginIndex];
  const newState = core.view.state.reconfigure({
    plugins: [
      ...oldPlugins.slice(0, oldPastePluginIndex),
      new Plugin({
        key,
        props: {
          handlePaste: (view, event, slice) => {
            if (!event.clipboardData) {
              return false;
            }
            const markdown = getMarkdown(event.clipboardData);

            if (!markdown) {
              // Try the old paste plugin
              return oldPastePlugin.props.handlePaste?.apply(oldPastePlugin, [
                view,
                event,
                slice,
              ]);
            }

            md2html(markdown).then((html: string) => {
              const slice = window.BetterNotesEditorAPI.getSliceFromHTML(
                view.state,
                html,
              );
              const tr = view.state.tr.replaceSelection(slice);
              view.dispatch(tr);
            });
            return true;
          },
          handleDrop: (view, event, slice, moved) => {
            if (!event.dataTransfer) {
              return false;
            }

            const markdown = getMarkdown(event.dataTransfer);
            if (!markdown) {
              // Try the old drop plugin first
              return oldPastePlugin.props.handleDrop?.apply(oldPastePlugin, [
                view,
                event,
                slice,
                moved,
              ]);
            }

            md2html(markdown).then((html: string) => {
              const slice = window.BetterNotesEditorAPI.getSliceFromHTML(
                view.state,
                html,
              );
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (!pos) {
                return;
              }
              // Insert the slice to the current position
              const tr = view.state.tr.insert(pos.pos, slice);
              view.dispatch(tr);
            });

            return true;
          },
        },
      }),
      ...oldPlugins.slice(oldPastePluginIndex + 1),
    ],
  });
  core.view.updateState(newState);
}

function getMarkdown(clipboardData: DataTransfer) {
  // If the clipboard contains HTML, don't handle it
  if (clipboardData.types.includes("text/html")) {
    return false;
  }

  if (clipboardData.types.includes("text/markdown")) {
    return clipboardData.getData("text/markdown");
  }

  // For Typora
  if (clipboardData.types.includes("text/x-markdown")) {
    return clipboardData.getData("text/x-markdown");
  }

  // Match markdown patterns
  if (clipboardData.types.includes("text/plain")) {
    const text = clipboardData.getData("text/plain");
    const markdownPatterns = [
      /^#/m, // Headers: Lines starting with #
      /^\s*[-+*]\s/m, // Unordered lists: Lines starting with -, +, or *
      /^\d+\.\s/m, // Ordered lists: Lines starting with numbers followed by a dot
      /\[.*\]\(.*\)/, // Links: [text](url)
      /`[^`]+`/, // Inline code: `code`
      /^> /m, // Blockquotes: Lines starting with >
      /```/, // Code blocks: Triple backticks
    ];

    for (const pattern of markdownPatterns) {
      if (pattern.test(text)) {
        return text;
      }
    }
  }
  return false;
}