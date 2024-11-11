import { config } from "../../../package.json";
import { PluginCEBase } from "../base";
import { NotePicker } from "./notePicker";
import { NotePreview } from "./notePreview";
import { OutlinePicker } from "./outlinePicker";
import { getPref, setPref } from "../../utils/prefs";

export class OutboundCreator extends PluginCEBase {
  notePicker!: NotePicker;
  noteOutline!: OutlinePicker;
  notePreview!: NotePreview;

  // Where the link is inserted to
  currentNote: Zotero.Item | undefined;
  // Where the link is generated from
  targetNotes: Zotero.Item[] | undefined;

  positionData: NoteNodeData | undefined;

  _openedNoteIDs: number[] = [];

  _currentLineIndex: number | undefined;

  loaded: boolean = false;

  get content() {
    return MozXULElement.parseXULToFragment(`
<linkset>
  <html:link
    rel="stylesheet"
    href="chrome://${config.addonRef}/content/styles/linkCreator/outboundCreator.css"
  ></html:link>
</linkset>
<bn-note-picker></bn-note-picker>
<bn-note-outline></bn-note-outline>
<bn-note-preview></bn-note-preview>
`);
  }

  get openedNoteIDs() {
    return this._openedNoteIDs;
  }

  set openedNoteIDs(val) {
    this._openedNoteIDs = val;
  }

  get item() {
    return this.currentNote;
  }

  set item(val) {
    this.currentNote = val;
  }

  async load(io: any) {
    if (this.loaded) return;
    this.openedNoteIDs = io.openedNoteIDs || [];
    this._currentLineIndex = io.currentLineIndex;
    this.item = Zotero.Items.get(io.currentNoteID);
    this.loadNotePicker();
    this.loadNoteOutline();
    this.loadNotePreview();
    this.loadInsertPosition();
    this.loaded = true;

    this.scrollToSection("picker");
  }

  async accept(io: any) {
    if (!this.targetNotes) return;
    const content = await this.getContentToInsert();
    this.notePicker.saveRecentNotes();

    io.targetNoteID = this.currentNote!.id;
    io.content = content;
    io.lineIndex = this.getIndexToInsert();
  }

  async loadNotePicker() {
    this.notePicker = this.querySelector("bn-note-picker") as NotePicker;
    this.notePicker.openedNoteIDs = this.openedNoteIDs;
    await this.notePicker.load();

    this.notePicker.addEventListener("selectionchange", (event: any) => {
      this.targetNotes = this.notePicker.getSelectedNotes();
      this.updatePickerTitle(this.targetNotes);
      this.updateNotePreview();
      if (this.targetNotes) this.scrollToSection("outline");
    });

    const content = document.createElement("span");
    content.innerHTML = "";
    content.dataset.l10nId = `${config.addonRef}-outbound-step1-content`;
    content.classList.add("toolbar-header", "content");
    const title = document.createElement("span");
    title.id = "selected-note-title";
    title.classList.add("toolbar-header", "highlight");
    this.notePicker
      .querySelector("#search-toolbar .toolbar-start")
      ?.append(content, title);
  }

  loadNoteOutline() {
    this.noteOutline = this.querySelector("bn-note-outline") as OutlinePicker;

    this.noteOutline.load();
    this.noteOutline.item = this.currentNote;
    if (typeof this._currentLineIndex === "number") {
      this.noteOutline.lineIndex = this._currentLineIndex;
    }
    this.noteOutline.render();
    this.positionData = undefined;
    this.updateNotePreview();

    this.noteOutline.addEventListener("selectionchange", (event: any) => {
      this.positionData = event.detail.selectedSection;
      this.updateNotePreview();
      this.updateOutlineTitle();
    });

    const content = document.createElement("span");
    content.dataset.l10nId = `${config.addonRef}-outbound-step2-content`;
    content.classList.add("toolbar-header", "content");
    const title = document.createElement("span");
    title.id = "selected-outline-title";
    title.classList.add("toolbar-header", "highlight");
    this.noteOutline
      .querySelector(".toolbar .toolbar-start")
      ?.append(content, title);
  }

