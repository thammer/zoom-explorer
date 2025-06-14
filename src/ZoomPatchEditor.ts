import { getColorFromEffectID, htmlToElement, supportsContentEditablePlaintextOnly } from "./htmltools.js";
import { LogLevel, shouldLog } from "./Logger.js";
import { EffectIDMap, ZoomDevice } from "./ZoomDevice.js";
import { ZoomPatch } from "./ZoomPatch.js";
import { ZoomScreen, ZoomScreenCollection } from "./ZoomScreenInfo.js";


export type EditPatchTextEditedListenerType = (event: Event, type: string, initialValueString: string) => boolean;
export type EditPatchMouseEventListenerType = (cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => void;
export type EditPatchEffectSlotOnOffListenerType = (effectSlot: number, on: boolean) => void;
export type EditPatchEffectSlotDeleteListenerType = (effectSlot: number) => void;
export type EditPatchEffectSlotMoveListenerType = (effectSlot: number, direction: "left" | "right") => void;
export type EditPatchEffectSlotAddListenerType = (effectSlot: number, direction: "left" | "right") => void;

let debugCounter = 0;

export class ZoomPatchEditor
{
  private textEditedCallback: EditPatchTextEditedListenerType | undefined = undefined;
  private mouseMovedCallback: EditPatchMouseEventListenerType | undefined = undefined;
  private mouseUpCallback: EditPatchMouseEventListenerType | undefined = undefined;
  private effectSlotOnOffCallback: EditPatchEffectSlotOnOffListenerType | undefined = undefined;
  private effectSlotDeleteCallback: EditPatchEffectSlotDeleteListenerType | undefined = undefined;
  private effectSlotMoveCallback: EditPatchEffectSlotMoveListenerType | undefined = undefined;
  private effectSlotAddCallback: EditPatchEffectSlotAddListenerType | undefined = undefined;

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

  private currentMouseMoveCell: HTMLTableCellElement | undefined = undefined;
  private initialMouseMoveCellText: string = "";
  private mouseDownX: number = 0;
  private mouseDownY: number = 0;

  constructor(patchEditorID?: string)
  {
    // this.patchEditorTable = document.getElementById("editPatchTableID") as HTMLTableElement;
    if (patchEditorID !== undefined)
      this.patchEditorTable = document.getElementById(patchEditorID) as HTMLTableElement;
    else
      this.patchEditorTable = this.createHTML();

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

    document.addEventListener("mousemove", e => {
      if (this.currentMouseMoveCell !== undefined && this.mouseMovedCallback !== undefined) {
        let xOffset = e.pageX - this.mouseDownX;
        let yOffset = -1 * (e.pageY - this.mouseDownY);

        // if (Math.abs(yOffset) > 8) {
        //   // attempt to disable selection
        //   let sel = window.getSelection();
        //   if (sel !== null) {
        //     const range = sel.getRangeAt(0);
        //     const { startOffset, endOffset } = range;
        //     if (endOffset - startOffset > 0) {
        //         this.setCaret(this.currentMouseMoveCell, endOffset);
        //     }
        //   }
        // }

        this.mouseMovedCallback(this.currentMouseMoveCell, this.initialMouseMoveCellText, xOffset, yOffset);
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        let xOffset = e.pageX - this.mouseDownX;
        let yOffset = -1 * (e.pageY - this.mouseDownY);

        if (this.mouseUpCallback !== undefined && this.currentMouseMoveCell !== undefined)
          this.mouseUpCallback(this.currentMouseMoveCell, this.initialMouseMoveCellText, xOffset, yOffset);
        
        this.currentMouseMoveCell = undefined;
        this.initialMouseMoveCellText = ""
      }
    });
  }

  createHTML(): HTMLTableElement
  {
    let html = `
        <table id="editPatchTableID" class="editPatchTable">
          <tr>
            <th class="editPatchTableNumber">Patch 00:</th>
            <th class="editPatchTableName" id="editPatchTableNameID">Patch Name</th>
            <th class="editPatchTableTempoValue" id="editPatchTableTempoValueID">42</th>
            <th class="editPatchTableTempoLabel">BPM</th>
          </tr>
          <tr>
              <th colspan="4" class="editPatchTableDescription" id="editPatchTableDescriptionID"></th>
          </tr>
          <tr>
              <td colspan="4">
                  <table>
                    <tr>
                      <td>
                      </td>
                    </tr>
                  </table>
              </td>
          </tr>
        </table>
    `;

    let htmlElement = htmlToElement(html) as HTMLTableElement; 
    return htmlElement;
  }

  public get htmlElement(): HTMLTableElement
  {
    return this.patchEditorTable;
  }


  hide()
  {
    this.patchEditorTable.style.display = "none";
  }

  show()
  {
    this.patchEditorTable.style.display = "table";
  }

  get visible(): boolean
  {
    return this.patchEditorTable.style.display === "table";
  }

  setTextEditedCallback(textEditedCallback: EditPatchTextEditedListenerType) 
  { 
    this.textEditedCallback = textEditedCallback;
  }

  setMouseMovedCallback(mouseMovedCallback: EditPatchMouseEventListenerType) 
  { 
    this.mouseMovedCallback = mouseMovedCallback;
  }

  setMouseUpCallback(mouseUpCallback: EditPatchMouseEventListenerType) 
  { 
    this.mouseUpCallback = mouseUpCallback;
  }

  setEffectSlotOnOffCallback(effectSlotOnOffCallback: EditPatchEffectSlotOnOffListenerType) 
  { 
    this.effectSlotOnOffCallback = effectSlotOnOffCallback;
  }

  setEffectSlotDeleteCallback(effectSlotDeleteCallback: EditPatchEffectSlotDeleteListenerType) 
  { 
    this.effectSlotDeleteCallback = effectSlotDeleteCallback;
  }

  setEffectSlotMoveCallback(effectSlotMoveCallback: EditPatchEffectSlotMoveListenerType) 
  {
    this.effectSlotMoveCallback = effectSlotMoveCallback;
  }

  setEffectSlotAddCallback(effectSlotAddCallback: EditPatchEffectSlotAddListenerType) 
  {
    this.effectSlotAddCallback = effectSlotAddCallback;
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
    let cell = this.patchEditorTable.querySelector(`[id="${id}"]`) as HTMLTableCellElement;
    if (cell === null)
      return undefined;
    return cell;
  }

  private setCaret(target: HTMLElement, position = 0)
  {
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(target.childNodes[0], position);
    range.collapse(true);
    if (sel !== null) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  private setupEventListenersForCell(cell: HTMLTableCellElement) {
    if (cell !== undefined) {
      cell.contentEditable = supportsContentEditablePlaintextOnly() ? "plaintext-only" : "true";

      cell.ondrag = () => { this.currentMouseMoveCell = undefined; return false; };
      cell.ondragenter = () => { this.currentMouseMoveCell = undefined; return false; };
      cell.ondragleave = () => { this.currentMouseMoveCell = undefined; return false; };
      cell.ondragover = () => { this.currentMouseMoveCell = undefined; return false; };
      cell.ondragstart = () => { this.currentMouseMoveCell = undefined; return false; };
      cell.ondragend = () => { this.currentMouseMoveCell = undefined; return false; };

      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          cell.blur();
        }
        else if (e.key === "Escape" || e.key === "Esc") {
          cell.innerText = this.undoOnEscape;
          if (this.textEditedCallback !== undefined)
            this.textEditedCallback(e, "input", this.undoOnEscape);
          this.muteBlurOnEscape = true;
          cell.blur();
          this.muteBlurOnEscape = false;
        }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown" || e.key === "Tab") {
          e.preventDefault();
          if (this.textEditedCallback !== undefined)
            this.textEditedCallback(e, "key", this.undoOnEscape);
          }
      });

      cell.addEventListener("input", (e) => {
        if (this.textEditedCallback !== undefined)
          this.textEditedCallback(e, "input", this.undoOnEscape);
      });

      cell.addEventListener("focus", (e) => {
        this.undoOnEscape = cell.innerText;
        if (this.textEditedCallback !== undefined)
          this.textEditedCallback(e, "focus", this.undoOnEscape);
      });

      cell.addEventListener("blur", (e) => {
        if (!this.muteBlurOnEscape)
          if (this.textEditedCallback !== undefined) {
            let acceptEdit = this.textEditedCallback(e, "blur", this.undoOnEscape);
            if (!acceptEdit)
              cell.innerText = this.undoOnEscape;
          }
      });

      cell.addEventListener("mousedown", (e) => {
        if (e.button === 0) {
          this.currentMouseMoveCell = cell;
          this.initialMouseMoveCellText = cell.innerText;
          this.mouseDownX = e.pageX;
          this.mouseDownY = e.pageY;
        }
      });
    }
  }

  public updateEffectSlotFrame(currentEffectSlot: number): void
  {
    for (let effectColumn=0; effectColumn<this.effectsRow.children.length; effectColumn++) {
      let cellWithEffectTable = this.effectsRow.children[effectColumn] as HTMLTableRowElement;
      let effectTable: HTMLTableElement = cellWithEffectTable.children[0] as HTMLTableElement;
      let className = effectTable.className;
      className = className.replace("editEffectSlot", "");
      let effectSlot = this.effectsRow.children.length - effectColumn - 1;
      if (effectSlot === currentEffectSlot) {
        className = className + " editEffectSlot";
      }
      effectTable.className = className;
    }
  }

  public updateTempo(tempo: number): void
  {
    let newPatchTempo = tempo.toString().padStart(3, "0");
    if (this.patchTempoCell.textContent !== newPatchTempo) {
      this.patchTempoCell.textContent = newPatchTempo;
      this.patchTempoCell.blur();
    }
  }

  public addCellHighlights(slotParameterEffectList: [slot: number, parameterNumber: number, unmapped: boolean][])
  {
    for (let slotParameter of slotParameterEffectList) {
      let slot = slotParameter[0];
      let parameterNumber = slotParameter[1];
      let unmapped = slotParameter[2];
      let cell = this.getCell(slot, parameterNumber);
      if (cell !== undefined) {
        if (unmapped)
          cell.classList.add("unmapped"); // input value is not mapped to output value
        else
          cell.classList.add("changed"); // output value is different from input value
      }
    }
  }

  public clearAllCellHighlights()
  {
    for (let effectColumn of this.effectsRow.children) {
      let cellWithEffectTable = effectColumn as HTMLTableRowElement;
      let effectTable: HTMLTableElement = cellWithEffectTable.children[0] as HTMLTableElement;
      if (effectTable.children.length < 3)
        return;
      for (let row = 2; row < effectTable.children.length; row +=2) {
        for (let column = 0; column < effectTable.children[row].children.length; column++) {
          let cell = effectTable.children[row].children[column] as HTMLTableCellElement;
          cell.classList.remove("unmapped");
          cell.classList.remove("changed");
        }       
      }
    }
  }

  public update(device: ZoomDevice, screenCollection: ZoomScreenCollection | undefined, patch: ZoomPatch | undefined, patchNumberText: string, 
    previousScreenCollection: ZoomScreenCollection | undefined, previousPatch: ZoomPatch | undefined): void
  {
    this.updateFromMap(device.effectIDMap, device.numParametersPerPage, screenCollection, patch, patchNumberText, 
      previousScreenCollection, previousPatch);
  }

  public updateFromMap(effectIDMap: EffectIDMap | undefined, numParametersPerPage: number, screenCollection: ZoomScreenCollection | undefined, patch: ZoomPatch | undefined, 
    patchNumberText: string, previousScreenCollection: ZoomScreenCollection | undefined, previousPatch: ZoomPatch | undefined): void
  {
    function screenIsVisible(screen: ZoomScreen, screenNumber: number, patch: ZoomPatch | undefined) {
      return ! ((screen.parameters.length >= 2 && screen.parameters[1].name === "Blank") || 
                (patch !== undefined && patch.effectSettings !== null && screenNumber >= patch.effectSettings.length));
    }

    shouldLog(LogLevel.Info) && console.log(`ZoomPatchEditor.update() - ${debugCounter++}`);	

    if (patch !== undefined) {
      this.patchNumberCell.textContent = patchNumberText;
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

    let maxNumParamsPerLine = numParametersPerPage;

    // let offset = 6;
    // let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(data, offset);
    let numScreens = screenCollection.screens.length;

    // Number of visible screens === number of effects in the patch
    let numVisibleScreens = 0;
    for (let i=0; i<numScreens; i++)
      if (screenIsVisible(screenCollection.screens[i], i, patch))
        numVisibleScreens += 1;
      
    // Remove superfluous td elements (effects) so we have one td element for each effect
    while (this.effectsRow.firstChild !== null && this.effectsRow.children.length > numVisibleScreens) {
      this.effectsRow.removeChild(this.effectsRow.firstChild);
    }

    // Add missing td elements (effects) so we have one td element (cell) for each effect. Each effect is a table within this td element.
    while (this.effectsRow.children.length < numVisibleScreens) {
      let td = document.createElement("td") as HTMLTableCellElement;
      if (this.effectsRow.children.length < 1)
        this.effectsRow.appendChild(td);
      else
      this.effectsRow.insertBefore(td, this.effectsRow.firstChild);
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
      let effectSlotName: HTMLSpanElement;
      let effectOnOffButton: HTMLButtonElement;
      let effectLibraryButton: HTMLButtonElement;
      let effectDeleteButton: HTMLButtonElement;
      let effectMoveLeftButton: HTMLButtonElement;
      let effectMoveRightButton: HTMLButtonElement;
      let effectAddLeftButton: HTMLButtonElement;
      let effectAddRightButton: HTMLButtonElement;

      if (cellWithEffectTable.children.length < 1) {
        effectTable = document.createElement("table");
        cellWithEffectTable.appendChild(effectTable);
        effectTable.className="editEffectTable";
        let tr = document.createElement("tr") as HTMLTableRowElement;
        effectTable.appendChild(tr);

        let html = `
          <th colspan="4">
              <div class="editEffectTableTopBar">
                <span class="editEffectTableEffectNameContainer">
                    <button class="material-symbols-outlined effectOnOffButton">radio_button_unchecked</button>
                    <span class="editEffectTableEffectName"></span>
                    <button class="material-symbols-outlined effectActionButton">data_table</button>
                </span>
                <span class="editEffectTableButtons">
                    <button class="material-symbols-outlined effectActionButton">add_circle</button>
                    <button class="material-symbols-outlined effectActionButton">arrow_back_2</button>
                    <button class="material-symbols-outlined effectActionButton">delete</button>
                    <button class="material-symbols-outlined effectActionButton">play_arrow</button>
                    <button class="material-symbols-outlined effectActionButton">add_circle</button>
                </span>
              </div>
          </th>
        `;
        effectHeader = htmlToElement(html) as HTMLTableCellElement;
        tr.appendChild(effectHeader);

        effectOnOffButton = effectHeader.children[0].children[0].children[0] as HTMLButtonElement;
        effectOnOffButton.dataset.effectSlot = effectSlot.toString();
        effectOnOffButton.addEventListener("click", (event) => this.onEffectSlotOnOffButtonClick(event));

        effectAddLeftButton = effectHeader.children[0].children[1].children[0] as HTMLButtonElement;
        effectAddLeftButton.dataset.effectSlot = effectSlot.toString();
        effectAddLeftButton.addEventListener("click", (event) => this.onEffectSlotAddButtonClick(event, "left"));

        effectMoveLeftButton = effectHeader.children[0].children[1].children[1] as HTMLButtonElement;
        effectMoveLeftButton.dataset.effectSlot = effectSlot.toString();
        effectMoveLeftButton.addEventListener("click", (event) => this.onEffectSlotMoveButtonClick(event, "left"));

        effectDeleteButton = effectHeader.children[0].children[1].children[2] as HTMLButtonElement;
        effectDeleteButton.dataset.effectSlot = effectSlot.toString();
        effectDeleteButton.addEventListener("click", (event) => this.onEffectSlotDeleteButtonClick(event));

        effectMoveRightButton = effectHeader.children[0].children[1].children[3] as HTMLButtonElement;
        effectMoveRightButton.dataset.effectSlot = effectSlot.toString();
        effectMoveRightButton.addEventListener("click", (event) => this.onEffectSlotMoveButtonClick(event, "right"));

        effectAddRightButton = effectHeader.children[0].children[1].children[4] as HTMLButtonElement;
        effectAddRightButton.dataset.effectSlot = effectSlot.toString();
        effectAddRightButton.addEventListener("click", (event) => this.onEffectSlotAddButtonClick(event, "right"));
      }
      else {
        effectTable = cellWithEffectTable.children[0] as HTMLTableElement;
        effectHeader = effectTable.children[0].children[0] as HTMLTableCellElement;
        effectOnOffButton = effectHeader.children[0].children[0].children[0] as HTMLButtonElement;
        effectAddLeftButton = effectHeader.children[0].children[1].children[0] as HTMLButtonElement;
        effectMoveLeftButton = effectHeader.children[0].children[1].children[1] as HTMLButtonElement;
        effectDeleteButton = effectHeader.children[0].children[1].children[2] as HTMLButtonElement;
        effectMoveRightButton = effectHeader.children[0].children[1].children[3] as HTMLButtonElement;
        effectAddRightButton = effectHeader.children[0].children[1].children[4] as HTMLButtonElement;
      }
      effectSlotName = effectHeader.children[0].children[0].children[1] as HTMLSpanElement;

      effectMoveRightButton.disabled = (effectSlot === 0);
      effectMoveLeftButton.disabled = (effectSlot === numScreens - 1);
      effectAddRightButton.disabled = (numScreens === patch?.maxNumEffects);
      effectAddLeftButton.disabled = (numScreens === patch?.maxNumEffects);

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
      {
        effectTableClass += " editEffectOff";
        effectOnOffButton.classList.remove("on");
        effectOnOffButton.textContent = "radio_button_unchecked";
      }
      else {
        effectOnOffButton.classList.add("on");
        effectOnOffButton.textContent = "radio_button_checked";
      }

      effectTable.className = effectTableClass;
      effectSlotName.textContent = screen.parameters.length > 1 ? screen.parameters[1].name : "BPM";

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
            previousScreenCollection.screens.length === screenCollection.screens.length && 
            previousScreenCollection.screens[effectSlot].parameters.length === screen.parameters.length && 
            previousScreenCollection.screens[effectSlot].parameters.length >= 2 && 
            previousScreenCollection.screens[effectSlot].parameters[1].name === screen.parameters[1].name &&
            previousScreenCollection.screens[effectSlot].parameters[parameterNumber].valueString !== screen.parameters[parameterNumber].valueString;
          let boldStart = valueChanged ? "<b>" : "";
          let boldEnd = valueChanged ? "</b>" : "";
          // Map Zoom's byte codes to HTML/unicode characters. This is also done in ZoomDevice.ts
          // let valueString = screen.parameters[parameterNumber].valueString.replace(/\x16/g, "&#119138;").replace(/\x17/g, "&#119137;").replace(/\x18/g, "&#119136;").replace(/\x19/g, "&#119135;").replace(/\x1A/g, "&#119134;");
          let valueString = screen.parameters[parameterNumber].valueString;
          // valueString = ZoomPatch.noteByteCodeToHtml(valueString);
          
          // td.innerHTML = boldStart + valueString + boldEnd;
          // textXontent is much faster than using innerHtml
          if (ZoomPatch.isNoteHtml(valueString)) {
            td.innerHTML = boldStart + valueString + boldEnd;
          } 
          else {
            td.textContent = valueString; 
            td.style.fontWeight = valueChanged ? "bold" : "normal"; 
          }

          td.id = this.encodeEffectAndParameterNumber(effectSlot, parameterNumber);

          if (effectID !== -1) {
            let [rawValue, maxValue] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMap, effectID, parameterNumber, valueString);
            let percentage: number;
            if (maxValue === -1)
              percentage = 0;
            else
              percentage = (rawValue / maxValue) * 100;
            td.style.backgroundSize = percentage.toFixed(0).toString() + "%";
          }
        }
        else
          td.textContent = " ";
      }
    }
  }
  onEffectSlotOnOffButtonClick(event: MouseEvent): any
  {
    let button = event.target as HTMLButtonElement;
    if (button.dataset.effectSlot === undefined)
      return; // this should never happen
    let effectSlot = Number.parseInt(button.dataset.effectSlot);
    if (this.effectSlotOnOffCallback !== undefined)
      this.effectSlotOnOffCallback(effectSlot, !button.classList.contains("on"));
  }

  onEffectSlotMoveButtonClick(event: MouseEvent, direction: "left" | "right"): any
  {
    let button = event.target as HTMLButtonElement;
    if (button.dataset.effectSlot === undefined)
      return; // this should never happen
    let effectSlot = Number.parseInt(button.dataset.effectSlot);
    if (this.effectSlotMoveCallback !== undefined)
      this.effectSlotMoveCallback(effectSlot, direction);
  }

  onEffectSlotAddButtonClick(event: MouseEvent, direction: "left" | "right"): any
  {
    let button = event.target as HTMLButtonElement;
    if (button.dataset.effectSlot === undefined)
      return; // this should never happen
    let effectSlot = Number.parseInt(button.dataset.effectSlot);
    if (this.effectSlotAddCallback !== undefined)
      this.effectSlotAddCallback(effectSlot, direction);
  }

  onEffectSlotDeleteButtonClick(event: MouseEvent): any
  {
    let button = event.target as HTMLButtonElement;
    if (button.dataset.effectSlot === undefined)
      return; // this should never happen
    let effectSlot = Number.parseInt(button.dataset.effectSlot);
    if (this.effectSlotDeleteCallback !== undefined)
      this.effectSlotDeleteCallback(effectSlot);
  }


  updateValueBar(cell: HTMLTableCellElement, rawValue: number, maxValue: number)
  {
    let id = cell.id;
    let [effectSlot, parameterNumber] = this.getEffectAndParameterNumber(id);
    let percentage = (rawValue / maxValue) * 100;
    cell.style.backgroundSize = percentage.toFixed(0).toString() + "%";
  }
}