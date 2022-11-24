/*
 * This file realizes note export.
 */

import Knowledge4Zotero from "../addon";
import { pick } from "../utils";
import AddonBase from "../module";

class NoteExport extends AddonBase {
  _exportPath: string;
  _exportFileInfo: Array<{
    link: string;
    id: number;
    note: Zotero.Item;
    filename: string;
  }>;
  _pdfPrintPromise: ZoteroPromise;
  _docxPromise: ZoteroPromise;
  _docxBlob: Blob;

  constructor(parent: Knowledge4Zotero) {
    super(parent);
    this._exportFileInfo = [];
  }

  async exportNote(
    note: Zotero.Item,
    options: {
      embedLink?: boolean;
      exportNote?: boolean;
      exportMD?: boolean;
      exportSubMD?: boolean;
      exportAutoSync?: boolean;
      exportHighlight?: boolean;
      convertSquare?: boolean;
      exportDocx?: boolean;
      exportPDF?: boolean;
      exportFreeMind?: boolean;
    } = {
      embedLink: true,
      exportNote: false,
      exportMD: true,
      exportSubMD: false,
      exportAutoSync: false,
      exportHighlight: false,
      convertSquare: false,
      exportDocx: false,
      exportPDF: false,
      exportFreeMind: false,
    }
  ) {
    // Trick: options containing 'export' all false? return
    if (
      !Object.keys(options)
        .filter((k) => k.includes("export"))
        .find((k) => options[k])
    ) {
      console.log("[BN] options containing 'export' all false");
      return;
    }
    this._exportFileInfo = [];

    let newNote: Zotero.Item;
    if (options.embedLink || options.exportNote) {
      const noteID = await ZoteroPane_Local.newNote();
      newNote = Zotero.Items.get(noteID) as Zotero.Item;
      const rootNoteIds = [note.id];

      const convertResult = await this._Addon.NoteUtils.convertNoteLines(
        note,
        rootNoteIds,
        options.embedLink
      );

      await this._Addon.NoteUtils.setLinesToNote(newNote, convertResult.lines);
      Zotero.debug(convertResult.subNotes);

      await Zotero.DB.executeTransaction(async () => {
        await Zotero.Notes.copyEmbeddedImages(note, newNote);
        for (const subNote of convertResult.subNotes) {
          await Zotero.Notes.copyEmbeddedImages(subNote, newNote);
        }
      });
    } else {
      newNote = note;
    }

    if (options.exportMD) {
      const filename = await pick(
        `${Zotero.getString("fileInterface.export")} MarkDown Document`,
        "save",
        [["MarkDown File(*.md)", "*.md"]],
        `${newNote.getNoteTitle()}.md`
      );
      if (filename) {
        this._exportPath = this._Addon.NoteUtils.formatPath(
          Zotero.File.pathToFile(filename).parent.path + "/attachments"
        );
        await this._exportMD(newNote, filename, false);
      }
    }
    if (options.exportDocx) {
      const instance: Zotero.EditorInstance =
        this._Addon.WorkspaceWindow.getEditorInstance(newNote);
      this._docxPromise = Zotero.Promise.defer();
      instance._iframeWindow.postMessage({ type: "exportDocx" }, "*");
      await this._docxPromise.promise;
      console.log(this._docxBlob);
      const filename = await pick(
        `${Zotero.getString("fileInterface.export")} MS Word Document`,
        "save",
        [["MS Word Document(*.docx)", "*.docx"]],
        `${newNote.getNoteTitle()}.docx`
      );
      if (filename) {
        await this._exportDocx(filename);
      }
    }
    if (options.exportPDF) {
      console.log(newNote);
      let _w: Window;
      let t = 0;
      ZoteroPane.selectItem(note.id);
      do {
        ZoteroPane.openNoteWindow(newNote.id);
        _w = ZoteroPane.findNoteWindow(newNote.id);
        console.log(_w);
        await Zotero.Promise.delay(10);
        t += 1;
      } while (!_w && t < 500);
      ZoteroPane.selectItem(note.id);
      _w.resizeTo(900, 650);
      const editor: any = _w.document.querySelector("#zotero-note-editor");
      t = 0;
      while (
        !(
          editor.getCurrentInstance &&
          editor.getCurrentInstance() &&
          editor.getCurrentInstance()._knowledgeSelectionInitialized
        ) &&
        t < 500
      ) {
        t += 1;
        await Zotero.Promise.delay(10);
      }
      const instance: Zotero.EditorInstance = editor.getCurrentInstance();
      instance._iframeWindow.document.querySelector("#bn-headings")?.remove();
      this._pdfPrintPromise = Zotero.Promise.defer();
      instance._iframeWindow.postMessage({ type: "exportPDF" }, "*");
      await this._pdfPrintPromise.promise;
      console.log("print finish detected");
      const closeFlag = _w.confirm(
        "Printing finished. Do you want to close the preview window?"
      );
      if (closeFlag) {
        _w.close();
      }
    }
    if (options.exportFreeMind) {
      const filename = await pick(
        `${Zotero.getString("fileInterface.export")} FreeMind`,
        "save",
        [["FreeMind(*.mm)", "*.mm"]],
        `${newNote.getNoteTitle()}.mm`
      );
      if (filename) {
        await this._exportFreeMind(newNote, filename);
      }
    }
    if (!options.exportNote) {
      if (newNote.id !== note.id) {
        const _w: Window = ZoteroPane.findNoteWindow(newNote.id);
        if (_w) {
          _w.close();
        }
        await Zotero.Items.erase(newNote.id);
      }
    } else {
      ZoteroPane.openNoteWindow(newNote.id);
    }
  }

