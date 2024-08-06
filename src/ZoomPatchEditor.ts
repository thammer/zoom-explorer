import { getColorFromEffectID, supportsContentEditablePlaintextOnly } from "./htmltools.js";
import { EffectParameterMap, ParameterValueMap, ZoomDevice } from "./ZoomDevice.js";
import { ZoomPatch } from "./ZoomPatch.js";
import { ZoomScreen, ZoomScreenCollection } from "./ZoomScreenInfo.js";


export type EditPatchTextEditedListenerType = (event: Event, type: string, dirty: boolean) => boolean;

let debugCounter = 0;

export class ZoomPatchEditor
{
  private textEditedCallback: EditPatchTextEditedListenerType | undefined = undefined;

  private undoOnEscape = "";
  private muteBlurOnEscape = false;

  private patchEditorTable: HTMLTableElement;
  private effectsTable: HTMLTableElement;
  private effectsRow: HTMLTableRowElement;

  private patchNameRow: HTMLTableRowElement;
  private patchNumberCell: HTMLTableCellElement;
  private patchNameCell: HTMLTableCellElement;
  private patchTempoCell: HTMLTableCellElement;
  private patchDescriptionRow: HTMLTableRowElement;
  private patchDescriptionCell: HTMLTableCellElement;

  constructor()
  {
    this.patchEditorTable = document.getElementById("editPatchTableID") as HTMLTableElement;
    let lastRow = this.patchEditorTable.rows[this.patchEditorTable.rows.length -1] as HTMLTableRowElement;
    let lastCell = lastRow.children[0] as HTMLTableCellElement;
    this.effectsTable = lastCell.children[0] as HTMLTableElement;
    this.effectsRow = this.effectsTable.rows[0] as HTMLTableRowElement;
  
    while (this.effectsRow.lastChild) 
      this.effectsRow.removeChild(this.effectsRow.lastChild);
  
    this.patchNameRow = this.patchEditorTable.rows[0] as HTMLTableRowElement;
    this.patchNumberCell = this.patchNameRow.cells[0] as HTMLTableCellElement;
    this.patchNameCell = this.patchNameRow.cells[1] as HTMLTableCellElement;
    this.patchTempoCell = this.patchNameRow.cells[2] as HTMLTableCellElement;
    this.patchDescriptionRow= this.patchEditorTable.rows[1] as HTMLTableRowElement;
    this.patchDescriptionCell = this.patchDescriptionRow.cells[0] as HTMLTableCellElement;
      
    for (let cell of [this.patchNameCell, this.patchTempoCell, this.patchDescriptionCell]) {
      this.setupEventListenersForCell(cell);
    }
  }

  setTextEditedCallback(textEditedCallback: EditPatchTextEditedListenerType) 
  { 
    this.textEditedCallback = textEditedCallback;
  }

  getEffectAndParameterNumber(str: string): [effectSlot: number | undefined, parameterNumber: number | undefined] {
    let values = str.match(/effectSlot: (\d+), parameterNumber: (\d+)/);
    if (values === null || values.length !== 3) // [complete match, effectSlot, parameterNumber]
      return [undefined, undefined];
    return [parseInt(values[1]), parseInt(values[2])];
  }

  private encodeEffectAndParameterNumber(effectSlot: number, parameterNumber: number): string
  {
    return `effectSlot: ${effectSlot}, parameterNumber: ${parameterNumber}`;
  }

  getCell(effectSlot: number, parameterNumber: number): HTMLTableCellElement | undefined 
  {
    let id = this.encodeEffectAndParameterNumber(effectSlot, parameterNumber);
    let cell = document.getElementById(id) as HTMLTableCellElement;
    if (cell === undefined)
      return undefined;
    return cell;
  }

