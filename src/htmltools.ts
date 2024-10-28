/**
 * @module A collection of useful html-related functions 
 */

import { ZoomDevice } from "./ZoomDevice";
import { ZoomPatch } from "./ZoomPatch";
import { ZoomScreen, ZoomScreenCollection } from "./ZoomScreenInfo";

export class ConfirmDialog
{
  private confirmDialog: HTMLDialogElement;
  private confirmLabel: HTMLLabelElement;
  private confirmButton: HTMLButtonElement;
  private confirmEvent: (result: boolean) => void;

  constructor(dialogID: string, labelID: string, buttonID: string)
  {
    this.confirmDialog = document.getElementById(dialogID) as HTMLDialogElement;
    this.confirmLabel = document.getElementById(labelID) as HTMLLabelElement;
    this.confirmButton = document.getElementById(buttonID) as HTMLButtonElement;

    // Clear old event listeners
    // let clonedButton = this.confirmButton.cloneNode(true) as HTMLButtonElement;
    // this.confirmButton.parentNode?.replaceChild(clonedButton, this.confirmButton);
    // this.confirmButton = clonedButton;

    // let clonedDialog = this.confirmDialog.cloneNode(true) as HTMLDialogElement;
    // this.confirmDialog.parentNode?.replaceChild(clonedDialog, this.confirmDialog);
    // this.confirmDialog = clonedDialog;

    this.confirmButton.addEventListener("click", (event) => {
      event.preventDefault(); // 
      this.confirmDialog.close("ok");
      this.confirmEvent(true);
    });

    this.confirmEvent = (result: boolean) => {
      console.log("Confirm event result: " + result);
    }

    this.confirmDialog.addEventListener("close", (e) => {
      this.confirmEvent(false);
    });
  }

  public async getUserConfirmation(text: string): Promise<boolean>
  {
    return new Promise<boolean>( (resolve, reject) => {
      this.confirmLabel.innerHTML = text;
      this.confirmEvent = async (result: boolean) => {
        resolve(result);
      }
      this.confirmDialog.showModal();
    });
  }
}

export class InfoDialog
{
  private infoDialog: HTMLDialogElement;
  private infoLabel: HTMLLabelElement;
  private confirmButton: HTMLButtonElement | undefined;

  constructor(dialogID: string, labelID: string, buttonID: string = "")
  {
    this.infoDialog = document.getElementById(dialogID) as HTMLDialogElement;
    this.infoLabel = document.getElementById(labelID) as HTMLLabelElement;
    if (buttonID !== "") {
      this.confirmButton = document.getElementById(buttonID) as HTMLButtonElement;
      this.confirmButton.hidden = false;
      this.confirmButton.addEventListener("click", (event) => {
        event.preventDefault(); // 
        this.infoDialog.close("ok");
      });
      }
    else
      this.confirmButton = undefined;
  }

  public show(text: string): void
  {
    this.infoLabel.textContent = text;
    this.infoDialog.showModal();
  }

  public close(): void
  {
    this.infoDialog.close();
  }
}

let cachedSupportsContentEditablePlaintextOnly: boolean | undefined = undefined;

export function supportsContentEditablePlaintextOnly(): boolean
{
  if (cachedSupportsContentEditablePlaintextOnly === undefined) {
    var dummy = document.createElement("div");
    dummy.setAttribute("contentEditable", "plaintext-only");
    cachedSupportsContentEditablePlaintextOnly = dummy.contentEditable === "plaintext-only";
  }
  return cachedSupportsContentEditablePlaintextOnly;
}

/**
 * Prompts the user to select a file and loads the selected file
 * @param fileEnding 
 * @param fileDescription 
 * @returns [data, filename] where any of them can be undefined
 */
export async function loadDataFromFile(fileEnding: string, fileDescription: string): Promise<[Uint8Array | undefined, string | undefined]>
{
  return new Promise<[Uint8Array | undefined, string | undefined]> ( async (resolve, reject) => {
    let filename: string | undefined = undefined;
    try {
      if (window.showOpenFilePicker !== undefined) {
          const [fileHandle] = await window.showOpenFilePicker({
          types: [
            { description: fileDescription,
              accept: { "application/octet-stream" : [`.${fileEnding}`]}
            }
          ] 
        });
        filename = fileHandle.name;
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        resolve([data, filename]);
      } else {
        // Fallback to old-school file upload
        let input: HTMLInputElement = document.getElementById("fileInput") as HTMLInputElement;
        if (input === null) {
          input = document.createElement("input") as HTMLInputElement;
          input.id = "fileInput";
          input.type = "file";
          input.accept = `.${fileEnding}`;
          input.style.opacity = "0";
          let content = document.getElementById("content") as HTMLDivElement;
          content.appendChild(input);
        }

        // Clear old event listeners
        let clonedInput = input.cloneNode(true) as HTMLInputElement;
        input.parentNode?.replaceChild(clonedInput, input);
        input = clonedInput;
        input.files = null;
        input.value = "";

        input.addEventListener("change", () => {
          if (input.files !== null && input.files.length > 0)
            filename = input.files[0].name;
          console.log(`Selected filename: ${filename}`);
          const fileReader = new FileReader();
          fileReader.onload = (e) => {
            console.log("File loaded");
            if (fileReader.result != null) {
              let buffer = fileReader.result as ArrayBuffer;
              const data = new Uint8Array(buffer);
              resolve([data, filename]);
            }
          };
          if (input.files !== null)
            fileReader.readAsArrayBuffer(input.files[0])
        }, false);
        input.click();
      }
    } catch (err) {
      console.log("Exception when attempting to load file " + filename + " " + err); 
      resolve([undefined, filename]);
    }
  });
}

