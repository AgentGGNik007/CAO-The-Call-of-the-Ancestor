import { Ingredient, Product } from "./ingredient.js";
import { MASTERCRAFTED_CONST } from "../consts.js";
import { RecipeApp } from "../apps/recipeApp.js";
import { cleanIdsRecursive } from "../apps/recipeApp.js";

export class Recipe {
    constructor({ id = null, recipeBook = null, sound = "", time = null, name = "", macroName = "", description = "", ownership = {}, ingredients = [], products = [], tools = [], ingredientsInspection = 0, productInspection = 0, img = MASTERCRAFTED_CONST.RECIPE.IMG }) {
        this.id = id ?? foundry.utils.randomID();
        this.name = name;
        this.time = time;
        this.macroName = macroName;
        this.documentName = "Recipe";
        this.recipeBook = recipeBook;
        this.ownership = ownership;
        this.sound = sound;
        this.ingredientsInspection = ingredientsInspection;
        this.productInspection = productInspection;
        this.description = description;
        this.ingredients = ingredients.map((ingredient) => new Ingredient({ ...ingredient, recipe: this }));
        this.products = products.map((product) => new Product({ ...product, recipe: this }));
        this.tools = tools.length ? tools : "";
        this._tools = this.getToolsArray();
        this._hasTools = this._tools.length > 0;
        this.img = img || MASTERCRAFTED_CONST.RECIPE.IMG;
    }

    get craftingSound() {
        return this.sound || this.recipeBook.sound || `modules/${MASTERCRAFTED_CONST.MODULE_ID}/assets/crafting.ogg`;
    }

    get isOwner() {
        if (game.user.isGM) return true;
        const userId = game.user.id;
        if (this.ownership[userId] == 0 || !this.ownership[userId]) return this.recipeBook.isOwner;
        return this.ownership[userId] == 1;
    }

    get canInspectIngredients() {
        if (game.user.isGM) return true;
        if (this.ingredientsInspection == 0 || !this.ingredientsInspection) return this.recipeBook.ingredientsInspection == 1;
        return this.ingredientsInspection == 1;
    }

    get canInspectProducts() {
        if (game.user.isGM) return true;
        if (this.productInspection == 0 || !this.productInspection) return this.recipeBook.productInspection == 1;
        return this.productInspection == 1;
    }

