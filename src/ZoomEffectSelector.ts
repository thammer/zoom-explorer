import { htmlToElement, supportsContentEditablePlaintextOnly } from "./htmltools.js";
import { LogLevel, shouldLog } from "./Logger.js";
import { ZoomDevice } from "./ZoomDevice.js";

export class ZoomEffectSelector
{
  private effectSelector: HTMLDialogElement = document.createElement("dialog"); // dummy element;
  private searchBar: HTMLDivElement = document.createElement("div"); // dummy element;
  private categoryList: HTMLDivElement = document.createElement("div"); // dummy element;
  private effectLists: Map<string, Map<number, string>> = new Map<string, Map<number, string>>(); // dummy
  private selectedEffect: HTMLDivElement | undefined = undefined;
  private confirmEvent: (result: boolean) => void;

  private currentPedalName: string | undefined = undefined; //let's make the selector open to the same tab it last was on

  constructor()
  {
    this.createHTML();

    this.confirmEvent = (result: boolean) => {
      shouldLog(LogLevel.Info) && console.log("Confirm event result: " + result);
    }
  }

  private createHTML()
  {
    let html=`
      <dialog id="confirmDialog">
        <form>
          <div class="effectSelectorContainer">
            <div class="effectSelectorTitle">Select effect</div>
            <div class="effectSelectorCategoryList">
            </div>
          </div>
          <div class="effectSelectorButtons">
            <button formmethod="dialog" value="cancel">Cancel</button>
            <button class="zoomEffectSelectorConfirmButton" value="ok">OK</button>
          </div>
        </form>
      </dialog>
    `;

    this.effectSelector = htmlToElement(html) as HTMLDialogElement; 
    this.searchBar = this.effectSelector.querySelector(".effectSelectorTitle") as HTMLDivElement;
    this.categoryList = this.effectSelector.querySelector(".effectSelectorCategoryList") as HTMLDivElement;

    let confirmButton = this.effectSelector.querySelector(".zoomEffectSelectorConfirmButton") as HTMLButtonElement;
    confirmButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.effectSelector.close("ok");
      this.confirmEvent(true);
    });

    this.effectSelector.addEventListener("close", (e) => {
      this.confirmEvent(false);
    });
  }

  public get htmlElement(): HTMLElement
  {
    return this.effectSelector;
  }

  public setHeading(heading: string)
  {
    this.searchBar.textContent = heading;
  }

  public clearEffectList(clearPedalList: boolean = false)
  {
    while (this.categoryList.children.length > (clearPedalList ? 0 : 2) ) 
      this.categoryList.removeChild(this.categoryList.children[this.categoryList.children.length-1]);
  }
  public setEffectList(effectLists: Map<string, Map<number, string>>, defaultPedalName: string = "")
  {
    this.effectLists = effectLists;
    this.clearEffectList(true);

    let list: HTMLDivElement | undefined;

    let categoryNameElement = htmlToElement(`<div class="effectSelectorPedalTitle">Pedal:</div>`) as HTMLDivElement;
    categoryNameElement.style.backgroundColor = "#EEEEEE";

    list = htmlToElement(`<div class="effectSelectorList"></div>`) as HTMLDivElement;
    this.categoryList.appendChild(categoryNameElement);
    this.categoryList.appendChild(list);

    for (let [pedalName, effectList] of effectLists)
    {
      let pedal = htmlToElement(`<div class="effectSelectorPedal">${pedalName}</div>`) as HTMLDivElement;
      pedal.addEventListener("click", (event) => this.setSelectedPedal(pedalName));
      list.appendChild(pedal);
    }

    //I don't see why we'd ever pass a blank defaultPedalName, but check for it
    if (defaultPedalName !== "") {
        this.currentPedalName = defaultPedalName;
    }

    if (this.currentPedalName !== undefined) {
        this.setSelectedPedal(this.currentPedalName); //I don't think this does anything, since getEffect overwrites it when we open the dialog
    }

  }

  private selectPedal(pedalName: string)
  {
    for (let pedal of this.categoryList.querySelectorAll(".effectSelectorPedal"))
      pedal.classList.toggle("effectSelectorPedalSelected", pedal.textContent === pedalName);
  }

  public setSelectedPedal(pedalName: string)
  {
    let effectList = this.effectLists.get(pedalName);
    if (effectList === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect list found for pedal ${pedalName}`);
      return;
    }

    this.currentPedalName = pedalName;  //will store this tab selection for next time we open the dialog

    this.clearEffectList();
    this.selectPedal(pedalName);

    let sortedEffectList = Array.from(effectList.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1);
    let currentCategory: number = -1;
    let list: HTMLDivElement | undefined;

    for (let [id, name] of sortedEffectList) {
      let category = (id & 0xFF000000) >> 24;
      let effectColor = ZoomDevice.getColorFromEffectID(id, pedalName);

      if (category != currentCategory) {
        currentCategory = category;
        let categoryName = ZoomDevice.getCategoryNameFromID(id, pedalName);
        let categoryNameElement = htmlToElement(`<div class="effectSelectorCategoryName">${categoryName}</div>`) as HTMLDivElement;
        categoryNameElement.style.backgroundColor = effectColor;
        list = htmlToElement(`<div class="effectSelectorList"></div>`) as HTMLDivElement;
        this.categoryList.appendChild(categoryNameElement);
        this.categoryList.appendChild(list);
      }

      let effect = htmlToElement(`<div class="effectSelectorEffect">${name}</div>`) as HTMLDivElement;
      effect.style.backgroundColor = effectColor;
      effect.dataset.name = name;
      effect.dataset.id = id.toString(16).padStart(8, "0");
      effect.dataset.pedalName = pedalName;
      effect.addEventListener("click", (event) => {
        for (let otherEffect of this.categoryList.querySelectorAll(".effectSelectorEffect"))
          otherEffect.classList.remove("effectSelectorEffectSelected");
        this.selectedEffect = event.target as HTMLDivElement;
        this.selectedEffect.classList.add("effectSelectorEffectSelected");
      });
      effect.addEventListener("dblclick", (event) => {
        for (let otherEffect of this.categoryList.querySelectorAll(".effectSelectorEffect"))
          otherEffect.classList.remove("effectSelectorEffectSelected");
        this.selectedEffect = event.target as HTMLDivElement;
        this.selectedEffect.classList.add("effectSelectorEffectSelected");
        this.effectSelector.close("ok");
        this.confirmEvent(true);
      });

      list!.appendChild(effect);
    }
  }

  public async getEffect(currentEffectID: number, currentPedalName?: string): Promise<[effectID: number, effectName: string, pedalName: string]>
  { 
    return new Promise<[effectID: number, effectName: string, pedalName: string]>( (resolve, reject) => {
    // If caller provides a pedal, use it.
    // Otherwise use the remembered one.
    if (currentPedalName && currentPedalName !== "") {
        this.currentPedalName = currentPedalName;
    }

    // Otherwise do nothing (list will remain empty until caller setsEffectList()).
    if (this.currentPedalName !== undefined) {
        this.setSelectedPedal(this.currentPedalName);
    }
    for (let otherEffect of this.categoryList.querySelectorAll(".effectSelectorEffect") as NodeListOf<HTMLDivElement>)
        otherEffect.classList.toggle("effectSelectorEffectSelected", otherEffect.dataset.id === currentEffectID.toString(16).padStart(8, "0"));

      // Todo: select currentEffectID if its !== -1
      this.confirmEvent = async (result: boolean) => {
        if (!result)
          resolve([-1, "", ""]);
        else if (this.selectedEffect === undefined || this.selectedEffect.dataset.id === undefined || 
          this.selectedEffect.dataset.name === undefined || this.selectedEffect.dataset.pedalName === undefined)
        {
          resolve([-1, "", ""]);
        }
        else
          resolve([parseInt(this.selectedEffect.dataset.id, 16), this.selectedEffect.dataset.name, this.selectedEffect.dataset.pedalName]);
      }
      this.effectSelector.showModal();
    });
  }
}
