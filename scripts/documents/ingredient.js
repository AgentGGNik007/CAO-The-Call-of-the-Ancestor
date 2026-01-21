import { RecipeApp } from "../apps/recipeApp.js";
import { MASTERCRAFTED_CONST } from "../consts.js";

const compendiumIndex = new Map();

export class Ingredient {
    constructor({ id = null, name = null, components = [], recipe = null }) {
        this.id = id ?? foundry.utils.randomID();
        this.name = name;
        this.recipe = recipe;
        this.components = components.map((component) => new Component(component));
    }

    async getComponents(loadDocuments = false) {
        for (let component of this.components) {
            await component.getItem(loadDocuments);
        }
    }

    getComponent(id) {
        return this.components.find((component) => component.id === id);
    }

    addComponent(uuid, name) {
        this.components.push(new Component({ uuid, quantity: 1, name }));
    }

    removeComponent(id) {
        this.components = this.components.filter((component) => component.id !== id);
    }

    setQuantity(id, quantity) {
        const component = this.components.find((component) => component.id === id);
        component.quantity = quantity;
    }

    hasComponent(name) {
        return this.components.some((component) => component._name === name || component.name === name);
    }

    hasComponents(actor) {
        const availebleComponents = [];
        for (let component of this.components) {
            const resourcePath = component.item?.flags?.[MASTERCRAFTED_CONST.MODULE_ID]?.attributePath;
            const tags = component.tags;
            if (resourcePath) {
                const actorResource = parseFloat(foundry.utils.getProperty(actor.system, resourcePath));
                if (actorResource < component.quantity) {
                    availebleComponents.push({
                        id: component.id,
                        availeble: false,
                    });
                } else {
                    availebleComponents.push({
                        id: component.id,
                        availeble: true,
                    });
                }
                continue;
            }
            if (tags.length) {
                const actorItems = actor.items.filter((item) => Component.getTags(item).some((tag) => tags.includes(tag)));
                const totalQuantity = actorItems.reduce((total, item) => total + parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)), 0);
                if (totalQuantity < component.quantity) {
                    availebleComponents.push({
                        id: component.id,
                        availeble: false,
                    });
                } else {
                    availebleComponents.push({
                        id: component.id,
                        availeble: true,
                    });
                }
                continue;
            }
            const item = actor.items.getName(component.name);
            if (!item || parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)) < component.quantity) {
                availebleComponents.push({
                    id: component.id,
                    availeble: false,
                });
            } else {
                availebleComponents.push({
                    id: component.id,
                    availeble: true,
                });
            }
        }
        return availebleComponents;
    }

    toObject() {
        return {
            id: this.id,
            name: this.name,
            components: this.components.map((component) => component.toObject()),
        };
    }
}

export class Product extends Ingredient {
    constructor({ id = null, name = null, components = [] }) {
        super({ id, name, components });
    }
}

class Component {
    constructor({ id, uuid, quantity, name }) {
        this.id = id ?? foundry.utils.randomID();
        this.uuid = uuid;
        this._name = name;
        this.quantity = quantity;
    }

    get documentLink() {
        return `@UUID[${this.uuid}]{${this.name} x ${this.quantity}}`;
    }

    get item() {
        return this._item;
    }

    get tags() {
        return Component.getTags(this.item);
    }

    static getTags(item) {
        const flag = item.flags?.[MASTERCRAFTED_CONST.MODULE_ID]?.tags ?? "";
        return flag
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag);
    }

    get name() {
        return this._item?.name ?? this._name;
    }

    get img() {
        return this._item?.img;
    }

    async getItem(loadDocuments = true) {
        const useCached = !loadDocuments && this._item?._fromIndex;
        if (this._item && useCached) return this._item;
        if (!loadDocuments && this.uuid?.includes("Compendium")) {
            //extract compendium key
            const parts = this.uuid.split(".Item.");
            const compendiumKey = parts[0].replace("Compendium.", "");
            const itemId = parts[1];
            const index = compendiumIndex.get(compendiumKey) ?? (await game.packs.get(compendiumKey)?.getIndex({ fields: ["name", "img", "flags"] }));
            if (index) {
                compendiumIndex.set(compendiumKey, index);
                const item = index.get(itemId);
                if (item) {
                    item._fromIndex = true;
                    this._item = item;
                    this._name = this.name;
                    this.uuid = this._item.uuid;
                    return this._item;
                }
            }
        }
        let item = await this.tryFromUuid(this.uuid);
        if (!item) {
            item = await this.findMissingItem(this._name);
            if (!item) return ui.notifications.error(`Item ${this.name} not found. UUID: ${this.uuid}`);
        }
        this._item = item;
        this._name = this.name;
        this.uuid = this._item.uuid;
        return this._item;
    }

    async tryFromUuid(...args) {
        try {
            return await fromUuid(...args);
        }
        catch (err) {
            return undefined;
        }
    }


    render() {
        this._item.sheet.render(true);
    }

    toObject() {
        return {
            id: this.id,
            uuid: this.uuid,
            quantity: this.quantity,
            name: this.name ?? this._name,
        };
    }

    async findMissingItem(itemName) {
        const directoryItem = game.items.getName(itemName);
        if (directoryItem) return directoryItem;
        const packs = game.packs.filter((p) => p.documentName == "Item");
        let item = null;
        for (let pack of packs) {
            const index = await pack.getIndex();
            item = index.find((i) => i.name == itemName);
            if (item) {
                item = await pack.getDocument(item._id);
                break;
            }
        }
        if (item && game.user.isGM) {
            ui._mastercraftedRelink = true;
        }
        return item;
    }
}