    async craft(actor, data, skipConfirm) {
        if (!this.hasTool(actor)) {
            ui.notifications.warn(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.noTools`) + this._tools.join(", "));
            return;
        }
        const componentsToConsume = [];
        for (let [k, v] of Object.entries(data.ingredients)) {
            const component = this.getIngredient(k).getComponent(v);
            await component.getItem();
            componentsToConsume.push(component);
        }
        const product = this.getProduct(data.productId);
        await product.getComponents(true);

        skipConfirm ? this._craft(actor, componentsToConsume, product) : this.craftPrompt(actor, componentsToConsume, product);
    }

    async craftPrompt(actor, componentsToConsume, product) {
        let content = await renderTemplate(`modules/${MASTERCRAFTED_CONST.MODULE_ID}/templates/craftingPrompt.hbs`, { componentsToConsume, product });
        content = await TextEditor.enrichHTML(content);
        new Dialog({
            title: game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.craftDialog.title`),
            content: content,
            buttons: {
                craft: {
                    label: '<i class="fas fa-hammer"></i> ' + game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.craftDialog.craft`),
                    callback: () => {
                        this._craft(actor, componentsToConsume, product);
                    },
                },
                cancel: {
                    label: '<i class="fas fa-times"></i> ' + game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.craftDialog.cancel`),
                    callback: () => { },
                },
            },
            default: "craft",
        }).render(true);
    }

    async _craft(actor, componentsToConsume, product) {
        const updates = [];
        const actorUpdates = {};
        const toDelete = [];
        const productData = [];
        for (const component of product.components) {
            const itemData = (await component.getItem())?.toObject();
            if(itemData) foundry.utils.setProperty(itemData.system, MASTERCRAFTED_CONST.QUANTITY, parseFloat(component.quantity));
            productData.push(itemData);
        }
        const check = await this._executeMacro(actor, componentsToConsume, product, productData);
        const itemConsumedQuantity = {};
        for (let component of this.mergeComponents(componentsToConsume)) {
            const resourcePath = component.item?.flags?.[MASTERCRAFTED_CONST.MODULE_ID]?.attributePath;
            const tags = component.tags;
            if (resourcePath) {
                const actorResource = parseFloat(foundry.utils.getProperty(actor.system, resourcePath));
                if (actorResource < component.quantity) {
                    return this._onCraftError(component.name + " Not Enough");
                }
                actorUpdates[`system.${resourcePath}`] = actorResource - component.quantity;
            } else if (tags.length) {
                const actorItems = actor.items.filter((item) => component.constructor.getTags(item).some((tag) => tags.includes(tag))).filter((item) => !toDelete.includes(item.id));
                const totalQuantity = actorItems.reduce((total, item) => total + parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY), 0));
                if (totalQuantity < component.quantity) {
                    return this._onCraftError(component.name + " Not Enough");
                }
                let quantityToConsume = component.quantity;
                for (const item of actorItems) {
                    const quantity = itemConsumedQuantity[item.id] ?? parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY));
                    if (quantity - quantityToConsume <= 0) {
                        toDelete.push(item.id);
                        quantityToConsume -= quantity;
                        delete itemConsumedQuantity[item.id];
                    } else {
                        itemConsumedQuantity[item.id] = quantity - quantityToConsume;
                        updates.push({ _id: item.id, [`system.${MASTERCRAFTED_CONST.QUANTITY}`]: quantity - quantityToConsume });
                        quantityToConsume = 0;
                        break;
                    }
                }
            } else {
                const item = actor.items.getName(component.name);
                if (!item) return this._onCraftError(component.name + " Not Found");
                const quantity = parseFloat(component.quantity);
                if (parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)) < quantity) {
                    return this._onCraftError(component.name + " Not Enough");
                }
                if (parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)) - quantity == 0) {
                    toDelete.push(item.id);
                    continue;
                }
                updates.push({ _id: item.id, [`system.${MASTERCRAFTED_CONST.QUANTITY}`]: parseFloat(foundry.utils.getProperty(item.system, MASTERCRAFTED_CONST.QUANTITY)) - quantity });
            }
        }

        if (!check.success) {
            if (!check.consume) {
                ui.notifications.error(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.craftFailNotConsumed`));
                Object.values(ui.windows)
                    .find((window) => window instanceof RecipeApp)
                    ?.render(true);
                return;
            }
            await actor.updateEmbeddedDocuments("Item", updates);
            await actor.deleteEmbeddedDocuments("Item", toDelete);
            await actor.update(actorUpdates);
            ui.notifications.element.empty();
            ui.notifications.error(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.craftFailConsumed`));
            Object.values(ui.windows)
                .find((window) => window instanceof RecipeApp)
                ?.render(true);
            return;
        }

        const products = [];

        const timedCraft = [];

        if (this.time) {
            for (let component of product.components) {
                const item = productData[product.components.indexOf(component)];
                if (!item) return this._onCraftError("Item Not Found");
                timedCraft.push(item);
            }
        } else {
            for (let component of product.components) {
                const item = productData[product.components.indexOf(component)];
                if (!item) return this._onCraftError("Item Not Found");
                const existingItem = actor.items.getName(item.name);
                const itemData = item;
                if (existingItem) {
                    updates.push({ _id: existingItem.id, [`system.${MASTERCRAFTED_CONST.QUANTITY}`]: parseFloat(foundry.utils.getProperty(existingItem.system, MASTERCRAFTED_CONST.QUANTITY)) + parseFloat(foundry.utils.getProperty(itemData.system, MASTERCRAFTED_CONST.QUANTITY)) });
                } else {
                    products.push(itemData);
                }
            }
        }
        await actor.updateEmbeddedDocuments("Item", updates);
        await actor.createEmbeddedDocuments("Item", products);
        await actor.deleteEmbeddedDocuments("Item", toDelete);
        await actor.update(actorUpdates);
        if (timedCraft.length > 0) {
            await actor.setFlag(MASTERCRAFTED_CONST.MODULE_ID, foundry.utils.randomID(), { time: game.time.worldTime + this.time * 60, items: timedCraft });
        }
        foundry.audio.AudioHelper.play({
            src: this.craftingSound,
            volume: game.settings.get("core", "globalInterfaceVolume"),
        });
        ui.notifications.clear();
        ui.notifications.notify(game.i18n.localize(this.time ? `${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.craftSuccessTimed` : `${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.craftSuccess`) + product.components.map((product) => product.name + ` (${product.quantity})`).join(", "));
        this._postToChat(actor, componentsToConsume, product);
        Object.values(ui.windows)
            .find((window) => window instanceof RecipeApp)
            ?.render(true);
    }

    mergeComponents(components) {
        const merged = [];
        for (let component of components) {
            const existing = merged.find((mergedComponent) => mergedComponent.name == component.name);
            if (existing) {
                existing.quantity += parseFloat(component.quantity);
            } else {
                merged.push(component);
            }
        }
        return merged;
    }

    async _postToChat(actor, componentsToConsume, product) {
        let content = await renderTemplate(`modules/${MASTERCRAFTED_CONST.MODULE_ID}/templates/craftingChat.hbs`, { componentsToConsume, product, rName: this.name, recipe: this });
        content = await TextEditor.enrichHTML(content);
        ChatMessage.create(
            ChatMessage.applyRollMode(
                {
                    content: content,
                    speaker: { actor: actor.id },
                },
                game.settings.get("core", "rollMode"),
            ),
        );
    }

    async _executeMacro(actor, componentsToConsume, product, productData) {
        if (!this.macroName) return { success: true, consume: false };
        let macro = game.macros.getName(this.macroName.split("|")[0]);
        const macroArgs = macro ? this.macroName.split("|").slice(1) : [];
        if (!macro) macro = { command: this.macroName };
        const AsyncFunction = async function () { }.constructor;
        const fn = new AsyncFunction("actor", "componentsToConsume", "product", "productData", "macroArgs", macro.command);
        try {
            return await fn(actor, componentsToConsume, product, productData, macroArgs);
        } catch (e) {
            ui.notifications.error("There was an error in your macro syntax. See the console (F12) for details");
            return { success: true, consume: false };
        }
    }

    _onCraftError(error = "") {
        ui.notifications.error(game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.recipeApp.craftError` + error));
    }

    getToolsArray() {
        const bookTools = this.recipeBook.tools
            .split(",")
            .map((tool) => tool.trim())
            .filter((tool) => tool !== "");
        const recipeTools = this.tools
            .split(",")
            .map((tool) => tool.trim())
            .filter((tool) => tool !== "");
        const toolsToCheck = bookTools.concat(recipeTools);
        return toolsToCheck;
    }

    hasTool(actor) {
        if (!this._tools.length) return true;
        return this._tools.some((tool) => actor.items.getName(tool) !== undefined);
    }

    hasComponent(name) {
        return this.ingredients.some((ingredient) => ingredient.hasComponent(name));
    }

    hasProduct(name) {
        return this.products.some((product) => product.hasComponent(name));
    }

    getIngredient(id) {
        return this.ingredients.find((ingredient) => ingredient.id == id);
    }

    getProduct(id) {
        return this.products.find((product) => product.id == id);
    }

    async loadDocuments() {
        for (let ingredient of this.ingredients) {
            await ingredient.getComponents();
        }
        for (let product of this.products) {
            await product.getComponents();
        }
    }

    async update(data) {
        for (let key in data) {
            this[key] = data[key];
        }
        await this.recipeBook.saveData();
    }

    async addComponent(ingredientId, uuid, name) {
        const ingredient = this.ingredients.find((ingredient) => ingredient.id == ingredientId) ?? new Ingredient({ recipe: this });
        ingredient.addComponent(uuid, name);
        if (!ingredientId) this.ingredients.push(ingredient);
        await this.recipeBook.saveData();
    }

    async updateComponentQuantity(ingredientId, componentId, quantity) {
        const ingredient = this.ingredients.find((ingredient) => ingredient.id == ingredientId);
        ingredient.setQuantity(componentId, quantity);
        await this.recipeBook.saveData();
    }

    async removeComponent(ingredientId, componentId) {
        const ingredient = this.ingredients.find((ingredient) => ingredient.id == ingredientId);
        ingredient.removeComponent(componentId);
        if (ingredient.components.length == 0) {
            this.ingredients = this.ingredients.filter((ingredient) => ingredient.id !== ingredientId);
        }
        await this.recipeBook.saveData();
    }

    async addProduct(productId, uuid, name) {
        const product = this.products.find((product) => product.id == productId) ?? new Product({ recipe: this });
        product.addComponent(uuid, name);
        if (!productId) this.products.push(product);
        await this.recipeBook.saveData();
    }

    async updateProductQuantity(productId, componentId, quantity) {
        const product = this.products.find((product) => product.id == productId);
        product.setQuantity(componentId, quantity);
        await this.recipeBook.saveData();
    }

    async removeProduct(productId, componentId) {
        const product = this.products.find((product) => product.id == productId);
        product.removeComponent(componentId);
        if (product.components.length == 0) {
            this.products = this.products.filter((product) => product.id !== productId);
        }
        await this.recipeBook.saveData();
    }

    async delete() {
        Dialog.confirm({
            title: game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.delete-recipe-title`),
            content: game.i18n.localize(`${MASTERCRAFTED_CONST.MODULE_ID}.UI.delete-recipe-content`),
            yes: () => {
                this.recipeBook.recipes = this.recipeBook.recipes.filter((recipe) => recipe.id !== this.id);
                this.recipeBook.saveData();
            },
            defaultYes: false,
        });
    }

    async duplicate() {
        const recipe = new Recipe({ ...this.toObject(), recipeBook: this.recipeBook });
        recipe.id = foundry.utils.randomID();
        this.recipeBook.recipes.push(recipe);
        await this.recipeBook.saveData();
    }

    toObject() {
        return {
            id: this.id,
            name: this.name,
            time: this.time,
            macroName: this.macroName,
            ingredientsInspection: this.ingredientsInspection,
            productInspection: this.productInspection,
            description: this.description,
            tools: this.tools,
            ingredients: this.ingredients.map((ingredient) => ingredient.toObject()),
            products: this.products.map((product) => product.toObject()),
            img: this.img,
            sound: this.sound,
            ownership: this.ownership,
        };
    }

    export() {
        let data = this.toObject();
        data = cleanIdsRecursive(data);
        data.documentName = this.documentName;
        saveDataToFile(JSON.stringify(data, null, 2), "text/json", `mastercrafted-${this.documentName}-${this.name.slugify()}.json`);
    }

    async import() {
        new Dialog(
            {
                title: `Import Data: ${this.name}`,
                content: await renderTemplate("templates/apps/import-data.hbs", {
                    hint1: game.i18n.format("DOCUMENT.ImportDataHint1", { document: this.documentName }),
                    hint2: game.i18n.format("DOCUMENT.ImportDataHint2", { name: this.name }),
                }),
                buttons: {
                    import: {
                        icon: '<i class="fas fa-file-import"></i>',
                        label: "Import",
                        callback: (html) => {
                            const form = html.find("form")[0];
                            if (!form.data.files.length) return ui.notifications.error("You did not upload a data file!");
                            readTextFromFile(form.data.files[0]).then((json) => this.importFromJSON(json));
                        },
                    },
                    no: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                    },
                },
                default: "import",
            },
            {
                width: 400,
            },
        ).render(true);
    }

    async importFromJSON(json) {
        let data = JSON.parse(json);
        if (!data.documentName === this.documentName) return ui.notifications.error("This is not a valid recipe data file!");
        const recipe = new Recipe({ ...data, id: this.id, recipeBook: this.recipeBook });
        this.update(recipe);
    }
}