  async exportNotesToMDFiles(
    notes: Zotero.Item[],
    useEmbed: boolean,
    useSync: boolean = false
  ) {
    Components.utils.import("resource://gre/modules/osfile.jsm");
    this._exportFileInfo = [];
    const filepath = await pick(
      Zotero.getString(useSync ? "sync.sync" : "fileInterface.export") +
        " MarkDown",
      "folder"
    );

    if (!filepath) {
      return;
    }

    this._exportPath = this._Addon.NoteUtils.formatPath(
      Zotero.File.pathToFile(filepath).parent.path + "/attachments"
    );

    notes = notes.filter((n) => n && n.getNote);

    if (useEmbed) {
      for (const note of notes) {
        let newNote: Zotero.Item;
        if (this._Addon.NoteParse.parseLinkInText(note.getNote())) {
          const noteID = await ZoteroPane_Local.newNote();
          newNote = Zotero.Items.get(noteID) as Zotero.Item;
          const rootNoteIds = [note.id];

          const convertResult = await this._Addon.NoteUtils.convertNoteLines(
            note,
            rootNoteIds,
            true
          );

          await this._Addon.NoteUtils.setLinesToNote(
            newNote,
            convertResult.lines
          );
          Zotero.debug(convertResult.subNotes);

          await Zotero.DB.executeTransaction(async () => {
            await Zotero.Notes.copyEmbeddedImages(note, newNote);
            for (const subNote of convertResult.subNotes) {
              await Zotero.Notes.copyEmbeddedImages(subNote, newNote);
            }
          });
        } else {
          newNote = note;
        }

        let filename = `${
          Zotero.File.pathToFile(filepath).path
        }/${await this._getFileName(note)}`;
        filename = filename.replace(/\\/g, "/");

        await this._exportMD(newNote, filename, newNote.id !== note.id);
      }
    } else {
      // Export every linked note as a markdown file
      // Find all linked notes that need to be exported
      let allNoteIds: number[] = notes.map((n) => n.id);
      for (const note of notes) {
        const linkMatches = note
          .getNote()
          .match(/zotero:\/\/note\/\w+\/\w+\//g);
        if (!linkMatches) {
          continue;
        }
        const subNoteIds = (
          await Promise.all(
            linkMatches.map(async (link) =>
              this._Addon.NoteUtils.getNoteFromLink(link)
            )
          )
        )
          .filter((res) => res.item)
          .map((res) => res.item.id);
        allNoteIds = allNoteIds.concat(subNoteIds);
      }
      allNoteIds = Array.from(new Set(allNoteIds));
      const allNoteItems: Zotero.Item[] = Zotero.Items.get(
        allNoteIds
      ) as Zotero.Item[];
      const noteLinkDict = [];
      for (const _note of allNoteItems) {
        noteLinkDict.push({
          link: this._Addon.NoteUtils.getNoteLink(_note),
          id: _note.id,
          note: _note,
          filename: await this._getFileName(_note),
        });
      }
      this._exportFileInfo = noteLinkDict;

      for (const noteInfo of noteLinkDict) {
        let exportPath = `${Zotero.File.pathToFile(filepath).path}/${
          noteInfo.filename
        }`;
        await this._exportMD(noteInfo.note, exportPath, false);
        if (useSync) {
          this._Addon.SyncController.updateNoteSyncStatus(
            noteInfo.note,
            Zotero.File.pathToFile(filepath).path,
            noteInfo.filename
          );
        }
      }
    }
  }

  async syncNotesToMDFiles(notes: Zotero.Item[], filepath: string) {
    this._exportPath = this._Addon.NoteUtils.formatPath(
      Zotero.File.pathToFile(filepath).parent.path + "/attachments"
    );

    // Export every linked note as a markdown file
    // Find all linked notes that need to be exported
    let allNoteIds: number[] = notes.map((n) => n.id);
    for (const note of notes) {
      const linkMatches = note.getNote().match(/zotero:\/\/note\/\w+\/\w+\//g);
      if (!linkMatches) {
        continue;
      }
      const subNoteIds = (
        await Promise.all(
          linkMatches.map(async (link) =>
            this._Addon.NoteUtils.getNoteFromLink(link)
          )
        )
      )
        .filter((res) => res.item)
        .map((res) => res.item.id);
      allNoteIds = allNoteIds.concat(subNoteIds);
    }
    allNoteIds = new Array(...new Set(allNoteIds));
    // console.log(allNoteIds);
    const allNoteItems: Zotero.Item[] = Zotero.Items.get(
      allNoteIds
    ) as Zotero.Item[];
    const noteLinkDict = [];
    for (const _note of allNoteItems) {
      noteLinkDict.push({
        link: this._Addon.NoteUtils.getNoteLink(_note),
        id: _note.id,
        note: _note,
        filename: await this._getFileName(_note),
      });
    }
    this._exportFileInfo = noteLinkDict;

    for (const note of notes) {
      const syncInfo = this._Addon.SyncController.getNoteSyncStatus(note);
      let exportPath = `${decodeURIComponent(
        syncInfo.path
      )}/${decodeURIComponent(syncInfo.filename)}`;
      await this._exportMD(note, exportPath, false);
      this._Addon.SyncController.updateNoteSyncStatus(note);
    }
  }

  private async _exportDocx(filename: string) {
    await Zotero.File.putContentsAsync(filename, this._docxBlob);
    this._Addon.ZoteroViews.showProgressWindow(
      "Better Notes",
      `Note Saved to ${filename}`
    );
  }

  private async _exportMD(
    note: Zotero.Item,
    filename: string,
    deleteAfterExport: boolean
  ) {
    const hasImage = note.getNote().includes("<img");
    if (hasImage) {
      await Zotero.File.createDirectoryIfMissingAsync(this._exportPath);
    }

    filename = this._Addon.NoteUtils.formatPath(filename);
    const content: string = await this._Addon.NoteParse.parseNoteToMD(note);
    console.log(
      `Exporting MD file: ${filename}, content length: ${content.length}`
    );
    await Zotero.File.putContentsAsync(filename, content);
    this._Addon.ZoteroViews.showProgressWindow(
      "Better Notes",
      `Note Saved to ${filename}`
    );
    if (deleteAfterExport) {
      const _w: Window = ZoteroPane.findNoteWindow(note.id);
      if (_w) {
        _w.close();
      }
      await Zotero.Items.erase(note.id);
    }
  }

  private async _exportFreeMind(noteItem: Zotero.Item, filename: string) {
    filename = this._Addon.NoteUtils.formatPath(filename);
    await Zotero.File.putContentsAsync(
      filename,
      this._Addon.NoteParse.parseNoteToFreemind(noteItem)
    );
    this._Addon.ZoteroViews.showProgressWindow(
      "Better Notes",
      `Note Saved to ${filename}`
    );
  }

  private async _getFileName(noteItem: Zotero.Item) {
    return (
      (await this._Addon.TemplateController.renderTemplateAsync(
        "[ExportMDFileName]",
        "noteItem",
        [noteItem]
      )) as string
    ).replace(/\\/g, "-");
  }
}

export default NoteExport;