  private setupEventListenersForCell(cell: HTMLTableCellElement) {
    if (cell !== undefined) {
      cell.contentEditable = supportsContentEditablePlaintextOnly() ? "plaintext-only" : "true";

      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          cell.blur();
        }
        else if (e.key === "Escape" || e.key === "Esc") {
          cell.innerText = this.undoOnEscape;
          if (this.textEditedCallback !== undefined)
            this.textEditedCallback(e, "input", cell.innerText !== this.undoOnEscape);
          this.muteBlurOnEscape = true;
          cell.blur();
          this.muteBlurOnEscape = false;
        }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown" || e.key === "Tab") {
          e.preventDefault();
          if (this.textEditedCallback !== undefined)
            this.textEditedCallback(e, "key", cell.innerText !== this.undoOnEscape);
          }
      });

      cell.addEventListener("input", (e) => {
        if (this.textEditedCallback !== undefined)
          this.textEditedCallback(e, "input", cell.innerText !== this.undoOnEscape);
      });

      cell.addEventListener("focus", (e) => {
        this.undoOnEscape = cell.innerText;
        if (this.textEditedCallback !== undefined)
          this.textEditedCallback(e, "focus", cell.innerText !== this.undoOnEscape);
      });

      cell.addEventListener("blur", (e) => {
        if (!this.muteBlurOnEscape)
          if (this.textEditedCallback !== undefined) {
            let acceptEdit = this.textEditedCallback(e, "blur", cell.innerText !== this.undoOnEscape);
            if (!acceptEdit)
              cell.innerText = this.undoOnEscape;
          }
      });
    }
  }

  update(device: ZoomDevice, screenCollection: ZoomScreenCollection | undefined, patch: ZoomPatch | undefined, memorySlotNumber: number, 
    previousScreenCollection: ZoomScreenCollection | undefined, previousPatch: ZoomPatch | undefined): void
  {
    function screenIsVisible(screen: ZoomScreen, screenNumber: number, patch: ZoomPatch | undefined) {
      return ! ((screen.parameters.length >= 2 && screen.parameters[1].name === "Blank") || 
                (patch !== undefined && patch.effectSettings !== null && screenNumber >= patch.effectSettings.length));
    }

    console.log(`ZoomPatchEditor.update() - ${debugCounter++}`);	

    if (patch !== undefined) {
      this.patchNumberCell.textContent = `Patch ${(memorySlotNumber + 1).toString().padStart(2, "0")}:`;
      let newPatchName = patch.nameTrimmed;
      if (this.patchNameCell.textContent !== newPatchName) {
        this.patchNameCell.textContent = newPatchName;
        this.patchNameCell.blur();
      }
      let newPatchTempo = patch.tempo.toString().padStart(3, "0");
      if (this.patchTempoCell.textContent !== newPatchTempo) {
        this.patchTempoCell.textContent = newPatchTempo;
        this.patchTempoCell.blur();
      }
      let newPatchDescription = patch.descriptionEnglishTrimmed;
      if (this.patchDescriptionCell.textContent !== newPatchDescription) {
        this.patchDescriptionCell.textContent = newPatchDescription;
        this.patchDescriptionCell.blur();
      }
    }

    if (screenCollection === undefined)
      return;

    let maxNumParamsPerLine = device.numParametersPerPage;

    // let offset = 6;
    // let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(data, offset);
    let numScreens = screenCollection.screens.length;

    // Number of visible screens === number of effects in the patch
    let numVisibleScreens = 0;
    for (let i=0; i<numScreens; i++)
      if (screenIsVisible(screenCollection.screens[i], i, patch))
        numVisibleScreens += 1;
      
    // Remove superfluous td elements (effects) so we have one td element for each effect
    while (this.effectsRow.lastChild !== null && this.effectsRow.children.length > numVisibleScreens)
      this.effectsRow.removeChild(this.effectsRow.lastChild);

    // Add missing td elements (effects) so we have one td element (cell) for each effect. Each effect is a table within this td element.
    while (this.effectsRow.children.length < numVisibleScreens) {
      let td = document.createElement("td") as HTMLTableCellElement;
      this.effectsRow.appendChild(td);
    }

    let maxNumParameters = 0;
    for (let i=screenCollection.screens.length - 1; i>=0; i--)
      maxNumParameters = Math.max(maxNumParameters, screenCollection.screens[i].parameters.length - 2);

    let maxNumRowsPerEffect = Math.ceil(maxNumParameters/maxNumParamsPerLine); 

    let effectColumn = 0;
    for (let effectSlot=numScreens - 1; effectSlot>=0; effectSlot--) {
      let screen = screenCollection.screens[effectSlot];

      if (!screenIsVisible(screen, effectSlot, patch))
        continue;

      let cellWithEffectTable = this.effectsRow.children[effectColumn++] as HTMLTableRowElement;

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

      let effectID: number = -1;
      let effectColor: string = "";
      let backgroundImageString = ""

      if (patch !== undefined && patch.effectSettings !== null && effectSlot< patch.effectSettings.length) {
        effectID = patch.effectSettings[effectSlot].id;
        effectColor = getColorFromEffectID(effectID);

        let r = parseInt(effectColor.substring(1,3), 16);
        let g = parseInt(effectColor.substring(3,5), 16);
        let b = parseInt(effectColor.substring(5,7), 16);
        let rmin = r * 0.9;
        let gmin = g * 0.9;
        let bmin = b * 0.9;
        let rmax = r * 1.15;
        let gmax = g * 1.15;
        let bmax = b * 1.15;
        let rmaxline = rmax * 1.15;
        let gmaxline = gmax * 1.15;
        let bmaxline = bmax * 1.15;
        backgroundImageString = `linear-gradient(to right, rgba(${rmin}, ${gmin}, ${bmin}, 1) 0%, rgba(${rmax}, ${gmax}, ${bmax}, 1) 90%, rgba(${rmaxline}, ${gmaxline}, ${bmaxline}, 1) 100%)`;
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
          let cellShouldBeEditable = (rowNumber % 2 === 0);
          if (cellShouldBeEditable) {
            this.setupEventListenersForCell(td);
          }
        }

        // Set correct value bar color
        for (let columnNumber = 0; columnNumber < row.children.length; columnNumber++) {
          let td = row.children[columnNumber] as HTMLTableCellElement;
          td.style.backgroundImage = backgroundImageString;
          td.style.backgroundSize = "0%";
        }
      }

      effectHeader.colSpan = numColumns;

      if (effectID !== -1 && effectColor !== "") {
        effectTable.style.backgroundColor = effectColor;
      } 

      let numCellsPairsToFill = numColumns * numRowPairs;
      if (screen.parameters.length < 2) {
        console.info(`screen.parameters.length < 2`);
      }
      let effectTableClass = "editEffectTable";
      if (patch !== undefined && patch.currentEffectSlot === effectSlot)
        effectTableClass += " editEffectSlot";
      if (screen.parameters.length > 0 && screen.parameters[0].valueString === "0")
        effectTableClass += " editEffectOff";

      effectTable.className = effectTableClass;
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
          previousScreenCollection.screens.length === screenCollection.screens.length && previousScreenCollection.screens[effectSlot].parameters.length === screen.parameters.length && 
              previousScreenCollection.screens[effectSlot].parameters[parameterNumber].valueString !== screen.parameters[parameterNumber].valueString;
          let boldStart = valueChanged ? "<b>" : "";
          let boldEnd = valueChanged ? "</b>" : "";
          // Map Zoom's byte codes to HTML/unicode characters. This is also done in ZoomDevice.ts
          // let valueString = screen.parameters[parameterNumber].valueString.replace(/\x16/g, "&#119138;").replace(/\x17/g, "&#119137;").replace(/\x18/g, "&#119136;").replace(/\x19/g, "&#119135;").replace(/\x1A/g, "&#119134;");
          let valueString = screen.parameters[parameterNumber].valueString;
          valueString = ZoomPatch.noteByteCodeToHtml(valueString);

          td.innerHTML = boldStart + valueString + boldEnd;

          td.id = this.encodeEffectAndParameterNumber(effectSlot, parameterNumber);

          if (effectID !== -1) {
            let [rawValue, maxValue] = device.getRawParameterValueFromString(effectID, parameterNumber, valueString);
            let percentage = (rawValue / maxValue) * 100;
            td.style.backgroundSize = percentage.toFixed(0).toString() + "%";
          }
        }
        else
          td.textContent = " ";
      }
    }
  }
}