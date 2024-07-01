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
      this.confirmLabel.textContent = text;
      this.confirmEvent = async (result: boolean) => {
        resolve(result);
      }
      this.confirmDialog.showModal();
    });
  }
}

export function supportsPlaintextEdit () 
{
  var dummy = document.createElement("div");
  dummy.setAttribute("contentEditable", "plaintext-only");
  return dummy.contentEditable === "plaintext-only";
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

export function getColorFromEffectID(effectID: number): string
{
  let effectGroup = (effectID >> 24) & 0xFF;
  let color:string = effectGroup === 0x01 ? "#C8B4D7" : // purple
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

export function getCellForMemorySlot(device: ZoomDevice, tableName: string, currentMemorySlot: number)
{
  let patchesTable = document.getElementById(tableName) as HTMLTableElement;

  let headerRow = patchesTable.rows[0];
  let numColumns = headerRow.cells.length / 2;

  let numPatchesPerRow = Math.ceil(device.patchList.length / numColumns);

  let rowNumber = 1 + currentMemorySlot % numPatchesPerRow;
  let row = patchesTable.rows[rowNumber];

  let cellNumber = Math.floor(2 * currentMemorySlot / numPatchesPerRow);
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

export function cleanupEditPatchTable() {
  let table: HTMLTableElement = document.getElementById("editPatchTableID") as HTMLTableElement;
  let row: HTMLTableRowElement = table.rows[0] as HTMLTableRowElement;
  let headerCell: HTMLTableCellElement = row.cells[0] as HTMLTableCellElement;
  let effectsRow = table.rows[1] as HTMLTableRowElement;
  headerCell.colSpan = 1;
  while (effectsRow.lastChild) effectsRow.removeChild(effectsRow.lastChild);
}

export function updateEditPatchTable(screenCollection: ZoomScreenCollection, patch: ZoomPatch | undefined, previousScreenCollection: ZoomScreenCollection | undefined, previousPatch: ZoomPatch | undefined): void
{
  function screenIsVisible(screen: ZoomScreen, screenNumber: number, patch: ZoomPatch | undefined) {
    return ! ((screen.parameters.length >= 2 && screen.parameters[1].name === "Blank") || 
              (patch !== undefined && patch.effectSettings !== null && screenNumber >= patch.effectSettings.length));
  }

  let table: HTMLTableElement = document.getElementById("editPatchTableID") as HTMLTableElement;  
  
  let row: HTMLTableRowElement = table.rows[0] as HTMLTableRowElement;
  let headerCell: HTMLTableCellElement = row.cells[0] as HTMLTableCellElement;
  let effectsRow = table.rows[1] as HTMLTableRowElement;

  if (patch != undefined)
    headerCell.textContent = "Patch: " + patch.nameTrimmed;

  let maxNumParamsPerLine = 4;

  // let offset = 6;
  // let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(data, offset);
  let numScreens = screenCollection.screens.length;

  // Number of visible screens === number of effects in the patch
  let numVisibleScreens = 0;
  for (let i=0; i<numScreens; i++)
    if (screenIsVisible(screenCollection.screens[i], i, patch))
      numVisibleScreens += 1;

  headerCell.colSpan = numVisibleScreens - row.cells.length + 1;
    
  // Remove superfluous td elements (effects) so we have one td element for each effect
  while (effectsRow.lastChild !== null && effectsRow.children.length > numVisibleScreens)
    effectsRow.removeChild(effectsRow.lastChild);

  // Add missing td elements (effects) so we have one td element (cell) for each effect. Each effect is a table within this td element.
  while (effectsRow.children.length < numVisibleScreens) {
    let td = document.createElement("td") as HTMLTableCellElement;
    effectsRow.appendChild(td);
  }

  let maxNumParameters = 0;
  for (let i=screenCollection.screens.length - 1; i>=0; i--)
    maxNumParameters = Math.max(maxNumParameters, screenCollection.screens[i].parameters.length - 2);

  let maxNumRowsPerEffect = Math.ceil(maxNumParameters/maxNumParamsPerLine); 

  let effectColumn = 0;
  for (let i=numScreens - 1; i>=0; i--) {
    let screen = screenCollection.screens[i];

    if (!screenIsVisible(screen, i, patch))
      continue;

    let cellWithEffectTable = effectsRow.children[effectColumn++] as HTMLTableRowElement;

    let effectTable: HTMLTableElement;
    let effectHeader: HTMLTableCellElement;

    if (cellWithEffectTable.children.length < 1) {
      effectTable = document.createElement("table");
      cellWithEffectTable.appendChild(effectTable);
      effectTable.className="editEffectTable";
      let tr = document.createElement("tr") as HTMLTableRowElement;
      effectTable.appendChild(tr);
      effectHeader = document.createElement("th") as HTMLTableCellElement;
      tr.appendChild(effectHeader);  
    }
    else {
      effectTable = cellWithEffectTable.children[0] as HTMLTableElement;
      effectHeader = effectTable.children[0].children[0] as HTMLTableCellElement;
    }

    let paramNameRow: HTMLTableRowElement | undefined = undefined;
    let paramValueRow: HTMLTableRowElement | undefined = undefined;

    let numColumns = Math.max(Math.min(screen.parameters.length - 2, maxNumParamsPerLine), 1);
    let numRowPairs = maxNumRowsPerEffect;        

    // remove superfluous rows
    while (effectTable.lastChild !== null && effectTable.children.length > 1 + numRowPairs * 2) {
      effectTable.removeChild(effectTable.lastChild);
    }

    // add rows if needed
    while (effectTable.children.length < 1 + numRowPairs * 2) {
      let row = document.createElement("tr");
      effectTable.append(row);
    }

    for (let rowNumber = 1; rowNumber < effectTable.children.length; rowNumber++) {
      // remove superfluous cells (columns)
      let row = effectTable.children[rowNumber]; 
      while(row.lastChild !== null && row.children.length > numColumns) {
        row.removeChild(row.lastChild);
      }

      // add missing cells (columns)
      while(row.children.length < numColumns) {
        let td = document.createElement("td") as HTMLTableCellElement;
        row.appendChild(td);
      }
    }

    effectHeader.colSpan = numColumns;

    if (patch !== undefined && patch.edtbEffectSettings !== null && i< patch.edtbEffectSettings.length) {
      let effectID = patch.edtbEffectSettings[i].id;
      let color = getColorFromEffectID(effectID);
      effectTable.style.backgroundColor = color;
    } 

    let numCellsPairsToFill = numColumns * numRowPairs;
    if (screen.parameters.length < 2) {
      console.info(`screen.parameters.length < 2`);
    }
    effectTable.className = (screen.parameters.length > 0 && screen.parameters[0].valueString === "0") ? "editEffectTable editEffectOff" : "editEffectTable";          
    effectHeader.textContent = screen.parameters.length > 1 ? screen.parameters[1].name : "BPM";

    for (let cellPairNumber=0; cellPairNumber<numCellsPairsToFill; cellPairNumber++) {
      let parameterNumber = cellPairNumber + 2;
      let rowPairNumber = Math.floor(cellPairNumber / numColumns);
      let columnNumber = cellPairNumber % numColumns;
      paramNameRow = effectTable.children[1 + rowPairNumber * 2] as HTMLTableRowElement;
      paramValueRow = effectTable.children[1 + rowPairNumber * 2 + 1] as HTMLTableRowElement;

      let td = paramNameRow.children[columnNumber] as HTMLTableCellElement;
      if (parameterNumber < screen.parameters.length) 
        td.textContent = screen.parameters[parameterNumber].name;
      else
        td.textContent = " ";

      td = paramValueRow.children[columnNumber] as HTMLTableCellElement;
      if (parameterNumber < screen.parameters.length) {
        let valueChanged = previousPatch !== undefined && patch !== undefined && previousPatch.name === patch.name && previousScreenCollection !== undefined &&
            previousScreenCollection.screens[i].parameters[parameterNumber].valueString !== screen.parameters[parameterNumber].valueString;
        let boldStart = valueChanged ? "<b>" : "";
        let boldEnd = valueChanged ? "</b>" : "";
        let valueString = screen.parameters[parameterNumber].valueString.replace(/\x17/g, "&#119137;").replace(/\x18/g, "&#119136;").replace(/\x19/g, "&#119135;").replace(/\x1A/g, "&#119134;");
        td.innerHTML = boldStart + valueString + boldEnd;
      }
      else
        td.textContent = " ";
    }
  }
}