  loadInsertPosition() {
    const insertPosition = this.querySelector(
      "#bn-link-insert-position",
    ) as HTMLSelectElement;
    insertPosition.value = getPref("insertLinkPosition") as string;

    insertPosition.addEventListener("command", () => {
      setPref("insertLinkPosition", insertPosition.value);
      this.updateNotePreview();
    });
  }

  loadNotePreview() {
    this.notePreview = this.querySelector("bn-note-preview") as NotePreview;

    const content = document.createElement("span");
    content.dataset.l10nId = `${config.addonRef}-outbound-step3-content`;
    content.classList.add("toolbar-header", "content");

    const fromTitle = document.createElement("span");
    fromTitle.id = "preview-note-from-title";
    fromTitle.classList.add("toolbar-header", "highlight");

    const middleTitle = document.createElement("span");
    middleTitle.id = "preview-note-middle-title";
    middleTitle.dataset.l10nId = `${config.addonRef}-outbound-step3-middle`;
    middleTitle.classList.add("toolbar-header", "content");

    const toTitle = document.createElement("span");
    toTitle.id = "preview-note-to-title";
    toTitle.classList.add("toolbar-header", "highlight");
    this.notePreview
      .querySelector(".toolbar .toolbar-start")
      ?.append(content, fromTitle, middleTitle, toTitle);
  }

  getPickedNotesTitle(noteItems?: Zotero.Item[]) {
    let title = "";
    if (!noteItems?.length) {
      title = "-";
    }
    if (noteItems?.length === 1) {
      title = noteItems[0].getNoteTitle();
    } else {
      title = `${noteItems?.length} notes`;
    }
    return title;
  }

  updatePickerTitle(noteItems?: Zotero.Item[]) {
    this.querySelector("#selected-note-title")!.textContent =
      this.getPickedNotesTitle(noteItems);
  }

  updateOutlineTitle() {
    const title = this.positionData?.name || "";
    this.querySelector("#selected-outline-title")!.textContent = title;
  }

  updatePreviewTitle() {
    this.querySelector("#preview-note-from-title")!.textContent =
      this.currentNote?.getNoteTitle() || "No title";
    (
      this.querySelector("#preview-note-middle-title") as HTMLElement
    ).dataset.l10nArgs = `{"show": "true"}`;
    this.querySelector("#preview-note-to-title")!.textContent =
      this.getPickedNotesTitle(this.targetNotes);
  }

  async updateNotePreview() {
    if (!this.loaded || !this.currentNote) return;

    const lines = await this._addon.api.note.getLinesInNote(this.currentNote, {
      convertToHTML: true,
    });
    let index = this.getIndexToInsert();
    if (index < 0) {
      index = lines.length;
    } else {
      this.scrollToSection("preview");
    }
    const before = lines.slice(0, index).join("\n");
    const after = lines.slice(index).join("\n");

    // TODO: use index or section
    const middle = await this.getContentToInsert();

    this.notePreview.render({ before, middle, after });
    this.updatePreviewTitle();
  }

  scrollToSection(type: "picker" | "outline" | "preview") {
    if (!this.loaded) return;
    const querier = {
      picker: "bn-note-picker",
      outline: "bn-note-outline",
      preview: "bn-note-preview",
    };
    const container = this.querySelector(querier[type]);
    if (!container) return;
    container.scrollIntoView({
      behavior: "smooth",
      inline: "center",
    });
  }

  async getContentToInsert() {
    if (!this.currentNote || !this.targetNotes?.length) return "";
    let content = "";
    for (const note of this.targetNotes) {
      const forwardLink = this._addon.api.convert.note2link(note, {});
      content += await this._addon.api.template.runTemplate(
        "[QuickInsertV2]",
        "link, linkText, subNoteItem, noteItem",
        [
          forwardLink,
          note.getNoteTitle().trim() || forwardLink,
          note,
          this.currentNote,
        ],
        {
          dryRun: true,
        },
      );
      content += "\n";
    }

    return content;
  }

  getIndexToInsert() {
    if (!this.positionData) return -1;
    let position = getPref("insertLinkPosition") as string;
    if (!["start", "end"].includes(position)) {
      position = "end";
    }
    let index = {
      start: this.positionData.lineIndex + 1,
      end: this.positionData.endIndex + 1,
    }[position];
    if (index === undefined) {
      index = -1;
    }
    return index;
  }
}