export async function saveBlobToFile(blob: Blob, suggestedName: string, fileEnding: string, fileDescription: string) {
  try {
    let newHandle;
    if (window.showSaveFilePicker !== undefined) {
      newHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [
          {
            description: fileDescription,
            accept: { "application/octet-stream": [`.${fileEnding}`] }
          }
        ]
      });
      const writableStream = await newHandle.createWritable();
      await writableStream.write(blob);
      await writableStream.close();
    }
    else {
      // Fallback to old-school file download
      let dummy = document.createElement("a");
      dummy.href = URL.createObjectURL(blob);
      dummy.target = "_blank";
      dummy.download = suggestedName;
      dummy.click();
    }
  } catch (err) {
    console.warn(err);
  }
}

export function getChildWithIDThatStartsWith(children: HTMLCollection, startsWidth: string) : HTMLElement | null
{
  let index = 0;
  while (index < children.length) {
    let item = children.item(index++) as HTMLElement;
    if (item.id.startsWith(startsWidth))
      return item;
  }
  return null;
}

/**
 * Removes all event listeners from the given HTMLElement by replacing it with a clone.
 *
 * @param {HTMLElement} element - the HTMLElement to remove event listeners from
 * @return {HTMLElement} the cloned HTMLElement with no event listeners
 */
export function removeAllEventListeners(element: HTMLElement): HTMLElement
{
    let clonedElement = element.cloneNode(true) as HTMLElement;
    element.parentNode?.replaceChild(clonedElement, element);
    return clonedElement;
}

/**
 * Adds the given CSS style to the document.
 * @param {string} styleString - a string containing valid CSS
 * @returns {HTMLStyleElement} - the added style element
 */
export function addStyle(styleString: string) : HTMLStyleElement
{
  const style = document.createElement("style");
  style.textContent = styleString;
  document.head.append(style);
  return style;
}

export function htmlToElement(html: string): HTMLElement
{
  let template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

export function getColorFromEffectID(effectID: number): string
{
  let effectGroup = (effectID >> 24) & 0xFF;
  let color:string = effectGroup === 0x00 ? "#E8E69E" : // yellow (BPM is the only known module with ID 0)
    effectGroup === 0x01 ? "#C8B4D7" : // purple
    effectGroup === 0x02 ? "#FFE2BF" : // orange
    effectGroup === 0x03 ? "#F7BFB9" : // red
    effectGroup === 0x04 ? "#F7BFB9" : // red
    effectGroup === 0x06 ? "#ADF2F4" : // turquoise
    effectGroup === 0x07 ? "#E8E69E" : // yellow
    effectGroup === 0x08 ? "#A5BBE1" : // blue
    effectGroup === 0x09 ? "#ABD3A3" : // green
    "#FFFFFF";
  return color;
}

export function getCellForMemorySlot(device: ZoomDevice, tableName: string, currentMemorySlot: number): HTMLTableCellElement | undefined
{
  let patchesTable = document.getElementById(tableName) as HTMLTableElement;

  let headerRow = patchesTable.rows[0];
  let numColumns = headerRow.cells.length / 2;

  let numPatchesPerRow = Math.ceil(device.patchList.length / numColumns);

  let rowNumber = 1 + currentMemorySlot % numPatchesPerRow;

  if (patchesTable.rows === undefined || patchesTable.rows.length <= rowNumber)
    return undefined;

  let row = patchesTable.rows[rowNumber];

  let cellNumber = Math.floor(2 * currentMemorySlot / numPatchesPerRow);

  if (row.cells === undefined || row.cells.length <= cellNumber)
    return undefined;

  let selected = row.cells[cellNumber] as HTMLTableCellElement;
  return selected;
}

export function togglePatchesTablePatch(cell: HTMLTableCellElement)
{
  let cellNumber = parseInt(cell.id);
  if (cellNumber === undefined)
    return;
  let row = cell.parentElement as HTMLTableRowElement;
  if (row === null)
    return;
  let column = Math.floor(cellNumber / 2);
  row.cells[column * 2].classList.toggle("highlight");
  row.cells[column * 2 + 1].classList.toggle("highlight");
}

export function getPatchNumber(cell: HTMLTableCellElement) : number
{
  let cellNumber = parseInt(cell.id);
  if (cellNumber === undefined)
    return -1;
  let row = cell.parentElement as HTMLTableRowElement;
  if (row === null)
    return -1;
  let column = Math.floor(cellNumber / 2);
  let text = row.cells[column * 2].textContent;
  if (text === null)
    return -1;
  return parseInt(text);
}
