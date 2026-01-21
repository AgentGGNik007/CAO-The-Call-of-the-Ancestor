import {MASTERCRAFTED_CONST} from "../consts.js";

const MODULE_ID = MASTERCRAFTED_CONST.MODULE_ID;

export class ItemConfig extends FormApplication{
    constructor (object) {
        super();
        this.object = object;
    }

    static get defaultOptions() {
        return {
            ...super.defaultOptions,
            title: game.i18n.localize(`${MODULE_ID}.itemConfig.title`),
            id: `${MODULE_ID}-item-config`,
            classes: [],
            template: `modules/${MODULE_ID}/templates/itemConfig.hbs`,
            resizable: false,
            width: 400,
            dragDrop: [{dragSelector: null, dropSelector: null}],
        };
    }

    getData() {
        return {object: this.object};
    }

    async _updateObject(event, formData) {
        formData = foundry.utils.expandObject(formData);
        return this.object.update(formData);
    }

    static setHooks() {
        if(!game.user.isGM) return;
        Hooks.on("getItemSheetHeaderButtons", (sheet, buttons) => {
            buttons.unshift({
                class: "item-config",
                icon: "fa-duotone fa-hammer",
                onclick: (event) => {
                    event.preventDefault();
                    const item = sheet.object;
                    new ItemConfig(item).render(true);
                },
                label: game.i18n.localize(`${MODULE_ID}.itemConfig.sheetButton`),
            });
        });

        Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
            if(app.document.documentName !== "Item") return;
            controls.push({
                class: "item-config",
                icon: "fa-duotone fa-hammer",
                onClick: (event) => {
                    event.preventDefault();
                    const item = app.document;
                    new ItemConfig(item).render(true);
                },
                label: game.i18n.localize(`${MODULE_ID}.itemConfig.title`),
            });
        });
    }
}