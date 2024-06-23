/**
 * @module A collection of useful html-related functions 
 */

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
    effectGroup === 0x04 ? "#F7BFB9" : // red
    effectGroup === 0x06 ? "#ADF2F4" : // turquoise
    effectGroup === 0x07 ? "#E8E69E" : // yellow
    effectGroup === 0x08 ? "#A5BBE1" : // blue
    effectGroup === 0x09 ? "#ABD3A3" : // green
    "#FFFFFF";
  return color;
}
